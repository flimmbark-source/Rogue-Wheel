// src/game/values.ts
import { Card, SplitChoiceMap } from "./types";

export const isSplit = (
  c: Card | null | undefined
): c is Card & { type: "split"; leftValue: number; rightValue: number } =>
  !!c && c.type === "split" && typeof c.leftValue === "number" && typeof c.rightValue === "number";

export const isNormal = (
  c: Card | null | undefined
): c is Card & { type?: "normal"; number: number } =>
  !!c && ((c.type ?? "normal") === "normal") && typeof c.number === "number";

// Value used by step math (raw negatives allowed)
export function effectiveValue(c: Card | null | undefined, split: SplitChoiceMap): number {
  if (!c) return 0;
  if (isNormal(c)) return c.number;
  if (isSplit(c)) {
    const face = split[c.id];
    return face === "right" ? c.rightValue : c.leftValue;
  }
  return 0;
}

// UI helper: true minus sign
export const fmtNum = (n: number) => (n < 0 ? `−${Math.abs(n)}` : String(n));
