import { SLICES } from "./types.js";
import type { Fighter } from "./types.js";
import {
  applyCardStatAdjustments,
  applyChilledCardUpdates,
} from "../features/threeWheel/utils/spellEffectTransforms.js";
import type {
  CardStatAdjustment,
  ChilledCardUpdate,
  LaneChillStacks,
  LegacySide,
  SpellEffectPayload,
} from "../features/threeWheel/utils/spellEffectTransforms.js";

export type AssignmentState<CardT> = {
  player: (CardT | null)[];
  enemy: (CardT | null)[];
};

export type ReserveState = {
  player: number;
  enemy: number;
};

export type SpellEffectLogEntry = {
  message: string;
  type?: "general" | "spell";
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

export function getCardValue(card: CardLikeWithValues | null | undefined): number {
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

export function computeWheelTokenTargets<CardT extends { id: string }>(
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

type MirrorCopyContext<CardT extends { id: string }> = {
  assignSnapshot: AssignmentState<CardT>;
  updateAssignments: (updater: (prev: AssignmentState<CardT>) => AssignmentState<CardT>) => void;
  previewTokenTargets: (targets: [number, number, number]) => void;
};

export function handleMirrorCopyEffects<CardT extends { id: string }>(
  effects: SpellEffectPayload["mirrorCopyEffects"],
  context: MirrorCopyContext<CardT>,
): { latestAssignments: AssignmentState<CardT>; logEntries: SpellEffectLogEntry[] } {
  let mirrorUpdatedAssignments: AssignmentState<CardT> | null = null;
  let latestAssignments: AssignmentState<CardT> = context.assignSnapshot;

  if (effects?.length) {
    context.updateAssignments((prev) => {
      let nextPlayer = prev.player;
      let nextEnemy = prev.enemy;
      let changed = false;

      effects.forEach((effect) => {
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
      const updated = { player: nextPlayer, enemy: nextEnemy } as AssignmentState<CardT>;
      mirrorUpdatedAssignments = updated;
      latestAssignments = updated;
      return updated;
    });
  }

  if (mirrorUpdatedAssignments) {
    const nextTokenSteps = computeWheelTokenTargets(mirrorUpdatedAssignments);
    context.previewTokenTargets(nextTokenSteps);
    latestAssignments = mirrorUpdatedAssignments;
  }

  return { latestAssignments, logEntries: [] };
}

type WheelTokenContext = {
  updateTokens: (updater: (prev: [number, number, number]) => [number, number, number]) => void;
  updateTokenVisual?: (wheelIndex: number, value: number) => void;
  updateRoundStartTokens?: (tokens: [number, number, number]) => void;
};

export function handleWheelTokenAdjustments(
  adjustments: SpellEffectPayload["wheelTokenAdjustments"],
  context: WheelTokenContext,
): SpellEffectLogEntry[] {
  if (!adjustments?.length) return [];

  const tokenUpdates = new Map<number, number>();
  let persistedTokens: [number, number, number] | null = null;
  context.updateTokens((prev) => {
    let next = prev;
    let changed = false;

    adjustments.forEach((adjustment) => {
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
    context.updateTokenVisual?.(index, value);
  });

  if (persistedTokens) {
    context.updateRoundStartTokens?.(persistedTokens);
  }

  return [];
}

type ReserveDrainContext = {
  updateReserveSums: (updater: (prev: ReserveState | null) => ReserveState | null) => void;
  applyReservePenalty?: (side: LegacySide, amount: number) => void;
};

export function handleReserveDrains(
  drains: SpellEffectPayload["reserveDrains"],
  context: ReserveDrainContext,
): SpellEffectLogEntry[] {
  if (!drains?.length) return [];

  context.updateReserveSums((prev) => {
    if (!prev) return prev;
    let next = prev;
    let changed = false;

    drains.forEach((drain) => {
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

  drains.forEach((drain) => {
    if (!drain) return;
    const { side, amount } = drain;
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return;
    context.applyReservePenalty?.(side, amount);
  });

  return [];
}

type CardAdjustmentContext<CardT extends { id: string }> = {
  updateAssignments: (updater: (prev: AssignmentState<CardT>) => AssignmentState<CardT>) => void;
  previewTokenTargets: (targets: [number, number, number]) => void;
};

export function handleCardAdjustments<CardT extends { id: string }>(
  adjustments: SpellEffectPayload["cardAdjustments"],
  context: CardAdjustmentContext<CardT>,
): { latestAssignments: AssignmentState<CardT> | null; logEntries: SpellEffectLogEntry[] } {
  if (!adjustments?.length) return { latestAssignments: null, logEntries: [] };

  let updatedAssignments: AssignmentState<CardT> | null = null;
  context.updateAssignments((prev) => {
    const updated = applyCardStatAdjustments(prev, adjustments as CardStatAdjustment[]);
    if (updated) {
      updatedAssignments = updated;
      return updated;
    }
    return prev;
  });

  if (updatedAssignments) {
    const nextTokenSteps = computeWheelTokenTargets(updatedAssignments);
    context.previewTokenTargets(nextTokenSteps);
  }

  return { latestAssignments: updatedAssignments, logEntries: [] };
}

type HandAdjustmentContext = {
  updateFighter: (side: LegacySide, updater: (fighter: Fighter) => Fighter) => void;
};

export function handleHandAdjustments(
  adjustments: SpellEffectPayload["handAdjustments"],
  context: HandAdjustmentContext,
): SpellEffectLogEntry[] {
  if (!adjustments?.length) return [];

  adjustments.forEach((adjustment) => {
    context.updateFighter(adjustment.side, (fighter) => {
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

  return [];
}

export function handleHandDiscards(
  discards: SpellEffectPayload["handDiscards"],
  context: HandAdjustmentContext,
): SpellEffectLogEntry[] {
  if (!discards?.length) return [];

  discards.forEach((discard) => {
    context.updateFighter(discard.side, (fighter) => {
      const index = fighter.hand.findIndex((card) => card.id === discard.cardId);
      if (index === -1) return fighter;
      const nextHand = [...fighter.hand];
      const [removed] = nextHand.splice(index, 1);
      const nextDiscard = removed ? [...fighter.discard, removed] : [...fighter.discard];
      return { ...fighter, hand: nextHand, discard: nextDiscard };
    });
  });

  return [];
}

type DrawCardsContext = {
  updateFighter: (side: LegacySide, updater: (fighter: Fighter) => Fighter) => void;
};

export function handleDrawCards(
  requests: SpellEffectPayload["drawCards"],
  context: DrawCardsContext,
): SpellEffectLogEntry[] {
  if (!requests?.length) return [];

  requests.forEach((request) => {
    if (!request) return;
    const side = request.side;
    const rawCount = request.count;
    if (side !== "player" && side !== "enemy") return;
    const normalizedCount =
      typeof rawCount === "number" && Number.isFinite(rawCount)
        ? Math.max(0, Math.floor(rawCount))
        : 0;
    if (normalizedCount <= 0) return;

    context.updateFighter(side, (fighter) => {
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

  return [];
}

type PositionSwapContext<CardT extends { id: string }> = {
  updateAssignments: (updater: (prev: AssignmentState<CardT>) => AssignmentState<CardT>) => void;
};

export function handlePositionSwaps<CardT extends { id: string }>(
  swaps: SpellEffectPayload["positionSwaps"],
  context: PositionSwapContext<CardT>,
): { latestAssignments: AssignmentState<CardT> | null; logEntries: SpellEffectLogEntry[] } {
  if (!swaps?.length) {
    return { latestAssignments: null, logEntries: [] };
  }

  let latestAssignments: AssignmentState<CardT> | null = null;
  context.updateAssignments((prev) => {
    let nextPlayer = prev.player;
    let nextEnemy = prev.enemy;
    let changed = false;

    swaps.forEach((swap) => {
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

  return { latestAssignments, logEntries: [] };
}

type ChillContext<CardT extends { id: string }> = {
  updateLaneChillStacks: (updater: (prev: LaneChillStacks) => LaneChillStacks) => void;
  latestAssignments: AssignmentState<CardT>;
};

export function handleChilledCards<CardT extends { id: string }>(
  chilledCards: SpellEffectPayload["chilledCards"],
  context: ChillContext<CardT>,
): SpellEffectLogEntry[] {
  if (!chilledCards?.length) return [];

  context.updateLaneChillStacks((prev) => {
    const updated = applyChilledCardUpdates(prev, context.latestAssignments, chilledCards as ChilledCardUpdate[]);
    return updated ?? prev;
  });

  return [];
}

type InitiativeContext<CardT extends { id: string }> = {
  initiativeChallenges: SpellEffectPayload["initiativeChallenges"];
  initiativeTarget: SpellEffectPayload["initiative"];
  latestAssignments: AssignmentState<CardT>;
  setInitiative: (side: LegacySide) => void;
  currentInitiative: LegacySide;
};

export function handleInitiativeEffects<CardT extends { id: string }>(
  context: InitiativeContext<CardT>,
): SpellEffectLogEntry[] {
  const { initiativeChallenges, initiativeTarget, latestAssignments, setInitiative, currentInitiative } = context;

  if (initiativeChallenges?.length) {
    initiativeChallenges.forEach((challenge) => {
      const laneIndex = challenge.lane;
      if (!Number.isInteger(laneIndex)) return;
      const challengerSide = challenge.side;
      const opponentSide = challengerSide === "player" ? "enemy" : "player";
      const challengerLanes =
        challengerSide === "player" ? latestAssignments.player : latestAssignments.enemy;
      const opponentLanes =
        opponentSide === "player" ? latestAssignments.player : latestAssignments.enemy;
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

  if (initiativeTarget && initiativeTarget !== currentInitiative) {
    setInitiative(initiativeTarget);
  }

  return [];
}

export function handleDelayedEffects(
  delayedEffects: SpellEffectPayload["delayedEffects"],
): SpellEffectLogEntry[] {
  if (!Array.isArray(delayedEffects)) return [];

  return delayedEffects
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => ({ message: entry, type: "spell" as const }));
}

export function normalizeLogMessages(logMessages: SpellEffectPayload["logMessages"]): SpellEffectLogEntry[] {
  if (!Array.isArray(logMessages)) return [];

  return logMessages
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => ({ message: entry, type: "spell" as const }));
}
