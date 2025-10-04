import type { Fighter, Phase } from "./types.js";
import { SLICES } from "./types.js";
import type { SpellDefinition, SpellRuntimeState, SpellTargetInstance, SpellTargetOwnership } from "./spells.js";
import {
  spellTargetRequiresManualSelection,
  getSpellTargetStages,
  getSpellTargetStage,
  spellTargetStageRequiresManualSelection,
} from "./spells.js";
import {
  applyCardStatAdjustments,
  applyChilledCardUpdates,
  collectRuntimeSpellEffects,
  type CardStatAdjustment,
  type ChilledCardUpdate,
  type LaneChillStacks,
  type LegacySide,
  type SpellEffectPayload,
} from "../features/threeWheel/utils/spellEffectTransforms.js";

export type { LegacySide, SpellEffectPayload, LaneChillStacks } from "../features/threeWheel/utils/spellEffectTransforms.js";
export type { SpellDefinition, SpellRuntimeState, SpellTargetInstance, SpellTargetOwnership } from "./spells.js";

export { spellTargetRequiresManualSelection };

export type PendingSpellDescriptor = {
  side: LegacySide;
  spell: SpellDefinition;
  targets: SpellTargetInstance[];
  currentStage: number;
  spentMana: number;
};

export type SpellCostContext = {
  caster: Fighter;
  opponent: Fighter;
  phase: Phase;
  runtimeState: SpellRuntimeState;
};

export function computeSpellCost(spell: SpellDefinition, context: SpellCostContext): number {
  const computedCostRaw = spell.variableCost
    ? spell.variableCost({
        caster: context.caster,
        opponent: context.opponent,
        phase: context.phase,
        state: context.runtimeState,
      })
    : spell.cost;
  return Number.isFinite(computedCostRaw)
    ? Math.max(0, Math.round(computedCostRaw as number))
    : spell.cost;
}

export type ResolveSpellParams = {
  descriptor: PendingSpellDescriptor;
  caster: Fighter;
  opponent: Fighter;
  phase: Phase;
  runtimeState: SpellRuntimeState;
  targetOverride?: SpellTargetInstance | null;
};

export type SpellResolutionResult =
  | {
      outcome: "requiresTarget";
      pendingSpell: PendingSpellDescriptor;
      manaRefund?: number;
    }
  | {
      outcome: "success";
      payload: SpellEffectPayload | null;
      manaRefund?: number;
    }
  | {
      outcome: "error";
      error: unknown;
      manaRefund?: number;
    };

const RUNTIME_CLEANUP_KEYS: Array<keyof SpellRuntimeState | string> = [
  "mirrorCopyEffects",
  "wheelTokenAdjustments",
  "reserveDrains",
  "drawCards",
  "chilledCards",
  "delayedEffects",
  "timeMomentum",
  "cardAdjustments",
  "handAdjustments",
  "handDiscards",
  "positionSwaps",
  "initiativeChallenges",
];

