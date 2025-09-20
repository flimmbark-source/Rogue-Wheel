import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  startTransition,
} from "react";

import {
  SLICES,
  TARGET_WINS,
  GAUNTLET_TARGET_WINS,
  type Side as TwoSide,
  type Card,
  type Section,
  type Fighter,
  type Players,
  LEGACY_FROM_SIDE,
} from "../types";
import { easeInOutCubic, inSection, createSeededRng } from "../math";
import { genWheelSections } from "../wheel";
import {
  makeFighter,
  drawOne,
  refillTo,
  freshFive,
  cloneCardForGauntlet,
  addPurchasedCardToFighter,
  getCardSourceId,
  recordMatchResult,
  rollStoreOfferings,
  buildGauntletDeckAsCards,
  applyGauntletPurchase,
  type MatchResultSummary,
  type LevelProgress,
} from "../../player/profileStore";
import { getCardPlayValue, getCardReserveValue } from "../values";
import { MAX_WHEEL, calcWheelSize } from "./wheelSizing";
import {
  computeAdjustedCardValue,
  computeEffectiveCardValues,
  type ActivationAdjustmentsMap,
  type ActivationSwapPairs,
} from "./valueAdjustments";

function useLatestRef<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

const isActivatableCard = (card: Card | null | undefined): card is Card => {
  if (!card) return false;
  return !!card.behavior;
};

export type LegacySide = "player" | "enemy";
export type Phase =
  | "choose"
  | "showEnemy"
  | "anim"
  | "roundEnd"
  | "shop"
  | "activation"
  | "activationComplete"
  | "ended";

export type MatchMode = "classic" | "gauntlet";

export type GauntletShopPurchase = { cardId: string; round: number };

export type GauntletShopState = {
  inventory: Card[];
  roll: number;
  round: number;
  purchases: GauntletShopPurchase[];
};

export type PendingShopPurchase = {
  card: Card;
  sourceId: string | null;
  cost: number;
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
  inventory: Card[];
  round: number;
  roll: number;
};

export type GauntletGoldPayload = {
  gold: number;
  delta?: number;
};

export type MPIntent =
  | { type: "assign"; lane: number; side: LegacySide; card: Card }
  | { type: "clear"; lane: number; side: LegacySide }
  | { type: "reveal"; side: LegacySide }
  | { type: "nextRound"; side: LegacySide }
  | { type: "rematch"; side: LegacySide }
  | { type: "reserve"; side: LegacySide; reserve: number; round: number }
  | ({ type: "shopRoll"; side: LegacySide } & GauntletShopRollPayload)
  | { type: "shopReady"; side: LegacySide }
  | ({ type: "shopPurchase"; side: LegacySide } & (
      | { cardId: string; round: number }
      | { card: Card; cost: number; sourceId?: string | null }
    ))
  | ({ type: "gold"; side: LegacySide } & GauntletGoldPayload)
  | { type: "activationSelect"; side: LegacySide; activationId: string }
  | { type: "activationPass"; side: LegacySide }
  | { type: "activation"; side: LegacySide; action: "activate" | "pass"; cardId?: string };


// --- Shop / Activation intents (merged) ---
type ShopRollIntent =
  ({ type: "shopRoll"; side: LegacySide } & GauntletShopRollPayload);

type ShopReadyIntent =
  { type: "shopReady"; side: LegacySide };

// Back-compat: support both legacy (cardId+round) and new (card+cost)
type ShopPurchaseIntent =
  ({ type: "shopPurchase"; side: LegacySide } & (
    | { cardId: string; round: number }           // legacy shape
    | { card: Card; cost: number; sourceId?: string | null } // new shape
  ));

type GoldIntent =
  ({ type: "gold"; side: LegacySide } & GauntletGoldPayload);

// Back-compat: support older split select/pass and newer consolidated activation
type ActivationIntent =
  | { type: "activationSelect"; side: LegacySide; activationId: string }
  | { type: "activationPass"; side: LegacySide }
  | { type: "activation"; side: LegacySide; action: "activate" | "pass"; cardId?: string };

export interface UseMatchControllerOptions {
  localSide: TwoSide;
  players: Players;
  seed: number;
  hostId?: string;
  targetWins?: number;
  isMultiplayer: boolean;
  sendIntent?: (intent: MPIntent) => void;
  onExit?: () => void;
  mode?: MatchMode;
}

export type MatchController = ReturnType<typeof useMatchController>;

