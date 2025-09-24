import { useCallback, useEffect, useMemo, useState } from "react";

import type { CorePhase, Fighter, Phase } from "../types";
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
  handlePendingSpellCancel: (refundMana: boolean) => void;
  handleSpellTargetSelect: (cardId: string, ownerSide: LegacySide, cardName: string) => void;
  handleWheelTargetSelect: (wheelIndex: number) => void;
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
        setPendingSpell(result.pendingSpell);
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
        setPendingSpell(null);
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

      setPendingSpell(null);
      closeGrimoire();
      setPhaseBeforeSpell(null);
    },
    [
      applySpellEffects,
      caster,
      closeGrimoire,
      opponent,
      phaseForLogic,
      runtimeStateRef,
      setManaPools,
    ],
  );

  const handlePendingSpellCancel = useCallback(
    (refundMana: boolean) => {
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

      let didSpend = false;
      setManaPools((current) => {
        const currentMana = current[localSide];
        if (currentMana < effectiveCost) return current;

        didSpend = true;
        const next: SideState<number> = { ...current };
        next[localSide] = currentMana - effectiveCost;
        return next;
      });

      if (!didSpend) return;

      setPhaseBeforeSpell((current) => current ?? phaseForLogic);

      const requiresManualTarget = spellTargetRequiresManualSelection(spell.target);

      closeGrimoire();

      const initialTarget: SpellTargetInstance | null = (() => {
        switch (spell.target.type) {
          case "self":
            return { type: "self" };
          case "none":
            return { type: "none" };
          default:
            return requiresManualTarget ? null : null;
        }
      })();

      const descriptor: PendingSpellDescriptor = {
        side: localSide,
        spell,
        target: initialTarget,
        spentMana: effectiveCost,
      };

      if (requiresManualTarget) {
        setPendingSpell({ ...descriptor, target: null });
        return;
      }

      handleResolvePendingSpell(descriptor, initialTarget);
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
    (cardId: string, ownerSide: LegacySide, cardName: string) => {
      if (!pendingSpell) return;

      if (pendingSpell.side !== localSide) {
        return;
      }

      const definition = pendingSpell.spell.target;
      if (definition.type !== "card" || definition.automatic === true) {
        return;
      }

      const candidateOwnership = ownerSide === pendingSpell.side ? "ally" : "enemy";

      const allowedOwnership = definition.ownership;
      const isAllowed = allowedOwnership === "any" || allowedOwnership === candidateOwnership;
      if (!isAllowed) {
        return;
      }

      const nextTarget: SpellTargetInstance = {
        type: "card",
        cardId,
        owner: candidateOwnership,
        cardName,
      };

      handleResolvePendingSpell(pendingSpell, nextTarget);
    },
    [handleResolvePendingSpell, localSide, pendingSpell],
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
