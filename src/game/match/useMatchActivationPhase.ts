import { useCallback, useEffect, useRef, useState, startTransition } from "react";
import type { MutableRefObject } from "react";

import type { Card } from "../types";
import { getCardPlayValue } from "../values";
import { useLatestRef } from "./useLatestRef";
import type { ActivationAdjustmentsMap, ActivationSwapPairs } from "./valueAdjustments";
import type { LegacySide } from "./useGauntletShop";

export type Phase =
  | "choose"
  | "showEnemy"
  | "anim"
  | "roundEnd"
  | "shop"
  | "activation"
  | "activationComplete"
  | "ended";

export type ActivationActionParams = {
  side: LegacySide;
  action: "activate" | "pass";
  cardId?: string;
};

export type ActivationIntent = ActivationActionParams & { type: "activation" };

export type ActivationLogEntry = ActivationActionParams;

export type UseMatchActivationPhaseOptions = {
  phase: Phase;
  setPhase: (next: Phase) => void;
  assignRef: MutableRefObject<{ player: (Card | null)[]; enemy: (Card | null)[] }>;
  initiative: LegacySide;
  appendLog: (message: string) => void;
  activationCompleteRef: MutableRefObject<(enemyPicks: (Card | null)[]) => void>;
  emitIntent?: (intent: ActivationIntent) => void;
  isMultiplayer: boolean;
  remoteLegacySide: LegacySide;
};

const isActivatableCard = (card: Card | null | undefined): card is Card => {
  if (!card) return false;
  return !!card.behavior;
};

const oppositeSide = (side: LegacySide): LegacySide => (side === "player" ? "enemy" : "player");

