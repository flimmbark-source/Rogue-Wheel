import type { Card } from "./types";
import { fmtNum } from "./values.js";

function coerceFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export type SkillAbility = "swapReserve" | "rerollReserve" | "boostCard" | "reserveBoost";

export function getSkillCardValue(card: Card | null | undefined): number | null {
  if (!card) return null;
  const baseValue = coerceFiniteNumber(card.baseNumber);
  if (baseValue !== null) {
    return baseValue;
  }
  const numberValue = coerceFiniteNumber(card.number);
  if (numberValue !== null) {
    return numberValue;
  }
  return null;
}

export function determineSkillAbility(card: Card | null): SkillAbility | null {
  if (!card) return null;
  const baseValue = coerceFiniteNumber(card.baseNumber);
  const value = baseValue ?? getSkillCardValue(card);
  if (value === null) return null;
  if (value <= 0) return "swapReserve";
  if (value === 1 || value === 2) return "rerollReserve";
  if (value === 3 || value === 4) return "boostCard";
  return "reserveBoost";
}

export function isReserveBoostTarget(card: Card | null | undefined): boolean {
  const value = getSkillCardValue(card);
  if (value === null) return false;
  return value > 0;
}

export function describeSkillAbility(ability: SkillAbility, card: Card): string {
  const printedValue =
    coerceFiniteNumber(card.baseNumber) ??
    coerceFiniteNumber(card.number) ??
    0;
  const value = fmtNum(printedValue);
  switch (ability) {
    case "swapReserve":
      return "Swap this card with any reserve card, replacing it on the board.";
    case "rerollReserve":
      return "Discard a reserve card you select and draw a replacement.";
    case "boostCard":
      return `Add ${value} to a card in play.`;
    case "reserveBoost":
      return "Exhaust a reserve card to add its value to a card in play, exhausting it in the process.";
    default:
      return "Activate skill.";
  }
}

export const SKILL_ABILITY_COLORS: Record<SkillAbility, string> = {
  swapReserve: "text-amber-300",
  rerollReserve: "text-sky-300",
  boostCard: "text-rose-300",
  reserveBoost: "text-emerald-300",
};

export const SKILL_ABILITY_COLOR_HEX: Record<SkillAbility, string> = {
  swapReserve: "#fcd34d", // amber-300
  rerollReserve: "#7dd3fc", // sky-300
  boostCard: "#fda4af", // rose-300
  reserveBoost: "#6ee7b7", // emerald-300
};

export function getSkillAbilityColorClass(card: Card | null): string | null {
  const ability = determineSkillAbility(card);
  return ability ? SKILL_ABILITY_COLORS[ability] : null;
}

export function getSkillAbilityColorHex(card: Card | null): string | null {
  const ability = determineSkillAbility(card);
  return ability ? SKILL_ABILITY_COLOR_HEX[ability] : null;
}
