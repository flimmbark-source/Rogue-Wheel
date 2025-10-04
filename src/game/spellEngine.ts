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
  "log",
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

  const mirrorCopyEffects = Array.isArray(runtimeState.mirrorCopyEffects)
    ? runtimeState.mirrorCopyEffects
        .map((effect: unknown) => {
          if (!effect || typeof effect !== "object") return null;
          const targetCardId = (effect as { targetCardId?: unknown }).targetCardId;
          if (typeof targetCardId !== "string") return null;
          const mode = (effect as { mode?: unknown }).mode;
          return {
            targetCardId,
            mode: typeof mode === "string" ? mode : undefined,
          };
        })
        .filter((effect): effect is { targetCardId: string; mode: string | undefined } => effect !== null)
    : undefined;

  const wheelTokenAdjustments = Array.isArray(runtimeState.wheelTokenAdjustments)
    ? runtimeState.wheelTokenAdjustments
        .map((entry: unknown) => {
          if (!entry || typeof entry !== "object") return null;
          const amount = (entry as { amount?: unknown }).amount;
          if (typeof amount !== "number") return null;
          const target = (entry as { target?: unknown }).target;
          if (!target || typeof target !== "object") return null;
          const targetType = (target as { type?: unknown }).type;
          const wheelId = (target as { wheelId?: unknown }).wheelId;
          if (targetType !== "wheel" || typeof wheelId !== "string") return null;
          const idx = Number.parseInt(wheelId, 10);
          if (!Number.isInteger(idx)) return null;
          return { wheelIndex: idx, amount };
        })
        .filter((entry): entry is { wheelIndex: number; amount: number } => entry !== null)
    : undefined;

  const reserveDrains = Array.isArray(runtimeState.reserveDrains)
    ? runtimeState.reserveDrains
        .map((entry: unknown) => {
          if (!entry || typeof entry !== "object") return null;
          const amount = (entry as { amount?: unknown }).amount;
          if (typeof amount !== "number") return null;

          let targetSide: LegacySide | null = null;
          const target = (entry as { target?: unknown }).target;
          if (target && typeof target === "object" && (target as { type?: unknown }).type === "card") {
            const owner = (target as { owner?: unknown }).owner as SpellTargetOwnership | undefined;
            targetSide = ownerToLegacy(owner);
          }

          if (!targetSide) {
            targetSide = opponentSideLegacy;
          }

          return { side: targetSide, amount };
        })
        .filter((entry): entry is { side: LegacySide; amount: number } => entry !== null)
    : undefined;

  const rawHandAdjustments = Array.isArray(runtimeState.handAdjustments)
    ? runtimeState.handAdjustments.reduce<
        Array<{ side: LegacySide; cardId: string; numberDelta?: number }>
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
        acc.push({
          side: owner,
          cardId,
          numberDelta: typeof numberDelta === "number" ? numberDelta : undefined,
        });
        return acc;
      }, [])
    : undefined;

  const handAdjustments = rawHandAdjustments && rawHandAdjustments.length > 0 ? rawHandAdjustments : undefined;

  const rawHandDiscards = Array.isArray(runtimeState.handDiscards)
    ? runtimeState.handDiscards.reduce<Array<{ side: LegacySide; cardId: string }>>(
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
          acc.push({ side: owner, cardId });
          return acc;
        },
        [],
      )
    : undefined;

  const handDiscards = rawHandDiscards && rawHandDiscards.length > 0 ? rawHandDiscards : undefined;

  const positionSwaps = Array.isArray(runtimeState.positionSwaps)
    ? runtimeState.positionSwaps
        .map((entry: unknown) => {
          if (!entry || typeof entry !== "object") return null;
          const first = (entry as { first?: unknown }).first;
          const second = (entry as { second?: unknown }).second;
          if (
            !first ||
            typeof first !== "object" ||
            (first as { type?: unknown }).type !== "card" ||
            !second ||
            typeof second !== "object" ||
            (second as { type?: unknown }).type !== "card"
          ) {
            return null;
          }
          const laneA = (first as { lane?: unknown }).lane;
          const laneB = (second as { lane?: unknown }).lane;
          if (!Number.isInteger(laneA) || !Number.isInteger(laneB)) return null;
          const owner = ownerToLegacy((first as { owner?: unknown }).owner as SpellTargetOwnership | undefined);
          if (!owner) return null;
          return { side: owner, laneA: laneA as number, laneB: laneB as number };
        })
        .filter((entry): entry is { side: LegacySide; laneA: number; laneB: number } => entry !== null)
    : undefined;

  const initiativeChallenges = Array.isArray(runtimeState.initiativeChallenges)
    ? runtimeState.initiativeChallenges
        .map((entry: unknown) => {
          if (!entry || typeof entry !== "object") return null;
          const target = (entry as { target?: unknown }).target;
          if (!target || typeof target !== "object" || (target as { type?: unknown }).type !== "card") {
            return null;
          }
          const cardId = (target as { cardId?: unknown }).cardId;
          if (typeof cardId !== "string") return null;
          const lane = (target as { lane?: unknown }).lane;
          if (!Number.isInteger(lane)) return null;
          const owner = ownerToLegacy((target as { owner?: unknown }).owner as SpellTargetOwnership | undefined);
          if (!owner) return null;
          const mode = (entry as { mode?: unknown }).mode;
          const normalizedMode = mode === "lower" ? "lower" : "higher";
          return { side: owner, lane: lane as number, cardId, mode: normalizedMode };
        })
        .filter(
          (entry): entry is { side: LegacySide; lane: number; cardId: string; mode: "higher" | "lower" } =>
            entry !== null,
        )
    : undefined;

  const logMessages = Array.isArray(runtimeState.log)
    ? runtimeState.log.filter((entry: unknown): entry is string => typeof entry === "string")
    : undefined;

  const runtimeSummary = collectRuntimeSpellEffects(runtimeState, descriptor.side);

  const effectPayload: SpellEffectPayload = { caster: descriptor.side };
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
  if (logMessages && logMessages.length > 0) {
    effectPayload.logMessages = logMessages;
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
    Boolean(effectPayload.initiative) ||
    (effectPayload.logMessages?.length ?? 0) > 0;

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
    logMessages,
  } = payload;

  let mirrorUpdatedAssignments: AssignmentState<CardT> | null = null;
  let latestAssignments: AssignmentState<CardT> = assignSnapshot;
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
      });

      if (!changed) return prev;
      const updated = { player: nextPlayer, enemy: nextEnemy };
      mirrorUpdatedAssignments = updated;
      latestAssignments = updated;
      return updated;
    });
  }

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

  if (cardAdjustments?.length) {
    let updatedAssignments: AssignmentState<CardT> | null = null;
    updateAssignments((prev) => {
      const updated = applyCardStatAdjustments(prev, cardAdjustments as CardStatAdjustment[]);
      if (updated) {
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
          }
        }
        if (nextHand[index] === updatedCard) return fighter;
        nextHand[index] = updatedCard;
        return { ...fighter, hand: nextHand };
      });
    });
  }

  if (handDiscards?.length) {
    handDiscards.forEach((discard) => {
      updateFighter(discard.side, (fighter) => {
        const index = fighter.hand.findIndex((card) => card.id === discard.cardId);
        if (index === -1) return fighter;
        const nextHand = [...fighter.hand];
        const [removed] = nextHand.splice(index, 1);
        const nextDiscard = removed ? [...fighter.discard, removed] : [...fighter.discard];
        return { ...fighter, hand: nextHand, discard: nextDiscard };
      });
    });
  }

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
        return { ...fighter, deck: nextDeck, hand: nextHand };
      });
    });
  }

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
        const temp = targetArray[laneA];
        targetArray[laneA] = targetArray[laneB];
        targetArray[laneB] = temp;
        if (side === "player") nextPlayer = targetArray;
        else nextEnemy = targetArray;
        changed = true;
      });

      if (!changed) return prev;
      const updated = { player: nextPlayer, enemy: nextEnemy } as AssignmentState<CardT>;
      latestAssignments = updated;
      return updated;
    });
  }

  if (chilledCards?.length) {
    updateLaneChillStacks((prev) => {
      const updated = applyChilledCardUpdates(prev, latestAssignments, chilledCards as ChilledCardUpdate[]);
      return updated ?? prev;
    });
  }

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
    });
  }

  if (initiativeTarget && initiativeTarget !== initiative) {
    setInitiative(initiativeTarget);
  }

  if (Array.isArray(logMessages)) {
    logMessages.forEach((entry) => {
      if (typeof entry === "string" && entry.trim().length > 0) {
        appendLog(entry, { type: "spell" });
      }
    });
  }

  if (Array.isArray(delayedEffects)) {
    delayedEffects.forEach((entry) => {
      if (typeof entry === "string" && entry.trim().length > 0) {
        appendLog(entry, { type: "spell" });
      }
    });
  }

  const shouldBroadcast = options?.broadcast ?? true;
  if (shouldBroadcast && isMultiplayer && broadcastEffects) {
    broadcastEffects(payload);
  }
}

