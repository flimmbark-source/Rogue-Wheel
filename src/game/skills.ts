import type { Card, LegacySide } from "./types.js";

export type AbilityKind =
  | "swapReserve"
  | "rerollReserve"
  | "boostCard"
  | "reserveBoost";

export type SkillTargetKind = "board" | "reserve";

export type SkillTargetOwnership = "ally" | "enemy" | "any";

export type SkillTargetStageDefinition = {
  kind: SkillTargetKind;
  ownership: SkillTargetOwnership;
  allowSelf?: boolean;
  label?: string;
};

type SkillTargetStageConfig = SkillTargetStageDefinition & { count?: number };

export type SkillTargetSelection =
  | { kind: "board"; side: LegacySide; lane: number; card: Card }
  | { kind: "reserve"; side: LegacySide; index: number; card: Card };

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

export function deriveAbilityForCard(printed: number): AbilityKind {
  if (printed >= 5) {
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
  swapReserve: () => "Swap this card with one from your reserve.",
  rerollReserve: () => "Discard a reserve card and draw a new one.",
  boostCard: (card) => {
    const value = Math.abs(getSkillCardValue(card ?? ({} as Card)));
    return `Add ${value} to a card in play.`;
  },
  reserveBoost: (card) => {
    const value = getReserveBoostValue(card ?? ({} as Card));
    return value > 0
      ? `Consume a reserve worth ${value} to boost this lane.`
      : "Consume a positive reserve to boost this lane.";
  },
};

export function describeSkillAbility(kind: AbilityKind, card?: Card): string {
  const describe = ABILITY_DESCRIPTIONS[kind];
  return describe ? describe(card) : "";
}

const SKILL_TARGET_STAGE_CONFIG: Record<AbilityKind, SkillTargetStageConfig[]> = {
  swapReserve: [
    {
      kind: "reserve",
      ownership: "ally",
      label: "a reserve card to swap",
    },
  ],
  rerollReserve: [
    {
      kind: "reserve",
      ownership: "ally",
      label: "a reserve card to reroll",
    },
  ],
  boostCard: [
    {
      kind: "board",
      ownership: "ally",
      label: "a friendly card to boost",
    },
  ],
  reserveBoost: [
    {
      kind: "reserve",
      ownership: "ally",
      label: "a reserve card to consume",
    },
  ],
};

export function getSkillAbilityTargetStages(kind: AbilityKind): SkillTargetStageDefinition[] {
  const config = SKILL_TARGET_STAGE_CONFIG[kind] ?? [];
  const stages: SkillTargetStageDefinition[] = [];
  for (const entry of config) {
    const { count = 1, ...definition } = entry;
    const repeats = Number.isInteger(count) && count && count > 0 ? count : 1;
    for (let i = 0; i < repeats; i += 1) {
      stages.push({ ...definition });
    }
  }
  return stages;
}

export function skillAbilityRequiresTargets(kind: AbilityKind): boolean {
  return getSkillAbilityTargetStages(kind).length > 0;
}