export function useMatchController({
  localSide,
  players,
  seed,
  hostId,
  targetWins,
  isMultiplayer,
  sendIntent,
  onExit,
  mode = "classic",
}: UseMatchControllerOptions) {
  const matchMode = mode;
  const isGauntletMode = matchMode === "gauntlet";

  const sendIntentRef = useRef(sendIntent);
  useEffect(() => {
    sendIntentRef.current = sendIntent;
  }, [sendIntent]);

  const emitIntent = useCallback(
    (intent: MPIntent) => {
      if (!isMultiplayer) return;
      sendIntentRef.current?.(intent);
    },
    [isMultiplayer],
  );


// Keep the ref fresh if sendIntent changes
useEffect(() => {
  sendIntentRef.current = sendIntent;
}, [sendIntent]);



  const localLegacySide: LegacySide = LEGACY_FROM_SIDE[localSide];
  const remoteLegacySide: LegacySide = localLegacySide === "player" ? "enemy" : "player";

  const HUD_COLORS = useMemo(
    () => ({
      player: players.left.color ?? "#84cc16",
      enemy: players.right.color ?? "#d946ef",
    }) as const,
    [players.left.color, players.right.color],
  );

  const namesByLegacy: Record<LegacySide, string> = useMemo(
    () => ({
      player: players.left.name,
      enemy: players.right.name,
    }),
    [players.left.name, players.right.name],
  );

  const defaultTargetWins = isGauntletMode ? GAUNTLET_TARGET_WINS : TARGET_WINS;

  const winGoal = useMemo(() => {
    if (typeof targetWins === "number" && Number.isFinite(targetWins)) {
      return Math.max(1, Math.min(15, Math.round(targetWins)));
    }
    return defaultTargetWins;
  }, [targetWins, defaultTargetWins]);

  const hostLegacySide: LegacySide = useMemo(() => {
    if (!hostId) return "player";
    if (players.left.id === hostId) return "player";
    if (players.right.id === hostId) return "enemy";
    return "player";
  }, [hostId, players.left.id, players.right.id]);

  const mountedRef = useRef(true);
  const timeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      timeoutsRef.current.forEach(clearTimeout);
      timeoutsRef.current.clear();
    };
  }, []);

  const setSafeTimeout = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      if (mountedRef.current) {
        fn();
      }
    }, ms);
    timeoutsRef.current.add(id);
    return id;
  }, []);

  const [player, setPlayer] = useState<Fighter>(() =>
    isGauntletMode ? makeFighter("Wanderer", { deck: buildGauntletDeckAsCards() }) : makeFighter("Wanderer"),
  );
  const [enemy, setEnemy] = useState<Fighter>(() => makeFighter("Shade Bandit"));
  const playerRef = useLatestRef(player);
  const enemyRef = useLatestRef(enemy);

  const [initiative, setInitiative] = useState<LegacySide>(() =>
    hostId ? hostLegacySide : localLegacySide,
  );
  const [wins, setWins] = useState<{ player: number; enemy: number }>({
    player: 0,
    enemy: 0,
  });
  const [round, setRound] = useState(1);
  const shouldOpenShopThisRound = useMemo(
    () => isGauntletMode && round >= 3 && round % 3 === 0,
    [isGauntletMode, round],
  );

  const [freezeLayout, setFreezeLayout] = useState(false);
  const [lockedWheelSize, setLockedWheelSize] = useState<number | null>(null);

  const [phase, setPhase] = useState<Phase>("choose");

  const [gold, setGold] = useState<Record<LegacySide, number>>({
    player: 0,
    enemy: 0,
  });
  const [shopInventory, setShopInventory] = useState<Record<LegacySide, Card[]>>({
    player: [],
    enemy: [],
  });
  const [shopPurchases, setShopPurchases] = useState<
    Record<LegacySide, PendingShopPurchase[]>
  >({
    player: [],
    enemy: [],
  });
  const shopPurchasesRef = useLatestRef(shopPurchases);
  const [shopReady, setShopReady] = useState<{ player: boolean; enemy: boolean }>({
    player: false,
    enemy: false,
  });

  const [activationTurn, setActivationTurn] = useState<LegacySide | null>(null);
  const [activationPasses, setActivationPasses] = useState<{
    player: boolean;
    enemy: boolean;
  }>({
    player: false,
    enemy: false,
  });
  const [activationLog, setActivationLog] = useState<
    { side: LegacySide; action: "activate" | "pass"; cardId?: string }[]
  >([]);

  const [activationAvailable, setActivationAvailable] = useState<
    Record<LegacySide, string[]>
  >({ player: [], enemy: [] });
  const [activationInitial, setActivationInitial] = useState<Record<LegacySide, string[]>>({
    player: [],
    enemy: [],
  });
  const [pendingSwapCardId, setPendingSwapCardId] = useState<string | null>(null);
  const [activationSwapPairs, setActivationSwapPairs] = useState<ActivationSwapPairs>([]);
  const [activationAdjustments, setActivationAdjustments] =
    useState<ActivationAdjustmentsMap>({});

  const activationAvailableRef = useRef(activationAvailable);
  useEffect(() => {
    activationAvailableRef.current = activationAvailable;
  }, [activationAvailable]);

  const activationAdjustmentsRef = useRef<ActivationAdjustmentsMap>(activationAdjustments);
  useEffect(() => {
    activationAdjustmentsRef.current = activationAdjustments;
  }, [activationAdjustments]);

  const activationSwapPairsRef = useRef<ActivationSwapPairs>(activationSwapPairs);
  useEffect(() => {
    activationSwapPairsRef.current = activationSwapPairs;
  }, [activationSwapPairs]);

  const pendingSwapRef = useRef(pendingSwapCardId);
  useEffect(() => {
    pendingSwapRef.current = pendingSwapCardId;
  }, [pendingSwapCardId]);

  const activationEnemyPicksRef = useRef<(Card | null)[] | null>(null);
  const startActivationPhaseRef = useRef<(enemyPicks: (Card | null)[]) => void>(() => {});

  const [resolveVotes, setResolveVotes] = useState<{ player: boolean; enemy: boolean }>(
    {
      player: false,
      enemy: false,
    },
  );

  const markResolveVote = useCallback((side: LegacySide) => {
    setResolveVotes((prev) => {
      if (prev[side]) return prev;
      return { ...prev, [side]: true };
    });
  }, []);

  const clearResolveVotes = useCallback(() => {
    setResolveVotes((prev) => {
      if (!prev.player && !prev.enemy) return prev;
      return { player: false, enemy: false };
    });
  }, []);

  const [advanceVotes, setAdvanceVotes] = useState<{ player: boolean; enemy: boolean }>(
    {
      player: false,
      enemy: false,
    },
  );

  const markAdvanceVote = useCallback((side: LegacySide) => {
    setAdvanceVotes((prev) => {
      if (prev[side]) return prev;
      return { ...prev, [side]: true };
    });
  }, []);

  const clearAdvanceVotes = useCallback(() => {
    setAdvanceVotes((prev) => {
      if (!prev.player && !prev.enemy) return prev;
      return { player: false, enemy: false };
    });
  }, []);

  const [rematchVotes, setRematchVotes] = useState<{ player: boolean; enemy: boolean }>(
    {
      player: false,
      enemy: false,
    },
  );

  const gauntletStateRef = useRef<GauntletState>(createInitialGauntletState());
  const [gauntletState, setGauntletState] = useState<GauntletState>(() => gauntletStateRef.current);

  const updateGauntletState = useCallback((updater: (prev: GauntletState) => GauntletState) => {
    setGauntletState((prev) => {
      const next = updater(prev);
      gauntletStateRef.current = next;
      return next;
    });
  }, []);

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
        const nextInventory = payload.inventory.map(cloneCardForGauntlet);
        const sameInventory = inventoriesEqual(base.shop.inventory, nextInventory);
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

