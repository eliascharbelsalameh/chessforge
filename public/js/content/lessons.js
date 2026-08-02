// Lesson curriculum aggregator + track metadata.
import { BASICS } from './lessons-basics.js';
import { ADVANCED } from './lessons-advanced.js';

export const TRACKS = [
  { id: 'fundamentals', name: 'Fundamentals', icon: '♟', blurb: 'Rules edge-cases, values, principles — the ground floor.' },
  { id: 'tactics', name: 'Tactics', icon: '⚡', blurb: 'Forks to zwischenzugs: the patterns that win material.' },
  { id: 'mates', name: 'Checkmate patterns', icon: '☠', blurb: 'The classic mating machines, from ladder to Greek gift.' },
  { id: 'strategy', name: 'Strategy', icon: '🧭', blurb: 'Structures, squares, files and plans — chess between tactics.' },
  { id: 'endgames-theory', name: 'Endgame principles', icon: '🏁', blurb: 'The ideas behind the drills: opposition, passers, rook rules.' },
];

export const LESSONS = [...BASICS, ...ADVANCED];

export function lessonsByTrack(trackId) {
  return LESSONS.filter((l) => l.track === trackId);
}

export function findLesson(id) {
  return LESSONS.find((l) => l.id === id);
}

export function nextLesson(id) {
  const i = LESSONS.findIndex((l) => l.id === id);
  return i >= 0 && i + 1 < LESSONS.length ? LESSONS[i + 1] : null;
}
