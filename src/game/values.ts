// src/game/values.ts
import {
  ActivationAbility,
  Card,
  CardBehavior,
  CardSplitFace,
  ReserveBehavior,
  SplitChoiceMap,
  SplitFaceId,
} from "./types";

const SPLIT_FACE_ORDER: SplitFaceId[] = ["left", "right"];

export const isSplit = (
  c: Card | null | undefined,
): c is Card & { type: "split"; split: NonNullable<Card["split"]> } =>
  !!c && c.type === "split" && !!c.split;

export const getCardBehavior = (
  card: Card | null | undefined,
): CardBehavior | null => {
  if (!card) return null;
  return card.behavior ?? null;
};

export const isNormal = (
  c: Card | null | undefined,
): c is Card & { type?: "normal"; number: number } =>
  !!c && ((c.type ?? "normal") === "normal") && typeof c.number === "number";

export const getSplitFaces = (card: Card): CardSplitFace[] => {
  if (!isSplit(card)) return [];
  return SPLIT_FACE_ORDER.map((id) => card.split.faces[id]).filter(Boolean);
};

export const getSplitFace = (card: Card, faceId?: SplitFaceId): CardSplitFace | undefined => {
  if (!isSplit(card)) return undefined;
  if (!faceId) return undefined;
  return card.split.faces[faceId];
};

const highestValueFace = (card: Card): CardSplitFace | undefined => {
  return getSplitFaces(card).reduce<CardSplitFace | undefined>((best, face) => {
    if (!best) return face;
    return face.value > best.value ? face : best;
  }, undefined);
};

const resolveSplitFace = (
  card: Card,
  choice?: SplitFaceId,
): CardSplitFace | undefined => {
  if (!isSplit(card)) return undefined;
  if (choice) {
    const chosen = getSplitFace(card, choice);
    if (chosen) return chosen;
  }
  if (card.split?.defaultFace) {
    const defaultFace = getSplitFace(card, card.split.defaultFace);
    if (defaultFace) return defaultFace;
  }
  return highestValueFace(card);
};

const collectAbilities = (
  card: Card,
  face?: CardSplitFace | null,
): ActivationAbility[] => {
  const fromCard = card.activation ?? [];
  const fromFace = face?.activation ?? [];
  return [...fromCard, ...fromFace];
};

const applyValueEffects = (
  base: number,
  abilities: ActivationAbility[],
  timing: "onPlay" | "reserve",
): number => {
  let value = base;
  for (const ability of abilities) {
    if (ability.timing !== timing && ability.timing !== "passive") continue;
    for (const effect of ability.effects) {
      if (effect.type === "selfValue" && timing === "onPlay") {
        value += effect.amount;
      } else if (effect.type === "reserveBonus" && timing === "reserve") {
        value += effect.amount;
      } else if (effect.type === "reserveMultiplier" && timing === "reserve") {
        value = Math.round(value * effect.multiplier);
      } else if (effect.type === "opponentValue" && timing === "onPlay") {
        value += effect.amount;
      }
    }
  }
  return value;
};

const baseReserveValue = (card: Card, behavior?: ReserveBehavior): { value: number; face?: CardSplitFace } => {
  if (isNormal(card)) {
    return { value: card.number, face: undefined };
  }
  if (isSplit(card)) {
    const face = resolveSplitFace(card, behavior?.preferredFace);
    return { value: face?.value ?? 0, face: face ?? undefined };
  }
  return { value: 0, face: undefined };
};

// Value used by step math (raw negatives allowed)
export function getCardPlayValue(
  c: Card | null | undefined,
  split: SplitChoiceMap = {},
): number {
  if (!c) return 0;
  if (isNormal(c)) {
    return applyValueEffects(c.number, collectAbilities(c), "onPlay");
  }
  if (isSplit(c)) {
    const face = resolveSplitFace(c, split[c.id]);
    const base = face?.value ?? 0;
    return applyValueEffects(base, collectAbilities(c, face ?? null), "onPlay");
  }
  return 0;
}

// Back-compat export
export function effectiveValue(c: Card | null | undefined, split: SplitChoiceMap = {}): number {
  return getCardPlayValue(c, split);
}

export function getCardReserveValue(c: Card | null | undefined): number {
  if (!c) return 0;
  const behavior = c.reserve;
  const { value: base, face } = baseReserveValue(c, behavior);

  let adjusted = base;
  if (behavior) {
    switch (behavior.type) {
      case "fixed":
        adjusted = behavior.value;
        break;
      case "bonus":
        adjusted = base + behavior.amount;
        break;
      case "multiplier":
        adjusted = Math.round(base * behavior.multiplier);
        break;
      default:
        adjusted = base;
        break;
    }
  }

  return applyValueEffects(adjusted, collectAbilities(c, face ?? null), "reserve");
}

// UI helper: true minus sign
export const fmtNum = (n: number) => (n < 0 ? `−${Math.abs(n)}` : String(n));