export function resolvePendingSpell(params: ResolveSpellParams): SpellResolutionResult {
  const { descriptor, caster, opponent, phase, runtimeState, targetOverride } = params;

  const stages = getSpellTargetStages(descriptor.spell.target);
  const pendingTargets = Array.isArray(descriptor.targets) ? [...descriptor.targets] : [];
  let stageIndex = descriptor.currentStage ?? 0;
  const casterSideLegacy = descriptor.side;
  const opponentSideLegacy: LegacySide = casterSideLegacy === "player" ? "enemy" : "player";
  const ownerToLegacy = (owner: SpellTargetOwnership | undefined): LegacySide | null => {
    if (owner === "ally") return casterSideLegacy;
    if (owner === "enemy") return opponentSideLegacy;
    return null;
  };

  const extractCardDetails = (
    target: SpellTargetInstance | undefined,
  ): {
    lane: number | null;
    cardName?: string;
    cardValue?: number | null;
    leftValue?: number | null;
    rightValue?: number | null;
    location?: string | null;
  } => {
    if (!target || target.type !== "card") {
      return { lane: null };
    }
    const laneRaw = target.lane;
    const lane = Number.isInteger(laneRaw) ? (laneRaw as number) : null;
    const cardName = typeof target.cardName === "string" ? target.cardName : undefined;
    const cardValue =
      typeof target.cardValue === "number" && Number.isFinite(target.cardValue)
        ? (target.cardValue as number)
        : null;
    const leftValueRaw = (target as { leftValue?: unknown }).leftValue;
    const leftValue =
      typeof leftValueRaw === "number" && Number.isFinite(leftValueRaw) ? (leftValueRaw as number) : null;
    const rightValueRaw = (target as { rightValue?: unknown }).rightValue;
    const rightValue =
      typeof rightValueRaw === "number" && Number.isFinite(rightValueRaw) ? (rightValueRaw as number) : null;
    const locationRaw = (target as { location?: unknown }).location;
    const location = typeof locationRaw === "string" ? locationRaw : null;
    return { lane, cardName, cardValue, leftValue, rightValue, location };
  };

  if (targetOverride !== undefined) {
    if (targetOverride === null) {
      return {
        outcome: "requiresTarget",
        pendingSpell: { ...descriptor },
        manaRefund: 0,
      };
    }
    pendingTargets[stageIndex] = { ...targetOverride, stageIndex };
    stageIndex += 1;
  }

  const overrideProvided = targetOverride !== undefined;

  while (stageIndex < stages.length) {
    const stage = stages[stageIndex];
    let existingTarget = pendingTargets[stageIndex];

    if (!overrideProvided && stage.optional && !existingTarget) {
      existingTarget = { type: "none", stageIndex };
      pendingTargets[stageIndex] = existingTarget;
    }

    if (spellTargetStageRequiresManualSelection(stage, existingTarget)) break;
    if (stage.type === "self") {
      pendingTargets[stageIndex] = { type: "self", stageIndex };
      stageIndex += 1;
      continue;
    }
    if (stage.type === "none") {
      pendingTargets[stageIndex] = { type: "none", stageIndex };
      stageIndex += 1;
      continue;
    }
    if (stage.optional && pendingTargets[stageIndex]?.type === "none") {
      stageIndex += 1;
      continue;
    }
    break;
  }

  if (stageIndex < stages.length) {
    return {
      outcome: "requiresTarget",
      pendingSpell: { ...descriptor, targets: pendingTargets, currentStage: stageIndex },
      manaRefund: 0,
    };
  }

  const finalTarget = pendingTargets[pendingTargets.length - 1] ?? null;

  const context = {
    caster,
    opponent,
    phase,
    target: finalTarget ?? undefined,
    targets: pendingTargets,
    state: runtimeState,
  } as const;

  try {
    descriptor.spell.resolver(context);
  } catch (error) {
    return { outcome: "error", error, manaRefund: 0 };
  }

  const mirrorCopyEffectsList = Array.isArray(runtimeState.mirrorCopyEffects)
    ? runtimeState.mirrorCopyEffects.reduce<
        Array<{ targetCardId: string; mode?: string; cardName?: string; lane?: number | null }>
      >((acc, effect: unknown) => {
        if (!effect || typeof effect !== "object") return acc;
        const targetCardId = (effect as { targetCardId?: unknown }).targetCardId;
        if (typeof targetCardId !== "string") return acc;
        const mode = (effect as { mode?: unknown }).mode;
        const cardName = (effect as { cardName?: unknown }).cardName;
        const laneRaw = (effect as { lane?: unknown }).lane;
        acc.push({
          targetCardId,
          mode: typeof mode === "string" ? mode : undefined,
          cardName: typeof cardName === "string" ? cardName : undefined,
          lane: Number.isInteger(laneRaw) ? (laneRaw as number) : null,
        });
        return acc;
      }, [])
    : [];
  const mirrorCopyEffects = mirrorCopyEffectsList.length > 0 ? mirrorCopyEffectsList : undefined;

  const wheelTokenAdjustmentsList = Array.isArray(runtimeState.wheelTokenAdjustments)
    ? runtimeState.wheelTokenAdjustments.reduce<
        Array<{ wheelIndex: number; amount: number; casterName?: string }>
      >((acc, entry: unknown) => {
        if (!entry || typeof entry !== "object") return acc;
        const amount = (entry as { amount?: unknown }).amount;
        if (typeof amount !== "number") return acc;
        const target = (entry as { target?: unknown }).target;
        if (!target || typeof target !== "object") return acc;
        const targetType = (target as { type?: unknown }).type;
        const wheelId = (target as { wheelId?: unknown }).wheelId;
        if (targetType !== "wheel" || typeof wheelId !== "string") return acc;
        const idx = Number.parseInt(wheelId, 10);
        if (!Number.isInteger(idx)) return acc;
        const casterName = (entry as { caster?: unknown }).caster;
        acc.push({
          wheelIndex: idx,
          amount,
          casterName: typeof casterName === "string" ? casterName : undefined,
        });
        return acc;
      }, [])
    : [];
  const wheelTokenAdjustments = wheelTokenAdjustmentsList.length > 0 ? wheelTokenAdjustmentsList : undefined;

  const reserveDrainsList = Array.isArray(runtimeState.reserveDrains)
    ? runtimeState.reserveDrains.reduce<
        Array<{
          side: LegacySide;
          amount: number;
          cardId?: string;
          cardName?: string;
          lane?: number | null;
          casterName?: string;
        }>
      >((acc, entry: unknown) => {
        if (!entry || typeof entry !== "object") return acc;
        const amount = (entry as { amount?: unknown }).amount;
        if (typeof amount !== "number") return acc;

        let targetSide: LegacySide | null = null;
        const target = (entry as { target?: unknown }).target;
        let targetCardId: string | undefined;
        let targetCardName: string | undefined;
        let targetLane: number | null = null;
        if (target && typeof target === "object" && (target as { type?: unknown }).type === "card") {
          const owner = (target as { owner?: unknown }).owner as SpellTargetOwnership | undefined;
          targetSide = ownerToLegacy(owner);
          const details = extractCardDetails(target as SpellTargetInstance | undefined);
          targetCardId = (target as { cardId?: unknown }).cardId as string | undefined;
          targetCardName = details.cardName;
          targetLane = details.lane;
        }

        if (!targetSide) {
          targetSide = opponentSideLegacy;
        }

        const casterName = (entry as { caster?: unknown }).caster;
        acc.push({
          side: targetSide,
          amount,
          cardId: typeof targetCardId === "string" ? targetCardId : undefined,
          cardName: targetCardName,
          lane: targetLane,
          casterName: typeof casterName === "string" ? casterName : undefined,
        });
        return acc;
      }, [])
    : [];
  const reserveDrains = reserveDrainsList.length > 0 ? reserveDrainsList : undefined;

  const rawHandAdjustments = Array.isArray(runtimeState.handAdjustments)
    ? runtimeState.handAdjustments.reduce<
        Array<{
          side: LegacySide;
          cardId: string;
          cardName?: string;
          numberDelta?: number;
          cardValue?: number | null;
        }>
      >((acc, entry: unknown) => {
        if (!entry || typeof entry !== "object") return acc;
        const target = (entry as { target?: unknown }).target;
        if (!target || typeof target !== "object" || (target as { type?: unknown }).type !== "card") {
          return acc;
        }
        const cardId = (target as { cardId?: unknown }).cardId;
        if (typeof cardId !== "string") return acc;
        const owner = ownerToLegacy((target as { owner?: unknown }).owner as SpellTargetOwnership | undefined);
        if (!owner) return acc;
        const numberDelta = (entry as { numberDelta?: unknown }).numberDelta;
        const details = extractCardDetails(target as SpellTargetInstance | undefined);
        acc.push({
          side: owner,
          cardId,
          cardName: details.cardName,
          numberDelta: typeof numberDelta === "number" ? numberDelta : undefined,
          cardValue: details.cardValue ?? null,
        });
        return acc;
      }, [])
    : undefined;

  const handAdjustments = rawHandAdjustments && rawHandAdjustments.length > 0 ? rawHandAdjustments : undefined;

  const rawHandDiscards = Array.isArray(runtimeState.handDiscards)
    ? runtimeState.handDiscards.reduce<Array<{ side: LegacySide; cardId: string; cardName?: string }>>(
        (acc, entry: unknown) => {
          if (!entry || typeof entry !== "object") return acc;
          const target = (entry as { target?: unknown }).target;
          if (!target || typeof target !== "object" || (target as { type?: unknown }).type !== "card") {
            return acc;
          }
          const cardId = (target as { cardId?: unknown }).cardId;
          if (typeof cardId !== "string") return acc;
          const owner = ownerToLegacy((target as { owner?: unknown }).owner as SpellTargetOwnership | undefined);
          if (!owner) return acc;
          const details = extractCardDetails(target as SpellTargetInstance | undefined);
          acc.push({ side: owner, cardId, cardName: details.cardName });
          return acc;
        },
        [],
      )
    : undefined;

  const handDiscards = rawHandDiscards && rawHandDiscards.length > 0 ? rawHandDiscards : undefined;

  const positionSwapsList = Array.isArray(runtimeState.positionSwaps)
    ? runtimeState.positionSwaps.reduce<
        Array<{
          side: LegacySide;
          laneA: number;
          laneB: number;
          cardA?: {
            cardId?: string;
            cardName?: string;
            lane?: number | null;
            cardValue?: number | null;
            location?: string | null;
          };
          cardB?: {
            cardId?: string;
            cardName?: string;
            lane?: number | null;
            cardValue?: number | null;
            location?: string | null;
          };
          casterName?: string;
        }>
      >((acc, entry: unknown) => {
        if (!entry || typeof entry !== "object") return acc;
        const first = (entry as { first?: unknown }).first as SpellTargetInstance | undefined;
        const second = (entry as { second?: unknown }).second as SpellTargetInstance | undefined;
        if (!first || !second || first.type !== "card" || second.type !== "card") {
          return acc;
        }
        const laneA = first.lane;
        const laneB = second.lane;
        if (!Number.isInteger(laneA) || !Number.isInteger(laneB)) return acc;
        const owner = ownerToLegacy(first.owner as SpellTargetOwnership | undefined);
        if (!owner) return acc;
        const cardA = extractCardDetails(first);
        const cardB = extractCardDetails(second);
        const casterName = (entry as { caster?: unknown }).caster;
        acc.push({
          side: owner,
          laneA: laneA as number,
          laneB: laneB as number,
          cardA: {
            cardId: first.cardId,
            cardName: cardA.cardName,
            lane: cardA.lane,
            cardValue: cardA.cardValue,
            location: cardA.location,
          },
          cardB: {
            cardId: second.cardId,
            cardName: cardB.cardName,
            lane: cardB.lane,
            cardValue: cardB.cardValue,
            location: cardB.location,
          },
          casterName: typeof casterName === "string" ? casterName : undefined,
        });
        return acc;
      }, [])
    : [];
  const positionSwaps = positionSwapsList.length > 0 ? positionSwapsList : undefined;

  const initiativeChallengesList = Array.isArray(runtimeState.initiativeChallenges)
    ? runtimeState.initiativeChallenges.reduce<
        Array<{
          side: LegacySide;
          lane: number;
          cardId: string;
          cardName?: string;
          mode: "higher" | "lower";
          casterName?: string;
        }>
      >((acc, entry: unknown) => {
        if (!entry || typeof entry !== "object") return acc;
        const target = (entry as { target?: unknown }).target;
        if (!target || typeof target !== "object" || (target as { type?: unknown }).type !== "card") {
          return acc;
        }
        const cardId = (target as { cardId?: unknown }).cardId;
        if (typeof cardId !== "string") return acc;
        const lane = (target as { lane?: unknown }).lane;
        if (!Number.isInteger(lane)) return acc;
        const owner = ownerToLegacy((target as { owner?: unknown }).owner as SpellTargetOwnership | undefined);
        if (!owner) return acc;
        const mode = (entry as { mode?: unknown }).mode;
        const normalizedMode = mode === "lower" ? "lower" : "higher";
        const details = extractCardDetails(target as SpellTargetInstance | undefined);
        const casterName = (entry as { caster?: unknown }).caster;
        acc.push({
          side: owner,
          lane: lane as number,
          cardId,
          cardName: details.cardName,
          mode: normalizedMode,
          casterName: typeof casterName === "string" ? casterName : undefined,
        });
        return acc;
      }, [])
    : [];
  const initiativeChallenges = initiativeChallengesList.length > 0 ? initiativeChallengesList : undefined;

  const runtimeSummary = collectRuntimeSpellEffects(runtimeState, descriptor.side);

  const effectPayload: SpellEffectPayload = { caster: descriptor.side, casterName: caster.name };
  if (mirrorCopyEffects && mirrorCopyEffects.length > 0) {
    effectPayload.mirrorCopyEffects = mirrorCopyEffects;
  }
  if (wheelTokenAdjustments && wheelTokenAdjustments.length > 0) {
    effectPayload.wheelTokenAdjustments = wheelTokenAdjustments;
  }
  if (reserveDrains && reserveDrains.length > 0) {
    effectPayload.reserveDrains = reserveDrains;
  }
  if (runtimeSummary.drawCards && runtimeSummary.drawCards.length > 0) {
    effectPayload.drawCards = runtimeSummary.drawCards;
  }
  if (handAdjustments && handAdjustments.length > 0) {
    effectPayload.handAdjustments = handAdjustments;
  }
  if (handDiscards && handDiscards.length > 0) {
    effectPayload.handDiscards = handDiscards;
  }
  if (positionSwaps && positionSwaps.length > 0) {
    effectPayload.positionSwaps = positionSwaps;
  }
  if (initiativeChallenges && initiativeChallenges.length > 0) {
    effectPayload.initiativeChallenges = initiativeChallenges;
  }
  if (runtimeSummary.cardAdjustments && runtimeSummary.cardAdjustments.length > 0) {
    effectPayload.cardAdjustments = runtimeSummary.cardAdjustments;
  }
  if (runtimeSummary.chilledCards && runtimeSummary.chilledCards.length > 0) {
    effectPayload.chilledCards = runtimeSummary.chilledCards;
  }
  if (runtimeSummary.delayedEffects && runtimeSummary.delayedEffects.length > 0) {
    effectPayload.delayedEffects = runtimeSummary.delayedEffects;
  }
  if (runtimeSummary.initiative) {
    effectPayload.initiative = runtimeSummary.initiative;
  }

  const hasEffect =
    (effectPayload.mirrorCopyEffects?.length ?? 0) > 0 ||
    (effectPayload.wheelTokenAdjustments?.length ?? 0) > 0 ||
    (effectPayload.reserveDrains?.length ?? 0) > 0 ||
    (effectPayload.drawCards?.length ?? 0) > 0 ||
    (effectPayload.cardAdjustments?.length ?? 0) > 0 ||
    (effectPayload.handAdjustments?.length ?? 0) > 0 ||
    (effectPayload.handDiscards?.length ?? 0) > 0 ||
    (effectPayload.positionSwaps?.length ?? 0) > 0 ||
    (effectPayload.initiativeChallenges?.length ?? 0) > 0 ||
    (effectPayload.chilledCards?.length ?? 0) > 0 ||
    (effectPayload.delayedEffects?.length ?? 0) > 0 ||
    Boolean(effectPayload.initiative);

  for (const key of RUNTIME_CLEANUP_KEYS) {
    if (key in runtimeState) {
      delete (runtimeState as Record<string, unknown>)[key as string];
    }
  }

  return {
    outcome: "success",
    payload: hasEffect ? effectPayload : null,
    manaRefund: 0,
  };
}

