#!/usr/bin/env node
// ChessForge server — zero-dependency static file server + progress-sync API.
// All chess computation (engine included) happens client-side; this only
// serves files and persists a small JSON progress blob for cross-device sync.
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createGzip, gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'userdata');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const PORT = Number(process.env.PORT) || 8420;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_BODY = 8 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.webmanifest', '.txt', '.wasm']);
// vendor libs and generated data change rarely; app code revalidates every load
const LONG_CACHE = /^\/(vendor|data)\//;

const gzCache = new Map(); // path -> {mtimeMs, buf}

async function serveStatic(req, res, urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC + path.sep) && file !== PUBLIC) return send(res, 403, 'forbidden');
  let st;
  try {
    st = await stat(file);
    if (st.isDirectory()) return send(res, 404, 'not found');
  } catch {
    return send(res, 404, 'not found');
  }
  const ext = path.extname(file).toLowerCase();
  const etag = `"${st.size.toString(16)}-${st.mtimeMs.toString(16)}"`;
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    ETag: etag,
    'Cache-Control': LONG_CACHE.test(p) ? 'public, max-age=86400' : 'no-cache',
  };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  const wantsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '') && COMPRESSIBLE.has(ext);
  if (wantsGzip && st.size < 32 * 1024 * 1024) {
    let entry = gzCache.get(file);
    if (!entry || entry.mtimeMs !== st.mtimeMs) {
      entry = { mtimeMs: st.mtimeMs, buf: gzipSync(await readFile(file), { level: 6 }) };
      gzCache.set(file, entry);
    }
    headers['Content-Encoding'] = 'gzip';
    headers['Content-Length'] = entry.buf.length;
    headers.Vary = 'Accept-Encoding';
    res.writeHead(200, headers);
    return res.end(entry.buf);
  }
  headers['Content-Length'] = st.size;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

function send(res, code, body, type = 'text/plain; charset=utf-8') {
  const buf = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(code, { 'Content-Type': typeof body === 'string' ? type : 'application/json; charset=utf-8', 'Content-Length': buf.length });
  res.end(buf);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/health') return send(res, 200, { ok: true, ts: Date.now() });
  if (url.pathname === '/api/state') {
    if (req.method === 'GET') {
      try {
        const raw = await readFile(STATE_FILE, 'utf8');
        return send(res, 200, raw, 'application/json; charset=utf-8');
      } catch {
        return send(res, 200, { ts: 0, state: null });
      }
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      try {
        const body = JSON.parse((await readBody(req)).toString('utf8'));
        if (typeof body !== 'object' || body === null || typeof body.ts !== 'number') {
          return send(res, 400, { error: 'expected {ts, state}' });
        }
        await mkdir(DATA_DIR, { recursive: true });
        const tmp = STATE_FILE + '.tmp';
        await writeFile(tmp, JSON.stringify(body));
        await rename(tmp, STATE_FILE);
        return send(res, 200, { ok: true, ts: body.ts });
      } catch (e) {
        return send(res, 400, { error: String(e.message || e) });
      }
    }
    return send(res, 405, { error: 'method not allowed' });
  }
  return send(res, 404, { error: 'not found' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
    return await serveStatic(req, res, url.pathname);
  } catch (e) {
    console.error(e);
    return send(res, 500, 'internal error');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`ChessForge listening on http://${HOST}:${PORT}`);
});