export function useMatchActivationPhase({
  phase,
  setPhase,
  assignRef,
  initiative,
  appendLog,
  activationCompleteRef,
  emitIntent,
  isMultiplayer,
  remoteLegacySide,
}: UseMatchActivationPhaseOptions) {
  const [activationTurn, setActivationTurn] = useState<LegacySide | null>(null);
  const [activationPasses, setActivationPasses] = useState<{ player: boolean; enemy: boolean }>(
    () => ({ player: false, enemy: false }),
  );
  const [activationLog, setActivationLog] = useState<ActivationLogEntry[]>([]);
  const [activationAvailable, setActivationAvailable] = useState<Record<LegacySide, string[]>>({
    player: [],
    enemy: [],
  });
  const [activationInitial, setActivationInitial] = useState<Record<LegacySide, string[]>>({
    player: [],
    enemy: [],
  });
  const [pendingSwapCardId, setPendingSwapCardId] = useState<string | null>(null);
  const [activationSwapPairs, setActivationSwapPairs] = useState<ActivationSwapPairs>([]);
  const [activationAdjustments, setActivationAdjustments] =
    useState<ActivationAdjustmentsMap>({});

  const activationAvailableRef = useLatestRef(activationAvailable);
  const activationAdjustmentsRef = useLatestRef<ActivationAdjustmentsMap>(activationAdjustments);
  const activationSwapPairsRef = useLatestRef<ActivationSwapPairs>(activationSwapPairs);
  const pendingSwapRef = useLatestRef<string | null>(pendingSwapCardId);
  const activationEnemyPicksRef = useRef<(Card | null)[] | null>(null);

  const resetActivationPhase = useCallback(() => {
    setActivationTurn(null);
    setActivationPasses({ player: false, enemy: false });
    setActivationLog([]);
    setActivationAvailable({ player: [], enemy: [] });
    setActivationInitial({ player: [], enemy: [] });
    setActivationSwapPairs([]);
    setActivationAdjustments({});
    setPendingSwapCardId(null);
    activationEnemyPicksRef.current = null;
  }, []);

  const startActivationPhase = useCallback(
    (enemyPicks: (Card | null)[]) => {
      const playerCards = assignRef.current.player.filter((c): c is Card => !!c);
      const enemyCards = enemyPicks.filter((c): c is Card => !!c);

      const playerActivatable = playerCards.filter((card) => isActivatableCard(card));
      const enemyActivatable = enemyCards.filter((card) => isActivatableCard(card));

      const playerIds = playerActivatable.map((card) => card.id);
      const enemyIds = enemyActivatable.map((card) => card.id);

      activationEnemyPicksRef.current = enemyPicks;

      setActivationInitial({ player: playerIds, enemy: enemyIds });
      setActivationAvailable({ player: playerIds, enemy: enemyIds });
      setActivationPasses({ player: false, enemy: false });
      setActivationLog([]);
      setActivationAdjustments({});
      setActivationSwapPairs([]);
      setPendingSwapCardId(null);

      const hasPlayerCards = playerIds.length > 0;
      const hasEnemyCards = enemyIds.length > 0;

      const starter: LegacySide | null = (() => {
        if (!hasPlayerCards && !hasEnemyCards) return null;
        if (initiative === "player") {
          if (hasPlayerCards) return "player";
          if (hasEnemyCards) return "enemy";
        } else {
          if (hasEnemyCards) return "enemy";
          if (hasPlayerCards) return "player";
        }
        if (hasPlayerCards) return "player";
        if (hasEnemyCards) return "enemy";
        return null;
      })();

      setActivationTurn(starter);

      if (!hasPlayerCards && !hasEnemyCards) {
        setPhase("anim");
        activationCompleteRef.current(enemyPicks);
        return;
      }

      appendLog("Activation phase begins.");
      setPhase("activation");
    },
    [appendLog, assignRef, initiative, setPhase, activationCompleteRef],
  );

  const finishActivationPhase = useCallback(() => {
    if (phase !== "activation") return false;
    const enemyPicks = activationEnemyPicksRef.current ?? assignRef.current.enemy;
    setActivationTurn(null);
    setActivationPasses({ player: false, enemy: false });
    setPendingSwapCardId(null);
    activationEnemyPicksRef.current = null;
    setPhase("anim");
    activationCompleteRef.current(enemyPicks);
    return true;
  }, [
    activationCompleteRef,
    assignRef,
    phase,
    setPhase,
  ]);

  const applyActivationAction = useCallback(
    (params: ActivationActionParams, opts?: { emit?: boolean }) => {
      if (phase !== "activation") return false;

      const availableForSide = activationAvailableRef.current[params.side];

      if (activationTurn && activationTurn !== params.side) {
        const canForcePass = params.action === "pass" && availableForSide.length === 0;
        if (!canForcePass) {
          return false;
        }
      }

      if (params.action === "activate") {
        const cardId = params.cardId;
        if (!cardId) return false;

        if (!availableForSide.includes(cardId)) {
          return false;
        }

        const card =
          assignRef.current.player.find((c) => c?.id === cardId) ??
          assignRef.current.enemy.find((c) => c?.id === cardId) ??
          null;
        if (!card) return false;

        const swapSource = pendingSwapRef.current;
        if (swapSource && swapSource !== cardId) {
          setActivationSwapPairs((prev) => [...prev, [swapSource, cardId]]);
          setPendingSwapCardId(null);
        } else if (swapSource && swapSource === cardId) {
          setPendingSwapCardId(null);
        }

        const behavior = card.behavior ?? null;
        if (behavior === "split") {
          setActivationAdjustments((prev) => ({ ...prev, [cardId]: { type: "split" } }));
        } else if (behavior === "boost") {
          setActivationAdjustments((prev) => ({ ...prev, [cardId]: { type: "boost" } }));
        } else if (behavior === "swap") {
          setPendingSwapCardId(cardId);
        }

        const nextAvailableForSide = availableForSide.filter((id) => id !== cardId);
        setActivationAvailable((prev) => ({
          ...prev,
          [params.side]: nextAvailableForSide,
        }));
        setActivationLog((prev) => [...prev, { ...params }]);
        setActivationPasses({ player: false, enemy: false });

        if (opts?.emit && isMultiplayer) {
          emitIntent?.({ type: "activation", ...params });
        }

        const otherSide = oppositeSide(params.side);
        const otherHasCards = activationAvailableRef.current[otherSide].length > 0;
        const selfHasCardsAfter = nextAvailableForSide.length > 0;

        if (!otherHasCards && !selfHasCardsAfter) {
          setActivationTurn(null);
          finishActivationPhase();
          return true;
        }

        const nextTurn = otherHasCards ? otherSide : params.side;
        setActivationTurn(nextTurn);
        return true;
      }

      let shouldFinish = false;
      setActivationPasses((prev) => {
        if (prev[params.side]) return prev;
        const updated = { ...prev, [params.side]: true };
        if (updated.player && updated.enemy) {
          shouldFinish = true;
        }
        return updated;
      });
      setActivationLog((prev) => [...prev, { ...params }]);

      if (opts?.emit && isMultiplayer) {
        emitIntent?.({ type: "activation", ...params });
      }

      const otherSide = oppositeSide(params.side);
      const otherHasCards = activationAvailableRef.current[otherSide].length > 0;
      const selfHasCards = availableForSide.length > 0;

      if (shouldFinish || (!otherHasCards && !selfHasCards)) {
        setActivationTurn(null);
        finishActivationPhase();
        return true;
      }

      const nextTurn = otherHasCards ? otherSide : params.side;
      setActivationTurn(nextTurn);
      return true;
    },
    [
      activationAvailableRef,
      activationTurn,
      emitIntent,
      finishActivationPhase,
      isMultiplayer,
      pendingSwapRef,
      phase,
      assignRef,
    ],
  );

  const activateCurrent = useCallback(
    (side: LegacySide, cardId?: string) =>
      applyActivationAction({ side, action: "activate", cardId }, { emit: true }),
    [applyActivationAction],
  );

  const passActivation = useCallback(
    (side: LegacySide) => applyActivationAction({ side, action: "pass" }, { emit: true }),
    [applyActivationAction],
  );

  const applyActivationActionRef = useLatestRef(applyActivationAction);

  useEffect(() => {
    if (phase !== "activation") return;

    const activationAction = applyActivationActionRef.current;
    if (!activationAction) return;

    (Object.keys(activationAvailable) as LegacySide[]).forEach((side) => {
      if (activationAvailable[side].length > 0) return;
      if (activationPasses[side]) return;

      activationAction({ side, action: "pass" }, { emit: true });
    });
  }, [activationAvailable, activationPasses, phase, applyActivationActionRef]);

  useEffect(() => {
    if (isMultiplayer) return;
    if (phase !== "activation") return;
    if (activationTurn !== remoteLegacySide) return;
    if (activationPasses[remoteLegacySide]) return;

    const activationAction = applyActivationActionRef.current;
    if (!activationAction) return;

    const availableIds = activationAvailable[remoteLegacySide];

    const findCard = (cardId: string): Card | null => {
      const fromAssign =
        assignRef.current.player.find((card) => card?.id === cardId) ??
        assignRef.current.enemy.find((card) => card?.id === cardId) ??
        null;
      if (fromAssign) return fromAssign;

      const enemyPicks = activationEnemyPicksRef.current;
      if (!enemyPicks) return null;
      return enemyPicks.find((card) => card?.id === cardId) ?? null;
    };

    let bestCardId: string | undefined;
    let bestValue = Number.NEGATIVE_INFINITY;

    for (const cardId of availableIds) {
      const card = findCard(cardId);
      if (!card) continue;
      const value = getCardPlayValue(card);
      if (value > bestValue) {
        bestValue = value;
        bestCardId = cardId;
      }
    }

    if (!bestCardId && availableIds.length > 0) {
      bestCardId = availableIds[0];
    }

    const params: ActivationActionParams =
      bestCardId
        ? { side: remoteLegacySide, action: "activate", cardId: bestCardId }
        : { side: remoteLegacySide, action: "pass" };

    startTransition(() => {
      const success = activationAction(params);
      if (!success && params.action === "activate") {
        activationAction({ side: remoteLegacySide, action: "pass" });
      }
    });
  }, [
    activationAvailable,
    activationPasses,
    activationTurn,
    assignRef,
    isMultiplayer,
    phase,
    remoteLegacySide,
  ]);

  return {
    activationTurn,
    activationPasses,
    activationLog,
    activationAvailable,
    activationInitial,
    activationSwapPairs,
    activationAdjustments,
    pendingSwapCardId,
    startActivationPhase,
    finishActivationPhase,
    applyActivationAction,
    activateCurrent,
    passActivation,
    resetActivationPhase,
    activationAdjustmentsRef,
    activationSwapPairsRef,
    activationEnemyPicksRef,
    applyActivationActionRef,
  };
}
