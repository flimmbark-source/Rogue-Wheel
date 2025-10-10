import type { Card } from "./types.js";

export type AbilityKind =
  | "swapReserve"
  | "rerollReserve"
  | "boostCard"
  | "reserveBoost";

export const SKILL_ABILITY_LABELS: Record<AbilityKind, string> = {
  swapReserve: "Swap Reserve",
  rerollReserve: "Reroll Reserve",
  boostCard: "Boost Card",
  reserveBoost: "Reserve Boost",
};

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

  if (card.reserveExhausted) {
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

  if (card.reserveExhausted) {
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
  swapReserve: () => "Select a reserve card to swap into a lane.",
  rerollReserve: () => "Select a reserve card to discard and draw a replacement.",
  boostCard: (card) => {
    const current = getCurrentSkillCardValue(card ?? ({} as Card));
    const value = Math.abs(
      current !== undefined
        ? current
        : getSkillCardValue(card ?? ({} as Card)),
    );
    return `Select a friendly lane to add ${value}.`;
  },
  reserveBoost: (card) => {
    const value = getReserveBoostValue(card ?? ({} as Card));
    return value > 0
      ? `Select a positive reserve card to exhaust and boost a friendly lane by ${value}.`
      : "-";
  },
};

export function describeSkillAbility(kind: AbilityKind, card?: Card): string {
  const describe = ABILITY_DESCRIPTIONS[kind];
  return describe ? describe(card) : "";
}
