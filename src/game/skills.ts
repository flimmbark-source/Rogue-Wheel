import type { Card } from "./types.js";

export type AbilityKind =
  | "swapReserve"
  | "rerollReserve"
  | "boostCard"
  | "reserveBoost";

function sanitizeNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function getSkillCardValue(card: Card): number {
  const base = sanitizeNumber(card.baseNumber);
  if (base !== undefined) {
    return base;
  }

  const current = sanitizeNumber(card.number);
  if (current !== undefined) {
    return current;
  }

  return 0;
}

export function getCurrentSkillCardValue(card: Card): number | undefined {
  return sanitizeNumber(card.number);
}

export function deriveAbilityForCard(printed: number): AbilityKind {
  if (printed >= 6) {
    return "reserveBoost";
  }

  if (printed >= 3) {
    return "boostCard";
  }

  if (printed >= 1) {
    return "rerollReserve";
  }

  return "swapReserve";
}

export function determineSkillAbility(card: Card): AbilityKind {
  const value = getSkillCardValue(card);
  return deriveAbilityForCard(value);
}

function hasNegativeBase(card: Card): boolean {
  const base = sanitizeNumber(card.baseNumber);
  return base !== undefined && base < 0;
}

export function getReserveBoostValue(card: Card): number {
  if (hasNegativeBase(card)) {
    return 0;
  }

  const base = sanitizeNumber(card.baseNumber);
  if (base !== undefined && base > 0) {
    return base;
  }

  const current = sanitizeNumber(card.number);
  if (current !== undefined && current > 0) {
    return current;
  }

  return 0;
}

export function isReserveBoostTarget(card: Card): boolean {
  if (hasNegativeBase(card)) {
    return false;
  }

  const base = sanitizeNumber(card.baseNumber);
  if (base !== undefined && base > 0) {
    return true;
  }

  const current = sanitizeNumber(card.number);
  return current !== undefined && current > 0;
}

const ABILITY_DESCRIPTIONS: Record<AbilityKind, (card?: Card) => string> = {
  swapReserve: () => "Swap a card with one from your reserve.",
  rerollReserve: () =>
    "Discard a reserve card to draw a new one. You may repeat once.",
  boostCard: (card) => {
    const value = Math.abs(getSkillCardValue(card ?? ({} as Card)));
    return `Add ${value} to a card in play.`;
  },
  reserveBoost: (card) => {
    const value = getReserveBoostValue(card ?? ({} as Card));
    return value > 0
      ? `Exhaust a reserve card to boost a card in play.`
      : "-";
  },
};

export function describeSkillAbility(kind: AbilityKind, card?: Card): string {
  const describe = ABILITY_DESCRIPTIONS[kind];
  return describe ? describe(card) : "";
}
