// Endgame course: theory + play-out drills against the engine.
// Every FEN is a standard theoretical position. goal: 'win' = deliver mate,
// 'draw' = reach any draw (stalemate, repetition, 50-move, insufficient).
export const SECTIONS = [
  { id: 'mates', name: 'Basic checkmates', icon: '♛' },
  { id: 'pawns', name: 'Pawn endgames', icon: '♟' },
  { id: 'rooks', name: 'Rook endgames', icon: '♜' },
  { id: 'queens', name: 'Queen endgames', icon: '♕' },
  { id: 'fortress', name: 'Fortresses & draws', icon: '🏰' },
];

export const DRILLS = [
  // ---------- basic mates ----------
  {
    id: 'mate-kq', section: 'mates', title: 'Queen mate', goal: 'win', side: 'white',
    fen: '8/8/8/4k3/8/8/8/4K2Q w - - 0 1',
    theory: `<p>The queen alone cannot mate — she needs the king. Method: <b>the box</b>.</p>
<ol><li>Use the queen to shrink the “box” around the enemy king, moving her a knight’s-move away from him.</li>
<li>When the king is confined to the edge, <b>stop</b> — bring your own king up.</li>
<li>Mate with queen protected by king, or along the edge.</li></ol>
<p><b>Danger:</b> stalemate! When the king sits in the corner, leave him two squares until your king arrives.</p>`,
    hints: ['Place the queen a knight’s move away from the enemy king and copy his moves.',
      'Once the king is stuck on the edge, walk your own king straight up.',
      'Typical mates: queen on the edge square next to the king, protected by your king.'],
  },
  {
    id: 'mate-kr', section: 'mates', title: 'Rook mate', goal: 'win', side: 'white',
    fen: '8/8/8/4k3/8/8/8/R3K3 w - - 0 1',
    theory: `<p>The rook mate is all about <b>the shrinking fence</b> and <b>the waiting move</b>.</p>
<ol><li>The rook cuts the board; your king approaches to guard it.</li>
<li>Shrink the fence rank by rank / file by file.</li>
<li>When kings face each other (opposition) — check! The king must retreat.</li>
<li>If it’s not opposition yet, make a <b>waiting move</b> with the rook along the fence.</li></ol>`,
    hints: ['Keep the rook one rank/file between it and the enemy king — a fence he can’t cross.',
      'March your king up until the kings stand face to face.',
      'Kings in opposition? Check from the side. Not yet? Small waiting move with the rook.'],
  },
  {
    id: 'mate-2b', section: 'mates', title: 'Two-bishop mate', goal: 'win', side: 'white',
    fen: '8/8/8/4k3/8/8/8/2B1KB2 w - - 0 1',
    theory: `<p>Two bishops side by side form a moving wall of two full diagonals.</p>
<ol><li>Line the bishops up (adjacent diagonals) to fence the king toward a corner.</li>
<li>Advance the wall one step at a time, with your king escorting.</li>
<li>The mate happens in (or next to) a corner: one bishop checks, the other and your king cover every escape.</li></ol>
<p>Watch for stalemate as the king runs out of squares — always leave one until ready.</p>`,
    hints: ['Put the bishops on adjacent diagonals — a diagonal wall the king cannot pass.',
      'Escort with your king; push the wall square by square toward a corner.',
      'Final picture: king in corner, your king a knight-move away, bishops checking along the two last diagonals.'],
  },
  {
    id: 'mate-kbn', section: 'mates', title: 'Bishop + knight mate', goal: 'win', side: 'white', challenge: true,
    fen: '8/8/8/4k3/8/8/8/1N2KB2 w - - 0 1',
    theory: `<p>The hardest basic mate — mate only happens in a corner <b>of the bishop’s color</b>.</p>
<ol><li>Drive the king to any edge first.</li>
<li>If he runs to the “wrong” corner, escort him along the edge to the right one using the famous <b>W-maneuver</b> of the knight.</li>
<li>Mate: king confined by your king + knight, bishop delivers along the corner diagonal.</li></ol>
<p>You have 50 moves. Masters need ~30. Good luck!</p>`,
    hints: ['Which corner? Your bishop is light-squared: mate happens on h1 or a8.',
      'The knight zig-zags a “W” along the edge, taking escape squares one by one while king and bishop seal the rest.',
      'Keep all three pieces close; the king does most of the pushing.'],
  },

  // ---------- pawn endgames ----------
  {
    id: 'kpk-win', section: 'pawns', title: 'King + pawn: win with opposition', goal: 'win', side: 'white',
    fen: '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1',
    theory: `<p>The fundamental endgame. Rule one: <b>the king leads, the pawn follows.</b></p>
<ol><li>March your king in front of the pawn (two squares ahead if possible).</li>
<li><b>Opposition</b>: kings facing with one square between — whoever must move, loses ground. Use spare pawn moves to hand the “must move” to Black.</li>
<li>Get your king to the 6th rank in front of the pawn — then it’s always winning.</li>
<li>Promote and finish with the queen mate you know.</li></ol>`,
    hints: ['King first! Ke2–d3/e3–d4/e4 ahead of the pawn.',
      'When kings face off, push the pawn ONE square to pass the move back to Black.',
      'King on e6 with pawn behind = always winning: escort to e8.'],
  },
  {
    id: 'kpk-defend', section: 'pawns', title: 'Defend vs rook pawn', goal: 'draw', side: 'black',
    fen: '8/2k5/8/8/8/P7/8/K7 b - - 0 1',
    theory: `<p>Rook pawns are the great drawers: the defending king only needs to reach <b>the corner</b> (or trap the attacking king in front of its own pawn).</p>
<ol><li>Run to a8 — nothing can evict you from b7/a8/b8.</li>
<li>When the pawn arrives at a7 with your king on a8… any White king approach is <b>stalemate</b>.</li></ol>`,
    hints: ['Head straight for b7, then shuffle between a8/b7/b8.',
      'You cannot be zugzwanged: the corner squares repeat forever.',
      'If White’s king blocks his own pawn on a7/a8 — also a draw. The corner is a fortress.'],
  },
  {
    id: 'k2p', section: 'pawns', title: 'Two connected pawns', goal: 'win', side: 'white',
    fen: '8/8/8/4k3/8/8/3PP3/4K3 w - - 0 1',
    theory: `<p>Two connected pawns win easily — <b>if you never rush</b>.</p>
<ol><li>Advance them together like soldiers: the rear pawn always guards the front one.</li>
<li>The king escorts from the side.</li><li>One pawn will eventually cost the enemy king his position; the other promotes. Avoid stalemate at the end.</li></ol>`,
    hints: ['Never push one pawn two ranks ahead of its brother.',
      'If the king blockades, bring your king around to break the blockade.',
      'You can even sacrifice one pawn to promote the other — count carefully.'],
  },
  {
    id: 'outside-passer', section: 'pawns', title: 'The outside passed pawn', goal: 'win', side: 'white',
    fen: '8/5p2/5k2/8/P4K2/8/5P2/8 w - - 0 1',
    theory: `<p>The outside passed pawn is a <b>decoy</b>, not a hero. It wins by dying far from the main battle.</p>
<ol><li>Push the a-pawn. Black’s king must chase it (yours is closer to the real battlefield).</li>
<li>While he’s away, your king invades and eats the kingside.</li>
<li>Your remaining pawn promotes with the king’s escort (you know this ending now!).</li></ol>`,
    hints: ['Push the a-pawn and make the enemy king walk west.',
      'The moment his king leaves range, run at f7 — count the moves, you arrive first.',
      'After winning f7, it’s the K+P win you already mastered.'],
  },
  {
    id: 'breakthrough', section: 'pawns', title: 'The breakthrough', goal: 'win', side: 'white',
    fen: '8/ppp5/8/PPP5/8/8/8/4K2k w - - 0 1',
    theory: `<p>Three pawns face three pawns — and White wins by force with a famous sacrifice cascade. The kings are spectators: <b>calculate before you push!</b></p>
<p>Idea: sacrifice two pawns to clear the road for the third. The first move is the middle pawn.</p>`,
    hints: ['Start with the CENTER pawn of the trio: b6!',
      'After 1.b6 axb6 comes 2.c6! bxc6 3.a6! — and mirrored: 1…cxb6 2.a6! bxa6 3.c6!',
      'The surviving pawn queens in three moves; the black king is nine moves away.'],
  },

  // ---------- rook endgames ----------
  {
    id: 'lucena', section: 'rooks', title: 'The Lucena position', goal: 'win', side: 'white',
    fen: '3K4/3P1k2/8/8/8/8/r7/4R3 w - - 0 1',
    theory: `<p>THE most important rook endgame: pawn on the 7th, your king in front of it, enemy king cut off. Winning method: <b>building the bridge</b>.</p>
<ol><li>Push the enemy king one file further: <b>Rf1+</b>.</li>
<li>Prepare the bridge: <b>Rf4!</b> (the mysterious rook move).</li>
<li>King steps out — Black checks — you walk down: Kc7, Kb6, Kc6, Kb5…</li>
<li>When checks continue, <b>Rb4!</b> blocks — the bridge is built, the pawn promotes.</li></ol>`,
    hints: ['First: Rf1+ to shove the defending king one more file away.',
      'The key move is Rf4!! — it looks pointless, but the rook will shield your king on the 4th rank.',
      'March: Kc7–b6 meeting checks; when the rook checks from behind, block with Rb4.'],
  },
  {
    id: 'philidor', section: 'rooks', title: 'The Philidor defense', goal: 'draw', side: 'black',
    fen: '4k3/R7/1r6/4K3/4P3/8/8/8 b - - 0 1',
    theory: `<p>The defensive twin of the Lucena. Down a pawn in a rook ending? Philidor saves you.</p>
<ol><li>Park your rook on your <b>third rank</b> (here: the 6th) — White’s king can never advance past the fence.</li>
<li>Wait. Shuffle the rook along the rank.</li>
<li>The moment the pawn steps onto the 6th: <b>drop your rook to the 1st rank</b> and check from behind forever. The king has no shelter — draw.</li></ol>`,
    hints: ['Keep the rook gliding along YOUR third rank (b6–h6) as long as the pawn hasn’t crossed.',
      'Never let your king get pushed off the promotion square’s file area.',
      'Pawn to e6? Instantly Rb1! and endless checks from behind — the pawn itself blocks the king’s shelter.'],
  },

  // ---------- queen endgames ----------
  {
    id: 'qvp-win', section: 'queens', title: 'Queen vs 7th-rank pawn', goal: 'win', side: 'white',
    fen: 'Q7/8/8/1K6/8/8/4pk2/8 w - - 0 1',
    theory: `<p>A queen beats a pawn one step from promotion — with the right dance (works for center and knight pawns).</p>
<ol><li>Approach with checks / pins, forcing the enemy king <b>in front of its own pawn</b>.</li>
<li>That buys one tempo — step your king closer.</li>
<li>Repeat. Each cycle your king gains a square, until it joins the attack and wins the pawn or mates.</li></ol>`,
    hints: ['Check from behind and the side until the king must block its own pawn on e1.',
      'Every time the king stands on e1 (pawn frozen), play a king move — that’s the gained tempo.',
      'When your king reaches the third rank, mate ideas appear everywhere.'],
  },
  {
    id: 'qvp-cdraw', section: 'queens', title: 'The c-pawn miracle draw', goal: 'draw', side: 'black', challenge: true,
    fen: '7K/6Q1/8/8/8/8/2p5/1k6 b - - 0 1',
    theory: `<p>Bishop-pawns (and rook-pawns) on the 7th DRAW against a queen when the attacking king is far. The trick is glorious:</p>
<ol><li>Keep the king next to the pawn, threatening to promote.</li>
<li>When the queen pins or approaches… step into the corner: <b>Ka1!</b></li>
<li>Now Qxc2 is <b>stalemate</b>. White can never gain the tempo needed to bring his king. Shuffle forever.</li></ol>`,
    hints: ['Threaten c1=Q every move you can.',
      'When the queen hits c2 or pins the pawn — Ka1! is always the resource.',
      'If White never takes the pawn, just repeat: Kb1–a1–b2 as legal. The 50-move rule is your friend.'],
  },
  {
    id: 'kqkr', section: 'queens', title: 'Queen vs rook', goal: 'win', side: 'white', challenge: true,
    fen: '8/1r6/8/5Q2/8/8/1k3K2/8 w - - 0 1',
    theory: `<p>Queen vs rook is a real test — masters have failed it. Core plan:</p>
<ol><li>Drive the enemy king toward an edge with checks and cut-offs.</li>
<li>Force the rook away from its king (they must separate eventually — <b>zugzwang</b>).</li>
<li>A separated rook falls to a fork within a few checks.</li></ol>
<p>Beware perpetual-check tricks against YOUR king, and stalemates.</p>`,
    hints: ['Centralize the queen where it eyes both king and rook.',
      'Use checks to walk the king to the board’s edge; approach with your own king.',
      'When the rook hugs its king, triangulate — pass the move — and zugzwang breaks the bond.'],
  },

  // ---------- fortresses ----------
  {
    id: 'wrong-bishop', section: 'fortress', title: 'The wrong bishop', goal: 'draw', side: 'black',
    fen: '2k5/8/8/P1K5/8/8/3B4/8 b - - 0 1',
    theory: `<p>Bishop + rook-pawn is a DRAW when the bishop doesn’t control the promotion corner and the defending king reaches it. a8 is a light square; White’s bishop lives on dark squares — it can never evict you.</p>
<ol><li>Sprint to the corner: b7, then a8/b8/b7 forever.</li>
<li>White’s only winning attempt walks into <b>stalemate</b>.</li></ol>`,
    hints: ['Kb7 immediately — nothing can stop you reaching the corner.',
      'The dark-squared bishop can never attack a8 or b7’s escape loop. Shuffle calmly.',
      'Careful only of leaving the corner zone — never step past the c-file.'],
  },
  {
    id: 'ocb-fortress', section: 'fortress', title: 'Opposite bishops: the blockade', goal: 'draw', side: 'black',
    fen: '3b1k2/8/4P3/5PK1/2B5/8/8/8 b - - 0 1',
    theory: `<p>Two pawns down — completely lost? Not with opposite-colored bishops! The pawns must cross <b>dark squares</b> (e7, f6) and White’s light bishop can never fight for them.</p>
<ol><li>Your bishop alone covers both e7 and f6 from d8 (one diagonal!).</li>
<li>Keep the king on f8/g7 area, bishop on the d8–h4 diagonal.</li>
<li>White has zero ways to make progress. This is a <b>fortress</b> — repeat moves and claim the draw.</li></ol>`,
    hints: ['The d8–h4 diagonal covers BOTH blockade squares e7 and f6 — keep the bishop on it.',
      'King stays on f8 (or g7 when safe). Do nothing — gloriously.',
      'If e7+ Bxe7 f6: take with the bishop and hold; even sac endings are dead draws here.'],
  },
];

export function drillsBySection() {
  const map = new Map(SECTIONS.map((s) => [s.id, { ...s, drills: [] }]));
  for (const d of DRILLS) map.get(d.section).drills.push(d);
  return [...map.values()];
}

export function findDrill(id) { return DRILLS.find((d) => d.id === id); }
