// src/game/wheel.ts
import { SLICES, VC, Section } from "./types";

export type WheelShape = "burst" | "triangle" | "square" | "diamond" | "hex";

export type WheelPaletteMode = "default" | "colorblind";

export const VC_ORDER: readonly VC[] = [
  "Strongest",
  "Weakest",
  "ReserveSum",
  "ClosestToTarget",
  "Initiative",
] as const;

const createRegularPolygonPoints = (
  sides: number,
  radius: number,
  rotationDeg: number
): readonly [number, number][] => {
  const rotation = (rotationDeg * Math.PI) / 180;
  const center = 50;
  const pts: [number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const angle = rotation + (i * 2 * Math.PI) / sides;
    const x = center + Math.cos(angle) * radius;
    const y = center + Math.sin(angle) * radius;
    pts.push([parseFloat(x.toFixed(3)), parseFloat(y.toFixed(3))]);
  }
  return pts;
};

const createStarPoints = (
  points: number,
  outerRadius: number,
  innerRadius: number,
  rotationDeg: number
): readonly [number, number][] => {
  const rotation = (rotationDeg * Math.PI) / 180;
  const center = 50;
  const pts: [number, number][] = [];
  for (let i = 0; i < points * 2; i++) {
    const isOuter = i % 2 === 0;
    const radius = isOuter ? outerRadius : innerRadius;
    const angle = rotation + (i * Math.PI) / points;
    const x = center + Math.cos(angle) * radius;
    const y = center + Math.sin(angle) * radius;
    pts.push([parseFloat(x.toFixed(3)), parseFloat(y.toFixed(3))]);
  }
  return pts;
};

const pointsToPath = (pts: readonly [number, number][]): string =>
  pts.reduce((acc, [x, y], idx) => `${acc}${idx === 0 ? "M" : "L"}${x} ${y} `, "").trimEnd() + " Z";

export const WHEEL_SHAPE_POINTS: Record<WheelShape, readonly [number, number][]> = {
  burst: createStarPoints(5, 44, 20, -90),
  triangle: createRegularPolygonPoints(3, 42, -90),
  square: [
    [18, 18],
    [82, 18],
    [82, 82],
    [18, 82],
  ],
  diamond: createRegularPolygonPoints(4, 44, -45),
  hex: createRegularPolygonPoints(6, 40, -90),
};

export const WHEEL_SHAPE_PATHS: Record<WheelShape, string> = Object.fromEntries(
  (Object.entries(WHEEL_SHAPE_POINTS) as [WheelShape, readonly [number, number][]][]).map(([shape, pts]) => [
    shape,
    pointsToPath(pts),
  ])
) as Record<WheelShape, string>;

export const WHEEL_PALETTES: Record<WheelPaletteMode, Record<VC, string>> = {
  default: {
    Strongest: "#c2410c",
    Weakest: "#0f766e",
    ReserveSum: "#1d4ed8",
    ClosestToTarget: "#9333ea",
    Initiative: "#b91c1c",
  },
  colorblind: {
    Strongest: "#d55e00",
    Weakest: "#0072b2",
    ReserveSum: "#009e73",
    ClosestToTarget: "#e69f00",
    Initiative: "#cc79a7",
  },
};

export const VC_META: Record<
  VC,
  { short: string; explain: string; shape: WheelShape; label: string }
> = {
  Strongest: {
    short: "STR",
    explain: "Higher value wins.",
    shape: "burst",
    label: "Strongest",
  },
  Weakest: {
    short: "WEAK",
    explain: "Lower value wins.",
    shape: "triangle",
    label: "Weakest",
  },
  ReserveSum: {
    short: "RES",
    explain: "Compare sums of the two cards left in hand.",
    shape: "square",
    label: "Reserve",
  },
  ClosestToTarget: {
    short: "CL",
    explain: "Value closest to target wins.",
    shape: "diamond",
    label: "Closest",
  },
  Initiative: {
    short: "INIT",
    explain: "Initiative holder wins.",
    shape: "hex",
    label: "Initiative",
  },
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
    const defaultColor = WHEEL_PALETTES.default[id];
    sections.push({
      id,
      color: defaultColor,
      start,
      end,
      target: id === "ClosestToTarget" ? Math.floor(rng() * 16) : undefined,
    });
    start = (start + len) % SLICES;
  }
  return sections;
}