function createInitialGauntletState(): GauntletState {
  return {
    player: createInitialGauntletSideState(),
    enemy: createInitialGauntletSideState(),
  };
}


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
    (inventory: Card[], round: number, roll?: number) => {
      const sanitizedInventory = inventory.map(cloneCardForGauntlet);
      const current = gauntletStateRef.current[localLegacySide];
      const resolvedRoll =
        typeof roll === "number" && Number.isFinite(roll) ? roll : current.shop.roll + 1;
      if (
        inventoriesEqual(current.shop.inventory, sanitizedInventory) &&
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
      emitIntent({
        type: "shopRoll",
        side: localLegacySide,
        inventory: sanitizedInventory,
        round,
        roll: resolvedRoll,
      });
    },
    [applyGauntletShopRollFor, emitIntent, localLegacySide],
  );

  const gauntletConfirmPurchase = useCallback(
    (cardId: string, round: number) => {
      const current = gauntletStateRef.current[localLegacySide];
      const alreadyRecorded = current.shop.purchases.some(
        (p) => p.cardId === cardId && p.round === round,
      );
      const hasCard = current.shop.inventory.some((card) => card.id === cardId);
      if (!hasCard && alreadyRecorded) {
        return;
      }
      applyGauntletPurchaseFor(localLegacySide, { cardId, round });
      emitIntent({ type: "shopPurchase", side: localLegacySide, cardId, round });
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
      emitIntent({ type: "gold", side: localLegacySide, gold, delta: resolvedDelta });
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
      emitIntent({ type: "activationSelect", side: localLegacySide, activationId });
    },
    [applyGauntletActivationSelectFor, emitIntent, localLegacySide],
  );

  const gauntletPassActivation = useCallback(() => {
    const current = gauntletStateRef.current[localLegacySide];
    if (current.activation.passed && current.activation.selection === null) {
      return;
    }
    applyGauntletActivationPassFor(localLegacySide);
    emitIntent({ type: "activationPass", side: localLegacySide });
  }, [
    applyGauntletActivationPassFor,
    emitIntent,
    localLegacySide,
  ]);

  const markRematchVote = useCallback((side: LegacySide) => {
    setRematchVotes((prev) => {
      if (prev[side]) return prev;
      return { ...prev, [side]: true };
    });
  }, []);

  const clearRematchVotes = useCallback(() => {
    setRematchVotes((prev) => {
      if (!prev.player && !prev.enemy) return prev;
      return { player: false, enemy: false };
    });
  }, []);

  const [matchSummary, setMatchSummary] = useState<MatchResultSummary | null>(null);
  const [xpDisplay, setXpDisplay] = useState<LevelProgress | null>(null);
  const [levelUpFlash, setLevelUpFlash] = useState(false);
  const hasRecordedResultRef = useRef(false);

  const matchWinner: LegacySide | null =
    wins.player >= winGoal ? "player" : wins.enemy >= winGoal ? "enemy" : null;
  const localWinsCount = localLegacySide === "player" ? wins.player : wins.enemy;
  const remoteWinsCount = localLegacySide === "player" ? wins.enemy : wins.player;
  const localWon = matchWinner ? matchWinner === localLegacySide : false;
  const winnerName = matchWinner ? namesByLegacy[matchWinner] : null;
  const localName = namesByLegacy[localLegacySide];
  const remoteName = namesByLegacy[remoteLegacySide];

  useEffect(() => {
    setInitiative(hostId ? hostLegacySide : localLegacySide);
  }, [hostId, hostLegacySide, localLegacySide]);

  useEffect(() => {
    if (phase === "ended") {
      if (!hasRecordedResultRef.current) {
        const summary = recordMatchResult({ didWin: localWon });
        hasRecordedResultRef.current = true;
        setMatchSummary(summary);

        if (summary.didWin) {
          setXpDisplay(summary.before);
          setLevelUpFlash(false);
          if (summary.segments.length === 0) {
            setXpDisplay(summary.after);
          }
          summary.segments.forEach((segment, idx) => {
            setSafeTimeout(() => {
              setXpDisplay({
                level: segment.level,
                exp: segment.exp,
                expToNext: segment.expToNext,
                percent: segment.percent,
              });
              if (segment.leveledUp) {
                setLevelUpFlash(true);
                setSafeTimeout(() => setLevelUpFlash(false), 900);
              }
            }, 600 * (idx + 1));
          });
        } else {
          setXpDisplay(null);
          setLevelUpFlash(false);
        }
      }
    } else {
      hasRecordedResultRef.current = false;
      if (phase === "choose" && wins.player === 0 && wins.enemy === 0) {
        setMatchSummary(null);
        setXpDisplay(null);
        setLevelUpFlash(false);
      }
    }
  }, [phase, localWon, wins.player, wins.enemy, setSafeTimeout]);

  const [handClearance, setHandClearance] = useState<number>(0);

  const [wheelSize, setWheelSize] = useState<number>(() =>
    typeof window !== "undefined"
      ? calcWheelSize(window.innerHeight, window.innerWidth, 0)
      : MAX_WHEEL,
  );

  useEffect(() => {
    const onResize = () => {
      if (freezeLayout || lockedWheelSize !== null) return;
      setWheelSize(calcWheelSize(window.innerHeight, window.innerWidth, handClearance));
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    const timeout = setTimeout(() => {
      if (!freezeLayout && lockedWheelSize === null) {
        onResize();
      }
    }, 350);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      clearTimeout(timeout);
    };
  }, [freezeLayout, handClearance, lockedWheelSize]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (freezeLayout || lockedWheelSize !== null) return;
    setWheelSize(calcWheelSize(window.innerHeight, window.innerWidth, handClearance));
  }, [handClearance, freezeLayout, lockedWheelSize]);

  const wheelRngRef = useRef<() => number>(() => Math.random());
  const [wheelSections, setWheelSections] = useState<Section[][]>(() => {
    const seeded = createSeededRng(seed);
    wheelRngRef.current = seeded;
    return [
      genWheelSections("bandit", seeded),
      genWheelSections("sorcerer", seeded),
      genWheelSections("beast", seeded),
    ];
  });

  const generateWheelSet = useCallback((): Section[][] => {
    const rng = wheelRngRef.current ?? Math.random;
    return [
      genWheelSections("bandit", rng),
      genWheelSections("sorcerer", rng),
      genWheelSections("beast", rng),
    ];
  }, []);

  useEffect(() => {
    wheelRngRef.current = createSeededRng(seed);
    setWheelSections(generateWheelSet());
  }, [seed, generateWheelSet]);

  const [tokens, setTokens] = useState<[number, number, number]>([0, 0, 0]);
  const [active] = useState<[boolean, boolean, boolean]>([true, true, true]);
  const [wheelHUD, setWheelHUD] = useState<[string | null, string | null, string | null]>([
    null,
    null,
    null,
  ]);

  const [assign, setAssign] = useState<{ player: (Card | null)[]; enemy: (Card | null)[] }>(
    { player: [null, null, null], enemy: [null, null, null] },
  );
  const assignRef = useRef(assign);
  useEffect(() => {
    assignRef.current = assign;
  }, [assign]);

  const reserveReportsRef = useRef<
    Record<LegacySide, { reserve: number; round: number } | null>
  >({
    player: null,
    enemy: null,
  });

  const storeReserveReport = useCallback(
    (side: LegacySide, reserve: number, roundValue: number) => {
      const prev = reserveReportsRef.current[side];
      if (!prev || prev.reserve !== reserve || prev.round !== roundValue) {
        reserveReportsRef.current[side] = { reserve, round: roundValue };
        return true;
      }
      return false;
    },
    [],
  );

  const broadcastLocalReserve = useCallback(() => {
    const fighter = localLegacySide === "player" ? playerRef.current : enemyRef.current;
    const assignedLane =
      localLegacySide === "player" ? assignRef.current.player : assignRef.current.enemy;
    const assignedIds = new Set(
      assignedLane.filter((card): card is Card => !!card).map((card) => card.id),
    );
    const reserve = computeReserveSum(fighter.hand, assignedIds);
    const updated = storeReserveReport(localLegacySide, reserve, round);
    if (isMultiplayer && updated) {
      emitIntent({ type: "reserve", side: localLegacySide, reserve, round });
    }
  }, [
    emitIntent,
    enemyRef,
    isMultiplayer,
    localLegacySide,
    playerRef,
    round,
    storeReserveReport,
  ]);

  const [dragCardId, setDragCardId] = useState<string | null>(null);
  const [dragOverWheelInternal, setDragOverWheelInternal] = useState<number | null>(null);
  const dragOverRef = useRef<number | null>(null);
  const setDragOverWheel = useCallback((index: number | null) => {
    dragOverRef.current = index;
    if (typeof (window as any).requestIdleCallback === "function") {
      (window as any).requestIdleCallback(() => {
        setDragOverWheelInternal(dragOverRef.current);
      });
    } else {
      setTimeout(() => setDragOverWheelInternal(dragOverRef.current), 0);
    }
  }, []);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  const [reserveSums, setReserveSums] = useState<null | { player: number; enemy: number }>(
    null,
  );

  const START_LOG = "A Shade Bandit eyes your purse...";
  const [log, setLog] = useState<string[]>([START_LOG]);
  const appendLog = useCallback((entry: string) => {
    setLog((prev) => [entry, ...prev].slice(0, 60));
  }, []);

  const canReveal = useMemo(() => {
    const lane = localLegacySide === "player" ? assign.player : assign.enemy;
    return lane.every((card, index) => !active[index] || !!card);
  }, [assign, active, localLegacySide]);

  type WheelRefHandle = { setVisualToken: (slice: number) => void };
  const wheelRefs = [
    useRef<WheelRefHandle | null>(null),
    useRef<WheelRefHandle | null>(null),
    useRef<WheelRefHandle | null>(null),
  ];

  const assignCardToLaneForSide = useCallback(
    (side: LegacySide, laneIndex: number, card: Card) => {
      if (!active[laneIndex]) return false;

      const lane = side === "player" ? assignRef.current.player : assignRef.current.enemy;
      const prevAtLane = lane[laneIndex];
      const fromIdx = lane.findIndex((c) => c?.id === card.id);

      if (prevAtLane && prevAtLane.id === card.id && fromIdx === laneIndex) {
        if (side === localLegacySide) {
          setSelectedCardId(null);
        }
        return false;
      }

      const isPlayer = side === "player";

      startTransition(() => {
        setAssign((prev) => {
          const laneArr = isPlayer ? prev.player : prev.enemy;
          const nextLane = [...laneArr];
          const existingIdx = nextLane.findIndex((c) => c?.id === card.id);
          if (existingIdx !== -1) nextLane[existingIdx] = null;
          nextLane[laneIndex] = card;
          return isPlayer ? { ...prev, player: nextLane } : { ...prev, enemy: nextLane };
        });

        if (isPlayer) {
          setPlayer((p) => {
            let hand = p.hand.filter((c) => c.id !== card.id);
            if (
              prevAtLane &&
              prevAtLane.id !== card.id &&
              !hand.some((c) => c.id === prevAtLane.id)
            ) {
              hand = [...hand, prevAtLane];
            }
            return { ...p, hand };
          });
        } else {
          setEnemy((e) => {
            let hand = e.hand.filter((c) => c.id !== card.id);
            if (
              prevAtLane &&
              prevAtLane.id !== card.id &&
              !hand.some((c) => c.id === prevAtLane.id)
            ) {
              hand = [...hand, prevAtLane];
            }
            return { ...e, hand };
          });
        }

        if (side === localLegacySide) {
          setSelectedCardId(null);
        }
      });

      clearResolveVotes();

      return true;
    },
    [active, clearResolveVotes, localLegacySide],
  );

  const clearAssignFor = useCallback(
    (side: LegacySide, laneIndex: number) => {
      const lane = side === "player" ? assignRef.current.player : assignRef.current.enemy;
      const prevCard = lane[laneIndex];
      if (!prevCard) return false;

      const isPlayer = side === "player";

      startTransition(() => {
        setAssign((prevState) => {
          const laneArr = isPlayer ? prevState.player : prevState.enemy;
          if (!laneArr[laneIndex]) return prevState;
          const nextLane = [...laneArr];
          nextLane[laneIndex] = null;
          return isPlayer
            ? { ...prevState, player: nextLane }
            : { ...prevState, enemy: nextLane };
        });

        if (isPlayer) {
          setPlayer((p) => {
            if (p.hand.some((c) => c.id === prevCard.id)) return p;
            return { ...p, hand: [...p.hand, prevCard] };
          });
        } else {
          setEnemy((e) => {
            if (e.hand.some((c) => c.id === prevCard.id)) return e;
            return { ...e, hand: [...e.hand, prevCard] };
          });
        }

        if (side === localLegacySide) {
          setSelectedCardId((sel) => (sel === prevCard.id ? null : sel));
        }
      });

      clearResolveVotes();

      return true;
    },
    [clearResolveVotes, localLegacySide],
  );

  const assignToWheelLocal = useCallback(
    (laneIndex: number, card: Card) => {
      const changed = assignCardToLaneForSide(localLegacySide, laneIndex, card);
      if (changed && isMultiplayer) {
        emitIntent({ type: "assign", lane: laneIndex, side: localLegacySide, card });
      }
      return changed;
    },
    [assignCardToLaneForSide, emitIntent, isMultiplayer, localLegacySide],
  );

  const clearAssignLocal = useCallback(
    (laneIndex: number) => {
      const changed = clearAssignFor(localLegacySide, laneIndex);
      if (changed && isMultiplayer) {
        emitIntent({ type: "clear", lane: laneIndex, side: localLegacySide });
      }
      return changed;
    },
    [clearAssignFor, emitIntent, isMultiplayer, localLegacySide],
  );

  const configureShopInventory = useCallback(
    (inventory: Partial<Record<LegacySide, Card[]>>) => {
      if (!isGauntletMode) return;
      setShopInventory((prev) => ({
        player: inventory.player ? [...inventory.player] : prev.player,
        enemy: inventory.enemy ? [...inventory.enemy] : prev.enemy,
      }));
    },
    [isGauntletMode],
  );

  const applyShopPurchase = useCallback(
    (
      side: LegacySide,
      card: Card,
      cost: number,
      opts?: { force?: boolean; sourceId?: string | null },
    ) => {
      if (!isGauntletMode) return false;
      const alreadyPurchased = shopPurchases[side].some(
        (purchase) => purchase.card.id === card.id,
      );
      if (alreadyPurchased) {
        return false;
      }

      let allowed = false;
      setGold((prev) => {
        const current = prev[side];
        if (!opts?.force && current < cost) {
          return prev;
        }
        allowed = true;
        return { ...prev, [side]: Math.max(0, current - cost) };
      });
      if (!allowed) {
        return false;
      }

      const purchaseSourceId =
        opts && "sourceId" in opts ? opts.sourceId ?? null : getCardSourceId(card);
      setShopPurchases((prev) => ({
        ...prev,
        [side]: [
          ...prev[side],
          { card: cloneCardForGauntlet(card), sourceId: purchaseSourceId ?? null, cost },
        ],
      }));
      setShopReady((prev) => ({ ...prev, [side]: false }));

      appendLog(
        `${namesByLegacy[side]} purchases ${card.name} for ${cost} gold.`,
      );
      return true;
    },
    [
      appendLog,
      isGauntletMode,
      namesByLegacy,
      shopPurchases,
    ],
  );

  const purchaseFromShop = useCallback(
    (side: LegacySide, card: Card, cost = 10) => {
      if (!isGauntletMode) return false;
      if (phase !== "shop") return false;
      const sourceId = getCardSourceId(card);
      const success = applyShopPurchase(side, card, cost, {
        force: false,
        sourceId,
      });
      if (!success) return false;
      if (isMultiplayer) {
        emitIntent({ type: "shopPurchase", side, card, cost, sourceId });
      }
      return true;
    },
    [applyShopPurchase, emitIntent, isGauntletMode, isMultiplayer, phase],
  );

  const openShopPhase = useCallback(() => {
    if (!isGauntletMode) return false;
    if (round < 3) return false;
    if (phase === "shop") return false;
    setPlayer((prev) => discardHand(prev));
    setEnemy((prev) => discardHand(prev));
    setShopReady(() => {
      const base = { player: false, enemy: false };
      if (isMultiplayer) {
        return { ...base };
      }
      return { ...base, [remoteLegacySide]: true };
    });
    setPhase("shop");
    return true;
  }, [isGauntletMode, isMultiplayer, phase, remoteLegacySide, round]);

  useEffect(() => {
    if (!shouldOpenShopThisRound) return;
    if (phase !== "roundEnd") return;
    openShopPhase();
  }, [openShopPhase, phase, shouldOpenShopThisRound]);

  useEffect(() => {
    if (!isGauntletMode) return;
    if (phase !== "shop") return;
    if (isMultiplayer && localLegacySide !== hostLegacySide) return;
    const currentInventory = shopInventory[localLegacySide] ?? [];
    if (currentInventory.length > 0) return;
    const offerings = rollStoreOfferings();
    if (offerings.length === 0) return;
    setShopInventory((prev) => ({
      ...prev,
      [localLegacySide]: offerings.map((offer) => offer.card),
    }));
  }, [
    hostLegacySide,
    isGauntletMode,
    isMultiplayer,
    localLegacySide,
    phase,
    rollStoreOfferings,
    shopInventory,
  ]);

  const revealRoundCore = useCallback(() => {
    const allow = phase === "choose" && canReveal;
    if (!allow) return false;

    setFreezeLayout(true);
    setLockedWheelSize(Math.round(wheelSize));
    setPhase("showEnemy");

    broadcastLocalReserve();

    const autoPickEnemy = () => {
      const { hand } = enemy;
      if (hand.length === 0) {
        appendLog("Enemy is out of cards!");
        return [null, null, null] as (Card | null)[];
      }

      const picks: (Card | null)[] = [null, null, null];
      const taken = new Set<string>();

      const assignEnemyCard = (idx: number, card: Card) => {
        picks[idx] = card;
        taken.add(card.id);
      };

      const chooseForLane = (idx: number) => {
        const lane = assign.enemy[idx];
        if (lane) return;

        const available = hand.filter((card) => !taken.has(card.id));
        if (available.length === 0) return;

        let best = available[0];
        let bestValue = getCardPlayValue(best);
        for (let i = 1; i < available.length; i++) {
          const candidate = available[i];
          const value = getCardPlayValue(candidate);
          if (value > bestValue) {
            best = candidate;
            bestValue = value;
          }
        }

        if (best) assignEnemyCard(idx, best);
      };

      chooseForLane(0);
      chooseForLane(1);
      chooseForLane(2);

      return picks;
    };

    const enemyPicks: (Card | null)[] = isMultiplayer
      ? [...assignRef.current.enemy]
      : autoPickEnemy();

    if (!isMultiplayer && enemyPicks.some(Boolean)) {
      const pickIds = new Set((enemyPicks.filter(Boolean) as Card[]).map((c) => c.id));
      setEnemy((prev) => ({
        ...prev,
        hand: prev.hand.filter((card) => !pickIds.has(card.id)),
      }));
      setAssign((a) => ({ ...a, enemy: enemyPicks }));
    }

    setSafeTimeout(() => {
      if (!mountedRef.current) return;
      startActivationPhaseRef.current(enemyPicks);
    }, 600);

    return true;
  }, [
    appendLog,
    assign.enemy,
    broadcastLocalReserve,
    canReveal,
    enemy,
    isMultiplayer,
    phase,
    setSafeTimeout,
    wheelSize,
  ]);

  const onReveal = useCallback(() => revealRoundCore(), [revealRoundCore]);

  useEffect(() => {
    if (!isMultiplayer) return;
    if (phase !== "choose") return;
    if (!canReveal) return;
    if (!resolveVotes.player || !resolveVotes.enemy) return;
    revealRoundCore();
  }, [canReveal, isMultiplayer, phase, resolveVotes, revealRoundCore]);

  function resolveRound(enemyPicks?: (Card | null)[]) {
    const played = [0, 1, 2].map((i) => ({
      p: assign.player[i] as Card | null,
      e: (enemyPicks?.[i] ?? assign.enemy[i]) as Card | null,
    }));

    const adjustments = activationAdjustmentsRef.current;
    const swaps = activationSwapPairsRef.current;

    const effectiveValues = computeEffectiveCardValues(
      played.flatMap((slot) => [slot.p, slot.e]),
      adjustments,
      swaps,
    );

    const valueForCard = (card: Card | null): number => {
      if (!card) return 0;
      const cached = effectiveValues.get(card.id);
      if (typeof cached === "number") return cached;
      const value = computeAdjustedCardValue(card, adjustments);
      effectiveValues.set(card.id, value);
      return value;
    };

    const localFighter =
      localLegacySide === "player" ? playerRef.current : enemyRef.current;
    const remoteFighter =
      remoteLegacySide === "player" ? playerRef.current : enemyRef.current;

    const playerAssigned = new Set(
      played
        .map((slot) => slot.p?.id)
        .filter((id): id is string => typeof id === "string"),
    );
    const enemyAssigned = new Set(
      played
        .map((slot) => slot.e?.id)
        .filter((id): id is string => typeof id === "string"),
    );
    const assignedByLegacy: Record<LegacySide, Set<string>> = {
      player: playerAssigned,
      enemy: enemyAssigned,
    };

    const localReserve = computeReserveSum(localFighter.hand, assignedByLegacy[localLegacySide]);
    let remoteReserve: number;
    let usedRemoteReport = false;

    if (!isMultiplayer) {
      remoteReserve = computeReserveSum(
        remoteFighter.hand,
        assignedByLegacy[remoteLegacySide],
      );
    } else {
      const report = reserveReportsRef.current[remoteLegacySide];
      if (report && report.round === round) {
        remoteReserve = report.reserve;
        usedRemoteReport = true;
      } else {
        remoteReserve = computeReserveSum(
          remoteFighter.hand,
          assignedByLegacy[remoteLegacySide],
        );
      }
    }

    storeReserveReport(localLegacySide, localReserve, round);
    if (!isMultiplayer || !usedRemoteReport) {
      storeReserveReport(remoteLegacySide, remoteReserve, round);
    }

    const pReserve = localLegacySide === "player" ? localReserve : remoteReserve;
    const eReserve = localLegacySide === "enemy" ? localReserve : remoteReserve;

    setReserveSums({ player: pReserve, enemy: eReserve });

    type Outcome = {
      steps: number;
      targetSlice: number;
      section: Section;
      winner: LegacySide | null;
      tie: boolean;
      wheel: number;
      detail: string;
    };
    const outcomes: Outcome[] = [];

    for (let w = 0; w < 3; w++) {
      const secList = wheelSections[w];
      const cardP = played[w].p ?? null;
      const cardE = played[w].e ?? null;
      const baseP = valueForCard(cardP);
      const baseE = valueForCard(cardE);
      const steps = ((baseP % SLICES) + (baseE % SLICES)) % SLICES;
      const targetSlice = (tokens[w] + steps) % SLICES;
      const section =
        secList.find((s) => targetSlice !== 0 && inSection(targetSlice, s)) ||
        ({ id: "Strongest", color: "transparent", start: 0, end: 0 } as Section);

      const pVal = baseP;
      const eVal = baseE;
      let winner: LegacySide | null = null;
      let tie = false;
      let detail = "";
      switch (section.id) {
        case "Strongest":
          if (pVal === eVal) tie = true;
          else winner = pVal > eVal ? "player" : "enemy";
          detail = `Strongest ${pVal} vs ${eVal}`;
          break;
        case "Weakest":
          if (pVal === eVal) tie = true;
          else winner = pVal < eVal ? "player" : "enemy";
          detail = `Weakest ${pVal} vs ${eVal}`;
          break;
        case "ReserveSum":
          if (pReserve === eReserve) tie = true;
          else winner = pReserve > eReserve ? "player" : "enemy";
          detail = `Reserve ${pReserve} vs ${eReserve}`;
          break;
        case "ClosestToTarget": {
          const target = targetSlice === 0 ? section.target ?? 0 : targetSlice;
          const pd = Math.abs(pVal - target);
          const ed = Math.abs(eVal - target);
          if (pd === ed) tie = true;
          else winner = pd < ed ? "player" : "enemy";
          detail = `Closest to ${target}: ${pVal} vs ${eVal}`;
          break;
        }
        case "Initiative":
          winner = initiative;
          detail = `Initiative -> ${winner}`;
          break;
        default:
          tie = true;
          detail = "Slice 0: no section";
          break;
      }
      outcomes.push({ steps, targetSlice, section, winner, tie, wheel: w, detail });
    }

    const animateSpins = async () => {
      const finalTokens: [number, number, number] = [...tokens] as [
        number,
        number,
        number,
      ];

      for (const outcome of outcomes) {
        const start = finalTokens[outcome.wheel];
        const steps = outcome.steps;
        if (steps <= 0) continue;
        const total = Math.max(220, Math.min(1000, 110 + 70 * steps));
        const t0 = performance.now();
        await new Promise<void>((resolve) => {
          const frame = (now: number) => {
            if (!mountedRef.current) return resolve();
            const tt = Math.max(0, Math.min(1, (now - t0) / total));
            const progressed = Math.floor(easeInOutCubic(tt) * steps);
            wheelRefs[outcome.wheel].current?.setVisualToken(
              (start + progressed) % SLICES,
            );
            if (tt < 1) {
              requestAnimationFrame(frame);
            } else {
              wheelRefs[outcome.wheel].current?.setVisualToken((start + steps) % SLICES);
              resolve();
            }
          };
          requestAnimationFrame(frame);
        });
        finalTokens[outcome.wheel] = (start + steps) % SLICES;
        await new Promise((r) => setTimeout(r, 90));
      }

      setTokens(finalTokens);

      let pWins = wins.player;
      let eWins = wins.enemy;
      const hudColors: [string | null, string | null, string | null] = [
        null,
        null,
        null,
      ];
      const roundWinsCount: Record<LegacySide, number> = { player: 0, enemy: 0 };

      outcomes.forEach((outcome) => {
        if (outcome.tie) {
          appendLog(
            `Wheel ${outcome.wheel + 1} tie: ${outcome.detail} — no win.`,
          );
        } else if (outcome.winner) {
          hudColors[outcome.wheel] = HUD_COLORS[outcome.winner];
          roundWinsCount[outcome.winner] += 1;
          if (outcome.winner === "player") pWins += 1;
          else eWins += 1;
          appendLog(
            `Wheel ${outcome.wheel + 1} win -> ${outcome.winner} (${outcome.detail}).`,
          );
        }
      });

      if (!mountedRef.current) return;

      const prevInitiative = initiative;
      const roundScore = `${roundWinsCount.player}-${roundWinsCount.enemy}`;
      let nextInitiative: LegacySide;
      let initiativeLog: string;
      if (roundWinsCount.player === roundWinsCount.enemy) {
        nextInitiative = prevInitiative === "player" ? "enemy" : "player";
        initiativeLog = `Round ${round} tie (${roundScore}) — initiative swaps to ${namesByLegacy[nextInitiative]}.`;
      } else if (roundWinsCount.player > roundWinsCount.enemy) {
        nextInitiative = "player";
        initiativeLog = `${namesByLegacy.player} wins the round ${roundScore} and takes initiative next round.`;
      } else {
        nextInitiative = "enemy";
        initiativeLog = `${namesByLegacy.enemy} wins the round ${roundScore} and takes initiative next round.`;
      }

      setInitiative(nextInitiative);
      appendLog(initiativeLog);

      setWheelHUD(hudColors);
      setWins({ player: pWins, enemy: eWins });
      setReserveSums({ player: pReserve, enemy: eReserve });
      if (isGauntletMode && pWins < winGoal && eWins < winGoal) {
        const playerReserveGold = Number.isFinite(pReserve) ? pReserve : 0;
        const enemyReserveGold = Number.isFinite(eReserve) ? eReserve : 0;

        setGold((prev) => ({
          player:
            prev.player + roundWinsCount.player + playerReserveGold,
          enemy: prev.enemy + roundWinsCount.enemy + enemyReserveGold,
        }));
        setShopPurchases({ player: [], enemy: [] });
        setShopReady(() => {
          const base = { player: false, enemy: false };
          if (isMultiplayer) {
            return { ...base };
          }
          return { ...base, [remoteLegacySide]: true };
        });
        appendLog(
          `Gauntlet rewards — ${namesByLegacy.player} gains ${roundWinsCount.player} gold, ${namesByLegacy.enemy} gains ${roundWinsCount.enemy} gold.`,
        );
        if (playerReserveGold !== 0 || enemyReserveGold !== 0) {
          appendLog(
            `Reserve spoils — ${namesByLegacy.player} claims ${playerReserveGold} gold, ${namesByLegacy.enemy} claims ${enemyReserveGold} gold.`,
          );
        }
      }
      clearAdvanceVotes();
      setPhase("roundEnd");
      if (pWins >= winGoal || eWins >= winGoal) {
        clearRematchVotes();
        setPhase("ended");
        const localWins = localLegacySide === "player" ? pWins : eWins;
        appendLog(
          localWins >= winGoal
            ? "You win the match!"
            : `${namesByLegacy[remoteLegacySide]} wins the match!`,
        );
      }
    };

    void animateSpins();
  }

  const nextRoundCore = useCallback(
    (opts?: { force?: boolean }) => {
      const allow = opts?.force || phase === "roundEnd";
      if (!allow) return false;

      clearResolveVotes();
      clearAdvanceVotes();

      const currentAssign = assignRef.current;
      const playerPlayed = currentAssign.player.filter((c): c is Card => !!c);
      const enemyPlayed = currentAssign.enemy.filter((c): c is Card => !!c);

      wheelRefs.forEach((ref) => ref.current?.setVisualToken(0));

      setFreezeLayout(false);
      setLockedWheelSize(null);

      setPlayer((p) => settleFighterAfterRound(p, playerPlayed));
      setEnemy((e) => settleFighterAfterRound(e, enemyPlayed));

      setWheelSections(generateWheelSet());
      setAssign({ player: [null, null, null], enemy: [null, null, null] });

      setSelectedCardId(null);
      setDragCardId(null);
      setDragOverWheel(null);
      setTokens([0, 0, 0]);
      setReserveSums(null);
      setWheelHUD([null, null, null]);

      setPhase("choose");
      setActivationTurn(null);
      setActivationPasses({ player: false, enemy: false });
      setActivationLog([]);
      setActivationAvailable({ player: [], enemy: [] });
      setActivationInitial({ player: [], enemy: [] });
      setActivationSwapPairs([]);
      setActivationAdjustments({});
      setPendingSwapCardId(null);
      activationEnemyPicksRef.current = null;
      if (isGauntletMode) {
        setShopInventory({ player: [], enemy: [] });
        setShopPurchases({ player: [], enemy: [] });
        setShopReady({ player: false, enemy: false });
        resetGauntletShops();
        setActivationTurn(null);
        setActivationPasses({ player: false, enemy: false });
        setActivationLog([]);
      }
      setRound((r) => r + 1);

      return true;
    },
    [
      clearAdvanceVotes,
      clearResolveVotes,
      generateWheelSet,
      isGauntletMode,
      phase,
      resetGauntletShops,
      setAssign,
      setEnemy,
      setFreezeLayout,
      setLockedWheelSize,
      setPlayer,
      setReserveSums,
      setTokens,
      setWheelHUD,
      setWheelSections,
      wheelRefs,
    ],
  );

  const nextRound = nextRoundCore;

  const resumeAfterShop = useCallback(() => {
    if (!isGauntletMode) return;

    const pending = shopPurchasesRef.current;
    if (pending.player.length > 0) {
      setPlayer((prev) => stackPurchasesOnDeck(prev, pending.player));
    }
    if (pending.enemy.length > 0) {
      setEnemy((prev) => stackPurchasesOnDeck(prev, pending.enemy));
    }

    const localPending = pending[localLegacySide];
    for (const purchase of localPending) {
      if (!purchase.sourceId) continue;
      try {
        applyGauntletPurchase({
          add: [{ cardId: purchase.sourceId, qty: 1 }],
          cost: purchase.cost,
        });
      } catch (error) {
        console.error("Failed to record gauntlet purchase", error);
      }
    }

    setShopPurchases({ player: [], enemy: [] });

    nextRoundCore({ force: true });
  }, [
    applyGauntletPurchase,
    isGauntletMode,
    localLegacySide,
    nextRoundCore,
    setEnemy,
    setPlayer,
    shopPurchasesRef,
    setShopPurchases,
  ]);

  const completeShopForSide = useCallback(
    (side: LegacySide, opts?: { emit?: boolean }) => {
      if (!isGauntletMode) return false;
      if (phase !== "shop") return false;
      let changed = false;
      let shouldAdvance = false;
      setShopReady((prev) => {
        if (prev[side]) return prev;
        changed = true;
        const updated = { ...prev, [side]: true };
        if (updated.player && updated.enemy) {
          shouldAdvance = true;
        }
        return updated;
      });
      if (!changed) return false;
      if (opts?.emit && isMultiplayer) {
        emitIntent({ type: "shopReady", side });
      }
      if (shouldAdvance) {
        resumeAfterShop();
      }
      return true;
    },
    [resumeAfterShop, emitIntent, isGauntletMode, isMultiplayer, phase],
  );

  useEffect(() => {
    if (!isGauntletMode) return;
    if (phase !== "shop") return;
    if (!shopReady.player || !shopReady.enemy) return;
    resumeAfterShop();
  }, [isGauntletMode, phase, resumeAfterShop, shopReady.enemy, shopReady.player]);

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
        resolveRound(enemyPicks);
        return;
      }

      appendLog("Activation phase begins.");
      setPhase("activation");
    },
    [appendLog, initiative, resolveRound, setPhase],
  );

  const markShopComplete = useCallback(
    (side: LegacySide) => completeShopForSide(side, { emit: true }),
    [completeShopForSide],
  );

  startActivationPhaseRef.current = startActivationPhase;

  const finishActivationPhase = useCallback(() => {
    if (phase !== "activation") return false;
    const enemyPicks = activationEnemyPicksRef.current ?? assignRef.current.enemy;
    setActivationTurn(null);
    setActivationPasses({ player: false, enemy: false });
    setPendingSwapCardId(null);
    activationEnemyPicksRef.current = null;
    setPhase("anim");
    resolveRound(enemyPicks);
    return true;
  }, [assignRef, phase, resolveRound, setPhase]);

  const applyActivationAction = useCallback(
    (
      params: { side: LegacySide; action: "activate" | "pass"; cardId?: string },
      opts?: { emit?: boolean },
    ) => {
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
          emitIntent({ type: "activation", ...params });
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
        emitIntent({ type: "activation", ...params });
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
      activationTurn,
      emitIntent,
      finishActivationPhase,
      isMultiplayer,
      phase,
    ],
  );

  const activateCurrent = useCallback(
    (side: LegacySide, cardId?: string) =>
      applyActivationAction({ side, action: "activate", cardId }, { emit: true }),
    [applyActivationAction],
  );

  const passActivation = useCallback(
    (side: LegacySide) =>
      applyActivationAction({ side, action: "pass" }, { emit: true }),
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

    const params: { side: LegacySide; action: "activate" | "pass"; cardId?: string } =
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
    isMultiplayer,
    phase,
    remoteLegacySide,
  ]);

  const grantGold = useCallback(
    (side: LegacySide, amount: number) => {
      if (!isGauntletMode) return false;
      if (!Number.isFinite(amount)) return false;
      setGold((prev) => ({
        ...prev,
        [side]: Math.max(0, prev[side] + amount),
      }));
      return true;
    },
    [isGauntletMode],
  );


  const handleRevealClick = useCallback(() => {
    if (phase !== "choose" || !canReveal) return;

    if (!isMultiplayer) {
      onReveal();
      return;
    }

    if (resolveVotes[localLegacySide]) return;

    markResolveVote(localLegacySide);
    emitIntent({ type: "reveal", side: localLegacySide });
  }, [
    canReveal,
    emitIntent,
    isMultiplayer,
    localLegacySide,
    markResolveVote,
    onReveal,
    phase,
    resolveVotes,
  ]);

  const handleNextClick = useCallback(() => {
    if (isGauntletMode) {
      if (phase === "roundEnd" && shouldOpenShopThisRound) {
        const opened = openShopPhase();
        if (opened) {
          return;
        }
      }
      if (phase === "shop" || phase === "activation") {
        return;
      }
    }
    if (phase !== "roundEnd") return;

    if (!isMultiplayer) {
      nextRound();
      return;
    }

    if (advanceVotes[localLegacySide]) return;

    markAdvanceVote(localLegacySide);
    emitIntent({ type: "nextRound", side: localLegacySide });
  }, [
    advanceVotes,
    emitIntent,
    isGauntletMode,
    isMultiplayer,
    localLegacySide,
    openShopPhase,
    markAdvanceVote,
    nextRound,
    phase,
    shouldOpenShopThisRound,
  ]);

  useEffect(() => {
    if (!isMultiplayer) return;
    if (phase !== "roundEnd") return;
    if (isGauntletMode) return;
    if (!advanceVotes.player || !advanceVotes.enemy) return;
    nextRound();
  }, [advanceVotes, isGauntletMode, isMultiplayer, nextRound, phase]);

  const resetMatch = useCallback(() => {
    clearResolveVotes();
    clearAdvanceVotes();
    clearRematchVotes();

    reserveReportsRef.current = { player: null, enemy: null };

    resetGauntletState();

    wheelRefs.forEach((ref) => ref.current?.setVisualToken(0));

    setFreezeLayout(false);
    setLockedWheelSize(null);

    setPlayer(() =>
      isGauntletMode ? makeFighter("Wanderer", { deck: buildGauntletDeckAsCards() }) : makeFighter("Wanderer"),
    );
    setEnemy(() => makeFighter("Shade Bandit"));

    setInitiative(hostId ? hostLegacySide : localLegacySide);

    setWins({ player: 0, enemy: 0 });
    setRound(1);
    setPhase("choose");
    setGold({ player: 0, enemy: 0 });
    setShopInventory({ player: [], enemy: [] });
    setShopPurchases({ player: [], enemy: [] });
    setShopReady({ player: false, enemy: false });
    setActivationTurn(null);
    setActivationPasses({ player: false, enemy: false });
    setActivationLog([]);
    setActivationAvailable({ player: [], enemy: [] });
    setActivationInitial({ player: [], enemy: [] });
    setActivationSwapPairs([]);
    setActivationAdjustments({});
    setPendingSwapCardId(null);
    activationEnemyPicksRef.current = null;

    const emptyAssign: { player: (Card | null)[]; enemy: (Card | null)[] } = {
      player: [null, null, null],
      enemy: [null, null, null],
    };
    assignRef.current = emptyAssign;
    setAssign(emptyAssign);

    setSelectedCardId(null);
    setDragCardId(null);
    dragOverRef.current = null;
    setDragOverWheelInternal(null);

    setTokens([0, 0, 0]);
    setReserveSums(null);
    setWheelHUD([null, null, null]);

    setLog([START_LOG]);

    wheelRngRef.current = createSeededRng(seed);
    setWheelSections(generateWheelSet());
  }, [
    clearAdvanceVotes,
    clearRematchVotes,
    clearResolveVotes,
    generateWheelSet,
    isGauntletMode,
    hostId,
    hostLegacySide,
    localLegacySide,
    seed,
    setAssign,
    setEnemy,
    setFreezeLayout,
    setInitiative,
    setLockedWheelSize,
    setLog,
    setPhase,
    setPlayer,
    setReserveSums,
    setRound,
    setTokens,
    setWheelHUD,
    setWheelSections,
    setWins,
    resetGauntletState,
  ]);

  useEffect(() => {
    if (!isMultiplayer) return;
    if (phase !== "ended") return;
    if (!rematchVotes.player || !rematchVotes.enemy) return;
    resetMatch();
  }, [isMultiplayer, phase, rematchVotes, resetMatch]);

  const assignCardToLaneForSideRef = useLatestRef(assignCardToLaneForSide);
  const clearAssignForRef = useLatestRef(clearAssignFor);
  const markResolveVoteRef = useLatestRef(markResolveVote);
  const markAdvanceVoteRef = useLatestRef(markAdvanceVote);
  const markRematchVoteRef = useLatestRef(markRematchVote);
  const storeReserveReportRef = useLatestRef(storeReserveReport);
  const applyGauntletPurchaseForRef = useLatestRef(applyGauntletPurchaseFor);
  const applyGauntletShopRollForRef = useLatestRef(applyGauntletShopRollFor);
  const applyShopPurchaseRef = useLatestRef(applyShopPurchase);
  const completeShopForSideRef = useLatestRef(completeShopForSide);
  const applyGauntletGoldForRef = useLatestRef(applyGauntletGoldFor);
  const applyGauntletActivationSelectForRef = useLatestRef(applyGauntletActivationSelectFor);
  const applyGauntletActivationPassForRef = useLatestRef(applyGauntletActivationPassFor);

  const handleRemoteIntent = useCallback(
    (msg: MPIntent) => {
      const assignToWheel = assignCardToLaneForSideRef.current;
      const clearAssign = clearAssignForRef.current;
      const markResolve = markResolveVoteRef.current;
      const markAdvance = markAdvanceVoteRef.current;
      const markRematch = markRematchVoteRef.current;
      const storeReserve = storeReserveReportRef.current;
      const applyGauntletPurchaseFn = applyGauntletPurchaseForRef.current;
      const applyShopPurchaseFn = applyShopPurchaseRef.current;
      const completeShop = completeShopForSideRef.current;
      const applyGauntletGoldFn = applyGauntletGoldForRef.current;
      const selectActivation = applyGauntletActivationSelectForRef.current;
      const passActivation = applyGauntletActivationPassForRef.current;
      const activationAction = applyActivationActionRef.current;

      switch (msg.type) {
        case "assign": {
          if (msg.side === localLegacySide) break;
          assignToWheel?.(msg.side, msg.lane, msg.card);
          break;
        }
        case "clear": {
          if (msg.side === localLegacySide) break;
          clearAssign?.(msg.side, msg.lane);
          break;
        }
        case "reveal": {
          if (msg.side === localLegacySide) break;
          markResolve?.(msg.side);
          break;
        }
        case "nextRound": {
          if (msg.side === localLegacySide) break;
          markAdvance?.(msg.side);
          break;
        }
        case "rematch": {
          if (msg.side === localLegacySide) break;
          markRematch?.(msg.side);
          break;
        }
        case "reserve": {
          if (msg.side === localLegacySide) break;
          if (typeof msg.reserve === "number" && typeof msg.round === "number") {
            storeReserve?.(msg.side, msg.reserve, msg.round);
          }
          break;
        }

        case "shopRoll": {
          if (msg.side === localLegacySide) break;
          const applyShopRoll = applyGauntletShopRollForRef.current;
          applyShopRoll?.(msg.side, {
            inventory: msg.inventory,
            round: msg.round,
            roll: msg.roll,
          });
          setShopInventory((prev) => ({
            ...prev,
            [msg.side]: msg.inventory.map(cloneCardForGauntlet),
          }));
          break;
        }

        case "shopPurchase": {
          if (msg.side === localLegacySide) break;
          if ("cardId" in msg && typeof msg.cardId === "string" && typeof msg.round === "number") {
            applyGauntletPurchaseFn?.(msg.side, { cardId: msg.cardId, round: msg.round });
          } else if ("card" in msg && msg.card && typeof msg.cost === "number") {
            const { card, cost } = msg as Extract<ShopPurchaseIntent, { card: Card }>;
            const sourceId =
              "sourceId" in msg ? (msg.sourceId as string | null | undefined) ?? null : undefined;
            applyShopPurchaseFn?.(msg.side, card, cost, {
              force: true,
              sourceId,
            });
          }
          break;
        }
        case "shopReady": {
          if (msg.side === localLegacySide) break;
          completeShop?.(msg.side, { emit: false });
          break;
        }

        case "gold": {
          if (msg.side === localLegacySide) break;
          const payload: GauntletGoldPayload = { gold: msg.gold };
          if (typeof msg.delta === "number" && Number.isFinite(msg.delta)) {
            payload.delta = msg.delta;
          }
          applyGauntletGoldFn?.(msg.side, payload);
          break;
        }

        case "activationSelect": {
          if (msg.side === localLegacySide) break;
          selectActivation?.(msg.side, msg.activationId);
          break;
        }
        case "activationPass": {
          if (msg.side === localLegacySide) break;
          passActivation?.(msg.side);
          break;
        }
        case "activation": {
          if (msg.side === localLegacySide) break;
          activationAction?.(msg, { emit: false });
          break;
        }

        default:
          break;
      }
    },
    [
      localLegacySide,
      assignCardToLaneForSideRef,
      clearAssignForRef,
      markResolveVoteRef,
      markAdvanceVoteRef,
      markRematchVoteRef,
      storeReserveReportRef,
      applyGauntletPurchaseForRef,
      applyGauntletShopRollForRef,
      applyShopPurchaseRef,
      completeShopForSideRef,
      applyGauntletGoldForRef,
      applyGauntletActivationSelectForRef,
      applyGauntletActivationPassForRef,
      applyActivationActionRef,
    ],
  );

  const handleRematchClick = useCallback(() => {
    if (phase !== "ended") return;

    if (!isMultiplayer) {
      resetMatch();
      return;
    }

    if (rematchVotes[localLegacySide]) return;

    markRematchVote(localLegacySide);
    emitIntent({ type: "rematch", side: localLegacySide });
  }, [
    emitIntent,
    isMultiplayer,
    localLegacySide,
    markRematchVote,
    phase,
    rematchVotes,
    resetMatch,
  ]);

  const handleExitClick = useCallback(() => {
    onExit?.();
  }, [onExit]);

  return {
    matchMode,
    isGauntletMode,
    localLegacySide,
    remoteLegacySide,
    hostLegacySide,
    players,
    namesByLegacy,
    HUD_COLORS,
    winGoal,
    isMultiplayer,
    player,
    enemy,
    initiative,
    wins,
    round,
    gold,
    shopInventory,
    shopPurchases,
    shopReady,
    configureShopInventory,
    purchaseFromShop,
    markShopComplete,
    openShopPhase,
    grantGold,
    activationTurn,
    activationPasses,
    activationLog,
    activationAvailable,
    activationInitial,
    activationSwapPairs,
    activationAdjustments,
    pendingSwapCardId,
    activateCurrent,
    passActivation,
    finishActivationPhase,
    freezeLayout,
    lockedWheelSize,
    setLockedWheelSize,
    handClearance,
    setHandClearance,
    wheelSize,
    wheelSections,
    tokens,
    active,
    wheelHUD,
    assign,
    dragCardId,
    setDragCardId,
    dragOverWheel: dragOverWheelInternal,
    setDragOverWheel,
    selectedCardId,
    setSelectedCardId,
    reserveSums,
    log,
    phase,
    resolveVotes,
    advanceVotes,
    rematchVotes,
    matchSummary,
    xpDisplay,
    levelUpFlash,
    matchWinner,
    localWinsCount,
    remoteWinsCount,
    localWon,
    winnerName,
    localName,
    remoteName,
    canReveal,
    appendLog,
    wheelRefs,
    assignToWheelLocal,
    clearAssignLocal,
    handleRevealClick,
    handleNextClick,
    handleRematchClick,
    handleExitClick,
    nextRound,
    onReveal,
    resetMatch,
    gauntletState,
    gauntletRollShop,
    gauntletConfirmPurchase,
    gauntletUpdateGold,
    gauntletSelectActivation,
    gauntletPassActivation,
    handleRemoteIntent,
  };
}

