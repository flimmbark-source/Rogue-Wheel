import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Card, CorePhase, Fighter, Phase } from "../types";
import {
  computeSpellCost,
  resolvePendingSpell,
  type PendingSpellDescriptor,
  type SpellDefinition,
  type SpellEffectPayload,
  type SpellRuntimeState,
  type SpellTargetInstance,
} from "../spellEngine";
import { getSpellTargetStage, spellTargetStageRequiresManualSelection } from "../spells";
import type { SpellTargetLocation } from "../spells";
import { getCardArcana } from "../arcana";
import type { LegacySide } from "../../features/threeWheel/utils/spellEffectTransforms";

type SideState<T> = Record<LegacySide, T>;

export type UseSpellCastingOptions = {
  caster: Fighter;
  opponent: Fighter;
  phase: CorePhase;
  localSide: LegacySide;
  localMana: number;
  applySpellEffects: (payload: SpellEffectPayload) => void;
  setManaPools: React.Dispatch<React.SetStateAction<SideState<number>>>;
  runtimeStateRef: React.MutableRefObject<SpellRuntimeState>;
  closeGrimoire: () => void;
  isWheelActive: (wheelIndex: number) => boolean;
};

export type UseSpellCastingResult = {
  pendingSpell: PendingSpellDescriptor | null;
  phaseBeforeSpell: CorePhase | null;
  awaitingSpellTarget: boolean;
  handleSpellActivate: (spell: SpellDefinition) => void;
  handlePendingSpellCancel: (refundMana: boolean) => void;
  handleSpellTargetSelect: (
    selection: { side: LegacySide; lane: number | null; card: Card; location: SpellTargetLocation },
  ) => void;
  handleWheelTargetSelect: (wheelIndex: number) => void;
  handleOptionalStageSkip: () => void;
};

const enqueueMicrotask = (task: () => void) => {
  if (typeof queueMicrotask === "function") {
    queueMicrotask(task);
  } else {
    Promise.resolve().then(task);
  }
};

const getCardValueForSpell = (card: Card): number => {
  if (typeof card.number === "number" && Number.isFinite(card.number)) return card.number;
  if (typeof card.leftValue === "number" && Number.isFinite(card.leftValue)) return card.leftValue;
  if (typeof card.rightValue === "number" && Number.isFinite(card.rightValue)) return card.rightValue;
  return 0;
};

