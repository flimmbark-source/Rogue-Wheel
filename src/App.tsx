import { AnimatePresence, motion } from "framer-motion";
import {
  useThreeWheelGame,
  type GameLogEntry,
  type SkillTargetingState,
  type SkillTargetSelection,
} from "./features/threeWheel/hooks/useThreeWheelGame";
import React, {
  useMemo,
  useRef,
  useState,
  useEffect,
  forwardRef,
  useImperativeHandle,
  memo,
  startTransition,
  useCallback,
  useLayoutEffect,
} from "react";
import { Realtime } from "ably";


/**
 * Three-Wheel Roguelike — Wins-Only, Low Mental Load (v2.4.17-fix1)
 * Single-file App.tsx (Vite React)
 *
 * CHANGELOG (v2.4.17-fix1):
 * - Fix build error: wrapped adjacent JSX in WheelPanel and removed stray placeholder token.
 * - Moved enemy slot back inside the flex row; ensured a single parent element.
 * - Fixed typo in popover class (top-[110%]).
 * - Kept flicker mitigations: static IMG base, imperative token, integer snapping, isolated layers.
 */

// game modules
import {
  SLICES,
  type Side as TwoSide,
  type Card,
  type Section,
  type Fighter,
  type Players,
  type Phase,
  type CorePhase,
  type GameMode,
  LEGACY_FROM_SIDE,
} from "./game/types";
import { easeInOutCubic, inSection, createSeededRng } from "./game/math";
import { VC_META, genWheelSections } from "./game/wheel";
import { DEFAULT_GAME_MODE, normalizeGameMode } from "./gameModes";
import type { ArchetypeId } from "./game/archetypes";
import {
  makeFighter,
  drawOne,
  freshFive,
  recordMatchResult,
  getOnboardingState,
  setOnboardingStage as persistOnboardingStage,
  dismissOnboardingHint,
  getProfileBundle,
  type MatchResultSummary,
  type LevelProgress,
  type OnboardingState,
} from "./player/profileStore";
import { isSplit, isNormal, effectiveValue, fmtNum } from "./game/values";
import {
  autoPickEnemy,
  calcWheelSize,
  computeReserveSum,
  settleFighterAfterRound,
} from "./features/threeWheel/utils/combat";
import {
  computeSpellCost,
  resolvePendingSpell,
  type PendingSpellDescriptor,
  type SpellEffectPayload,
  type SpellTargetInstance,
} from "./game/spellEngine";
import { useSpellCasting } from "./game/hooks/useSpellCasting";

// components
import CanvasWheel, { type WheelHandle } from "./components/CanvasWheel";
import { SpellDescription } from "./components/SpellDescription";

import WheelPanel, { getWheelPanelLayout } from "./features/threeWheel/components/WheelPanel";

import HandDock from "./features/threeWheel/components/HandDock";
import FirstRunCoach from "./features/threeWheel/components/FirstRunCoach";
import HUDPanels from "./features/threeWheel/components/HUDPanels";
import VictoryOverlay from "./features/threeWheel/components/VictoryOverlay";
import {
  getLearnedSpellsForFighter,
  getSpellDefinitions,
  getSpellTargetStage,
  type SpellDefinition,
  type SpellId,
  type SpellRuntimeState,
} from "./game/spells";
import { countSymbolsFromCards, getVisibleSpellsForHand } from "./game/grimoire";
import StSCard from "./components/StSCard";
import { chooseCpuSpellResponse, type CpuSpellDecision } from "./game/ai/grimoireCpu";

// ---- Local aliases/types/state helpers
type AblyRealtime = InstanceType<typeof Realtime>;
type AblyChannel = ReturnType<AblyRealtime["channels"]["get"]>;
type LegacySide = "player" | "enemy";

type SideState<T> = Record<LegacySide, T>;
type WheelSideState<T> = [SideState<T>, SideState<T>, SideState<T>];

function createWheelSideState<T>(value: T): WheelSideState<T> {
  return [
    { player: value, enemy: value },
    { player: value, enemy: value },
    { player: value, enemy: value },
  ];
}

function createWheelLockState(): [boolean, boolean, boolean] {
  return [false, false, false];
}

function createPointerShiftState(): [number, number, number] {
  return [0, 0, 0];
}

function createReservePenaltyState(): SideState<number> {
  return { player: 0, enemy: 0 };
}

type LaneSpellState = {
  locked: boolean;
  damageModifier: number;
  mirrorTargetCardId: string | null;
  occupantCardId: string | null;
};


const createEmptyLaneSpellState = (): LaneSpellState => ({
  locked: false,
  damageModifier: 0,
  mirrorTargetCardId: null,
  occupantCardId: null,
});

const laneSpellStatesEqual = (a: LaneSpellState, b: LaneSpellState) =>
  a.locked === b.locked &&
  a.damageModifier === b.damageModifier &&
  a.mirrorTargetCardId === b.mirrorTargetCardId &&
  a.occupantCardId === b.occupantCardId;

// Multiplayer intents
type SpellTargetIntentPayload = {
  kind?: string;
  side?: LegacySide | null;
  lane?: number | null;
  cardId?: string | null;
  [key: string]: unknown;
};

type SpellResolutionIntentPayload = {
  manaSpent?: number;
  result?: Record<string, unknown> | null;
  [key: string]: unknown;
};

type MPIntent =
  | { type: "assign"; lane: number; side: LegacySide; card: Card }
  | { type: "clear"; lane: number; side: LegacySide }
  | { type: "reveal"; side: LegacySide }
  | { type: "nextRound"; side: LegacySide }
  | { type: "rematch"; side: LegacySide }
  | { type: "reserve"; side: LegacySide; reserve: number; round: number }
  | { type: "archetypeSelect"; side: LegacySide; archetype: ArchetypeId }
  | { type: "archetypeReady"; side: LegacySide; ready: boolean }
  | { type: "archetypeReadyAck"; side: LegacySide; ready: boolean }
  | { type: "spellSelect"; side: LegacySide; spellId: string | null }
  | { type: "spellTarget"; side: LegacySide; spellId: string; target: SpellTargetIntentPayload | null }
  | { type: "spellFireballCost"; side: LegacySide; spellId: string; cost: number }
  | {
      type: "spellResolve";
      side: LegacySide;
      spellId: string;
      manaAfter: number;
      payload?: SpellResolutionIntentPayload | null;
    }
  | { type: "spellState"; side: LegacySide; lane: number; state: LaneSpellState }
  | { type: "spellEffects"; payload: SpellEffectPayload };

// ---------------- Constants ----------------
const MAX_WHEEL = 200;

const THEME = {
  panelBg:   '#2c1c0e',
  panelBorder:'#5c4326',
  slotBg:    '#1b1209',
  slotBorder:'#7a5a33',
  brass:     '#b68a4e',
  textWarm:  '#ead9b9',
};

