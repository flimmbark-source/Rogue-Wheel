import { useCallback, useRef, useState } from "react";

import type { Card } from "../types";
import { cloneCardForGauntlet } from "../../player/profileStore";
import type { StoreOffering } from "../../player/profileStore";

export type LegacySide = "player" | "enemy";

export type GauntletShopPurchase = { cardId: string; round: number };

export type GauntletShopState = {
  inventory: StoreOffering[];
  roll: number;
  round: number;
  purchases: GauntletShopPurchase[];
};

export type GauntletActivationState = {
  selection: string | null;
  passed: boolean;
};

export type GauntletSideState = {
  shop: GauntletShopState;
  gold: number;
  goldDelta: number | null;
  activation: GauntletActivationState;
};

export type GauntletState = Record<LegacySide, GauntletSideState>;

export type GauntletShopRollPayload = {
  inventory: StoreOffering[];
  round: number;
  roll: number;
};

export type GauntletGoldPayload = {
  gold: number;
  delta?: number;
};

export type GauntletShopIntent =
  | ({ type: "shopRoll"; side: LegacySide } & GauntletShopRollPayload)
  | ({ type: "shopPurchase"; side: LegacySide } & GauntletShopPurchase)
  | ({ type: "gold"; side: LegacySide } & GauntletGoldPayload);

export type GauntletActivationIntent =
  | { type: "activationSelect"; side: LegacySide; activationId: string }
  | { type: "activationPass"; side: LegacySide };

export type UseGauntletShopOptions = {
  localLegacySide: LegacySide;
  emitIntent?: (intent: GauntletShopIntent | GauntletActivationIntent) => void;
};