export type AssignmentState<CardT> = {
  player: (CardT | null)[];
  enemy: (CardT | null)[];
};

export type ReserveState = {
  player: number;
  enemy: number;
};

export type SpellEffectApplicationContext<CardT> = {
  assignSnapshot: AssignmentState<CardT>;
  updateAssignments: (updater: (prev: AssignmentState<CardT>) => AssignmentState<CardT>) => void;
  updateReserveSums: (updater: (prev: ReserveState | null) => ReserveState | null) => void;
  updateTokens: (updater: (prev: [number, number, number]) => [number, number, number]) => void;
  updateLaneChillStacks: (updater: (prev: LaneChillStacks) => LaneChillStacks) => void;
  setInitiative: (side: LegacySide) => void;
  appendLog: (message: string, options?: { type?: "general" | "spell" }) => void;
  initiative: LegacySide;
  isMultiplayer: boolean;
  broadcastEffects?: (payload: SpellEffectPayload) => void;
  updateTokenVisual?: (wheelIndex: number, value: number) => void;
  applyReservePenalty?: (side: LegacySide, amount: number) => void;
  startingTokens?: [number, number, number];
  updateRoundStartTokens?: (tokens: [number, number, number]) => void;
  updateFighter: (side: LegacySide, updater: (fighter: Fighter) => Fighter) => void;
};

