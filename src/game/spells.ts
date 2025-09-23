// game/spells.ts (merged)

import type { Fighter, Phase } from "./types";
import {
  ARCHETYPE_DEFINITIONS,
  type ArchetypeId as SpellArchetype,
  type SpellId, // single source of truth for IDs (camelCase)
} from "./archetypes";

export type SpellTargetOwnership = "ally" | "enemy" | "any";

export type SpellTargetDefinition =
  | { type: "none" }
  | { type: "self"; automatic?: boolean }
  | { type: "card"; ownership: SpellTargetOwnership; automatic?: boolean }
  | { type: "wheel"; scope: "current" | "any" };

export function getSpellDefinitions(ids: SpellId[]): SpellDefinition[] {
  return ids
    .map((id) => getSpellById(id))
    .filter((s): s is SpellDefinition => Boolean(s));
}

export type SpellTargetInstance =
  | { type: "none" }
  | { type: "self" }
  | { type: "card"; cardId: string; owner: SpellTargetOwnership; cardName?: string }
  | { type: "wheel"; wheelId: string; label?: string };

export type SpellRuntimeState = Record<string, unknown> & { log?: string[] };

export type SpellResolverContext = {
  caster: Fighter;
  opponent: Fighter;
  phase: Phase;
  target?: SpellTargetInstance;
  state: SpellRuntimeState;
};

export type SpellResolver = (context: SpellResolverContext) => void;

export type SpellDefinition = {
  id: SpellId;
  name: string;
  description: string;
  cost: number;
  /**
   * Optional hook for spells whose mana cost can shift based on battle state.
   * When omitted the static {@link cost} should be used.
   */
  variableCost?: (context: SpellResolverContext) => number;
  target: SpellTargetDefinition;
  resolver: SpellResolver;
  icon?: string;
  allowedPhases?: Phase[];
};

// ---------- helpers for registry ----------
const ensureLog = (context: SpellResolverContext) => {
  if (!Array.isArray(context.state.log)) context.state.log = [];
  return context.state.log!;
};

const describeTarget = (target?: SpellTargetInstance): string => {
  if (!target) return "the void";
  switch (target.type) {
    case "card":
      return target.cardName ?? `card ${target.cardId}`;
    case "wheel":
      return target.label ?? `wheel ${target.wheelId}`;
    case "self":
      return "the caster";
    default:
      return "the field";
  }
};