export function useGauntletShop({
  localLegacySide,
  emitIntent,
}: UseGauntletShopOptions) {
  const gauntletStateRef = useRef<GauntletState>(createInitialGauntletState());
  const [gauntletState, setGauntletState] = useState<GauntletState>(
    () => gauntletStateRef.current,
  );

  const updateGauntletState = useCallback(
    (updater: (prev: GauntletState) => GauntletState) => {
      setGauntletState((prev) => {
        const next = updater(prev);
        gauntletStateRef.current = next;
        return next;
      });
    },
    [],
  );

  const resetGauntletState = useCallback(() => {
    const reset = createInitialGauntletState();
    gauntletStateRef.current = reset;
    setGauntletState(reset);
  }, []);

  const resetGauntletShops = useCallback(() => {
    updateGauntletState((prev) => ({
      player: {
        ...prev.player,
        shop: { inventory: [], roll: 0, round: 0, purchases: [] },
      },
      enemy: {
        ...prev.enemy,
        shop: { inventory: [], roll: 0, round: 0, purchases: [] },
      },
    }));
  }, [updateGauntletState]);

  const applyGauntletShopRollFor = useCallback(
    (side: LegacySide, payload: GauntletShopRollPayload) => {
      updateGauntletState((prev) => {
        const base = prev[side];
        const nextInventory = payload.inventory.map(cloneStoreOffering);
        const sameInventory = offeringsEqual(base.shop.inventory, nextInventory);
        const sameRoll = base.shop.roll === payload.roll;
        const sameRound = base.shop.round === payload.round;
        if (sameInventory && sameRoll && sameRound && base.shop.purchases.length === 0) {
          return prev;
        }
        const nextSide: GauntletSideState = {
          ...base,
          shop: {
            inventory: nextInventory,
            roll: payload.roll,
            round: payload.round,
            purchases: [],
          },
        };
        return { ...prev, [side]: nextSide };
      });
    },
    [updateGauntletState],
  );

  const applyGauntletPurchaseFor = useCallback(
    (side: LegacySide, purchase: GauntletShopPurchase) => {
      updateGauntletState((prev) => {
        const base = prev[side];
        const alreadyRecorded = base.shop.purchases.some(
          (p) => p.cardId === purchase.cardId && p.round === purchase.round,
        );
        if (alreadyRecorded) {
          return prev;
        }
        const nextSide: GauntletSideState = {
          ...base,
          shop: {
            inventory: base.shop.inventory,
            roll: base.shop.roll,
            round: base.shop.round,
            purchases: [...base.shop.purchases, { ...purchase }],
          },
        };
        return { ...prev, [side]: nextSide };
      });
    },
    [updateGauntletState],
  );

  const applyGauntletGoldFor = useCallback(
    (side: LegacySide, payload: GauntletGoldPayload) => {
      updateGauntletState((prev) => {
        const base = prev[side];
        const nextDelta =
          typeof payload.delta === "number" && Number.isFinite(payload.delta)
            ? payload.delta
            : payload.gold - base.gold;
        if (base.gold === payload.gold && base.goldDelta === nextDelta) {
          return prev;
        }
        const nextSide: GauntletSideState = {
          ...base,
          gold: payload.gold,
          goldDelta: nextDelta,
        };
        return { ...prev, [side]: nextSide };
      });
    },
    [updateGauntletState],
  );

  const applyGauntletActivationSelectFor = useCallback(
    (side: LegacySide, activationId: string) => {
      updateGauntletState((prev) => {
        const base = prev[side];
        if (base.activation.selection === activationId && !base.activation.passed) {
          return prev;
        }
        const nextSide: GauntletSideState = {
          ...base,
          activation: { selection: activationId, passed: false },
        };
        return { ...prev, [side]: nextSide };
      });
    },
    [updateGauntletState],
  );

  const applyGauntletActivationPassFor = useCallback(
    (side: LegacySide) => {
      updateGauntletState((prev) => {
        const base = prev[side];
        if (base.activation.passed && base.activation.selection === null) {
          return prev;
        }
        const nextSide: GauntletSideState = {
          ...base,
          activation: { selection: null, passed: true },
        };
        return { ...prev, [side]: nextSide };
      });
    },
    [updateGauntletState],
  );

  const gauntletRollShop = useCallback(
    (inventory: StoreOffering[], round: number, roll?: number) => {
      const sanitizedInventory = inventory.map(cloneStoreOffering);
      const current = gauntletStateRef.current[localLegacySide];
      const resolvedRoll =
        typeof roll === "number" && Number.isFinite(roll) ? roll : current.shop.roll + 1;
      if (
        offeringsEqual(current.shop.inventory, sanitizedInventory) &&
        current.shop.round === round &&
        current.shop.roll === resolvedRoll &&
        current.shop.purchases.length === 0
      ) {
        return;
      }
      applyGauntletShopRollFor(localLegacySide, {
        inventory: sanitizedInventory,
        round,
        roll: resolvedRoll,
      });
      emitIntent?.({
        type: "shopRoll",
        side: localLegacySide,
        inventory: sanitizedInventory,
        round,
        roll: resolvedRoll,
      });
    },
    [
      applyGauntletShopRollFor,
      emitIntent,
      localLegacySide,
    ],
  );

  const gauntletConfirmPurchase = useCallback(
    (cardId: string, round: number) => {
      const current = gauntletStateRef.current[localLegacySide];
      const alreadyRecorded = current.shop.purchases.some(
        (p) => p.cardId === cardId && p.round === round,
      );
      const hasCard = current.shop.inventory.some((offering) => offering.id === cardId);
      if (!hasCard && alreadyRecorded) {
        return;
      }
      applyGauntletPurchaseFor(localLegacySide, { cardId, round });
      emitIntent?.({ type: "shopPurchase", side: localLegacySide, cardId, round });
    },
    [applyGauntletPurchaseFor, emitIntent, localLegacySide],
  );

  const gauntletUpdateGold = useCallback(
    (gold: number, delta?: number) => {
      const current = gauntletStateRef.current[localLegacySide];
      const resolvedDelta =
        typeof delta === "number" && Number.isFinite(delta) ? delta : gold - current.gold;
      if (current.gold === gold && current.goldDelta === resolvedDelta) {
        return;
      }
      applyGauntletGoldFor(localLegacySide, { gold, delta: resolvedDelta });
      emitIntent?.({ type: "gold", side: localLegacySide, gold, delta: resolvedDelta });
    },
    [applyGauntletGoldFor, emitIntent, localLegacySide],
  );

  const gauntletSelectActivation = useCallback(
    (activationId: string) => {
      const current = gauntletStateRef.current[localLegacySide];
      if (current.activation.selection === activationId && !current.activation.passed) {
        return;
      }
      applyGauntletActivationSelectFor(localLegacySide, activationId);
      emitIntent?.({ type: "activationSelect", side: localLegacySide, activationId });
    },
    [applyGauntletActivationSelectFor, emitIntent, localLegacySide],
  );

  const gauntletPassActivation = useCallback(() => {
    const current = gauntletStateRef.current[localLegacySide];
    if (current.activation.passed && current.activation.selection === null) {
      return;
    }
    applyGauntletActivationPassFor(localLegacySide);
    emitIntent?.({ type: "activationPass", side: localLegacySide });
  }, [
    applyGauntletActivationPassFor,
    emitIntent,
    localLegacySide,
  ]);

  return {
    gauntletState,
    gauntletStateRef,
    resetGauntletState,
    resetGauntletShops,
    applyGauntletShopRollFor,
    applyGauntletPurchaseFor,
    applyGauntletGoldFor,
    applyGauntletActivationSelectFor,
    applyGauntletActivationPassFor,
    gauntletRollShop,
    gauntletConfirmPurchase,
    gauntletUpdateGold,
    gauntletSelectActivation,
    gauntletPassActivation,
  };
}

