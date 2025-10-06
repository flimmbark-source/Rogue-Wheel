// game/spells.ts (merged, Arcana Read paradigm)

import type { Arcana, Fighter, Phase } from "./types.js";
import { ARCHETYPE_DEFINITIONS, DEFAULT_ARCHETYPE, type ArchetypeId as SpellArchetype } from "./archetypes.js";

export type SpellTargetOwnership = "ally" | "enemy" | "any";
export type SpellTargetLocation = "board" | "hand" | "any";

/** NEW: per-spell requirement so it can be slotted into a player's grimoire */
export type SpellRequirement = {
  arcana: Arcana;       // which symbol track this spell belongs to
  symbols: number;      // minimum symbols allocated on profile
};

export type SpellTargetStageDefinition =
  | { type: "none"; label?: string; optional?: boolean }
  | { type: "self"; automatic?: boolean; label?: string; optional?: boolean }
  | {
      type: "card";
      ownership: SpellTargetOwnership;
      automatic?: boolean;
      arcana?: Arcana | Arcana[];  // may be used to constrain optional bonus picks
      location?: SpellTargetLocation;
      adjacentToPrevious?: boolean;
      label?: string;
      /** NEW: if true, UI should allow skipping this stage (optional Arcana Read pick) */
      optional?: boolean;
    }
  | {
      type: "wheel";
      scope: "current" | "any";
      requiresArcana?: Arcana | Arcana[];
      label?: string;
      optional?: boolean;
    };

export type SpellTargetDefinition =
  | SpellTargetStageDefinition
  | { type: "sequence"; stages: SpellTargetStageDefinition[]; label?: string };

const normalizeTarget = (target: SpellTargetDefinition): SpellTargetStageDefinition[] =>
  target.type === "sequence" ? target.stages : [target];

export const spellTargetStageRequiresManualSelection = (
  stage: SpellTargetStageDefinition,
  existingTarget?: SpellTargetInstance | null,
): boolean => {
  switch (stage.type) {
    case "card":
      if (stage.automatic === true) return false;
      if (stage.optional && existingTarget && existingTarget.type === "none") {
        return false;
      }
      return true;
    case "wheel":
      if (stage.optional && existingTarget && existingTarget.type === "none") {
        return false;
      }
      return true;
    default:
      return false;
  }
};

export const spellTargetRequiresManualSelection = (target: SpellTargetDefinition): boolean => {
  return normalizeTarget(target).some((stage) => spellTargetStageRequiresManualSelection(stage));
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
  /** NEW: simple draw counter for effects that grant draws */
  drawCards?: number;
};

