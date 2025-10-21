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
  rng: () => number = Math.random,
  options: { easyMode?: boolean } = {}
): Section[] {
  const easyMode = options.easyMode === true;
  const kinds: VC[] = shuffle([
    "Strongest",
    "Weakest",
    "ReserveSum",
    "ClosestToTarget",
    "Initiative",
  ], rng);

  const lens = (() => {
    if (easyMode) {
      const total = SLICES - 1;
      const candidate = [3, 2, 1].find((count) => count <= kinds.length && total % count === 0) ?? 1;
      const count = Math.max(1, candidate);
      const segmentLength = total / count;
      return new Array(count).fill(segmentLength);
    }

    if (archetype === "bandit") return shuffle([5, 4, 3, 2, 1], rng);
    if (archetype === "sorcerer") return shuffle([5, 5, 2, 2, 1], rng);
    return shuffle([6, 3, 3, 2, 1], rng);
  })();

  let start = 1;
  const sections: Section[] = [];
  const segmentCount = easyMode ? lens.length : kinds.length;
  for (let i = 0; i < segmentCount; i++) {
    const id = kinds[i];
    const len = lens[i];
    if (typeof id === "undefined" || typeof len !== "number") continue;
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