type LegacyCard = Card & {
  leftValue?: number | null;
  rightValue?: number | null;
};

function cardsEqual(a: Card, b: Card): boolean {
  const legacyA = a as LegacyCard;
  const legacyB = b as LegacyCard;
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

function inventoriesEqual(a: Card[], b: Card[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (!cardsEqual(a[i], b[i])) return false;
  }
  return true;
}

function createInitialGauntletSideState(): GauntletSideState {
  return {
    shop: { inventory: [], roll: 0, round: 0, purchases: [] },
    gold: 0,
    goldDelta: null,
    activation: { selection: null, passed: false },
  };
}


function computeReserveSum(hand: (Card | null | undefined)[], excludeIds?: Set<string>) {
  return hand.reduce((total, maybeCard) => {
    if (!maybeCard) return total;
    if (excludeIds?.has(maybeCard.id)) return total;
    return total + getCardReserveValue(maybeCard);
  }, 0);
}

function stackPurchasesOnDeck(
  fighter: Fighter,
  purchases: PendingShopPurchase[],
): Fighter {
  if (purchases.length === 0) return fighter;
  return purchases.reduce(
    (next, purchase) => addPurchasedCardToFighter(next, purchase.card),
    fighter,
  );
}

function discardHand(fighter: Fighter): Fighter {
  if (!fighter.hand.length) return fighter;
  return {
    ...fighter,
    hand: [],
    discard: [...fighter.discard, ...fighter.hand],
  };
}

export function settleFighterAfterRound(fighter: Fighter, played: Card[]) {
  const TARGET_HAND_SIZE = 5;
  const playedIds = new Set(played.map((card) => card.id));
  const remainingHand = fighter.hand.filter((card) => !playedIds.has(card.id));

  let next: Fighter = discardHand({
    ...fighter,
    hand: remainingHand,
    discard: [...fighter.discard, ...played],
  });

  next = refillTo(next, TARGET_HAND_SIZE);

  if (next.hand.length < TARGET_HAND_SIZE) {
    next = freshFive(next);
    next = refillTo(next, TARGET_HAND_SIZE);

  }

  return next;
}

function oppositeSide(side: LegacySide): LegacySide {
  return side === "player" ? "enemy" : "player";
}
