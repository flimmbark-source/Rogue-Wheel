import type { Card } from "./types";
import { fmtNum, isNormal } from "./values";

export type SkillAbility = "swapReserve" | "rerollReserve" | "boostSelf" | "reserveBoost";

export function determineSkillAbility(card: Card | null): SkillAbility | null {
  if (!card) return null;
  if (!isNormal(card)) return null;
  const value = typeof card.number === "number" ? card.number : null;
  if (value === null) return null;
  if (value <= 0) return "swapReserve";
  if (value === 1 || value === 2) return "rerollReserve";
  if (value === 3 || value === 4) return "boostSelf";
  return "reserveBoost";
}

export function describeSkillAbility(ability: SkillAbility, card: Card): string {
  const value = typeof card.number === "number" ? fmtNum(card.number) : "0";
  switch (ability) {
    case "swapReserve":
      return "Swap this card with one from your reserve.";
    case "rerollReserve":
      return "Discard your reserve cards and draw replacements.";
    case "boostSelf":
      return `Add ${value} to a card in play.`;
    case "reserveBoost":
      return "Exhaust a reserve card to add its value to a card in play.";
    default:
      return "Activate skill.";
  }
}

export const SKILL_ABILITY_COLORS: Record<SkillAbility, string> = {
  swapReserve: "text-amber-300",
  rerollReserve: "text-sky-300",
  boostSelf: "text-rose-300",
  reserveBoost: "text-emerald-300",
};

export function getSkillAbilityColorClass(card: Card | null): string | null {
  const ability = determineSkillAbility(card);
  return ability ? SKILL_ABILITY_COLORS[ability] : null;
}