type CardLikeWithValues = { number?: number | null; leftValue?: number | null; rightValue?: number | null };

function getCardValue(card: CardLikeWithValues | null | undefined): number {
  if (!card) return 0;
  if (typeof card.number === "number" && Number.isFinite(card.number)) {
    return card.number;
  }
  if (typeof card.leftValue === "number" && Number.isFinite(card.leftValue)) {
    return card.leftValue;
  }
  if (typeof card.rightValue === "number" && Number.isFinite(card.rightValue)) {
    return card.rightValue;
  }
  return 0;
}

function computeWheelTokenTargets<CardT extends { id: string }>(
  assignState: AssignmentState<CardT>,
): [number, number, number] {
  const next: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const playerValue = getCardValue(assignState.player[i] as CardLikeWithValues | null);
    const enemyValue = getCardValue(assignState.enemy[i] as CardLikeWithValues | null);
    const total = playerValue + enemyValue;
    const normalized = ((total % SLICES) + SLICES) % SLICES;
    next[i] = normalized;
  }
  return next;
}

export function applySpellEffects<CardT extends { id: string }>(
  payload: SpellEffectPayload,
  context: SpellEffectApplicationContext<CardT>,
  options?: { broadcast?: boolean },
): void {
  const {
    assignSnapshot,
    updateAssignments,
    updateReserveSums,
    updateTokens,
    updateLaneChillStacks,
    setInitiative,
    appendLog,
    initiative,
    isMultiplayer,
    broadcastEffects,
    updateTokenVisual,
    applyReservePenalty,
    startingTokens,
    updateRoundStartTokens,
    updateFighter,
  } = context;

  const {
    casterName: payloadCasterName,
    mirrorCopyEffects,
    wheelTokenAdjustments,
    reserveDrains,
    drawCards,
    cardAdjustments,
    handAdjustments,
    handDiscards,
    positionSwaps,
    initiativeChallenges,
    chilledCards,
    delayedEffects,
    initiative: initiativeTarget,
  } = payload;

  const defaultNameForSide = (side: LegacySide) => (side === "player" ? "Player" : "Enemy");
  const baseCasterName =
    typeof payloadCasterName === "string" && payloadCasterName.trim().length > 0
      ? payloadCasterName.trim()
      : defaultNameForSide(payload.caster);
  const resolveCasterName = (name?: string): string => {
    if (typeof name === "string" && name.trim().length > 0) return name.trim();
    return baseCasterName;
  };
  const logEntries: string[] = [];

  const readCardStat = (
    card: CardLikeWithValues | null | undefined,
    key: "number" | "leftValue" | "rightValue",
  ): number | null => {
    if (!card) return null;
    const raw = (card as Record<typeof key, unknown>)[key];
    return typeof raw === "number" && Number.isFinite(raw) ? (raw as number) : null;
  };

  const extractNameFromCard = (card: CardT | null | undefined): string | undefined => {
    if (!card) return undefined;
    const name = (card as { name?: unknown }).name;
    if (typeof name === "string" && name.trim().length > 0) {
      return name.trim();
    }
    return undefined;
  };

  const formatCardLabel = (
    card: CardT | null | undefined,
    fallbackName?: string,
    fallbackId?: string,
  ): string => {
    const primary = extractNameFromCard(card);
    if (primary) return primary;
    if (typeof fallbackName === "string" && fallbackName.trim().length > 0) {
      return fallbackName.trim();
    }
    if (typeof fallbackId === "string" && fallbackId.trim().length > 0) {
      return `card ${fallbackId.trim()}`;
    }
    return "a card";
  };

  const formatLaneLabel = (lane: number | null | undefined): string => {
    if (typeof lane === "number" && Number.isInteger(lane) && lane >= 0) {
      return `lane ${lane + 1}`;
    }
    return "the lane";
  };

  const describeSwapCard = (
    card: CardT | null | undefined,
    fallback?: { cardName?: string; cardId?: string },
  ): string => {
    if (!card) {
      const fallbackName = fallback?.cardName;
      if (typeof fallbackName === "string" && fallbackName.trim().length > 0) {
        return fallbackName.trim();
      }
      const fallbackId = fallback?.cardId;
      if (typeof fallbackId === "string" && fallbackId.trim().length > 0) {
        return `card ${fallbackId.trim()}`;
      }
      return "an empty slot";
    }
    return formatCardLabel(card, fallback?.cardName, fallback?.cardId);
  };

  let mirrorUpdatedAssignments: AssignmentState<CardT> | null = null;
  let latestAssignments: AssignmentState<CardT> = assignSnapshot;
  const mirrorLogs: string[] = [];
  if (mirrorCopyEffects?.length) {
    updateAssignments((prev) => {
      let nextPlayer = prev.player;
      let nextEnemy = prev.enemy;
      let changed = false;

      mirrorCopyEffects.forEach((effect) => {
        if (!effect || typeof effect.targetCardId !== "string") return;

        let side: LegacySide | null = null;
        let laneIndex = prev.player.findIndex((card) => card?.id === effect.targetCardId);
        if (laneIndex !== -1) {
          side = "player";
        } else {
          laneIndex = prev.enemy.findIndex((card) => card?.id === effect.targetCardId);
          if (laneIndex !== -1) {
            side = "enemy";
          }
        }

        if (side === null || laneIndex < 0) return;

        const targetLane = side === "player" ? prev.player : prev.enemy;
        const targetCard = targetLane[laneIndex];
        if (!targetCard) return;

        const opponentSide: LegacySide =
          effect.mode === "opponent" ? (side === "player" ? "enemy" : "player") : side;
        const sourceLane = opponentSide === "player" ? prev.player : prev.enemy;
        const sourceCard = sourceLane[laneIndex];
        if (!sourceCard) return;

        const copied: CardT = {
          ...(targetCard as CardT),
          ...(sourceCard as Partial<CardT>),
        };
        if (Array.isArray((sourceCard as Record<string, unknown>).tags)) {
          (copied as Record<string, unknown>).tags = [
            ...((sourceCard as Record<string, unknown>).tags as unknown[]),
          ];
        }

        if (side === "player") {
          if (nextPlayer === prev.player) nextPlayer = [...prev.player];
          nextPlayer[laneIndex] = copied;
        } else {
          if (nextEnemy === prev.enemy) nextEnemy = [...prev.enemy];
          nextEnemy[laneIndex] = copied;
        }
        changed = true;

        const targetLabel = formatCardLabel(targetCard as CardT | null, effect.cardName, effect.targetCardId);
        const laneLabel = formatLaneLabel(Number.isInteger(effect.lane) ? (effect.lane as number) : laneIndex);
        const sourceDescriptor = effect.mode === "opponent" ? "their foe" : "their ally";
        mirrorLogs.push(`${baseCasterName} mirrored ${targetLabel} on ${laneLabel} against ${sourceDescriptor}.`);
      });

      if (!changed) return prev;
      const updated = { player: nextPlayer, enemy: nextEnemy };
      mirrorUpdatedAssignments = updated;
      latestAssignments = updated;
      return updated;
    });
  }

  mirrorLogs.forEach((entry) => {
    if (entry.trim().length > 0) logEntries.push(entry);
  });

  const previewTokenTargets = (targets: [number, number, number]) => {
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i] ?? 0;
      const visual = ((target % SLICES) + SLICES) % SLICES;
      updateTokenVisual?.(i, visual);
    }
  };

  if (mirrorUpdatedAssignments) {
    const nextTokenSteps = computeWheelTokenTargets(mirrorUpdatedAssignments);
    previewTokenTargets(nextTokenSteps);
  }

  const wheelLogs: string[] = [];
  if (wheelTokenAdjustments?.length) {
    const tokenUpdates = new Map<number, number>();
    let persistedTokens: [number, number, number] | null = null;
    updateTokens((prev) => {
      let next = prev;
      let changed = false;

      wheelTokenAdjustments.forEach((adjustment) => {
        if (!adjustment) return;
        const idx = adjustment.wheelIndex;
        if (!Number.isInteger(idx) || idx < 0 || idx >= prev.length) return;
        const current = next === prev ? prev[idx] : next[idx];
        const raw = current + adjustment.amount;
        const updated = ((raw % SLICES) + SLICES) % SLICES;
        if (updated === current) return;
        if (!changed) next = [...prev] as [number, number, number];
        next[idx] = updated;
        changed = true;
        tokenUpdates.set(idx, updated);
        const casterDisplay = resolveCasterName(adjustment.casterName);
        const magnitude = Math.abs(adjustment.amount);
        const direction = adjustment.amount >= 0 ? "advanced" : "reversed";
        wheelLogs.push(
          `${casterDisplay} ${direction} wheel ${idx + 1} by ${magnitude} (now ${updated}).`,
        );
      });

      if (!changed) return prev;
      persistedTokens = next as [number, number, number];
      return next;
    });

    tokenUpdates.forEach((value, index) => {
      updateTokenVisual?.(index, value);
    });

    if (persistedTokens) {
      updateRoundStartTokens?.(persistedTokens);
    }
  }

  wheelLogs.forEach((entry) => {
    if (entry.trim().length > 0) logEntries.push(entry);
  });

  const reserveChangeSummaries: Array<{
    casterName: string;
    side: LegacySide;
    amount: number;
    before: number;
    after: number;
    cardName?: string;
  }> = [];
  if (reserveDrains?.length) {
    updateReserveSums((prev) => {
      if (!prev) return prev;
      let next = prev;
      let changed = false;

      reserveDrains.forEach((drain) => {
        if (!drain) return;
        const side = drain.side;
        const amount = drain.amount;
        if (typeof amount !== "number" || !Number.isFinite(amount)) return;
        const current = next === prev ? prev[side] ?? 0 : next[side] ?? 0;
        const updated = Math.max(0, current - amount);
        if (updated === current) return;
        if (!changed) next = { ...prev } as ReserveState;
        next[side] = updated;
        changed = true;
        reserveChangeSummaries.push({
          casterName: resolveCasterName(drain.casterName),
          side,
          amount,
          before: current,
          after: updated,
          cardName: drain.cardName,
        });
      });

      if (!changed) return prev;
      return next;
    });
    reserveDrains.forEach((drain) => {
      if (!drain) return;
      const { side, amount } = drain;
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return;
      applyReservePenalty?.(side, amount);
    });
  }

  if (reserveChangeSummaries.length > 0) {
    reserveChangeSummaries.forEach((summary) => {
      const sideDescriptor = summary.side === payload.caster ? "their reserve" : "the foe's reserve";
      const via = summary.cardName ? ` via ${summary.cardName}` : "";
      logEntries.push(
        `${summary.casterName} drained ${summary.amount} from ${sideDescriptor}${via} (now ${summary.after}).`,
      );
    });
  } else if ((reserveDrains ?? []).length > 0) {
    (reserveDrains ?? []).forEach((drain) => {
      const sideDescriptor = drain.side === payload.caster ? "their reserve" : "the foe's reserve";
      const via = drain.cardName ? ` via ${drain.cardName}` : "";
      logEntries.push(
        `${resolveCasterName(drain.casterName)} drained ${drain.amount} from ${sideDescriptor}${via}.`,
      );
    });
  }

  const cardAdjustmentLogs: string[] = [];
  if (cardAdjustments?.length) {
    let updatedAssignments: AssignmentState<CardT> | null = null;
    updateAssignments((prev) => {
      const updated = applyCardStatAdjustments(prev, cardAdjustments as CardStatAdjustment[]);
      if (updated) {
        cardAdjustments.forEach((adj) => {
          if (!adj || typeof adj.cardId !== "string") return;
          const owner = adj.owner;
          const prevLanes = owner === "player" ? prev.player : prev.enemy;
          const laneIndex =
            Number.isInteger(adj.lane) && (adj.lane as number) >= 0
              ? (adj.lane as number)
              : prevLanes.findIndex((card) => card?.id === adj.cardId);
          if (laneIndex < 0) return;
          const beforeCard = prevLanes[laneIndex] as CardLikeWithValues | null;
          const afterLanes = owner === "player" ? updated.player : updated.enemy;
          const afterCard = afterLanes[laneIndex] as CardLikeWithValues | null;
          if (!afterCard && !beforeCard) return;

          const displayCard = (afterCard as CardT | null) ?? (beforeCard as CardT | null);
          const cardLabel = formatCardLabel(displayCard, adj.cardName, adj.cardId);

          const prevNumber =
            typeof adj.cardValue === "number" && Number.isFinite(adj.cardValue)
              ? Math.round(adj.cardValue)
              : readCardStat(beforeCard, "number") ?? 0;
          const nextNumber = readCardStat(afterCard, "number") ?? prevNumber;
          const deltaNumber =
            typeof adj.numberDelta === "number" && Number.isFinite(adj.numberDelta)
              ? Math.round(adj.numberDelta)
              : nextNumber - prevNumber;
          if (deltaNumber < 0) {
            cardAdjustmentLogs.push(
              `${baseCasterName} dealt ${Math.abs(deltaNumber)} to ${cardLabel} (now ${nextNumber}).`,
            );
          } else if (deltaNumber > 0) {
            cardAdjustmentLogs.push(
              `${baseCasterName} boosted ${cardLabel} by ${deltaNumber} (now ${nextNumber}).`,
            );
          }

          const prevLeft =
            typeof adj.leftValue === "number" && Number.isFinite(adj.leftValue)
              ? Math.round(adj.leftValue)
              : readCardStat(beforeCard, "leftValue");
          const nextLeft = readCardStat(afterCard, "leftValue");
          const leftDelta =
            typeof adj.leftValueDelta === "number" && Number.isFinite(adj.leftValueDelta)
              ? Math.round(adj.leftValueDelta)
              : typeof prevLeft === "number" && typeof nextLeft === "number"
              ? nextLeft - prevLeft
              : 0;
          if (leftDelta !== 0 && typeof nextLeft === "number") {
            cardAdjustmentLogs.push(
              `${baseCasterName} shifted ${cardLabel}'s left value by ${leftDelta} (now ${nextLeft}).`,
            );
          }

          const prevRight =
            typeof adj.rightValue === "number" && Number.isFinite(adj.rightValue)
              ? Math.round(adj.rightValue)
              : readCardStat(beforeCard, "rightValue");
          const nextRight = readCardStat(afterCard, "rightValue");
          const rightDelta =
            typeof adj.rightValueDelta === "number" && Number.isFinite(adj.rightValueDelta)
              ? Math.round(adj.rightValueDelta)
              : typeof prevRight === "number" && typeof nextRight === "number"
              ? nextRight - prevRight
              : 0;
          if (rightDelta !== 0 && typeof nextRight === "number") {
            cardAdjustmentLogs.push(
              `${baseCasterName} shifted ${cardLabel}'s right value by ${rightDelta} (now ${nextRight}).`,
            );
          }
        });
        updatedAssignments = updated;
        latestAssignments = updated;
        return updated;
      }
      return prev;
    });

    if (updatedAssignments) {
      const nextTokenSteps = computeWheelTokenTargets(updatedAssignments);
      previewTokenTargets(nextTokenSteps);
    }
  }

  cardAdjustmentLogs.forEach((entry) => {
    if (entry.trim().length > 0) logEntries.push(entry);
  });

  const handAdjustmentLogs: string[] = [];
  if (handAdjustments?.length) {
    handAdjustments.forEach((adjustment) => {
      updateFighter(adjustment.side, (fighter) => {
        const index = fighter.hand.findIndex((card) => card.id === adjustment.cardId);
        if (index === -1) return fighter;
        const currentCard = fighter.hand[index];
        if (!currentCard) return fighter;
        const nextHand = [...fighter.hand];
        const updatedCard = { ...currentCard } as typeof currentCard;
        if (typeof adjustment.numberDelta === "number" && Number.isFinite(adjustment.numberDelta)) {
          const currentValue = typeof updatedCard.number === "number" ? updatedCard.number : 0;
          const nextValue = Math.max(0, Math.round(currentValue + adjustment.numberDelta));
          if (nextValue !== currentValue) {
            updatedCard.number = nextValue;
            const delta = nextValue - currentValue;
            const cardLabel = formatCardLabel(
              currentCard as unknown as CardT,
              adjustment.cardName,
              adjustment.cardId,
            );
            const actorName = baseCasterName;
            if (delta >= 0) {
              handAdjustmentLogs.push(
                `${actorName} boosted reserve card ${cardLabel} by ${delta} (now ${nextValue}).`,
              );
            } else {
              handAdjustmentLogs.push(
                `${actorName} reduced reserve card ${cardLabel} by ${Math.abs(delta)} (now ${nextValue}).`,
              );
            }
          }
        }
        if (nextHand[index] === updatedCard) return fighter;
        nextHand[index] = updatedCard;
        return { ...fighter, hand: nextHand };
      });
    });
  }

  handAdjustmentLogs.forEach((entry) => {
    if (entry.trim().length > 0) logEntries.push(entry);
  });

  const handDiscardLogs: string[] = [];
  if (handDiscards?.length) {
    handDiscards.forEach((discard) => {
      updateFighter(discard.side, (fighter) => {
        const index = fighter.hand.findIndex((card) => card.id === discard.cardId);
        if (index === -1) return fighter;
        const nextHand = [...fighter.hand];
        const [removed] = nextHand.splice(index, 1);
        const nextDiscard = removed ? [...fighter.discard, removed] : [...fighter.discard];
        if (removed) {
          const cardLabel = formatCardLabel(
            removed as unknown as CardT,
            discard.cardName,
            discard.cardId,
          );
          handDiscardLogs.push(`${baseCasterName} discarded ${cardLabel} from reserve.`);
        }
        return { ...fighter, hand: nextHand, discard: nextDiscard };
      });
    });
  }

  handDiscardLogs.forEach((entry) => {
    if (entry.trim().length > 0) logEntries.push(entry);
  });

  const drawLogs: string[] = [];
  if (drawCards?.length) {
    drawCards.forEach((request) => {
      if (!request) return;
      const side = request.side;
      const rawCount = request.count;
      if (side !== "player" && side !== "enemy") return;
      const normalizedCount =
        typeof rawCount === "number" && Number.isFinite(rawCount)
          ? Math.max(0, Math.floor(rawCount))
          : 0;
      if (normalizedCount <= 0) return;

      updateFighter(side, (fighter) => {
        const deckSize = fighter.deck.length;
        if (deckSize <= 0) return fighter;
        const drawAmount = Math.min(normalizedCount, deckSize);
        if (drawAmount <= 0) return fighter;
        const drawnCards = fighter.deck.slice(0, drawAmount);
        if (drawnCards.length === 0) return fighter;
        const nextDeck = fighter.deck.slice(drawAmount);
        const nextHand = [...fighter.hand, ...drawnCards];
        const actorName =
          typeof request.casterName === "string" && request.casterName.trim().length > 0
            ? request.casterName.trim()
            : side === payload.caster
            ? baseCasterName
            : defaultNameForSide(side);
        drawLogs.push(
          `${actorName} drew ${drawAmount} card${drawAmount === 1 ? "" : "s"}.`,
        );
        return { ...fighter, deck: nextDeck, hand: nextHand };
      });
    });
  }

  drawLogs.forEach((entry) => {
    if (entry.trim().length > 0) logEntries.push(entry);
  });

  const swapLogs: string[] = [];
  if (positionSwaps?.length) {
    updateAssignments((prev) => {
      let nextPlayer = prev.player;
      let nextEnemy = prev.enemy;
      let changed = false;

      positionSwaps.forEach((swap) => {
        const side = swap.side;
        const laneA = swap.laneA;
        const laneB = swap.laneB;
        if (!Number.isInteger(laneA) || !Number.isInteger(laneB)) return;
        const lanes = side === "player" ? prev.player : prev.enemy;
        if (
          laneA < 0 ||
          laneB < 0 ||
          laneA >= lanes.length ||
          laneB >= lanes.length ||
          laneA === laneB
        ) {
          return;
        }

        const baseline = side === "player" ? prev.player : prev.enemy;
        const working = side === "player" ? nextPlayer : nextEnemy;
        const targetArray: (CardT | null)[] = working === baseline ? [...baseline] : [...working];
        const cardABefore = lanes[laneA] as CardT | null;
        const cardBBefore = lanes[laneB] as CardT | null;
        const cardALabel = describeSwapCard(cardABefore, swap.cardA);
        const cardBLabel = describeSwapCard(cardBBefore, swap.cardB);
        const valueA = getCardValue(cardABefore as CardLikeWithValues | null);
        const valueB = getCardValue(cardBBefore as CardLikeWithValues | null);
        const laneLabelA = formatLaneLabel(laneA);
        const laneLabelB = formatLaneLabel(laneB);
        const temp = targetArray[laneA];
        targetArray[laneA] = targetArray[laneB];
        targetArray[laneB] = temp;
        if (side === "player") nextPlayer = targetArray;
        else nextEnemy = targetArray;
        changed = true;
        const actorName = resolveCasterName(swap.casterName);
        swapLogs.push(
          `${actorName} swapped ${laneLabelA} (${cardALabel} ${valueA}) with ${laneLabelB} (${cardBLabel} ${valueB}).`,
        );
      });

      if (!changed) return prev;
      const updated = { player: nextPlayer, enemy: nextEnemy } as AssignmentState<CardT>;
      latestAssignments = updated;
      return updated;
    });
  }

  swapLogs.forEach((entry) => {
    if (entry.trim().length > 0) logEntries.push(entry);
  });

  const chillLogs: string[] = [];
  if (chilledCards?.length) {
    let prevStacksSnapshot: LaneChillStacks | null = null;
    let nextStacksSnapshot: LaneChillStacks | null = null;
    updateLaneChillStacks((prev) => {
      prevStacksSnapshot = prev;
      const updated = applyChilledCardUpdates(prev, latestAssignments, chilledCards as ChilledCardUpdate[]);
      if (updated) {
        nextStacksSnapshot = updated;
        return updated;
      }
      return prev;
    });

    chilledCards.forEach((update) => {
      if (!update) return;
      const owner = update.owner;
      const lanes = owner === "player" ? latestAssignments.player : latestAssignments.enemy;
      let laneIndex =
        Number.isInteger(update.lane) && (update.lane as number) >= 0
          ? (update.lane as number)
          : lanes.findIndex((card) => card?.id === update.cardId);
      if (laneIndex < 0) return;
      const card = lanes[laneIndex] as CardT | null;
      const cardLabel = formatCardLabel(card, update.cardName, update.cardId);
      const laneLabel = formatLaneLabel(laneIndex);
      const stacksArray = nextStacksSnapshot
        ? owner === "player"
          ? nextStacksSnapshot.player
          : nextStacksSnapshot.enemy
        : prevStacksSnapshot
        ? owner === "player"
          ? prevStacksSnapshot.player
          : prevStacksSnapshot.enemy
        : null;
      const stackCount = stacksArray ? stacksArray[laneIndex] ?? 0 : update.stacks;
      chillLogs.push(`${baseCasterName} chilled ${cardLabel} on ${laneLabel} (${stackCount} stacks).`);
    });
  }

  chillLogs.forEach((entry) => {
    if (entry.trim().length > 0) logEntries.push(entry);
  });

  const initiativeLogs: string[] = [];
  if (initiativeChallenges?.length) {
    initiativeChallenges.forEach((challenge) => {
      const laneIndex = challenge.lane;
      if (!Number.isInteger(laneIndex)) return;
      const challengerSide = challenge.side;
      const opponentSide = challengerSide === "player" ? "enemy" : "player";
      const challengerLanes = challengerSide === "player" ? latestAssignments.player : latestAssignments.enemy;
      const opponentLanes = opponentSide === "player" ? latestAssignments.player : latestAssignments.enemy;
      const challengerCard = challengerLanes[laneIndex as number] as CardLikeWithValues | null;
      const opponentCard = opponentLanes[laneIndex as number] as CardLikeWithValues | null;
      const challengerValue = getCardValue(challengerCard);
      const opponentValue = getCardValue(opponentCard);
      const success =
        challenge.mode === "lower" ? challengerValue < opponentValue : challengerValue > opponentValue;
      if (success) {
        setInitiative(challengerSide);
      }
      const actorName = challenge.casterName
        ? resolveCasterName(challenge.casterName)
        : challengerSide === payload.caster
        ? baseCasterName
        : defaultNameForSide(challengerSide);
      const cardLabel = formatCardLabel(challengerCard as CardT | null, challenge.cardName, challenge.cardId);
      const laneLabel = formatLaneLabel(laneIndex as number);
      if (success) {
        const verb = challenge.mode === "lower" ? "outpaced" : "overpowered";
        initiativeLogs.push(
          `${actorName}'s ${cardLabel} on ${laneLabel} ${verb} the foe (${challengerValue} vs ${opponentValue}) to seize initiative.`,
        );
      } else {
        const verb = challenge.mode === "lower" ? "slip under" : "overpower";
        initiativeLogs.push(
          `${actorName}'s ${cardLabel} on ${laneLabel} couldn't ${verb} the foe (${challengerValue} vs ${opponentValue}).`,
        );
      }
    });
  }

  if (initiativeTarget && initiativeTarget !== initiative) {
    setInitiative(initiativeTarget);
    const actorName = initiativeTarget === payload.caster ? baseCasterName : defaultNameForSide(initiativeTarget);
    initiativeLogs.push(`${actorName} claimed initiative.`);
  }

  initiativeLogs.forEach((entry) => {
    if (entry.trim().length > 0) logEntries.push(entry);
  });

  if (Array.isArray(delayedEffects)) {
    delayedEffects.forEach((entry) => {
      if (typeof entry === "string" && entry.trim().length > 0) {
        logEntries.push(entry.trim());
      }
    });
  }

  logEntries.forEach((entry) => {
    if (entry.trim().length > 0) {
      appendLog(entry.trim(), { type: "spell" });
    }
  });

  const shouldBroadcast = options?.broadcast ?? true;
  if (shouldBroadcast && isMultiplayer && broadcastEffects) {
    broadcastEffects(payload);
  }
}