export function cloneStoreOffering(offering: StoreOffering): StoreOffering {
  return {
    ...offering,
    card: cloneCardForGauntlet(offering.card),
  };
}

export function offeringsEqual(a: StoreOffering[], b: StoreOffering[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const offerA = a[i];
    const offerB = b[i];
    if (!offerA || !offerB) return false;
    if (offerA.id !== offerB.id) return false;
    if (offerA.cost !== offerB.cost) return false;
    if (offerA.rarity !== offerB.rarity) return false;
    if (offerA.summary !== offerB.summary) return false;
    if (!cardsEqual(offerA.card, offerB.card)) return false;
  }
  return true;
}

function createInitialGauntletState(): GauntletState {
  return {
    player: createInitialGauntletSideState(),
    enemy: createInitialGauntletSideState(),
  };
}

function createInitialGauntletSideState(): GauntletSideState {
  return {
    shop: { inventory: [], roll: 0, round: 0, purchases: [] },
    gold: 0,
    goldDelta: null,
    activation: { selection: null, passed: false },
  };
}

function cardsEqual(a: Card, b: Card): boolean {
  const legacyA = a as Card & {
    leftValue?: number | null;
    rightValue?: number | null;
  };
  const legacyB = b as Card & {
    leftValue?: number | null;
    rightValue?: number | null;
  };
  if (a.id !== b.id) return false;
  if (a.name !== b.name) return false;
  if ((a.type ?? "normal") !== (b.type ?? "normal")) return false;
  if ((a.number ?? null) !== (b.number ?? null)) return false;
  if ((legacyA.leftValue ?? null) !== (legacyB.leftValue ?? null)) return false;
  if ((legacyA.rightValue ?? null) !== (legacyB.rightValue ?? null)) return false;
  if ((a.behavior ?? null) !== (b.behavior ?? null)) return false;
  if ((a.cost ?? null) !== (b.cost ?? null)) return false;
  if ((a.rarity ?? null) !== (b.rarity ?? null)) return false;
  if ((a.effectSummary ?? null) !== (b.effectSummary ?? null)) return false;
  if (a.tags.length !== b.tags.length) return false;
  for (let i = 0; i < a.tags.length; i += 1) {
    if (a.tags[i] !== b.tags[i]) return false;
  }
  return true;
}