// ---------------- Main Component ----------------
export default function ThreeWheel_WinsOnly({
  localSide,
  localPlayerId,
  players,
  seed,
  gameMode = DEFAULT_GAME_MODE,
  roomCode,
  hostId,
  targetWins,
  onExit,
}: {
  localSide: TwoSide;
  localPlayerId: string;
  players: Players;
  seed: number;
  gameMode?: GameMode;
  roomCode?: string;
  hostId?: string;
  targetWins?: number;
  onExit?: () => void;
}) {
  
  const { state, derived, refs, actions } = useThreeWheelGame({
    localSide,
    localPlayerId,
    players,
    seed,
    roomCode,
    hostId,
    targetWins,
    gameMode,
    onExit,
  });
  // --- from hook
  const {
    player,
    enemy,
    initiative,
    wins,
    round,
    ante,
    phase: basePhase,
    resolveVotes,
    advanceVotes,
    rematchVotes,
    matchSummary,
    xpDisplay,
    levelUpFlash,
    handClearance,
    wheelSize,
    wheelSections,
    tokens,
    active,
    wheelHUD,
    assign,
    dragCardId,
    dragOverWheel,
    selectedCardId,
    reserveSums,
    isPtrDragging,
    ptrDragCard,
    ptrDragType,
    lockedWheelSize,
    log,
    spellHighlights,
    skillPhase,
    skillTargeting,
  } = state;

  const {
    localLegacySide,
    remoteLegacySide,
    namesByLegacy,
    HUD_COLORS,
    winGoal,
    isMultiplayer,
    isSkillMode,
    localWinsCount,
    remoteWinsCount,
    localWon,
    winnerName,
    localName,
    remoteName,
    canReveal,
  } = derived;

  const { wheelRefs, ptrPos } = refs;

  const {
    setHandClearance,
    setSelectedCardId,
    setDragCardId,
    setDragOverWheel,
    startPointerDrag,
    startTouchDrag,
    assignToWheelLocal,
    handleRevealClick,
    handleNextClick: handleNextClickBase,
    handleRematchClick,
    handleExitClick,
    applySpellEffects,
    setAnteBet,
    activateSkillOption,
    passSkillTurn,
    resolveSkillTargeting,
    cancelSkillTargeting,
  } = actions;

  // --- local UI/Grimoire state (from Spells branch) ---
  const activeGameModes = useMemo(
    () => normalizeGameMode(gameMode ?? DEFAULT_GAME_MODE),
    [gameMode],
  );
  const isGrimoireMode = activeGameModes.includes("grimoire");
  const isAnteMode = activeGameModes.includes("ante");
  const effectiveGameMode = activeGameModes.length > 0 ? activeGameModes.join("+") : "classic";
  const spellRuntimeStateRef = useRef<SpellRuntimeState>({});

  const [cpuResponseTick, setCpuResponseTick] = useState(0);

  const applySpellEffectsWithAi = useCallback(
    (payload: SpellEffectPayload, options?: { broadcast?: boolean }) => {
      applySpellEffects(payload, options);
      if (
        !isMultiplayer &&
        isGrimoireMode &&
        payload.caster === localLegacySide &&
        remoteLegacySide !== localLegacySide
      ) {
        setCpuResponseTick((tick) => tick + 1);
      }
    },
    [
      applySpellEffects,
      isGrimoireMode,
      isMultiplayer,
      localLegacySide,
      remoteLegacySide,
    ],
  );

  const handleApplySpellEffects = useCallback(
    (payload: SpellEffectPayload) => {
      applySpellEffectsWithAi(payload);
    },
    [applySpellEffectsWithAi],
  );

  const handleSkillTargetSelect = useCallback(
    (selection: SkillTargetSelection) => {
      resolveSkillTargeting(selection);
    },
    [resolveSkillTargeting],
  );

  const handleSkillReserveSelect = useCallback(
    ({ cardId }: { cardId: string }) => {
      handleSkillTargetSelect({ kind: "reserve", cardId });
    },
    [handleSkillTargetSelect],
  );

  const handleSkillTargetCancel = useCallback(() => {
    cancelSkillTargeting();
  }, [cancelSkillTargeting]);

  const localGrimoireSpellIds = useMemo<SpellId[]>(() => {
    try {
      return getProfileBundle().grimoire?.spellIds ?? [];
    } catch {
      return [] as SpellId[];
    }
  }, []);

  const onboardingBootstrapRef = useRef<OnboardingState | null>(null);
  if (onboardingBootstrapRef.current === null) {
    onboardingBootstrapRef.current = getOnboardingState();
  }
  const [onboardingStage, setOnboardingStageState] = useState(
    onboardingBootstrapRef.current.stage,
  );
  const [onboardingDismissed, setOnboardingDismissed] = useState<string[]>(
    onboardingBootstrapRef.current.dismissed,
  );

  const [manaPools, setManaPools] = useState<SideState<number>>({ player: 0, enemy: 0 });
  const localMana = manaPools[localLegacySide];
  const lastManaAwardedRoundRef = useRef<number | null>(null);

  const [showGrimoire, setShowGrimoire] = useState(false);
  const closeGrimoire = useCallback(() => setShowGrimoire(false), [setShowGrimoire]);

  const [spellBannerEntry, setSpellBannerEntry] = useState<GameLogEntry | null>(null);
  const spellBannerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestSpellEntry = log.find((entry) => entry.type === "spell") ?? null;

  useEffect(() => {
    if (!latestSpellEntry) {
      setSpellBannerEntry(null);
      if (spellBannerTimeoutRef.current) {
        clearTimeout(spellBannerTimeoutRef.current);
        spellBannerTimeoutRef.current = null;
      }
      return;
    }

    setSpellBannerEntry(latestSpellEntry);
    if (spellBannerTimeoutRef.current) {
      clearTimeout(spellBannerTimeoutRef.current);
    }

    const timeoutId = setTimeout(() => {
      setSpellBannerEntry((current) =>
        current && current.id === latestSpellEntry.id ? null : current,
      );
      if (spellBannerTimeoutRef.current === timeoutId) {
        spellBannerTimeoutRef.current = null;
      }
    }, 2400);

    spellBannerTimeoutRef.current = timeoutId;

    return () => {
      clearTimeout(timeoutId);
      if (spellBannerTimeoutRef.current === timeoutId) {
        spellBannerTimeoutRef.current = null;
      }
    };
  }, [latestSpellEntry]);

  useEffect(() => {
    return () => {
      if (spellBannerTimeoutRef.current) {
        clearTimeout(spellBannerTimeoutRef.current);
        spellBannerTimeoutRef.current = null;
      }
    };
  }, []);

  const localHandCards = localLegacySide === "player" ? player.hand : enemy.hand;
  const localHandSymbols = useMemo(() => countSymbolsFromCards(localHandCards), [localHandCards]);
  const spellHighlightedCardIds = spellHighlights.cards;
  const reserveSpellHighlights = spellHighlights.reserve;
  const [spellLock, setSpellLock] = useState<{ round: number | null; ids: SpellId[] }>({
    round: null,
    ids: [],
  });
  const clearSpellLock = useCallback(() => {
    setSpellLock((prev) => {
      if (prev.round === null && prev.ids.length === 0) {
        return prev;
      }
      return { round: null, ids: [] };
    });
  }, []);

  const casterFighter = localLegacySide === "player" ? player : enemy;
  const opponentFighter = localLegacySide === "player" ? enemy : player;

  const localAnteValue = ante?.bets?.[localLegacySide] ?? 0;
  const remoteAnteValue = ante?.bets?.[remoteLegacySide] ?? 0;

  const isWheelActive = useCallback((wheelIndex: number) => Boolean(active[wheelIndex]), [active]);

  const {
    pendingSpell,
    phaseBeforeSpell,
    awaitingSpellTarget,
    handleSpellActivate,
    handlePendingSpellCancel,
    handleSpellTargetSelect,
    handleWheelTargetSelect,
    handleOptionalStageSkip,
  } = useSpellCasting({
    caster: casterFighter,
    opponent: opponentFighter,
    phase: basePhase,
    localSide: localLegacySide,
    localMana,
    applySpellEffects: handleApplySpellEffects,
    setManaPools,
    runtimeStateRef: spellRuntimeStateRef,
    closeGrimoire,
    isWheelActive,
  });

  const [spellTargetingSide, setSpellTargetingSide] = useState<LegacySide | null>(null);

  useEffect(() => {
    if (awaitingSpellTarget && pendingSpell) {
      setSpellTargetingSide(pendingSpell.side);
    } else if (!awaitingSpellTarget) {
      setSpellTargetingSide(null);
    }
  }, [awaitingSpellTarget, pendingSpell]);

  const phaseForLogic: CorePhase = phaseBeforeSpell ?? basePhase;
  const phase: Phase = spellTargetingSide ? "spellTargeting" : basePhase;
  const isAwaitingSkillTarget = Boolean(
    skillTargeting && skillTargeting.side === localLegacySide,
  );
  const castCpuSpell = useCallback(
    (decision: CpuSpellDecision) => {
      if (isMultiplayer) return;
      const cpuSide = remoteLegacySide;
      if (cpuSide === localLegacySide) return;

      const caster = cpuSide === "player" ? player : enemy;
      const opponent = cpuSide === "player" ? enemy : player;

      const availableMana = manaPools[cpuSide];
      if (availableMana < decision.cost) return;

      setManaPools((current) => {
        const currentMana = current[cpuSide];
        if (currentMana < decision.cost) return current;
        const next = { ...current } as SideState<number>;
        next[cpuSide] = currentMana - decision.cost;
        return next;
      });

      let pending: PendingSpellDescriptor | null = {
        side: cpuSide,
        spell: decision.spell,
        targets: [],
        currentStage: 0,
        spentMana: decision.cost,
      };

      let targetIndex = 0;

      while (pending) {
        const overrideTarget: SpellTargetInstance | undefined =
          targetIndex < decision.targets.length
            ? { ...decision.targets[targetIndex], stageIndex: pending.currentStage }
            : undefined;

        const result = resolvePendingSpell({
          descriptor: pending,
          caster,
          opponent,
          phase: phaseForLogic,
          runtimeState: spellRuntimeStateRef.current,
          targetOverride: overrideTarget,
        });

        if (result.outcome === "requiresTarget") {
          if (overrideTarget) {
            targetIndex += 1;
            pending = result.pendingSpell;
            continue;
          }

          setManaPools((current) => {
            const next = { ...current } as SideState<number>;
            next[cpuSide] = current[cpuSide] + decision.cost;
            return next;
          });
          return;
        }

        if (result.outcome === "error") {
          console.error("CPU spell failed", result.error);
          setManaPools((current) => {
            const next = { ...current } as SideState<number>;
            next[cpuSide] = current[cpuSide] + decision.cost;
            return next;
          });
          return;
        }

        if (result.manaRefund && result.manaRefund > 0) {
          setManaPools((current) => {
            const next = { ...current } as SideState<number>;
            next[cpuSide] = current[cpuSide] + result.manaRefund!;
            return next;
          });
        }

        if (result.payload) {
          applySpellEffectsWithAi(result.payload, { broadcast: false });
        }

        pending = null;
      }
    },
    [
      applySpellEffectsWithAi,
      enemy,
      isMultiplayer,
      localLegacySide,
      manaPools,
      phaseForLogic,
      player,
      remoteLegacySide,
      setManaPools,
      spellRuntimeStateRef,
    ],
  );

  const attemptCpuSpell = useCallback(() => {
    if (isMultiplayer || !isGrimoireMode) return;
    const cpuSide = remoteLegacySide;
    if (cpuSide === localLegacySide) return;
    if (phaseForLogic === "ended") return;

    const caster = cpuSide === "player" ? player : enemy;
    const opponent = cpuSide === "player" ? enemy : player;
    const mana = manaPools[cpuSide];
    if (mana <= 0) return;

    const learned = getLearnedSpellsForFighter(caster);
    if (!learned || learned.length === 0) return;

    const spellbook: SpellId[] = learned.map((spell) => spell.id as SpellId);
    if (spellbook.length === 0) return;

    const handSymbols = countSymbolsFromCards(caster.hand);
    const visibleSpellIds = getVisibleSpellsForHand(handSymbols, spellbook);
    if (visibleSpellIds.length === 0) return;

    const visibleSpells = getSpellDefinitions(visibleSpellIds);

    const affordableSpells: Array<{ spell: SpellDefinition; cost: number }> = [];
    const deferredSpells: Array<{ spell: SpellDefinition; cost: number }> = [];

    visibleSpells.forEach((spell) => {
      const allowedPhases = spell.allowedPhases ?? ["choose"];
      if (!allowedPhases.includes(phaseForLogic)) return;
      const cost = computeSpellCost(spell, {
        caster,
        opponent,
        phase: phaseForLogic,
        runtimeState: spellRuntimeStateRef.current,
      });
      const entry = { spell, cost };
      if (cost <= mana) {
        affordableSpells.push(entry);
      } else {
        deferredSpells.push(entry);
      }
    });

    if (affordableSpells.length === 0) return;

    const decision = chooseCpuSpellResponse({
      casterSide: cpuSide,
      caster,
      opponent,
      board: assign,
      reserveSums,
      initiative,
      availableSpells: affordableSpells,
    });

    if (!decision) return;

    if (deferredSpells.length > 0) {
      const minDeferredCost = deferredSpells.reduce(
        (lowest, entry) => Math.min(lowest, entry.cost),
        Number.POSITIVE_INFINITY,
      );
      if (Number.isFinite(minDeferredCost)) {
        const cheapThreshold = Math.min(2, Math.max(0, minDeferredCost - 1));
        if (
          cheapThreshold > 0 &&
          decision.cost <= cheapThreshold &&
          mana - decision.cost < minDeferredCost
        ) {
          return;
        }
      }
    }

    castCpuSpell(decision);
  }, [
    assign,
    castCpuSpell,
    enemy,
    initiative,
    isGrimoireMode,
    isMultiplayer,
    localLegacySide,
    manaPools,
    phaseForLogic,
    player,
    remoteLegacySide,
    reserveSums,
    spellRuntimeStateRef,
  ]);

  useEffect(() => {
    if (cpuResponseTick === 0) return;
    const timeout = window.setTimeout(() => {
      attemptCpuSpell();
    }, 1000);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [attemptCpuSpell, cpuResponseTick]);

  useEffect(() => {
    if (!isGrimoireMode) {
      clearSpellLock();
      return;
    }

    if (phaseForLogic === "ended") {
      clearSpellLock();
      return;
    }

    if (phaseForLogic !== "choose") {
      return;
    }

    setSpellLock((prev) => {
      if (prev.round === round) {
        return prev;
      }

      const nextIds = getVisibleSpellsForHand(localHandSymbols, localGrimoireSpellIds);
      return { round, ids: nextIds };
    });
  }, [
    clearSpellLock,
    isGrimoireMode,
    localGrimoireSpellIds,
    localHandSymbols,
    phaseForLogic,
    round,
  ]);

  const localSpellIds = useMemo(() => {
    if (!isGrimoireMode) return [] as SpellId[];
    if (phaseForLogic === "ended") return [] as SpellId[];
    if (spellLock.round !== round) return [] as SpellId[];
    return spellLock.ids;
  }, [isGrimoireMode, phaseForLogic, round, spellLock]);

  const localSpellDefinitions = useMemo<SpellDefinition[]>(
    () => getSpellDefinitions(localSpellIds),
    [localSpellIds]
  );

  const handleNextClick = useCallback(() => {
    handleNextClickBase();
  }, [handleNextClickBase]);

  const getSpellCost = useCallback(
    (spell: SpellDefinition): number =>
      computeSpellCost(spell, {
        caster: casterFighter,
        opponent: opponentFighter,
        phase: phaseForLogic,
        runtimeState: spellRuntimeStateRef.current,
      }),
    [casterFighter, opponentFighter, phaseForLogic]
  );


  const wheelDamage = useMemo(() => createWheelSideState(0), []);
  const wheelMirror = useMemo(() => createWheelSideState(false), []);
  const wheelLocks = useMemo(() => createWheelLockState(), []);
  const pointerShifts = useMemo(() => createPointerShiftState(), []);
  const reservePenalties = useMemo(() => createReservePenaltyState(), []);
  const wheelPanelLayout = useMemo(
    () => getWheelPanelLayout(wheelSize, lockedWheelSize),
    [wheelSize, lockedWheelSize],
  );
  const wheelPanelContainerStyle = useMemo<React.CSSProperties>(
    () => ({
      width: wheelPanelLayout.panelWidth,
      background: "transparent",
      borderColor: "transparent",
      borderWidth: 2,
      contain: "paint" as React.CSSProperties["contain"],
      backfaceVisibility: "hidden",
      transform: "translateZ(0)",
      isolation: "isolate",
    }),
    [wheelPanelLayout.panelWidth],
  );
  const wheelPanelContainerRef = useRef<HTMLDivElement | null>(null);
  const handDockRef = useRef<HTMLDivElement | null>(null);
  const [wheelPanelBounds, setWheelPanelBounds] = useState<
    { left: number; width: number } | null
  >(null);

  useLayoutEffect(() => {
    const node = wheelPanelContainerRef.current;
    if (!node) {
      setWheelPanelBounds(null);
      return;
    }

    const updateBounds = () => {
      const rect = node.getBoundingClientRect();
      const next = {
        left: Math.round(rect.left),
        width: Math.round(rect.width),
      };
      setWheelPanelBounds((prev) => {
        if (prev && prev.left === next.left && prev.width === next.width) {
          return prev;
        }
        return next;
      });
    };

    updateBounds();

    const handleResize = () => updateBounds();
    const handleOrientation = () => updateBounds();

    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleOrientation);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => updateBounds());
      resizeObserver.observe(node);
    }

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleOrientation);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [wheelPanelLayout.panelWidth]);
  const initiativeOverride: LegacySide | null = null;

  const playerManaButtonRef = useRef<HTMLButtonElement | null>(null);
  const resolveButtonRef = useRef<HTMLButtonElement | null>(null);
  const grimoireDesktopRef = useRef<HTMLDivElement | null>(null);

  const updateGrimoirePosition = useCallback(() => {
    const anchorEl = playerManaButtonRef.current;
    const popoverEl = grimoireDesktopRef.current;
    if (!anchorEl || !popoverEl) {
      return;
    }
    const rect = anchorEl.getBoundingClientRect();
    const yOffset = 12;
    popoverEl.style.position = "fixed";
    popoverEl.style.top = `${rect.bottom + yOffset}px`;
    popoverEl.style.left = `${rect.left + rect.width / 2}px`;
    popoverEl.style.transform = "translateX(-50%)";
  }, []);

  const infoPopoverRootRef = useRef<HTMLDivElement | null>(null);
  const [showRef, setShowRef] = useState(false);
  const [showAnte, setShowAnte] = useState(false);
  const persistStage = useCallback(
    (nextStage: number) => {
      const normalized = Number.isFinite(nextStage) ? Math.max(0, Math.floor(nextStage)) : 0;
      const targetStage = Math.max(onboardingStage, normalized);
      if (targetStage === onboardingStage) {
        return { stage: onboardingStage, dismissed: onboardingDismissed };
      }
      const updated = persistOnboardingStage(targetStage);
      setOnboardingStageState(updated.stage);
      setOnboardingDismissed(updated.dismissed);
      return updated;
    },
    [onboardingStage, onboardingDismissed, persistOnboardingStage],
  );

  const handlePlayerManaToggle = useCallback(() => {
    if (!isGrimoireMode) return;
    setShowGrimoire((prev) => {
      const next = !prev;
      if (next) {
        setShowRef(false);
        setShowAnte(false);
      }
      return next;
    });
  }, [isGrimoireMode]);

  useLayoutEffect(() => {
    if (!showGrimoire) {
      return;
    }

    updateGrimoirePosition();

    const handleReposition = () => {
      updateGrimoirePosition();
    };

    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);

    return () => {
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [showGrimoire, updateGrimoirePosition]);

  useEffect(() => {
    if (!(phaseForLogic === "roundEnd" || phaseForLogic === "ended")) {
      return;
    }
    if (!reserveSums) {
      return;
    }
    if (lastManaAwardedRoundRef.current === round) {
      return;
    }
    lastManaAwardedRoundRef.current = round;
    const playerGain = Math.ceil(reserveSums.player / 2);
    const enemyGain = Math.ceil(reserveSums.enemy / 2);
    if (playerGain === 0 && enemyGain === 0) {
      return;
    }
    setManaPools((current) => ({
      player: current.player + playerGain,
      enemy: current.enemy + enemyGain,
    }));
  }, [phaseForLogic, reserveSums, round]);

  useEffect(() => {
    if (!isAnteMode) {
      setShowAnte(false);
      return;
    }
    if (phase !== "choose") {
      setShowAnte(false);
    }
  }, [isAnteMode, phase]);

  const totalWheelSlots = assign.player.length;
  const playerAssignedCount = useMemo(
    () => assign.player.reduce((count, card) => (card ? count + 1 : count), 0),
    [assign.player],
  );

  useEffect(() => {
    if (onboardingStage === 0 && playerAssignedCount > 0) {
      persistStage(1);
    }
  }, [onboardingStage, playerAssignedCount, persistStage]);

  useEffect(() => {
    if (
      onboardingStage === 1 &&
      totalWheelSlots > 0 &&
      playerAssignedCount === totalWheelSlots
    ) {
      persistStage(2);
    }
  }, [onboardingStage, playerAssignedCount, persistStage, totalWheelSlots]);

  useEffect(() => {
    if (onboardingStage === 2 && phaseForLogic === "roundEnd") {
      persistStage(3);
    }
  }, [onboardingStage, phaseForLogic, persistStage]);

  const hasDismissedCoach = useMemo(
    () => onboardingDismissed.includes("firstRunCoach"),
    [onboardingDismissed],
  );
  const showCoachOverlay =
    onboardingStage < 3 &&
    !hasDismissedCoach &&
    !showGrimoire &&
    !showAnte &&
    !showRef &&
    phase !== "ended" &&
    phase !== "spellTargeting";

  const handleCoachAdvance = useCallback(() => {
    const nextStage = Math.min(onboardingStage + 1, 3);
    persistStage(nextStage);
  }, [onboardingStage, persistStage]);

  const handleCoachDismiss = useCallback(() => {
    const staged = persistStage(3);
    const updated = dismissOnboardingHint("firstRunCoach");
    setOnboardingDismissed(updated.dismissed);
    if (updated.stage !== staged.stage) {
      setOnboardingStageState(updated.stage);
    }
  }, [dismissOnboardingHint, persistStage]);

  const localResolveReady = resolveVotes[localLegacySide];
  const remoteResolveReady = resolveVotes[remoteLegacySide];

  const resolveButtonDisabled = !canReveal || (isMultiplayer && localResolveReady);
  const resolveButtonLabel = isMultiplayer && localResolveReady ? "Ready" : "Resolve";

  const resolveStatusText =
    isMultiplayer && phase === "choose"
      ? localResolveReady && !remoteResolveReady
        ? `Waiting for ${namesByLegacy[remoteLegacySide]}...`
        : !localResolveReady && remoteResolveReady
        ? `${namesByLegacy[remoteLegacySide]} is ready.`
        : null
      : null;

  const localAdvanceReady = advanceVotes[localLegacySide];
  const remoteAdvanceReady = advanceVotes[remoteLegacySide];
  const advanceButtonDisabled = isMultiplayer && localAdvanceReady;
  const advanceButtonLabel = isMultiplayer && localAdvanceReady ? "Ready" : "Next";
  const advanceStatusText =
    isMultiplayer && phase === "roundEnd"
      ? localAdvanceReady && !remoteAdvanceReady
        ? `Waiting for ${namesByLegacy[remoteLegacySide]}...`
        : !localAdvanceReady && remoteAdvanceReady
        ? `${namesByLegacy[remoteLegacySide]} is ready.`
        : null
      : null;

  const localRematchReady = rematchVotes[localLegacySide];
  const remoteRematchReady = rematchVotes[remoteLegacySide];
  const rematchButtonLabel = isMultiplayer && localRematchReady ? "Ready" : "Rematch";
  const rematchStatusText =
    isMultiplayer && phase === "ended"
      ? localRematchReady && !remoteRematchReady
        ? `Waiting for ${namesByLegacy[remoteLegacySide]}...`
        : !localRematchReady && remoteRematchReady
        ? `${namesByLegacy[remoteLegacySide]} is ready.`
        : null
      : null;

  const xpProgressPercent = xpDisplay ? Math.min(100, xpDisplay.percent * 100) : 0;
  const [victoryCollapsed, setVictoryCollapsed] = useState(false);
  useEffect(() => {
    if (phase !== "ended") setVictoryCollapsed(false);
  }, [phase]);

  const rootModeClassName = [
    "classic-mode",
    isGrimoireMode && "grimoire-mode",
    isAnteMode && "ante-mode",
  ]
    .filter(Boolean)
    .join(" ");
  const grimoireAttrValue = isGrimoireMode ? "true" : "false";
  const isAwaitingSpellTarget = Boolean(awaitingSpellTarget);
  const activeTargetStage = pendingSpell
    ? getSpellTargetStage(pendingSpell.spell.target, pendingSpell.currentStage)
    : null;
  const activeTargetStageLabel = pendingSpell
    ? activeTargetStage?.label ??
      (pendingSpell.spell.target.type === "sequence"
        ? `Target #${pendingSpell.currentStage + 1}`
        : null)
    : null;
  const targetingPrompt = pendingSpell
    ? (() => {
        if (!activeTargetStage) {
          return "Select a valid target.";
        }
        switch (activeTargetStage.type) {
          case "wheel":
            return activeTargetStage.scope === "any"
              ? "Select any wheel."
              : "Select the current wheel.";
          case "card": {
            const ownerText =
              activeTargetStage.ownership === "ally"
                ? "an ally card"
                : activeTargetStage.ownership === "enemy"
                ? "an enemy card"
                : "a card";
            const locationText =
              activeTargetStage.location === "board"
                ? "on the board"
                : activeTargetStage.location === "hand"
                ? "in reserve"
                : null;
            const locationSuffix = locationText ? ` ${locationText}` : "";
            return `Select ${ownerText}${locationSuffix}.`;
          }
          case "self":
            return "Confirm to target yourself.";
          default:
            return "Select a valid target.";
        }
      })()
    : "";
  const skillTargetingPrompt = useMemo(() => {
    if (!skillTargeting || skillTargeting.side !== localLegacySide) {
      return "";
    }
    switch (skillTargeting.ability) {
      case "swapReserve":
        return "Select a reserve card to swap in.";
      case "rerollReserve":
        return "Select a reserve card to cycle.";
      case "reserveBoost":
        return "Select a reserve card to exhaust for a boost.";
      default:
        return "";
    }
  }, [skillTargeting, localLegacySide]);

  const skillPhaseMessage =
    phase === "skill" && isSkillMode && skillPhase
      ? skillPhase.activeSide === localLegacySide
        ? isAwaitingSkillTarget
          ? skillTargetingPrompt || "Select a target."
          : "Click a card to use its skill or pass to end your turn."
        : `Waiting for ${namesByLegacy[skillPhase.activeSide]}...`
      : "";
  const hudAccentColor = HUD_COLORS[localLegacySide];

  useEffect(() => {
    if (isAwaitingSpellTarget) {
      setShowGrimoire(false);
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    }
  }, [isAwaitingSpellTarget]);

  return (
    <div
      className={`mx-auto w-full max-w-[720px] overflow-x-hidden overflow-y-hidden text-slate-100 p-1 grid gap-2 ${rootModeClassName}`}
      style={{
        gridTemplateRows: "auto auto 1fr auto",
        minHeight: "var(--app-min-height, min(100svh, 1600px))",
        height: "var(--app-min-height, min(100svh, 1600px))",
        maxHeight: "var(--app-min-height, min(100svh, 1600px))",
        maxWidth: "var(--app-max-width, min(100vw, 720px))",
      }}
      data-game-mode={effectiveGameMode}
      data-mana-enabled={grimoireAttrValue}
      data-spells-enabled={grimoireAttrValue}
      data-pending-spell={pendingSpell ? pendingSpell.spell.id : ""}
      data-local-mana={localMana}
      data-awaiting-spell-target={isAwaitingSpellTarget ? "true" : "false"}
    >
      <AnimatePresence>
        {spellBannerEntry ? (
          <motion.div
            key={spellBannerEntry.id}
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.24, ease: "easeOut" }}
            className="pointer-events-none fixed inset-x-0 top-8 z-[85] flex justify-center px-3"
          >
            <div
              className="pointer-events-none w-full max-w-md rounded-2xl border px-5 py-3 text-center text-[14px] font-semibold tracking-wide text-slate-100 shadow-[0_18px_40px_rgba(8,15,32,0.55)]"
              style={{
                borderColor: hudAccentColor,
                background: "rgba(15, 23, 42, 0.92)",
                color: hudAccentColor,
              }}
            >
              {spellBannerEntry.message}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {isAwaitingSpellTarget && pendingSpell ? (
        <div className="pointer-events-none fixed inset-x-0 top-20 z-[90] flex justify-center px-3">
          <div className="pointer-events-auto w-full max-w-sm rounded-xl border border-sky-500/60 bg-slate-900/95 px-3 py-2 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[13px] font-semibold text-slate-100">
                Select {activeTargetStageLabel ?? "a target"} for {pendingSpell.spell.name}
              </div>
              <div className="flex flex-col items-end gap-1">
                <button
                  type="button"
                  onClick={() => handlePendingSpellCancel(true)}
                  className="rounded border border-slate-600 px-2.5 py-1 text-[11px] text-slate-200 transition hover:border-slate-400 hover:text-white"
                >
                  Cancel spell
                </button>
                {activeTargetStage?.optional ? (
                  <button
                    type="button"
                    onClick={handleOptionalStageSkip}
                    className="rounded border border-slate-600 px-2.5 py-1 text-[11px] text-slate-200 transition hover:border-slate-400 hover:text-white"
                  >
                    Skip
                  </button>
                ) : null}
              </div>
            </div>
            <div className="mt-2 text-[11px] leading-snug text-slate-300">
              {targetingPrompt}
            </div>
          </div>
        </div>
      ) : null}

      {/* Controls */}
      <div className="flex items-center justify-between text-[12px] min-h-[24px]">
        <div className="flex items-center gap-3">
          <div>
            <span className="opacity-70">Goal</span>{" "}
            <span className="font-semibold">First to {winGoal} wins</span>
          </div>
        </div>

        <div ref={infoPopoverRootRef} className="flex items-center gap-2">
          {isAnteMode && (
            <div className="relative">
              <button
                onClick={() =>
                  setShowAnte((prev) => {
                    const next = !prev;
                    if (next) {
                      setShowRef(false);
                      setShowGrimoire(false);
                    }
                    return next;
                  })
                }
                disabled={phase !== "choose"}
                className="px-2.5 py-0.5 rounded bg-slate-700 text-white border border-slate-600 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Ante
              </button>

              {showAnte && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:absolute sm:inset-auto sm:top-[110%] sm:right-0 sm:z-50 sm:block sm:p-0">
                  <div className="w-full max-w-[calc(100vw-2rem)] rounded-lg border border-slate-700 bg-slate-800/95 p-3 shadow-xl sm:w-80">
                    <div className="flex items-center justify-between mb-1">
                      <div className="font-semibold">Ante</div>
                      <button
                        onClick={() => setShowAnte(false)}
                        className="text-xl leading-none text-slate-300 hover:text-white"
                      >
                        ×
                      </button>
                    </div>
                    <div className="text-[12px] space-y-3">
                      <div className="space-y-1">
                        <div className="font-semibold text-slate-200">Round odds</div>
                        <div className="flex justify-between text-xs text-slate-300">
                          <span>
                            {namesByLegacy.player}: {(ante?.odds?.player ?? 1.1).toFixed(2)}×
                          </span>
                          <span>
                            {namesByLegacy.enemy}: {(ante?.odds?.enemy ?? 1.1).toFixed(2)}×
                          </span>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="font-semibold text-slate-200" htmlFor="ante-input">
                          Your ante (wins)
                        </label>
                        <input
                          id="ante-input"
                          type="number"
                          min={0}
                          max={wins[localLegacySide]}
                          value={localAnteValue}
                          onChange={(event) => {
                            const parsed = Number.parseInt(event.target.value, 10);
                            setAnteBet(Number.isFinite(parsed) ? parsed : 0);
                          }}
                          disabled={phase !== "choose"}
                          className="w-full rounded border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/40 disabled:opacity-60"
                        />
                        <div className="text-xs text-slate-400">
                          Available wins: {wins[localLegacySide]}
                        </div>
                      </div>
                      {isMultiplayer && (
                        <div className="text-xs text-slate-300">
                          Opponent ante: {remoteAnteValue}
                        </div>
                      )}
                      <div className="text-xs text-slate-400">
                        Ante can only be changed before resolving the round.
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Reference button + popover */}
          <div className="relative">
            <button
              onClick={() =>
                setShowRef((prev) => {
                  const next = !prev;
                  if (next) setShowGrimoire(false);
                  if (next) setShowAnte(false);
                  return next;
                })
              }
              className="px-2.5 py-0.5 rounded bg-slate-700 text-white border border-slate-600 hover:bg-slate-600"
            >
              Reference
            </button>

            {showRef && (
              <div
                className="absolute top-[110%] right-0 w-72 max-w-[calc(100vw-2rem)] sm:w-80 rounded-lg border border-slate-700 bg-slate-800/95 shadow-xl p-3 z-50"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="font-semibold">Reference</div>
                  <button
                    onClick={() => setShowRef(false)}
                    className="text-xl leading-none text-slate-300 hover:text-white"
                  >
                    ×
                  </button>
                </div>
                <div className="text-[12px] space-y-2">
                  <div>
                    Place <span className="font-semibold">1 card next to each wheel</span>, then{" "}
                    <span className="font-semibold">press the Resolve button</span>. Where the{" "}
                    <span className="font-semibold">token stops</span> decides the winnning rule, and
                    the player who matches it gets <span className="font-semibold">1 win</span>.
                    First to <span className="font-semibold">{winGoal}</span> wins takes the match.
                  </div>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>💥 Strongest — higher value wins</li>
                    <li>🦊 Weakest — lower value wins</li>
                    <li>🗃️ Reserve — highest sum of cards left in hand</li>
                    <li>🎯 Closest — value closest to target wins</li>
                    <li>⚑ Initiative — initiative holder wins</li>
                    <li><span className="font-semibold">0 Start</span> — no one wins</li>
                  </ul>
                  {isGrimoireMode && (
                    <div className="space-y-1">
                      <div>
                        <span className="font-semibold">Grimoire - Symbols &amp; Mana</span>
                      </div>
                      <div>
                        Visit your profile to assign up to ten <span className="font-semibold">Arcana symbols</span> (🔥, 🗡️, 👁️,
                        🌙, 🐍). Those symbols seed your deck and determine which spells your archetype can learn.
                      </div>
                      <div>
                        Each round your hand shows the symbols you drew. Multi-symbol spells appear when at least two of their
                        listed icons are in hand; single-symbol spells need only one matching card.
                      </div>
                      <div>
                        Tap the <span className="font-semibold">🔮 Mana</span> counter in the HUD to open the Grimoire. Cast
                        spells during their listed phases and pay their Mana costs; after Resolve you earn Mana equal to half of
                        your remaining reserve (rounded up).
                      </div>
                      <div>
                        Some spells ask you to pick a <span className="font-semibold">card</span> or{" "}
                        <span className="font-semibold">wheel</span> before they resolve. Use <b>Cancel</b> if you change
                        your mind mid-cast.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {phase === "choose" && (
            <div className="flex flex-col items-end gap-1">
              <button
                ref={resolveButtonRef}
                disabled={resolveButtonDisabled}
                onClick={handleRevealClick}
                className="px-2.5 py-0.5 rounded bg-amber-400 text-slate-900 font-semibold disabled:opacity-50"
              >
                {resolveButtonLabel}
              </button>
              {isMultiplayer && resolveStatusText && (
                <span className="text-[11px] italic text-amber-200 text-right leading-tight">
                  {resolveStatusText}
                </span>
              )}
            </div>
          )}
          {phase === "roundEnd" && (
            <div className="flex flex-col items-end gap-1">
              <button
                disabled={advanceButtonDisabled}
                onClick={handleNextClick}
                className="px-2.5 py-0.5 rounded bg-emerald-500 text-slate-900 font-semibold disabled:opacity-50"
              >
                {advanceButtonLabel}
              </button>
              {isMultiplayer && advanceStatusText && (
                <span className="text-[11px] italic text-emerald-200 text-right leading-tight">
                  {advanceStatusText}
                </span>
              )}
            </div>
          )}
          {phase === "skill" && isSkillMode && skillPhase && (
            <div className="flex flex-col items-end gap-2 text-right">
              <div className="text-sm font-semibold text-slate-200">Skill Phase</div>
              {skillPhase.activeSide === localLegacySide && skillPhase.options.every((opt) => !opt.canActivate) && (
                <div className="text-xs text-slate-400">No ready skills.</div>
              )}
              {skillPhase.activeSide === localLegacySide && (
                <div className="flex items-center justify-end gap-2 self-end">
                  {isAwaitingSkillTarget && (
                    <button
                      type="button"
                      onClick={handleSkillTargetCancel}
                      className="rounded bg-slate-700 px-2.5 py-0.5 text-xs font-semibold text-slate-200 hover:bg-slate-600"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={passSkillTurn}
                    className="rounded bg-slate-700 px-2.5 py-0.5 text-xs font-semibold text-slate-200 hover:bg-slate-600"
                  >
                    Pass
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Grimoire button + popover/modal */}
          {isGrimoireMode && (
            <div className="relative">
              {showGrimoire && (
                <>
                  {/* Backdrop for mobile-only modal */}
                  <div
                    className="fixed inset-0 z-[70] bg-slate-950/40 backdrop-blur-sm sm:hidden"
                    onClick={() => setShowGrimoire(false)}
                    aria-hidden
                  />

                  {/* Desktop (>=sm) anchored popover */}
                  <div
                    className="hidden w-72 max-w-xs sm:block sm:max-w-sm z-[80]"
                    ref={grimoireDesktopRef}
                  >
                    <div className="rounded-2xl border border-slate-700 bg-slate-900/95 shadow-2xl">
                      <div className="flex items-center justify-between gap-2 border-b border-slate-700/70 px-4 py-3">
                        <div className="text-base font-semibold text-slate-100">Grimoire</div>
                        <button
                          onClick={() => setShowGrimoire(false)}
                          className="text-xl leading-none text-slate-300 transition hover:text-white"
                          aria-label="Close grimoire"
                        >
                          ×
                        </button>
                      </div>

                      {/* Shared content */}
                      <div className="max-h-[65vh] overflow-y-auto px-4 py-4 text-[12px]">
                        <div className="space-y-2">
                          {localSpellDefinitions.length === 0 ? (
                            <div className="italic text-slate-400">No spells learned yet.</div>
                          ) : (
                            <ul className="space-y-2">
                              {localSpellDefinitions.map((spell) => {
                                const allowedPhases = spell.allowedPhases ?? ["choose"];
                                const phaseAllowed = allowedPhases.includes(phase);
                                const effectiveCost = getSpellCost(spell);
                                const canAfford = localMana >= effectiveCost;
                                const disabled = !phaseAllowed || !canAfford || !!pendingSpell;

                                return (
                                  <li key={spell.id}>
  <button
    type="button"
    onClick={() => {
      handleSpellActivate(spell);
      setShowGrimoire(false);
      const el = document.activeElement as HTMLElement | null;
      if (el) el.blur();
    }}
    disabled={disabled}
    className="w-full rounded-xl border border-slate-700 bg-slate-800/60 px-3 py-2 text-left transition
               hover:bg-slate-800/90 disabled:opacity-50 disabled:cursor-not-allowed"
  >
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-1 font-semibold text-[13px] text-slate-100">
        {spell.icon ? <span aria-hidden>{spell.icon}</span> : null}
        <span>{spell.name}</span>
      </div>
      <div className="flex items-center gap-1 text-[11px] text-sky-200">
        <span aria-hidden className="text-[14px] leading-none">🔹</span>
        <span>{effectiveCost}</span>
      </div>
    </div>

    <div className="mt-1 space-y-0.5 text-[11px] leading-snug text-slate-300">
      <SpellDescription description={spell.description} />
    </div>

  </button>
</li>

                                );
                              })}
                            </ul>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Mobile (<sm) centered modal */}
                  <div className="fixed inset-x-4 top-20 z-[80] sm:hidden flex justify-center">
                    <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900/95 shadow-2xl">
                      <div className="flex items-center justify-between gap-2 border-b border-slate-700/70 px-4 py-3">
                        <div className="text-base font-semibold text-slate-100">Grimoire</div>
                        <button
                          onClick={() => setShowGrimoire(false)}
                          className="text-xl leading-none text-slate-300 transition hover:text-white"
                          aria-label="Close grimoire"
                        >
                          ×
                        </button>
                      </div>

                      {/* Same shared content as above */}
                      <div className="max-h-[65vh] overflow-y-auto px-4 py-4 text-[12px]">
                        <div className="space-y-2">
                          {localSpellDefinitions.length === 0 ? (
                            <div className="italic text-slate-400">No spells learned yet.</div>
                          ) : (
                            <ul className="space-y-2">
                              {localSpellDefinitions.map((spell) => {
                                const allowedPhases = spell.allowedPhases ?? ["choose"];
                                const phaseAllowed = allowedPhases.includes(phase);
                                const effectiveCost = getSpellCost(spell);
                                const canAfford = localMana >= effectiveCost;
                                const disabled = !phaseAllowed || !canAfford || !!pendingSpell;

                                return (
                                  <li key={spell.id}>
  <button
    type="button"
    onClick={() => {
      handleSpellActivate(spell);
      setShowGrimoire(false);
      const el = document.activeElement as HTMLElement | null;
      if (el) el.blur();
    }}
    disabled={disabled}
    className="w-full rounded-xl border border-slate-700 bg-slate-800/60 px-3 py-2 text-left transition
               hover:bg-slate-800/90 disabled:opacity-50 disabled:cursor-not-allowed"
  >
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-1 font-semibold text-[13px] text-slate-100">
        {spell.icon ? <span aria-hidden>{spell.icon}</span> : null}
        <span>{spell.name}</span>
      </div>
      <div className="flex items-center gap-1 text-[11px] text-sky-200">
        <span aria-hidden className="text-[14px] leading-none">🔹</span>
        <span>{effectiveCost}</span>
      </div>
    </div>

    <div className="mt-1 space-y-0.5 text-[11px] leading-snug text-slate-300">
      {spell.targetSummary ? (
        <div className="font-semibold text-slate-200">{spell.targetSummary}</div>
      ) : null}
      <SpellDescription description={spell.description} />
    </div>

  </button>
</li>

                                );
                              })}
                            </ul>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

      </div>

      {/* HUD */}
      <div className="relative z-10 mb-3 sm:mb-4">
        <HUDPanels
          manaPools={manaPools}
          isGrimoireMode={isGrimoireMode}
          reserveSums={reserveSums}
          players={players}
          hudColors={HUD_COLORS}
          wins={wins}
          initiative={initiative}
          localLegacySide={localLegacySide}
          phase={phase}
          theme={THEME}
          onPlayerManaToggle={handlePlayerManaToggle}
          isGrimoireOpen={showGrimoire}
          playerManaButtonRef={playerManaButtonRef}
          reserveSpellHighlights={reserveSpellHighlights}
        />
      </div>

      {skillPhaseMessage && (
        <div className="relative z-10 -mt-2 mb-2 flex justify-center px-2">
          <div className="max-w-md rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-1.5 text-center text-xs text-slate-200 shadow">
            {skillPhaseMessage}
          </div>
        </div>
      )}

      {/* Wheels center */}
      <div
        className="relative z-0 flex h-full items-center justify-center -translate-y-[36px] sm:-translate-y-6 lg:-translate-y-8"
        style={{ paddingBottom: handClearance }}
      >
        <div
          ref={wheelPanelContainerRef}
          className="mx-auto flex h-full flex-col items-center justify-center gap-0 rounded-xl border border-transparent p-2 shadow"
          style={wheelPanelContainerStyle}
        >
          {[0, 1, 2].map((i) => (
            <div key={i} className={i === 0 ? undefined : "-mt-3 md:-mt-4"}>
              <WheelPanel
                index={i}
                assign={assign}
                namesByLegacy={namesByLegacy}
                wheelSize={wheelSize}
                lockedWheelSize={lockedWheelSize}
                wheelDamage={wheelDamage[i]}
                wheelMirror={wheelMirror[i]}
                wheelLocked={wheelLocks[i]}
                pointerShift={pointerShifts[i]}
                reservePenalties={reservePenalties}
                selectedCardId={selectedCardId}
                setSelectedCardId={setSelectedCardId}
                localLegacySide={localLegacySide}
                phase={phase}
                setDragCardId={setDragCardId}
                dragCardId={dragCardId}
                setDragOverWheel={setDragOverWheel}
                dragOverWheel={dragOverWheel}
                player={player}
                enemy={enemy}
                assignToWheelLocal={assignToWheelLocal}
                isWheelActive={active[i]}
                wheelRef={wheelRefs[i]}
                wheelSection={wheelSections[i]}
                hudColors={HUD_COLORS}
                theme={THEME}
                initiativeOverride={initiativeOverride}
                startPointerDrag={startPointerDrag}
                startTouchDrag={startTouchDrag}
                wheelHudColor={wheelHUD[i]}
                pendingSpell={pendingSpell}
                onSpellTargetSelect={handleSpellTargetSelect}
                onWheelTargetSelect={handleWheelTargetSelect}
                isAwaitingSpellTarget={isAwaitingSpellTarget}
                variant="grouped"
                spellHighlightedCardIds={spellHighlightedCardIds}
                skillExhausted={skillPhase?.exhausted ?? null}
                isSkillMode={isSkillMode}
                onSkillActivate={activateSkillOption}
                skillPhaseActiveSide={skillPhase?.activeSide ?? null}
                skillOptions={
                  skillPhase?.options.map((option) => ({
                    lane: option.lane,
                    canActivate: option.canActivate,
                    reason: option.reason,
                  })) ?? []
                }
                skillTargeting={skillTargeting}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Docked hand overlay */}
      <HandDock
        ref={handDockRef}
        localLegacySide={localLegacySide}
        player={player}
        enemy={enemy}
        wheelPanelWidth={wheelPanelLayout.panelWidth}
        wheelPanelBounds={wheelPanelBounds}
        selectedCardId={selectedCardId}
        setSelectedCardId={setSelectedCardId}
        assign={assign}
        assignToWheelLocal={assignToWheelLocal}
        setDragCardId={setDragCardId}
        startPointerDrag={startPointerDrag}
        startTouchDrag={startTouchDrag}
        isPtrDragging={isPtrDragging}
        ptrDragCard={ptrDragCard}
        ptrDragType={ptrDragType}
        ptrPos={ptrPos}
        onMeasure={setHandClearance}
        pendingSpell={pendingSpell}
        isAwaitingSpellTarget={isAwaitingSpellTarget}
        onSpellTargetSelect={handleSpellTargetSelect}
        spellHighlightedCardIds={spellHighlightedCardIds}
        isSkillMode={isSkillMode}
        skillTargeting={skillTargeting}
        onSkillTargetSelect={handleSkillReserveSelect}
      />

      <FirstRunCoach
        stage={onboardingStage}
        show={showCoachOverlay}
        infoPopoverRef={infoPopoverRootRef}
        handRef={handDockRef}
        wheelRef={wheelPanelContainerRef}
        resolveButtonRef={resolveButtonRef}
        assigned={assign.player}
        handCount={player.hand.length}
        phase={phaseForLogic}
        onDismiss={handleCoachDismiss}
        onAdvance={handleCoachAdvance}
      />

      {/* Ended overlay (banner + modal) */}
      {phase === "ended" && (
        <VictoryOverlay
          victoryCollapsed={victoryCollapsed}
          onCollapseChange={setVictoryCollapsed}
          localWon={localWon}
          matchSummary={matchSummary}
          winGoal={winGoal}
          winnerName={winnerName}
          remoteName={remoteName}
          localName={localName}
          localWinsCount={localWinsCount}
          remoteWinsCount={remoteWinsCount}
          xpDisplay={xpDisplay}
          xpProgressPercent={xpProgressPercent}
          levelUpFlash={levelUpFlash}
          onRematch={handleRematchClick}
          rematchButtonLabel={rematchButtonLabel}
          isMultiplayer={isMultiplayer}
          localRematchReady={localRematchReady}
          rematchStatusText={rematchStatusText}
          onExitClick={handleExitClick}
          onExit={onExit}
        />
      )}
    </div>
  );
}

// ---------------- Dev Self-Tests (lightweight) ----------------
if (typeof window !== 'undefined') {
  try {
    const s: Section = { id: "Strongest", color: "#fff", start: 14, end: 2 } as any;
    console.assert(!inSection(0, s), 'slice 0 excluded');
    console.assert(inSection(14, s) && inSection(15, s) && inSection(1, s) && inSection(2, s), 'wrap includes 14,15,1,2');
  } catch {}
  try {
    const secs = genWheelSections("bandit");
    const len = (sec: Section) => (sec.start <= sec.end ? (sec.end - sec.start + 1) : (SLICES - sec.start + (sec.end + 1)));
    const sum = secs.reduce((a, s) => a + len(s), 0);
    console.assert(sum === 15, 'sections cover 15 slices');
  } catch {}
}
