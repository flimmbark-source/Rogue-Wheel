import type { Fighter, Phase } from "./types.js";
import { SLICES } from "./types.js";
import type {
  SpellDefinition,
  SpellRuntimeState,
  SpellTargetInstance,
  SpellTargetOwnership,
} from "./spells.js";
import { spellTargetRequiresManualSelection } from "./spells.js";
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
  target: SpellTargetInstance | null;
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
  "lastFireballTarget",
  "chilledCards",
  "delayedEffects",
  "timeMomentum",
  "log",
];

export function resolvePendingSpell(params: ResolveSpellParams): SpellResolutionResult {
  const { descriptor, caster, opponent, phase, runtimeState, targetOverride } = params;

  const manualTargetRequired = spellTargetRequiresManualSelection(descriptor.spell.target);
  const finalTarget =
    targetOverride !== undefined ? targetOverride : descriptor.target ? descriptor.target : null;

  if (manualTargetRequired && !finalTarget) {
    return {
      outcome: "requiresTarget",
      pendingSpell: { ...descriptor, target: null },
      manaRefund: 0,
    };
  }

  const context = {
    caster,
    opponent,
    phase,
    target: finalTarget ?? undefined,
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
            const owner = (target as { owner?: unknown }).owner;
            if (owner === "ally") targetSide = descriptor.side;
            else if (owner === "enemy") targetSide = descriptor.side === "player" ? "enemy" : "player";
          }

          if (!targetSide) {
            targetSide = descriptor.side === "player" ? "enemy" : "player";
          }

          return { side: targetSide, amount };
        })
        .filter((entry): entry is { side: LegacySide; amount: number } => entry !== null)
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
    (effectPayload.cardAdjustments?.length ?? 0) > 0 ||
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
  appendLog: (message: string) => void;
  initiative: LegacySide;
  isMultiplayer: boolean;
  broadcastEffects?: (payload: SpellEffectPayload) => void;
  updateTokenVisual?: (wheelIndex: number, value: number) => void;
  applyReservePenalty?: (side: LegacySide, amount: number) => void;
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
  } = context;

  const {
    mirrorCopyEffects,
    wheelTokenAdjustments,
    reserveDrains,
    cardAdjustments,
    chilledCards,
    delayedEffects,
    initiative: initiativeTarget,
    logMessages,
  } = payload;

  let mirrorUpdatedAssignments: AssignmentState<CardT> | null = null;
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
      return updated;
    });
  }

  if (mirrorUpdatedAssignments) {
    const nextTokens = computeWheelTokenTargets(mirrorUpdatedAssignments);
    const changedIndices: number[] = [];
    updateTokens((prev) => {
      let next = prev;
      for (let i = 0; i < nextTokens.length; i++) {
        if (nextTokens[i] !== prev[i]) {
          if (next === prev) next = [...prev] as [number, number, number];
          next[i] = nextTokens[i];
          changedIndices.push(i);
        }
      }
      return next === prev ? prev : next;
    });

    changedIndices.forEach((index) => {
      updateTokenVisual?.(index, nextTokens[index]);
    });
  }

  if (wheelTokenAdjustments?.length) {
    const tokenUpdates = new Map<number, number>();
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
      return next;
    });

    tokenUpdates.forEach((value, index) => {
      updateTokenVisual?.(index, value);
    });
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
        return updated;
      }
      return prev;
    });

    if (updatedAssignments) {
      const nextTokens = computeWheelTokenTargets(updatedAssignments);
      const changedIndices: number[] = [];
      updateTokens((prev) => {
        let next = prev;
        for (let i = 0; i < nextTokens.length; i++) {
          if (nextTokens[i] !== prev[i]) {
            if (next === prev) next = [...prev] as [number, number, number];
            next[i] = nextTokens[i];
            changedIndices.push(i);
          }
        }
        return next === prev ? prev : next;
      });

      changedIndices.forEach((index) => {
        updateTokenVisual?.(index, nextTokens[index]);
      });
    }
  }

  if (chilledCards?.length) {
    updateLaneChillStacks((prev) => {
      const updated = applyChilledCardUpdates(prev, assignSnapshot, chilledCards as ChilledCardUpdate[]);
      return updated ?? prev;
    });
  }

  if (initiativeTarget && initiativeTarget !== initiative) {
    setInitiative(initiativeTarget);
  }

  if (Array.isArray(logMessages)) {
    logMessages.forEach((entry) => {
      if (typeof entry === "string" && entry.trim().length > 0) {
        appendLog(entry);
      }
    });
  }

  if (Array.isArray(delayedEffects)) {
    delayedEffects.forEach((entry) => {
      if (typeof entry === "string" && entry.trim().length > 0) {
        appendLog(entry);
      }
    });
  }

  const shouldBroadcast = options?.broadcast ?? true;
  if (shouldBroadcast && isMultiplayer && broadcastEffects) {
    broadcastEffects(payload);
  }
}

