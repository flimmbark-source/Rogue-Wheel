// game/spells.ts (merged)

import type { Arcana, Fighter, Phase } from "./types.js";
import { ARCHETYPE_DEFINITIONS, DEFAULT_ARCHETYPE, type ArchetypeId as SpellArchetype } from "./archetypes.js";

export type SpellTargetOwnership = "ally" | "enemy" | "any";

export type SpellTargetLocation = "board" | "hand" | "any";

export type SpellTargetStageDefinition =
  | { type: "none"; label?: string }
  | { type: "self"; automatic?: boolean; label?: string }
  | {
      type: "card";
      ownership: SpellTargetOwnership;
      automatic?: boolean;
      arcana?: Arcana | Arcana[];
      location?: SpellTargetLocation;
      adjacentToPrevious?: boolean;
      label?: string;
    }
  | {
      type: "wheel";
      scope: "current" | "any";
      requiresArcana?: Arcana | Arcana[];
      label?: string;
    };

export type SpellTargetDefinition =
  | SpellTargetStageDefinition
  | { type: "sequence"; stages: SpellTargetStageDefinition[]; label?: string };

const normalizeTarget = (target: SpellTargetDefinition): SpellTargetStageDefinition[] =>
  target.type === "sequence" ? target.stages : [target];

export const spellTargetStageRequiresManualSelection = (
  stage: SpellTargetStageDefinition,
): boolean => {
  switch (stage.type) {
    case "card":
      return stage.automatic !== true;
    case "wheel":
      return true;
    default:
      return false;
  }
};

export const spellTargetRequiresManualSelection = (target: SpellTargetDefinition): boolean => {
  return normalizeTarget(target).some(spellTargetStageRequiresManualSelection);
};

export const getSpellTargetStage = (
  target: SpellTargetDefinition,
  index: number,
): SpellTargetStageDefinition | null => {
  const stages = normalizeTarget(target);
  return stages[index] ?? null;
};

export const getSpellTargetStages = (target: SpellTargetDefinition): SpellTargetStageDefinition[] =>
  normalizeTarget(target);

export function getSpellDefinitions(ids: SpellId[]): SpellDefinition[] {
  return ids
    .map((id: SpellId) => getSpellById(id))
    .filter((s): s is SpellDefinition => Boolean(s));
}

export type SpellTargetInstance =
  | { type: "none"; stageIndex?: number }
  | { type: "self"; stageIndex?: number }
  | {
      type: "card";
      cardId: string;
      owner: SpellTargetOwnership;
      cardName?: string;
      arcana?: Arcana;
      location?: SpellTargetLocation;
      lane?: number | null;
      stageIndex?: number;
      cardValue?: number;
    }
  | { type: "wheel"; wheelId: string; label?: string; stageIndex?: number };

export type SpellRuntimeState = Record<string, unknown> & {
  log?: string[];
  cardAdjustments?: RuntimeCardAdjustment[];
  handAdjustments?: RuntimeHandAdjustment[];
  handDiscards?: RuntimeHandDiscard[];
  positionSwaps?: RuntimeSwapRequest[];
  initiativeChallenges?: RuntimeInitiativeChallenge[];
  reserveDrains?: RuntimeReserveDrain[];
};

export type SpellResolverContext = {
  caster: Fighter;
  opponent: Fighter;
  phase: Phase;
  target?: SpellTargetInstance;
  targets?: SpellTargetInstance[];
  state: SpellRuntimeState;
};

export type SpellResolver = (context: SpellResolverContext) => void;

