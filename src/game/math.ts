// src/game/math.ts
import { Section } from "./types";

export const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export function inSection(index: number, s: Section) {
  if (index === 0) return false;
  if (s.start <= s.end) return index >= s.start && index <= s.end;
  return index >= s.start || index <= s.end;
}

export function polar(cx: number, cy: number, r: number, aDeg: number) {
  const a = (aDeg - 90) * (Math.PI / 180);
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