// ---------- registry (IDs MUST match archetypes SpellId union: camelCase) ----------
const SPELL_REGISTRY: Record<SpellId, SpellDefinition> = {
  fireball: {
    id: "fireball",
    name: "Fireball",
    description: "Blast an enemy card. Each cast costs 1 more mana this combat.",
    cost: 2,
    variableCost: (context) => {
      const streak = (context.state.fireballStreak as number | undefined) ?? 0;
      return context.state.fireballBaseCost === undefined
        ? 2 + streak
        : Number(context.state.fireballBaseCost);
    },
    icon: "🔥",
    allowedPhases: ["choose", "showEnemy"],
    target: { type: "card", ownership: "enemy" },
    resolver: (context) => {
      const log = ensureLog(context);
      log.push(`${context.caster.name} scorches ${describeTarget(context.target)} with a Fireball.`);
      const streak = (context.state.fireballStreak as number | undefined) ?? 0;
      context.state.fireballStreak = streak + 1;
      context.state.lastFireballTarget = context.target ?? { type: "none" };
    },
  },

  iceShard: {
    id: "iceShard",
    name: "Ice Shard",
    description: "Freeze an enemy card and mark it chilled.",
    cost: 1,
    icon: "❄️",
    allowedPhases: ["choose", "showEnemy"],
    target: { type: "card", ownership: "enemy" },
    resolver: (context) => {
      const log = ensureLog(context);
      log.push(`${context.caster.name} encases ${describeTarget(context.target)} in razor ice.`);
      const chilled = (context.state.chilledCards as Record<string, number> | undefined) ?? {};
      if (context.target?.type === "card") {
        chilled[context.target.cardId] = (chilled[context.target.cardId] ?? 0) + 1;
      }
      context.state.chilledCards = chilled;
    },
  },

  mirrorImage: {
    id: "mirrorImage",
    name: "Mirror Image",
    description: "Copy one of your cards for later tricks.",
    cost: 2,
    icon: "🪞",
    allowedPhases: ["choose", "showEnemy"],
    target: { type: "card", ownership: "ally" },
    resolver: (context) => {
      const log = ensureLog(context);
      log.push(`${context.caster.name} weaves a mirror image of ${describeTarget(context.target)}.`);
      if (context.target?.type === "card") {
        const copies = (context.state.mirroredCards as Record<string, number> | undefined) ?? {};
        copies[context.target.cardId] = (copies[context.target.cardId] ?? 0) + 1;
        context.state.mirroredCards = copies;
      }
    },
  },

  arcaneShift: {
    id: "arcaneShift",
    name: "Arcane Shift",
    description: "Nudge the current wheel toward your victory.",
    cost: 2,
    icon: "🌀",
    allowedPhases: ["choose", "showEnemy", "anim"],
    target: { type: "wheel", scope: "current" },
    resolver: (context) => {
      const log = ensureLog(context);
      log.push(`${context.caster.name} warps ${describeTarget(context.target)} with an Arcane Shift.`);
      context.state.shiftedWheel = {
        target: context.target ?? { type: "none" },
        by: context.caster.name,
      };
    },
  },

  hex: {
    id: "hex",
    name: "Hex",
    description: "Curse an enemy card and track the mark.",
    cost: 1,
    icon: "🕯️",
    allowedPhases: ["choose", "showEnemy"],
    target: { type: "card", ownership: "enemy" },
    resolver: (context) => {
      const log = ensureLog(context);
      log.push(`${context.caster.name} hexes ${describeTarget(context.target)} with baleful energy.`);
      if (context.target?.type === "card") {
        const curses = (context.state.hexedCards as Record<string, number> | undefined) ?? {};
        curses[context.target.cardId] = (curses[context.target.cardId] ?? 0) + 1;
        context.state.hexedCards = curses;
      }
    },
  },

  timeTwist: {
    id: "timeTwist",
    name: "Time Twist",
    description: "Gain momentum now and queue a later surge.",
    cost: 3,
    icon: "⏳",
    allowedPhases: ["anim", "roundEnd"],
    target: { type: "self", automatic: true },
    resolver: (context) => {
      const log = ensureLog(context);
      log.push(`${context.caster.name} bends time around themselves.`);
      const momentum = (context.state.timeMomentum as number | undefined) ?? 0;
      context.state.timeMomentum = momentum + 1;
      const delayed = (context.state.delayedEffects as string[] | undefined) ?? [];
      delayed.push(`${context.caster.name} banks a future surge.`);
      context.state.delayedEffects = delayed;
    },
  },
};

// ---------- API ----------
export function getSpellById(id: SpellId | string): SpellDefinition | undefined {
  return SPELL_REGISTRY[id as SpellId];
}

export function listSpellIds(): SpellId[] {
  return Object.keys(SPELL_REGISTRY) as SpellId[];
}

// Use archetype definitions as the single source for which spells an archetype has
export function listSpellsForArchetype(archetype: SpellArchetype): SpellDefinition[] {
  const def = ARCHETYPE_DEFINITIONS[archetype];
  const spellIds = def?.spellIds ?? [];
  return spellIds
    .map((id) => getSpellById(id))
    .filter((s): s is SpellDefinition => Boolean(s));
}

export function getSpellbookForArchetype(archetype: SpellArchetype): SpellDefinition[] {
  return listSpellsForArchetype(archetype);
}

function inferSpellArchetypeFromFighter(fighter: Fighter): SpellArchetype {
  const maybe = (fighter as Fighter & { archetype?: unknown }).archetype;
  if (typeof maybe === "string" && maybe in ARCHETYPE_DEFINITIONS) {
    return maybe as SpellArchetype;
  }
  // fallback inference by name
  const n = fighter.name?.toLowerCase?.() ?? "";
  if (n.includes("bandit")) return "bandit";
  if (n.includes("sorcerer")) return "sorcerer";
  if (n.includes("beast")) return "beast";
  return "wanderer";
}

export function getLearnedSpellsForFighter(fighter: Fighter): SpellDefinition[] {
  const archetype = inferSpellArchetypeFromFighter(fighter);
  const baseBook = getSpellbookForArchetype(archetype);
  const learned = (fighter as Fighter & { learnedSpells?: unknown }).learnedSpells;

  if (Array.isArray(learned) && learned.length > 0) {
    const allowed = new Set<SpellId>(
      learned.filter((id): id is SpellId => typeof id === "string" && getSpellById(id) !== undefined)
    );
    if (allowed.size > 0) {
      return baseBook.filter((spell) => allowed.has(spell.id));
    }
  }
  return baseBook;
}
