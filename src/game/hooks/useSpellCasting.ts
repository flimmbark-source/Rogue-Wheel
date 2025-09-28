import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CorePhase, Fighter } from "../types";
import {
  computeSpellCost,
  resolvePendingSpell,
  spellTargetRequiresManualSelection,
  type PendingSpellDescriptor,
  type SpellDefinition,
  type SpellEffectPayload,
  type SpellRuntimeState,
  type SpellTargetInstance,
} from "../spellEngine";
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
  handlePendingSpellCancel: (shouldRefund: boolean) => void;
  handleSpellTargetSelect: (selection: { side: LegacySide; lane: number | null; cardId: string }) => void;
  handleWheelTargetSelect: (wheelIndex: number) => void;
};

const enqueueMicrotask = (task: () => void) => {
  if (typeof queueMicrotask === "function") {
    queueMicrotask(task);
  } else {
    Promise.resolve().then(task);
  }
};

const findCardName = (fighter: Fighter, cardId: string): string | undefined => {
  for (const pool of [fighter.hand, fighter.deck, fighter.discard]) {
    const match = pool.find((card) => card.id === cardId);
    if (match) return match.name;
  }
  return undefined;
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

  const restoreMana = useCallback(
    (side: LegacySide, amount?: number | null) => {
      if (!amount || amount <= 0) return;
      setManaPools((mana) => ({ ...mana, [side]: mana[side] + amount }));
    },
    [setManaPools],
  );

  const spendMana = useCallback(
    (side: LegacySide, amount: number) => {
      if (amount <= 0) return true;

      let spent = false;
      setManaPools((current) => {
        const currentMana = current[side];
        if (currentMana < amount) return current;
        spent = true;
        return { ...current, [side]: currentMana - amount };
      });

      return spent;
    },
    [setManaPools],
  );

  const resetSpellContext = useCallback(() => {
    clearPendingSpell();
    closeGrimoire();
    setPhaseBeforeSpell(null);
  }, [clearPendingSpell, closeGrimoire, setPhaseBeforeSpell]);

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

      restoreMana(descriptor.side, result.manaRefund);

      if (result.outcome === "error") {
        console.error("Spell resolution failed", result.error);
        resetSpellContext();
        return;
      }

      if (result.payload) {
        applySpellEffects(result.payload);
      }

      resetSpellContext();
    },
    [
      applySpellEffects,
      beginPendingSpell,
      caster,
      opponent,
      phaseForLogic,
      restoreMana,
      resetSpellContext,
      runtimeStateRef,
    ],
  );

  const handlePendingSpellCancel = useCallback(
    (shouldRefund: boolean) => {
      setPendingSpell((current) => {
        if (shouldRefund && current) {
          restoreMana(current.side, current.spentMana);
        }
        return current;
      });
      resetSpellContext();
    },
    [restoreMana, resetSpellContext],
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

      const spent = spendMana(localSide, effectiveCost);
      if (!spent) return;

      setPhaseBeforeSpell((current) => current ?? phaseForLogic);

      const requiresManualTarget = spellTargetRequiresManualSelection(spell.target);

      closeGrimoire();

      const initialTarget: SpellTargetInstance | null =
        spell.target.type === "self"
          ? { type: "self" }
          : spell.target.type === "none"
          ? { type: "none" }
          : null;

      const descriptor: PendingSpellDescriptor = {
        side: localSide,
        spell,
        target: initialTarget,
        spentMana: effectiveCost,
      };

      if (requiresManualTarget) {
        beginPendingSpell({ ...descriptor, target: null });
        return;
      }

      handleResolvePendingSpell(descriptor, initialTarget);
    },
    [
      beginPendingSpell,
      closeGrimoire,
      getSpellCost,
      handleResolvePendingSpell,
      handlePendingSpellCancel,
      localMana,
      localSide,
      pendingSpell,
      phaseForLogic,
      spendMana,
    ],
  );

  const handleSpellTargetSelect = useCallback(
    (selection: { side: LegacySide; lane: number | null; cardId: string }) => {
      if (!pendingSpell) return;

      if (pendingSpell.side !== localSide) {
        return;
      }

      const definition = pendingSpell.spell.target;
      if (definition.type !== "card" || definition.automatic === true) {
        return;
      }

      const candidateOwnership = selection.side === pendingSpell.side ? "ally" : "enemy";

      const allowedOwnership = definition.ownership;
      const isAllowed = allowedOwnership === "any" || allowedOwnership === candidateOwnership;
      if (!isAllowed) {
        return;
      }

      const sourceFighter = selection.side === localSide ? caster : opponent;
      const cardName = findCardName(sourceFighter, selection.cardId);

      const nextTarget: SpellTargetInstance = {
        type: "card",
        cardId: selection.cardId,
        owner: candidateOwnership,
        cardName,
      };

      handleResolvePendingSpell(pendingSpell, nextTarget);
    },
    [caster, handleResolvePendingSpell, localSide, opponent, pendingSpell],
  );

  const handleWheelTargetSelect = useCallback(
    (wheelIndex: number) => {
      if (!pendingSpell) return;
      if (pendingSpell.side !== localSide) return;

      const definition = pendingSpell.spell.target;
      if (definition.type !== "wheel") return;

      if (definition.scope === "current" && !isWheelActive(wheelIndex)) {
        return;
      }

      const wheelTarget: SpellTargetInstance = {
        type: "wheel",
        wheelId: String(wheelIndex),
        label: `Wheel ${wheelIndex + 1}`,
      };

      handleResolvePendingSpell(pendingSpell, wheelTarget);
    },
    [handleResolvePendingSpell, isWheelActive, localSide, pendingSpell],
  );

  const awaitingSpellTarget = useMemo(() => {
    return (
      !!pendingSpell &&
      spellTargetRequiresManualSelection(pendingSpell.spell.target) &&
      !pendingSpell.target
    );
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
  };
}