export type SpellResolverContext = {
  caster: Fighter;
  opponent: Fighter;
  phase: Phase;
  target?: SpellTargetInstance;
  targets?: SpellTargetInstance[]; // sequence order, optional stages may be omitted
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

  /** NEW: requirement for profile grimoire slotting */
  requirements: SpellRequirement[];
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


export const SPELL_DESCRIPTIONS = {
  fireball: `Damage a card by 2\n+🔥: Boost spell by 🔥.`,
  iceShard: `Freeze a card\n+🗡️: Block initiative.`,
  mirrorImage: `Copy an opposing card's value\n+👁️: Increase by 👁️ value.`,
  arcaneShift: `Advance a wheel by 1\n+🌒: Boost spell by 🌒.`,
  hex: `Damage opponent's reserve by 2\n+🐍: Boost spell by 🐍.`,
  timeTwist: `Discard a card to gain Initiative\n–👁️: Draw 1 if discarded card is 👁️.`,
  kindle: `Increase a card by 2\n+🔥: Boost by 🔥.`,
  leech: `Drain value from an adjacent to selected card\n+🐍: Damage reserve by 🐍.`,
  suddenStrike: `Duel. If you win, gain Initiative\n–🗡️: Win on tie.`,
  offering: `Discard a card. Fortify by its value\n–🔥: Double if 🔥.`,
  crosscut: `Duel. Damage opponent's reserve by difference\n–🗡️: If tied, gain Initiative.`,
  phantom: `Swap a card with another in play\n-🌒: With a reserve.`,
} as const satisfies Record<string, string>;

// ---------- registry (IDs MUST match archetypes SpellId union: camelCase) ----------
const SPELL_REGISTRY: Record<string, SpellDefinition> = {
  // 🔥 Fireball — base -2; +🔥: add value of selected 🔥 to the reduction; still escalates cost by streak
  fireball: {
  id: "fireball",
  name: "Fireball",
  description: SPELL_DESCRIPTIONS.fireball,
  targetSummary: "Target: Enemy card (+optional 🔥)",
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
    type: "sequence",
    stages: [
      { type: "card", ownership: "enemy", location: "board", label: "Enemy card" },
      { type: "card", ownership: "ally", location: "any", arcana: "fire", label: "Optional 🔥 card", optional: true },
    ],
  },
  resolver: (context) => {
    const log = ensureLog(context);
    const [foe, bonus] = context.targets ?? [];
    log.push(`${context.caster.name} scorches ${describeTarget(foe)} with a Fireball.`);
    const streak = (context.state.fireballStreak as number | undefined) ?? 0;
    context.state.fireballStreak = streak + 1;
    if (foe?.type === "card") {
      const bonusVal = bonus?.type === "card" ? (bonus.cardValue ?? 0) : 0;
      pushCardAdjustment(context, { target: foe, numberDelta: -(2 + bonusVal) });
    }
  },
  requirements: [{ arcana: "fire", symbols: 1 }],
},

  // 🗡️ Ice Shard — freeze; +🗡️: prevents initiative gain by that card this round
  iceShard: {
    id: "iceShard",
    name: "Ice Shard",
    description: SPELL_DESCRIPTIONS.iceShard,
    targetSummary: "Target: Enemy card (+optional 🗡️)",
    cost: 1,
    icon: "🗡️",
    allowedPhases: ["roundEnd", "showEnemy"],
    target: {
      type: "sequence",
      stages: [
        { type: "card", ownership: "enemy", location: "board", label: "Enemy card" },
        { type: "card", ownership: "ally", location: "any", arcana: "blade", label: "Optional 🗡️ card", optional: true },
      ],
    },
    resolver: (context) => {
      const log = ensureLog(context);
      const [foe, blade] = context.targets ?? [];
      log.push(`${context.caster.name} encases ${describeTarget(foe)} in razor ice.`);
      const chilled = (context.state.chilledCards as Record<string, number> | undefined) ?? {};
      if (foe?.type === "card") {
        chilled[foe.cardId] = (chilled[foe.cardId] ?? 0) + 1;
        if (blade?.type === "card") {
          const key = "initBlock:" + foe.cardId;
          (context.state as any)[key] = true;
        }
      }
      context.state.chilledCards = chilled;
    },
    requirements: [{ arcana: "blade", symbols: 1 }],
  },

  // 👁️ Mirror Image — copy opposing; +👁️: add value of a selected 👁️ from reserve
  mirrorImage: {
    id: "mirrorImage",
    name: "Mirror Image",
    description: SPELL_DESCRIPTIONS.mirrorImage,
    targetSummary: "Target: Ally card (+optional 👁️ from reserve)",
    cost: 4,
    icon: "👁️",
    allowedPhases: ["roundEnd", "showEnemy"],
    target: {
      type: "sequence",
      stages: [
        { type: "card", ownership: "ally", location: "board", label: "Your card" },
        { type: "card", ownership: "ally", location: "hand", arcana: "eye", label: "Optional 👁️ in reserve", optional: true },
      ],
    },
    resolver: (context) => {
      const log = ensureLog(context);
      const [ally, eyeReserve] = context.targets ?? [];
      if (ally?.type !== "card") return;
      log.push(`${context.caster.name} reflects ${describeTarget(ally)} into its foe.`);
      const effects =
        (context.state.mirrorCopyEffects as
          | { targetCardId: string; mode: "opponent"; caster: string }[]
          | undefined) ?? [];
      effects.push({ targetCardId: ally.cardId, mode: "opponent", caster: context.caster.name });
      context.state.mirrorCopyEffects = effects;
      const bonusVal = eyeReserve?.type === "card" ? (eyeReserve.cardValue ?? 0) : 0;
      if (bonusVal !== 0) pushCardAdjustment(context, { target: ally, numberDelta: bonusVal });
    },
    requirements: [{ arcana: "eye", symbols: 1 }],
  },

  // 🌒 Arcane Shift — move token; +🌒 adds selected 🌒 value
  arcaneShift: {
    id: "arcaneShift",
    name: "Arcane Shift",
    description: SPELL_DESCRIPTIONS.arcaneShift,
    targetSummary: "Target: Active wheel (+optional 🌒)",
    cost: 3,
    icon: "🌒",
    allowedPhases: ["roundEnd", "showEnemy", "anim"],
    target: {
      type: "sequence",
      stages: [
        { type: "wheel", scope: "current", label: "Wheel" },
        { type: "card", ownership: "ally", location: "any", arcana: "moon", label: "Optional 🌒 card", optional: true },
      ],
    },
    resolver: (context) => {
      const log = ensureLog(context);
      const [wheel, moon] = context.targets ?? [];
      log.push(`${context.caster.name} empowers ${describeTarget(wheel)} with arcane momentum.`);
      const amount = 1 + (moon?.type === "card" ? (moon.cardValue ?? 0) : 0);
      const adjustments =
        (context.state.wheelTokenAdjustments as
          | { target: SpellTargetInstance; amount: number; caster: string }[]
          | undefined) ?? [];
      adjustments.push({ target: wheel ?? { type: "none" }, amount, caster: context.caster.name });
      context.state.wheelTokenAdjustments = adjustments;
    },
    requirements: [{ arcana: "moon", symbols: 1 }],
  },

  // 🐍 Hex — drain 2; +🐍 add selected 🐍 value
  hex: {
    id: "hex",
    name: "Hex",
    description: SPELL_DESCRIPTIONS.hex,
    targetSummary: "Target: Enemy card (+optional 🐍)",
    cost: 4,
    icon: "🐍",
    allowedPhases: ["roundEnd", "showEnemy"],
    target: {
      type: "sequence",
      stages: [
        { type: "card", ownership: "enemy", location: "board", label: "Enemy card" },
        { type: "card", ownership: "ally", location: "any", arcana: "serpent", label: "Optional 🐍 card", optional: true },
      ],
    },
    resolver: (context) => {
      const log = ensureLog(context);
      const [foe, snake] = context.targets ?? [];
      log.push(`${context.caster.name} drains their foe’s reserve with a wicked hex.`);
      if (foe?.type === "card") {
        const add = snake?.type === "card" ? (snake.cardValue ?? 0) : 0;
        pushReserveDrain(context, { target: foe, amount: 2 + add, caster: context.caster.name });
      }
    },
    requirements: [{ arcana: "serpent", symbols: 1 }],
  },

  // ⏳ Time Twist — discard to INIT; +👁️ draw if 👁️
  timeTwist: {
    id: "timeTwist",
    name: "Time Twist",
    description: SPELL_DESCRIPTIONS.timeTwist,
    targetSummary: "Target: Your reserve card",
    cost: 5,
    icon: "⏳",
    allowedPhases: ["choose", "roundEnd"],
    target: { type: "card", ownership: "ally", location: "hand", label: "Discard from reserve" },
    resolver: (context) => {
      const log = ensureLog(context);
      log.push(`${context.caster.name} bends time around themselves.`);
      const momentum = (context.state.timeMomentum as number | undefined) ?? 0;
      context.state.timeMomentum = momentum + 1;
      if (context.target?.type === "card") {
        if (context.target.arcana === "eye") {
          context.state.drawCards = (context.state.drawCards ?? 0) + 1;
        }
        pushHandDiscard(context, { target: context.target });
      }
    },
    requirements: [{ arcana: "eye", symbols: 1 }],
  },

  // 🔥 Kindle — +2; +🔥 add selected 🔥 value (works on hand or board)
  kindle: {
    id: "kindle",
    name: "Kindle",
    description: SPELL_DESCRIPTIONS.kindle,
    targetSummary: "Target: Your card (+optional 🔥)",
    cost: 2,
    icon: "🔥",
    allowedPhases: ["choose", "roundEnd", "showEnemy"],
    target: {
      type: "sequence",
      stages: [
        { type: "card", ownership: "ally", location: "any", label: "Your card" },
        { type: "card", ownership: "ally", location: "any", arcana: "fire", label: "Optional 🔥 card", optional: true }, // <- fixed ownership typo
      ],
    },
    resolver: (context) => {
      const log = ensureLog(context);
      const [tgt, bonus] = context.targets ?? [];
      log.push(`${context.caster.name} fans the flames of ${describeTarget(tgt)}.`);
      if (tgt?.type !== "card") return;
      const bonusVal = bonus?.type === "card" ? (bonus.cardValue ?? 0) : 0;
      if ((tgt.location ?? "board") === "hand") {
        pushHandAdjustment(context, { target: tgt, numberDelta: 2 + bonusVal });
      } else {
        pushCardAdjustment(context, { target: tgt, numberDelta: 2 + bonusVal });
      }
    },
    requirements: [{ arcana: "fire", symbols: 1 }],
  },

  // 🗡️ Sudden Strike — INIT if higher; +🗡️ also on tie (only if target itself is 🗡️)
  suddenStrike: {
    id: "suddenStrike",
    name: "Sudden Strike",
    description: SPELL_DESCRIPTIONS.suddenStrike,
    targetSummary: "Target: Your committed card",
    cost: 6,
    icon: "🗡️",
    allowedPhases: ["roundEnd", "showEnemy"],
    target: { type: "card", ownership: "ally", location: "board", label: "Your card" },
    resolver: (context) => {
      const log = ensureLog(context);
      const tgt = context.target;
      log.push(`${context.caster.name} lashes out with a sudden strike from ${describeTarget(tgt)}.`);
      if (tgt?.type === "card") {
        pushInitiativeChallenge(context, { target: tgt, mode: "higher", caster: context.caster.name });
        // +🗡️ applies only if the targeted card is blade
        if (tgt.arcana === "blade") {
          const key = "edgeTieWin:" + tgt.cardId;
          (context.state as any)[key] = true;
        }
      }
    },
    requirements: [{ arcana: "blade", symbols: 1 }],
  },

  // 🐍 Leech — move adjacent value; +🐍 drain reserve by selected 🐍 value
  leech: {
    id: "leech",
    name: "Leech",
    description: SPELL_DESCRIPTIONS.leech,
    targetSummary: "Targets: Your card → adjacent (+optional 🐍)",
    cost: 4,
    icon: "🐍",
    allowedPhases: ["roundEnd", "showEnemy"],
    target: {
      type: "sequence",
      stages: [
        { type: "card", ownership: "ally", location: "board", label: "Your card" },
        { type: "card", ownership: "any", location: "board", adjacentToPrevious: true, label: "Adjacent card" },
        { type: "card", ownership: "ally", location: "any", arcana: "serpent", label: "Optional 🐍 card", optional: true },
      ],
    },
    resolver: (context) => {
      const [primary, secondary, snake] = context.targets ?? [];
      const amount = secondary?.type === "card" ? secondary.cardValue ?? 0 : 0;
      if (!primary || primary.type !== "card" || !secondary || secondary.type !== "card") return;
      if (amount !== 0) {
        pushCardAdjustment(context, { target: primary, numberDelta: amount });
        pushCardAdjustment(context, { target: secondary, numberDelta: -amount });
      }
      const bonus = snake?.type === "card" ? (snake.cardValue ?? 0) : 0;
      if (bonus > 0) {
        // pick a reasonable foe target contextually; engine may refine this
        const foeTarget: SpellTargetInstance = { type: "card", cardId: primary.cardId, owner: "enemy" };
        pushReserveDrain(context, { target: foeTarget, amount: bonus, caster: context.caster.name });
      }
      const log = ensureLog(context);
      log.push(`${context.caster.name} siphons power between ${describeTarget(primary)} and its neighbor.`);
    },
    requirements: [{ arcana: "serpent", symbols: 2 }],
  },

  // 🗡️ Crosscut — reveal reserves; drain by difference; +🗡️: boost 🗡️ card by diff
  crosscut: {
    id: "crosscut",
    name: "Crosscut",
    description: SPELL_DESCRIPTIONS.crosscut,
    targetSummary: "Targets: Your reserve (+optional 🗡️ in play)",
    cost: 4,
    icon: "🗡️",
    allowedPhases: ["choose", "roundEnd"],
    target: {
      type: "sequence",
      stages: [
        { type: "card", ownership: "ally", location: "hand", label: "Your reserve card" },
        { type: "card", ownership: "ally", location: "board", arcana: "blade", label: "🗡️ card in play", optional: true },
      ],
    },
    resolver: (context) => {
      const [primary, blade] = context.targets ?? [];
      if (!primary || primary.type !== "card") return;

      const casterReserveValue =
        typeof primary.cardValue === "number"
          ? primary.cardValue
          : (() => {
              const found = context.caster.hand.find((card) => card.id === primary.cardId);
              if (!found) return 0;
              if (typeof found.number === "number" && Number.isFinite(found.number)) return found.number;
              if (typeof found.leftValue === "number" && Number.isFinite(found.leftValue)) return found.leftValue;
              if (typeof found.rightValue === "number" && Number.isFinite(found.rightValue)) return found.rightValue;
              return 0;
            })();

      const opponentCard = context.opponent.hand[0] ?? null;
      const opponentValue = opponentCard
        ? typeof opponentCard.number === "number" && Number.isFinite(opponentCard.number)
          ? opponentCard.number
          : typeof opponentCard.leftValue === "number" && Number.isFinite(opponentCard.leftValue)
            ? opponentCard.leftValue
            : typeof opponentCard.rightValue === "number" && Number.isFinite(opponentCard.rightValue)
              ? opponentCard.rightValue
              : 0
        : 0;

      const log = ensureLog(context);

      if (!opponentCard) {
        log.push(
          `${context.caster.name} reveals ${describeTarget(primary)} with Crosscut, but ${context.opponent.name} has no reserve to reveal.`,
        );
        return;
      }

      const foeTarget: SpellTargetInstance = {
        type: "card",
        cardId: opponentCard.id,
        cardName: opponentCard.name,
        arcana: opponentCard.arcana,
        owner: "enemy",
        location: "hand",
        cardValue: opponentValue,
      };

      const difference = Math.abs(casterReserveValue - opponentValue);
      log.push(
        `${context.caster.name} crosscuts ${describeTarget(primary)} against ${describeTarget(foeTarget)}, revealing a difference of ${difference}.`,
      );

      if (difference > 0) {
        pushReserveDrain(context, { target: foeTarget, amount: difference, caster: context.caster.name });
        if (blade && blade.type === "card") {
          pushCardAdjustment(context, { target: blade, numberDelta: difference });
        }
      }
    },
    requirements: [{ arcana: "blade", symbols: 2 }],
  },

  // 🔥 Offering — discard → add its value; +🔥 double if 🔥
  offering: {
    id: "offering",
    name: "Offering",
    description: SPELL_DESCRIPTIONS.offering,
    targetSummary: "Targets: Your committed → reserve to discard",
    cost: 4,
    icon: "🔥",
    allowedPhases: ["choose", "roundEnd"],
    target: {
      type: "sequence",
      stages: [
        { type: "card", ownership: "ally", location: "board", label: "Your committed card" },
        { type: "card", ownership: "ally", location: "hand", label: "Reserve to discard" },
      ],
    },
    resolver: (context) => {
      const [flame, fuel] = context.targets ?? [];
      if (!flame || flame.type !== "card" || !fuel || fuel.type !== "card") return;
      const value = fuel.cardValue ?? 0;
      const log = ensureLog(context);
      log.push(`${context.caster.name} offers ${describeTarget(fuel)} to empower ${describeTarget(flame)}.`);
      const gain = fuel.arcana === "fire" ? value * 2 : value;
      if (gain !== 0) pushCardAdjustment(context, { target: flame, numberDelta: gain });
      pushHandDiscard(context, { target: fuel });
    },
    requirements: [{ arcana: "fire", symbols: 2 }],
  },

  // 🌒 Phantom — swap two committed; +🌒 instead swap a 🌒 committed with reserve
  phantom: {
    id: "phantom",
    name: "Phantom",
    description: SPELL_DESCRIPTIONS.phantom,
    targetSummary: "Targets: Two committed (reserve if first 🌒)",
    cost: 3,
    icon: "🌒",
    allowedPhases: ["roundEnd", "showEnemy"],
    target: {
      type: "sequence",
      stages: [
        { type: "card", ownership: "ally", location: "board", label: "Committed card A" },
        {
          type: "card",
          ownership: "ally",
          location: "any",
          label: "Committed card B (or reserve if first 🌒)",
        },
      ],
    },
    resolver: (context) => {
      const [a, b] = context.targets ?? [];
      if (!a || a.type !== "card" || !b || b.type !== "card") return;
      const log = ensureLog(context);

      if (b.location === "hand") {
        if (a.arcana !== "moon") return;
        log.push(`${context.caster.name} phases ${describeTarget(a)} with ${describeTarget(b)} from reserve.`);
        pushSwapRequest(context, { first: a, second: b, caster: context.caster.name });
        return;
      }

      log.push(`${context.caster.name} phases ${describeTarget(a)} with ${describeTarget(b)}.`);
      pushSwapRequest(context, { first: a, second: b, caster: context.caster.name });
    },
    requirements: [{ arcana: "moon", symbols: 2 }],
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