export type SpellDefinition = {
  id: string;
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
  targetSummary?: string;
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

type RuntimeCardAdjustment = {
  target: SpellTargetInstance;
  numberDelta?: number;
  leftValueDelta?: number;
  rightValueDelta?: number;
};

type RuntimeHandAdjustment = {
  target: SpellTargetInstance;
  numberDelta?: number;
};

type RuntimeHandDiscard = {
  target: SpellTargetInstance;
};

type RuntimeSwapRequest = {
  first: SpellTargetInstance;
  second: SpellTargetInstance;
  caster: string;
};

type RuntimeInitiativeChallenge = {
  target: SpellTargetInstance;
  mode: "higher" | "lower";
  caster: string;
};

type RuntimeReserveDrain = {
  target: SpellTargetInstance;
  amount: number;
  caster: string;
};

const pushRuntimeArray = <T>(
  context: SpellResolverContext,
  key: keyof SpellRuntimeState,
  value: T,
) => {
  const existing = (context.state[key] as T[] | undefined) ?? [];
  existing.push(value);
  context.state[key] = existing as unknown as SpellRuntimeState[keyof SpellRuntimeState];
};

const pushCardAdjustment = (
  context: SpellResolverContext,
  adjustment: RuntimeCardAdjustment,
) => {
  pushRuntimeArray(context, "cardAdjustments", adjustment);
};

const pushHandAdjustment = (
  context: SpellResolverContext,
  adjustment: RuntimeHandAdjustment,
) => {
  pushRuntimeArray(context, "handAdjustments", adjustment);
};

const pushHandDiscard = (
  context: SpellResolverContext,
  discard: RuntimeHandDiscard,
) => {
  pushRuntimeArray(context, "handDiscards", discard);
};

const pushSwapRequest = (
  context: SpellResolverContext,
  request: RuntimeSwapRequest,
) => {
  pushRuntimeArray(context, "positionSwaps", request);
};

const pushInitiativeChallenge = (
  context: SpellResolverContext,
  challenge: RuntimeInitiativeChallenge,
) => {
  pushRuntimeArray(context, "initiativeChallenges", challenge);
};

const pushReserveDrain = (
  context: SpellResolverContext,
  drain: RuntimeReserveDrain,
) => {
  pushRuntimeArray(context, "reserveDrains", drain);
};

// ---------- registry (IDs MUST match archetypes SpellId union: camelCase) ----------
const SPELL_REGISTRY: Record<string, SpellDefinition> = {
  fireball: {
    id: "fireball",
    name: "Fireball",
    description: "Reduce an enemy card's value 2. Each successive cast costs +1 Mana.",
    targetSummary: "Target: 🔥 enemy card",
    cost: 2,
    variableCost: (context) => {
      const streak = (context.state.fireballStreak as number | undefined) ?? 0;
      return context.state.fireballBaseCost === undefined
        ? 2 + streak
        : Number(context.state.fireballBaseCost);
    },
    icon: "🔥",
    allowedPhases: ["roundEnd", "showEnemy"],
    target: {
      type: "card",
      ownership: "enemy",
      arcana: "fire",
      location: "board",
      label: "Enemy 🔥 card",
    },
    resolver: (context) => {
      const log = ensureLog(context);
      log.push(`${context.caster.name} scorches ${describeTarget(context.target)} with a Fireball.`);
      const streak = (context.state.fireballStreak as number | undefined) ?? 0;
      context.state.fireballStreak = streak + 1;
      if (context.target?.type === "card") {
        pushCardAdjustment(context, { target: context.target, numberDelta: -2 });
      }
    },
  },

  iceShard: {
    id: "iceShard",
    name: "Ice Shard",
    description: "Freeze a card's value for the round.",
    targetSummary: "Target: 🗡️ enemy card",
    cost: 1,
    icon: "🗡️",
    allowedPhases: ["roundEnd", "showEnemy"],
    target: {
      type: "card",
      ownership: "enemy",
      arcana: "blade",
      location: "board",
      label: "Enemy 🗡️ card",
    },
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
    description: "Your 👁️ card copies the opposing value.",
    targetSummary: "Target: 👁️ ally card",
    cost: 4,
    icon: "👁️",
    allowedPhases: ["roundEnd", "showEnemy"],
    target: {
      type: "card",
      ownership: "ally",
      arcana: "eye",
      location: "board",
      label: "Your 👁️ card",
    },
    resolver: (context) => {
      const log = ensureLog(context);
      log.push(
        `${context.caster.name} twists ${describeTarget(
          context.target,
        )} into an uncanny reflection of its foe.`,
      );
      if (context.target?.type === "card") {
        const effects =
          (context.state.mirrorCopyEffects as
            | { targetCardId: string; mode: "opponent"; caster: string }[]
            | undefined) ?? [];
        effects.push({
          targetCardId: context.target.cardId,
          mode: "opponent",
          caster: context.caster.name,
        });
        context.state.mirrorCopyEffects = effects;
      }
    },
  },

  arcaneShift: {
    id: "arcaneShift",
    name: "Arcane Shift",
    description: "Advance the wheel housing a 🌒 card by 1 space.",
    targetSummary: "Target: Wheel with 🌒 card",
    cost: 3,
    icon: "🌒",
    allowedPhases: ["roundEnd", "showEnemy", "anim"],
    target: {
      type: "wheel",
      scope: "current",
      requiresArcana: "moon",
      label: "Wheel containing 🌒",
    },
    resolver: (context) => {
      const log = ensureLog(context);
      log.push(`${context.caster.name} empowers ${describeTarget(context.target)} with arcane momentum.`);
      const adjustments =
        (context.state.wheelTokenAdjustments as
          | { target: SpellTargetInstance; amount: number; caster: string }[]
          | undefined) ?? [];
      adjustments.push({
        target: context.target ?? { type: "none" },
        amount: 1,
        caster: context.caster.name,
      });
      context.state.wheelTokenAdjustments = adjustments;
    },
  },

  hex: {
    id: "hex",
    name: "Hex",
    description: "Remove 2 reserve from foe if a 🐍 card is present.",
    targetSummary: "Target: 🐍 enemy card",
    cost: 4,
    icon: "🐍",
    allowedPhases: ["roundEnd", "showEnemy"],
    target: {
      type: "card",
      ownership: "enemy",
      arcana: "serpent",
      location: "board",
      label: "Enemy 🐍 card",
    },
    resolver: (context) => {
      const log = ensureLog(context);
      log.push(`${context.caster.name} drains their foe's reserves with a wicked hex.`);
      if (context.target?.type === "card") {
        pushReserveDrain(context, {
          target: context.target,
          amount: 2,
          caster: context.caster.name,
        });
      }
    },
  },

  timeTwist: {
    id: "timeTwist",
    name: "Time Twist",
    description: "Discard a 👁️ or 🌒 card in hand to gain initiative.",
    targetSummary: "Target: Your 👁️ or 🌒 card in hand",
    cost: 5,
    icon: "⏳",
    allowedPhases: ["choose", "roundEnd"],
    target: {
      type: "card",
      ownership: "ally",
      arcana: ["eye", "moon"],
      location: "hand",
      label: "Your 👁️ or 🌒 reserve card",
    },
    resolver: (context) => {
      const log = ensureLog(context);
      log.push(`${context.caster.name} bends time around themselves.`);
      const momentum = (context.state.timeMomentum as number | undefined) ?? 0;
      context.state.timeMomentum = momentum + 1;
      const delayed = (context.state.delayedEffects as string[] | undefined) ?? [];
      delayed.push(`${context.caster.name} banks a future surge.`);
      context.state.delayedEffects = delayed;
      if (context.target?.type === "card") {
        pushHandDiscard(context, { target: context.target });
      }
    },
  },

  kindle: {
    id: "kindle",
    name: "Kindle",
    description: "Increase a 🔥 card by +2. If it rests in reserve, remove 2 reserve from foe.",
    targetSummary: "Target: 🔥 ally card",
    cost: 2,
    icon: "🔥",
    allowedPhases: ["choose", "roundEnd", "showEnemy"],
    target: {
      type: "card",
      ownership: "ally",
      arcana: "fire",
      location: "any",
      label: "Your 🔥 card",
    },
    resolver: (context) => {
      const log = ensureLog(context);
      log.push(`${context.caster.name} fans the flames of ${describeTarget(context.target)}.`);
      if (context.target?.type !== "card") return;
      const location = context.target.location ?? "board";
      if (location === "hand") {
        pushHandAdjustment(context, { target: context.target, numberDelta: 2 });
        const opponentTarget: SpellTargetInstance = {
          type: "card",
          cardId: context.target.cardId,
          owner: context.target.owner === "ally" ? "enemy" : "ally",
        };
        pushReserveDrain(context, {
          target: opponentTarget,
          amount: 2,
          caster: context.caster.name,
        });
      } else {
        pushCardAdjustment(context, { target: context.target, numberDelta: 2 });
      }
    },
  },

  suddenStrike: {
    id: "suddenStrike",
    name: "Sudden Strike",
    description: "Reveal a 🗡️ card, foe must reveal a card. If the opposing card is lower, seize initiative.",
    targetSummary: "Target: Your 🗡️ card",
    cost: 3,
    icon: "🗡️",
    allowedPhases: ["roundEnd", "showEnemy"],
    target: {
      type: "card",
      ownership: "ally",
      arcana: "blade",
      location: "board",
      label: "Your 🗡️ card",
    },
    resolver: (context) => {
      const log = ensureLog(context);
      log.push(`${context.caster.name} lashes out with a sudden strike from ${describeTarget(context.target)}.`);
      if (context.target?.type === "card") {
        pushInitiativeChallenge(context, {
          target: context.target,
          mode: "higher",
          caster: context.caster.name,
        });
      }
    },
  },

  leech: {
    id: "leech",
    name: "Leech",
    description: "Drain value from an adjacent card into your 🐍.",
    targetSummary: "Targets: 🐍 card then adjacent card",
    cost: 4,
    icon: "🐍",
    allowedPhases: ["roundEnd", "showEnemy"],
    target: {
      type: "sequence",
      stages: [
        {
          type: "card",
          ownership: "ally",
          arcana: "serpent",
          location: "board",
          label: "Your 🐍 card",
        },
        {
          type: "card",
          ownership: "any",
          location: "board",
          adjacentToPrevious: true,
          label: "Adjacent card",
        },
      ],
    },
    resolver: (context) => {
      const [primary, secondary] = context.targets ?? [];
      const amount = secondary?.type === "card" ? secondary.cardValue ?? 0 : 0;
      if (!primary || primary.type !== "card" || !secondary || secondary.type !== "card") return;
      if (amount !== 0) {
        pushCardAdjustment(context, { target: primary, numberDelta: amount });
        pushCardAdjustment(context, { target: secondary, numberDelta: -amount });
      }
      const log = ensureLog(context);
      log.push(`${context.caster.name} siphons power between ${describeTarget(primary)} and its neighbor.`);
    },
  },

  crosscut: {
    id: "crosscut",
    name: "Crosscut",
    description: "Reveal a 🗡️ card in your reserve, your foe reveals any reserve card, Compare the revealed cards and drain foe's reserve by their difference.",
    targetSummary: "Targets: 🗡️ card in hand, then opposing card",
    cost: 3,
    icon: "🗡️",
    allowedPhases: ["choose", "roundEnd"],
    target: {
      type: "sequence",
      stages: [
        {
          type: "card",
          ownership: "ally",
          arcana: "blade",
          location: "hand",
          label: "Your reserve blade",
        },
        {
          type: "card",
          ownership: "enemy",
          location: "board",
          label: "Opponent's card",
        },
      ],
    },
    resolver: (context) => {
      const [primary, foe] = context.targets ?? [];
      if (!primary || primary.type !== "card" || !foe || foe.type !== "card") return;
      const attacker = primary.cardValue ?? 0;
      const defender = foe.cardValue ?? 0;
      const difference = attacker - defender;
      const log = ensureLog(context);
      log.push(`${context.caster.name} reveals a crosscut, comparing ${describeTarget(primary)} to ${describeTarget(foe)}.`);
      if (difference > 0) {
        pushReserveDrain(context, {
          target: foe,
          amount: difference,
          caster: context.caster.name,
        });
      }
    },
  },

  offering: {
    id: "offering",
    name: "Offering",
    description: "Sacrifice a reserve card to increase a 🔥 card by its value.",
    targetSummary: "Targets: 🔥 card, then your reserve card",
    cost: 4,
    icon: "🔥",
    allowedPhases: ["choose", "roundEnd"],
    target: {
      type: "sequence",
      stages: [
        {
          type: "card",
          ownership: "ally",
          arcana: "fire",
          location: "board",
          label: "Your 🔥 card",
        },
        {
          type: "card",
          ownership: "ally",
          location: "hand",
          label: "Reserve to sacrifice",
        },
      ],
    },
    resolver: (context) => {
      const [flame, fuel] = context.targets ?? [];
      if (!flame || flame.type !== "card" || !fuel || fuel.type !== "card") return;
      const value = fuel.cardValue ?? 0;
      const log = ensureLog(context);
      log.push(`${context.caster.name} offers ${describeTarget(fuel)} to empower ${describeTarget(flame)}.`);
      if (value !== 0) {
        pushCardAdjustment(context, { target: flame, numberDelta: value });
      }
      pushHandDiscard(context, { target: fuel });
    },
  },

  phantom: {
    id: "phantom",
    name: "Phantom",
    description: "Swap a 🌒 card with another of your cards.",
    targetSummary: "Targets: 🌒 card and another ally card",
    cost: 3,
    icon: "🌒",
    allowedPhases: ["roundEnd", "showEnemy"],
    target: {
      type: "sequence",
      stages: [
        {
          type: "card",
          ownership: "ally",
          arcana: "moon",
          location: "board",
          label: "Your 🌒 card",
        },
        {
          type: "card",
          ownership: "ally",
          location: "board",
          label: "Another committed card",
        },
      ],
    },
    resolver: (context) => {
      const [first, second] = context.targets ?? [];
      if (!first || first.type !== "card" || !second || second.type !== "card") return;
      const log = ensureLog(context);
      log.push(`${context.caster.name} phases ${describeTarget(first)} with ${describeTarget(second)}.`);
      pushSwapRequest(context, {
        first,
        second,
        caster: context.caster.name,
      });
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
  return DEFAULT_ARCHETYPE;
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

export type SpellId = keyof typeof SPELL_REGISTRY;
