import { getCardPlayValue } from "../values";
import type { Card } from "../types";

export type ActivationAdjustment = { type: "split" | "boost" };
export type ActivationAdjustmentsMap = Record<string, ActivationAdjustment | undefined>;
export type ActivationSwapPairs = Array<[string, string]>;

export function computeAdjustedCardValue(
  card: Card | null | undefined,
  adjustments: ActivationAdjustmentsMap,
): number {
  if (!card) return 0;
  const base = getCardPlayValue(card);
  const modifier = adjustments[card.id];
  if (!modifier) return base;
  switch (modifier.type) {
    case "split":
      return Math.trunc(base / 2);
    case "boost":
      return base * 2;
    default:
      return base;
  }
}

export function computeEffectiveCardValues(
  cards: Iterable<Card | null | undefined>,
  adjustments: ActivationAdjustmentsMap,
  swapPairs: ActivationSwapPairs,
): Map<string, number> {
  const values = new Map<string, number>();

  for (const card of cards) {
    if (!card) continue;
    values.set(card.id, computeAdjustedCardValue(card, adjustments));
  }

  for (const [a, b] of swapPairs) {
    if (!values.has(a) || !values.has(b)) continue;
    const aVal = values.get(a) ?? 0;
    const bVal = values.get(b) ?? 0;
    values.set(a, bVal);
    values.set(b, aVal);
  }

  return values;
}

export function buildSwapPartnerMap(
  swapPairs: ActivationSwapPairs,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const [a, b] of swapPairs) {
    map.set(a, b);
    map.set(b, a);
  }
  return map;
}
