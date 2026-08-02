// Spaced-repetition scheduling for opening lines (SM-2-lite).
import { epochDay } from './util.js';

export const INTERVALS = [1, 3, 7, 16, 35, 75, 150];

// entry: {idx, due, reps, lapses, learned}
export function initEntry() {
  return { idx: 0, due: epochDay() + INTERVALS[0], reps: 0, lapses: 0, learned: Date.now() };
}

export function applyReview(entry, pass) {
  const e = { ...entry };
  e.reps = (e.reps || 0) + 1;
  if (pass) {
    e.idx = Math.min((e.idx || 0) + 1, INTERVALS.length - 1);
  } else {
    e.lapses = (e.lapses || 0) + 1;
    e.idx = 0;
  }
  e.due = epochDay() + INTERVALS[e.idx];
  return e;
}

export function isDue(entry) {
  return entry && entry.due != null && epochDay() >= entry.due;
}

export function dueLines(linesState, allLineIds) {
  return allLineIds.filter((id) => isDue(linesState[id]));
}

export function dueInDays(entry) {
  if (!entry || entry.due == null) return null;
  return entry.due - epochDay();
}
