import type { Fighter, Phase } from "./types.js";
import { SLICES } from "./types.js";
import type { SpellDefinition, SpellRuntimeState, SpellTargetInstance, SpellTargetOwnership } from "./spells.js";
import {
  spellTargetRequiresManualSelection,
  getSpellTargetStages,
  getSpellTargetStage,
  spellTargetStageRequiresManualSelection,
} from "./spells.js";
import { collectRuntimeSpellEffects, type LaneChillStacks, type LegacySide, type SpellEffectPayload } from "../features/threeWheel/utils/spellEffectTransforms.js";
import {
  computeWheelTokenTargets,
  handleCardAdjustments,
  handleChilledCards,
  handleDelayedEffects,
  handleDrawCards,
  handleHandAdjustments,
  handleHandDiscards,
  handleInitiativeEffects,
  handleMirrorCopyEffects,
  handlePositionSwaps,
  handleReserveDrains,
  handleWheelTokenAdjustments,
  normalizeLogMessages,
  type AssignmentState,
  type ReserveState,
  type SpellEffectApplicationContext,
  type SpellEffectLogEntry,
} from "./spellEffectHandlers.js";

export type { LegacySide, SpellEffectPayload, LaneChillStacks } from "../features/threeWheel/utils/spellEffectTransforms.js";
export type { SpellDefinition, SpellRuntimeState, SpellTargetInstance, SpellTargetOwnership } from "./spells.js";
export type {
  AssignmentState,
  ReserveState,
  SpellEffectApplicationContext,
  SpellEffectLogEntry,
} from "./spellEffectHandlers.js";

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
          const winOnTie = (entry as { winOnTie?: unknown }).winOnTie === true;
          return winOnTie
            ? { side: owner, lane: lane as number, cardId, mode: normalizedMode, winOnTie: true }
            : { side: owner, lane: lane as number, cardId, mode: normalizedMode };
        })
        .filter(
          (
            entry,
          ): entry is {
            side: LegacySide;
            lane: number;
            cardId: string;
            mode: "higher" | "lower";
            winOnTie?: boolean;
          } => entry !== null,
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

  let latestAssignments: AssignmentState<CardT> = assignSnapshot;
  const previewTokenTargets = (targets: [number, number, number]) => {
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i] ?? 0;
      const visual = ((target % SLICES) + SLICES) % SLICES;
      updateTokenVisual?.(i, visual);
    }
  };

  const aggregatedLogs: SpellEffectLogEntry[] = [];

  const mirrorResult = handleMirrorCopyEffects<CardT>(mirrorCopyEffects, {
    assignSnapshot,
    updateAssignments,
    previewTokenTargets,
  });
  latestAssignments = mirrorResult.latestAssignments;
  aggregatedLogs.push(...mirrorResult.logEntries);

  aggregatedLogs.push(
    ...handleWheelTokenAdjustments(wheelTokenAdjustments, {
      updateTokens,
      updateTokenVisual,
      updateRoundStartTokens,
    }),
  );

  aggregatedLogs.push(...handleReserveDrains(reserveDrains, { updateReserveSums, applyReservePenalty }));

  const cardResult = handleCardAdjustments<CardT>(cardAdjustments, {
    updateAssignments,
    previewTokenTargets,
  });
  if (cardResult.latestAssignments) {
    latestAssignments = cardResult.latestAssignments;
  }
  aggregatedLogs.push(...cardResult.logEntries);

  aggregatedLogs.push(...handleHandAdjustments(handAdjustments, { updateFighter }));

  aggregatedLogs.push(...handleHandDiscards(handDiscards, { updateFighter }));

  aggregatedLogs.push(...handleDrawCards(drawCards, { updateFighter }));

  const positionResult = handlePositionSwaps<CardT>(positionSwaps, { updateAssignments });
  if (positionResult.latestAssignments) {
    latestAssignments = positionResult.latestAssignments;
  }
  aggregatedLogs.push(...positionResult.logEntries);

  aggregatedLogs.push(
    ...handleChilledCards(chilledCards, {
      updateLaneChillStacks,
      latestAssignments,
    }),
  );

  aggregatedLogs.push(
    ...handleInitiativeEffects<CardT>({
      initiativeChallenges,
      initiativeTarget,
      latestAssignments,
      setInitiative,
      currentInitiative: initiative,
    }),
  );

  aggregatedLogs.push(...normalizeLogMessages(logMessages));
  aggregatedLogs.push(...handleDelayedEffects(delayedEffects));

  aggregatedLogs.forEach((entry) => {
    appendLog(entry.message, { type: entry.type ?? "spell" });
  });

  const shouldBroadcast = options?.broadcast ?? true;
  if (shouldBroadcast && isMultiplayer && broadcastEffects) {
    broadcastEffects(payload);
  }
}