export function useSpellCasting(options: UseSpellCastingOptions): UseSpellCastingResult {
  const {
    caster,
    opponent,
    phase,
    localSide,
    localMana,
    applySpellEffects,
    setManaPools,
    runtimeStateRef,
    closeGrimoire,
    isWheelActive,
  } = options;

  const [pendingSpell, setPendingSpell] = useState<PendingSpellDescriptor | null>(null);
  const pendingSpellScheduleIdRef = useRef(0);

  const beginPendingSpell = useCallback(
    (descriptor: PendingSpellDescriptor) => {
      const scheduleId = ++pendingSpellScheduleIdRef.current;
      enqueueMicrotask(() => {
        if (pendingSpellScheduleIdRef.current !== scheduleId) return;
        setPendingSpell(descriptor);
      });
    },
    [],
  );

  const clearPendingSpell = useCallback(() => {
    pendingSpellScheduleIdRef.current++;
    setPendingSpell(null);
  }, []);
  const [phaseBeforeSpell, setPhaseBeforeSpell] = useState<CorePhase | null>(null);

  const phaseForLogic = phaseBeforeSpell ?? phase;

  const getSpellCost = useCallback(
    (spell: SpellDefinition): number =>
      computeSpellCost(spell, {
        caster,
        opponent,
        phase: phaseForLogic,
        runtimeState: runtimeStateRef.current,
      }),
    [caster, opponent, phaseForLogic, runtimeStateRef],
  );

  const handleResolvePendingSpell = useCallback(
    (descriptor: PendingSpellDescriptor, targetOverride?: SpellTargetInstance | null) => {
      const result = resolvePendingSpell({
        descriptor,
        targetOverride,
        caster,
        opponent,
        phase: phaseForLogic,
        runtimeState: runtimeStateRef.current,
      });

      if (result.outcome === "requiresTarget") {
        beginPendingSpell(result.pendingSpell);
        closeGrimoire();
        return;
      }

      if (result.outcome === "error") {
        console.error("Spell resolution failed", result.error);
        if (result.manaRefund && result.manaRefund > 0) {
          setManaPools((mana) => {
            const next: SideState<number> = { ...mana };
            next[descriptor.side] = mana[descriptor.side] + result.manaRefund!;
            return next;
          });
        }
        clearPendingSpell();
        closeGrimoire();
        setPhaseBeforeSpell(null);
        return;
      }

      if (result.manaRefund && result.manaRefund > 0) {
        setManaPools((mana) => {
          const next: SideState<number> = { ...mana };
          next[descriptor.side] = mana[descriptor.side] + result.manaRefund!;
          return next;
        });
      }

      if (result.payload) {
        applySpellEffects(result.payload);
      }

      clearPendingSpell();
      closeGrimoire();
      setPhaseBeforeSpell(null);
    },
    [
      applySpellEffects,
      beginPendingSpell,
      caster,
      clearPendingSpell,
      closeGrimoire,
      opponent,
      phaseForLogic,
      runtimeStateRef,
      setManaPools,
    ],
  );

  const handlePendingSpellCancel = useCallback(
    (refundMana: boolean) => {
      pendingSpellScheduleIdRef.current++;
      setPendingSpell((current) => {
        if (!current) return current;

        if (refundMana && current.spentMana > 0) {
          setManaPools((mana) => {
            const next: SideState<number> = { ...mana };
            next[current.side] = mana[current.side] + current.spentMana;
            return next;
          });
        }

        return null;
      });
      closeGrimoire();
      setPhaseBeforeSpell(null);
    },
    [closeGrimoire, setManaPools],
  );

  const handleSpellActivate = useCallback(
    (spell: SpellDefinition) => {
      if (pendingSpell && pendingSpell.side !== localSide) return;

      const refundablePending =
        pendingSpell && pendingSpell.side === localSide ? pendingSpell : null;

      const allowedPhases = spell.allowedPhases ?? ["choose"];
      if (!allowedPhases.includes(phaseForLogic)) return;

      const effectiveCost = getSpellCost(spell);
      const availableMana = refundablePending ? localMana + refundablePending.spentMana : localMana;
      if (availableMana < effectiveCost) return;

      if (refundablePending) {
        handlePendingSpellCancel(true);
      }

      setManaPools((current) => {
        const currentMana = current[localSide];
        if (currentMana < effectiveCost) return current;

        const next: SideState<number> = { ...current };
        next[localSide] = currentMana - effectiveCost;
        return next;
      });

      setPhaseBeforeSpell((current) => current ?? phaseForLogic);

      closeGrimoire();
      const descriptor: PendingSpellDescriptor = {
        side: localSide,
        spell,
        targets: [],
        currentStage: 0,
        spentMana: effectiveCost,
      };
      handleResolvePendingSpell(descriptor);
    },
    [
      closeGrimoire,
      getSpellCost,
      handleResolvePendingSpell,
      handlePendingSpellCancel,
      localMana,
      localSide,
      pendingSpell,
      phaseForLogic,
      setManaPools,
    ],
  );

  const handleSpellTargetSelect = useCallback(
    (selection: { side: LegacySide; lane: number | null; card: Card; location: SpellTargetLocation }) => {
      if (!pendingSpell) return;

      if (pendingSpell.side !== localSide) {
        return;
      }

      const stage = getSpellTargetStage(pendingSpell.spell.target, pendingSpell.currentStage);
      if (!stage || stage.type !== "card" || stage.automatic) {
        return;
      }

      const candidateOwnership = selection.side === pendingSpell.side ? "ally" : "enemy";

      const allowedOwnership = stage.ownership;
      const isAllowed = allowedOwnership === "any" || allowedOwnership === candidateOwnership;
      if (!isAllowed) {
        return;
      }

      const stageLocation = stage.location ?? "board";
      if (stageLocation !== "any") {
        if (stageLocation === "board" && selection.location !== "board") return;
        if (stageLocation === "hand" && selection.location !== "hand") return;
      }

      const cardArcana = getCardArcana(selection.card);

      if (stage.adjacentToPrevious) {
        const previous = pendingSpell.targets[pendingSpell.targets.length - 1];
        if (
          !previous ||
          previous.type !== "card" ||
          typeof previous.lane !== "number" ||
          typeof selection.lane !== "number"
        ) {
          return;
        }
        if (previous.owner !== candidateOwnership) return;
        if (Math.abs(previous.lane - selection.lane) !== 1) return;
      }

      const nextTarget: SpellTargetInstance = {
        type: "card",
        cardId: selection.card.id,
        owner: candidateOwnership,
        cardName: selection.card.name,
        arcana: cardArcana,
        location: selection.location,
        lane: selection.lane,
        stageIndex: pendingSpell.currentStage,
        cardValue: getCardValueForSpell(selection.card),
      };

      handleResolvePendingSpell(pendingSpell, nextTarget);
    },
    [handleResolvePendingSpell, localSide, pendingSpell],
  );

  const handleWheelTargetSelect = useCallback(
    (wheelIndex: number) => {
      if (!pendingSpell) return;
      if (pendingSpell.side !== localSide) return;

      const stage = getSpellTargetStage(pendingSpell.spell.target, pendingSpell.currentStage);
      if (!stage || stage.type !== "wheel") return;

      if (stage.scope === "current" && !isWheelActive(wheelIndex)) {
        return;
      }

      const wheelTarget: SpellTargetInstance = {
        type: "wheel",
        wheelId: String(wheelIndex),
        label: `Wheel ${wheelIndex + 1}`,
        stageIndex: pendingSpell.currentStage,
      };

      handleResolvePendingSpell(pendingSpell, wheelTarget);
    },
    [handleResolvePendingSpell, isWheelActive, localSide, pendingSpell],
  );

  const handleOptionalStageSkip = useCallback(() => {
    if (!pendingSpell) return;
    if (pendingSpell.side !== localSide) return;
    handleResolvePendingSpell(pendingSpell);
  }, [handleResolvePendingSpell, localSide, pendingSpell]);

  const awaitingSpellTarget = useMemo(() => {
    if (!pendingSpell) return false;
    const stage = getSpellTargetStage(pendingSpell.spell.target, pendingSpell.currentStage);
    if (!stage) return false;
    return spellTargetStageRequiresManualSelection(stage);
  }, [pendingSpell]);

  useEffect(() => {
    if (!pendingSpell) {
      setPhaseBeforeSpell((current) => (current !== null ? null : current));
    }
  }, [pendingSpell]);

  return {
    pendingSpell,
    phaseBeforeSpell,
    awaitingSpellTarget,
    handleSpellActivate,
    handlePendingSpellCancel,
    handleSpellTargetSelect,
    handleWheelTargetSelect,
    handleOptionalStageSkip,
  };
}
