// src/game/wheel.ts
import { SLICES, VC, Section } from "./types";

export const VC_META: Record<
  VC,
  { icon: string; color: string; short: string; explain: string }
> = {
  Strongest: { icon: "💥", color: "#f43f5e", short: "STR", explain: "Higher value wins." },
  Weakest: { icon: "🦊", color: "#10b981", short: "WEAK", explain: "Lower value wins." },
  ReserveSum: { icon: "🗃️", color: "#0ea5e9", short: "RES", explain: "Compare sums of the two cards left in hand." },
  ClosestToTarget: { icon: "🎯", color: "#f59e0b", short: "CL", explain: "Value closest to target wins." },
  Initiative: { icon: "⚑", color: "#a78bfa", short: "INIT", explain: "Initiative holder wins." },
};

import { shuffle } from "./math";

export function genWheelSections(
  archetype: "bandit" | "sorcerer" | "beast" = "bandit",
  rng: () => number = Math.random
): Section[] {
  const lens = (() => {
    if (archetype === "bandit") return shuffle([5, 4, 3, 2, 1], rng);
    if (archetype === "sorcerer") return shuffle([5, 5, 2, 2, 1], rng);
    return shuffle([6, 3, 3, 2, 1], rng);
  })();
  const kinds: VC[] = shuffle([
    "Strongest",
    "Weakest",
    "ReserveSum",
    "ClosestToTarget",
    "Initiative",
  ], rng);
  let start = 1;
  const sections: Section[] = [];
  for (let i = 0; i < kinds.length; i++) {
    const id = kinds[i];
    const len = lens[i];
    const end = (start + len - 1) % SLICES;
    sections.push({
      id,
      color: VC_META[id].color,
      start,
      end,
      target: id === "ClosestToTarget" ? Math.floor(rng() * 16) : undefined,
    });
    start = (start + len) % SLICES;
  }
  return sections;
}
