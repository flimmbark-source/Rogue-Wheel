import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  startTransition,
} from "react";
import type { PointerEvent as ReactPointerEvent, TouchEvent as ReactTouchEvent } from "react";
import { Realtime } from "ably";

import {
  SLICES,
  TARGET_WINS,
  type Side as TwoSide,
  type Card,
  type Section,
  type Fighter,
  type SplitChoiceMap,
  type Players,
  type CorePhase,
  LEGACY_FROM_SIDE,
} from "../../../game/types";
import { DEFAULT_GAME_MODE, normalizeGameMode, type GameMode } from "../../../gameModes";
import { easeInOutCubic, inSection, createSeededRng } from "../../../game/math";
import { genWheelSections } from "../../../game/wheel";
import {
  makeFighter,
  refillTo,
  drawOne,
  recordMatchResult,
  type MatchResultSummary,
  type LevelProgress,
} from "../../../player/profileStore";
import { fmtNum, isNormal } from "../../../game/values";
import {
  describeSkillAbility,
  determineSkillAbility,
  getSkillCardValue,
  isReserveBoostTarget,
  type SkillAbility,
} from "../../../game/skills";
import type { WheelHandle } from "../../../components/CanvasWheel";
import {
  applySpellEffects as runSpellEffects,
  type AssignmentState,
  type LaneChillStacks,
  type LegacySide,
  type SpellEffectPayload,
} from "../../../game/spellEngine";
import {
  summarizeRoundOutcome,
  type RoundAnalysis,
  type WheelOutcome,
} from "./roundOutcomeSummary";

export type { LegacySide, SpellEffectPayload } from "../../../game/spellEngine";

export type MPIntent =
  | { type: "assign"; lane: number; side: LegacySide; card: Card }
  | { type: "clear"; lane: number; side: LegacySide }
  | { type: "reveal"; side: LegacySide }
  | { type: "nextRound"; side: LegacySide }
  | { type: "rematch"; side: LegacySide }
  | { type: "reserve"; side: LegacySide; reserve: number; round: number }
  | { type: "ante"; side: LegacySide; bet: number; round: number }
  | { type: "spellEffects"; payload: SpellEffectPayload };

export type ThreeWheelGameProps = {
  localSide: TwoSide;
  localPlayerId: string;
  players: Players;
  seed: number;
  roomCode?: string;
  hostId?: string;
  targetWins?: number;
  gameMode?: GameMode;
  onExit?: () => void;
};

type AnteState = {
  round: number;
  bets: Record<LegacySide, number>;
  odds: Record<LegacySide, number>;
};

export type GameLogEntryType = "general" | "spell";

export type GameLogEntry = {
  id: string;
  message: string;
  type: GameLogEntryType;
};

let logIdCounter = 0;
const createLogEntry = (
  message: string,
  type: GameLogEntryType = "general",
): GameLogEntry => ({
  id: `log-${Date.now().toString(36)}-${(logIdCounter++).toString(36)}`,
  message,
  type,
});

type SideState<T> = Record<LegacySide, T>;

type SpellHighlightState = {
  cards: string[];
  reserve: SideState<boolean>;
};

const createEmptySpellHighlights = (): SpellHighlightState => ({
  cards: [],
  reserve: { player: false, enemy: false },
});

type SkillOption = {
  lane: number;
  card: Card;
  ability: SkillAbility;
  description: string;
  canActivate: boolean;
  reason?: string;
};

type SkillPhaseState = {
  activeSide: LegacySide;
  exhausted: SideState<[boolean, boolean, boolean]>;
  passed: SideState<boolean>;
};

type SkillPhaseView = {
  activeSide: LegacySide;
  exhausted: SideState<[boolean, boolean, boolean]>;
  passed: SideState<boolean>;
  options: SkillOption[];
};

export type SkillTargetingState =
  | {
      kind: "reserve";
      ability: "swapReserve" | "reserveBoost" | "rerollReserve";
      side: LegacySide;
      laneIndex: number;
    }
  | {
      kind: "lane";
      ability: "boostCard";
      side: LegacySide;
      laneIndex: number;
    };

export type SkillTargetSelection =
  | {
      kind: "reserve";
      cardId: string;
    }
  | {
      kind: "lane";
      laneIndex: number;
    };

export type ThreeWheelGameState = {
  player: Fighter;
  enemy: Fighter;
  initiative: LegacySide;
  wins: { player: number; enemy: number };
  round: number;
  ante: AnteState;
  freezeLayout: boolean;
  lockedWheelSize: number | null;
  phase: CorePhase;
  resolveVotes: { player: boolean; enemy: boolean };
  advanceVotes: { player: boolean; enemy: boolean };
  rematchVotes: { player: boolean; enemy: boolean };
  matchSummary: MatchResultSummary | null;
  xpDisplay: LevelProgress | null;
  levelUpFlash: boolean;
  handClearance: number;
  wheelSize: number;
  wheelSections: Section[][];
  tokens: [number, number, number];
  active: [boolean, boolean, boolean];
  wheelHUD: [string | null, string | null, string | null];
  assign: { player: (Card | null)[]; enemy: (Card | null)[] };
  laneChillStacks: LaneChillStacks;
  dragCardId: string | null;
  dragOverWheel: number | null;
  selectedCardId: string | null;
  reserveSums: null | { player: number; enemy: number };
  isPtrDragging: boolean;
  ptrDragCard: Card | null;
  ptrDragType: "pointer" | "touch" | null;
  log: GameLogEntry[];
  spellHighlights: SpellHighlightState;
  skillPhase: SkillPhaseView | null;
  skillTargeting: SkillTargetingState | null;
};

export type ThreeWheelGameDerived = {
  localLegacySide: LegacySide;
  remoteLegacySide: LegacySide;
  hostLegacySide: LegacySide;
  namesByLegacy: Record<LegacySide, string>;
  HUD_COLORS: { player: string; enemy: string };
  winGoal: number;
  isMultiplayer: boolean;
  isSkillMode: boolean;
  matchWinner: LegacySide | null;
  localWinsCount: number;
  remoteWinsCount: number;
  localWon: boolean;
  winnerName: string | null;
  localName: string;
  remoteName: string;
  canReveal: boolean;
};

export type ThreeWheelGameRefs = {
  wheelRefs: Array<React.MutableRefObject<WheelHandle | null>>;
  ptrPos: React.MutableRefObject<{ x: number; y: number }>;
};

export type ThreeWheelGameActions = {
  setHandClearance: React.Dispatch<React.SetStateAction<number>>;
  setSelectedCardId: React.Dispatch<React.SetStateAction<string | null>>;
  setDragCardId: React.Dispatch<React.SetStateAction<string | null>>;
  setDragOverWheel: (index: number | null) => void;
  startPointerDrag: (card: Card, event: ReactPointerEvent) => void;
  startTouchDrag: (card: Card, event: ReactTouchEvent<HTMLButtonElement>) => void;
  assignToWheelLocal: (index: number, card: Card) => void;
  handleRevealClick: () => void;
  handleNextClick: () => void;
  handleRematchClick: () => void;
  handleExitClick: () => void;
  applySpellEffects: (payload: SpellEffectPayload, options?: { broadcast?: boolean }) => void;
  setAnteBet: (bet: number) => void;
  activateSkillOption: (lane: number) => void;
  passSkillTurn: () => void;
  resolveSkillTargeting: (selection: SkillTargetSelection) => void;
  cancelSkillTargeting: () => void;
};

export type ThreeWheelGameReturn = {
  state: ThreeWheelGameState;
  derived: ThreeWheelGameDerived;
  refs: ThreeWheelGameRefs;
  actions: ThreeWheelGameActions;
};


export function useThreeWheelGame({
  localSide,
  localPlayerId,
  players,
  seed,
  roomCode,
  hostId,
  targetWins,
  gameMode,
  onExit,
}: ThreeWheelGameProps): ThreeWheelGameReturn {
  const mountedRef = useRef(true);
  const timeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const setSafeTimeout = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      if (mountedRef.current) {
        fn();
      }
    }, ms);
    timeoutsRef.current.add(id);
    return id;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      timeoutsRef.current.forEach(clearTimeout);
      timeoutsRef.current.clear();
    };
  }, []);

  const localLegacySide: LegacySide = LEGACY_FROM_SIDE[localSide];
  const remoteLegacySide: LegacySide = localLegacySide === "player" ? "enemy" : "player";

  const HUD_COLORS = {
    player: players.left.color ?? "#84cc16",
    enemy: players.right.color ?? "#d946ef",
  } as const;

  const playerName = players.left.name || "Wanderer";
  const enemyName = players.right.name || "Shade Bandit";

  const namesByLegacy: Record<LegacySide, string> = {
    player: playerName,
    enemy: enemyName,
  };

  const winGoal =
    typeof targetWins === "number" && Number.isFinite(targetWins)
      ? Math.max(1, Math.min(25, Math.round(targetWins)))
      : TARGET_WINS;

  const currentGameMode = normalizeGameMode(gameMode ?? DEFAULT_GAME_MODE);
  const isAnteMode = currentGameMode.includes("ante");
  const isSkillMode = currentGameMode.includes("skill");

  const hostLegacySide: LegacySide = (() => {
    if (!hostId) return "player";
    if (players.left.id === hostId) return "player";
    if (players.right.id === hostId) return "enemy";
    return "player";
  })();

  const isMultiplayer = !!roomCode;
  type AblyRealtime = InstanceType<typeof Realtime>;
  type AblyChannel = ReturnType<AblyRealtime["channels"]["get"]>;
  const ablyRef = useRef<AblyRealtime | null>(null);
  const chanRef = useRef<AblyChannel | null>(null);

  const [player, setPlayer] = useState<Fighter>(() => makeFighter(playerName));
  const playerRef = useRef(player);
  useEffect(() => {
    playerRef.current = player;
  }, [player]);
  const [enemy, setEnemy] = useState<Fighter>(() => makeFighter(enemyName));
  const enemyRef = useRef(enemy);
  useEffect(() => {
    enemyRef.current = enemy;
  }, [enemy]);

  useEffect(() => {
    setPlayer((prev) => (prev.name === playerName ? prev : { ...prev, name: playerName }));
  }, [playerName]);

  useEffect(() => {
    setEnemy((prev) => (prev.name === enemyName ? prev : { ...prev, name: enemyName }));
  }, [enemyName]);
  const [initiative, setInitiative] = useState<LegacySide>(() =>
    hostId ? hostLegacySide : localLegacySide
  );
  const [wins, setWins] = useState<{ player: number; enemy: number }>({ player: 0, enemy: 0 });
  const pendingWinsRef = useRef<{ player: number; enemy: number } | null>(null);

  const commitPendingWins = useCallback(() => {
    if (!pendingWinsRef.current) return;
    setWins(pendingWinsRef.current);
    pendingWinsRef.current = null;
  }, [setWins]);
  const [round, setRound] = useState(1);
  const [anteState, setAnteState] = useState<AnteState>(() => ({
    round: 0,
    bets: { player: 0, enemy: 0 },
    odds: { player: 1.2, enemy: 1.2 },
  }));
  const [freezeLayout, setFreezeLayout] = useState(false);
  const [lockedWheelSize, setLockedWheelSize] = useState<number | null>(null);
  const [phase, setPhase] = useState<CorePhase>("choose");
  const phaseRef = useRef(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  const [resolveVotes, setResolveVotes] = useState<{ player: boolean; enemy: boolean }>({
    player: false,
    enemy: false,
  });
  const resolveVotesRef = useRef(resolveVotes);
  useEffect(() => {
    resolveVotesRef.current = resolveVotes;
  }, [resolveVotes]);
  const [advanceVotes, setAdvanceVotes] = useState<{ player: boolean; enemy: boolean }>({
    player: false,
    enemy: false,
  });
  const [rematchVotes, setRematchVotes] = useState<{ player: boolean; enemy: boolean }>({
    player: false,
    enemy: false,
  });

  const anteStateRef = useRef(anteState);
  useEffect(() => {
    anteStateRef.current = anteState;
  }, [anteState]);

  const roundRef = useRef(round);
  useEffect(() => {
    roundRef.current = round;
  }, [round]);

  const clampAnteValue = useCallback(
    (side: LegacySide, value: number) => {
      if (!Number.isFinite(value)) return 0;
      const floored = Math.floor(value);
      const max = Math.max(0, wins[side]);
      if (floored <= 0) return 0;
      return Math.min(floored, max);
    },
    [wins]
  );

  useEffect(() => {
    if (!isAnteMode) {
      setAnteState((prev) => {
        if (prev.round === round && prev.bets.player === 0 && prev.bets.enemy === 0) {
          return prev;
        }
        return {
          round,
          bets: { player: 0, enemy: 0 },
          odds: { player: 1.1, enemy: 1.1 },
        };
      });
      return;
    }

    if (phase !== "choose") return;

    setAnteState((prev) => {
      if (prev.round === round) return prev;
      return {
        round,
        bets: { player: 0, enemy: 0 },
        odds: calculateAnteOdds({ wins, winGoal, initiative }),
      };
    });
  }, [initiative, isAnteMode, phase, round, winGoal, wins]);

  const markResolveVote = useCallback((side: LegacySide) => {
    setResolveVotes((prev) => {
      if (prev[side]) return prev;
      return { ...prev, [side]: true };
    });
  }, []);

  const clearResolveVotes = useCallback((side?: LegacySide) => {
    setResolveVotes((prev) => {
      if (side) {
        if (!prev[side]) return prev;
        return { ...prev, [side]: false };
      }
      if (!prev.player && !prev.enemy) return prev;
      return { player: false, enemy: false };
    });
  }, []);

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

  const calcWheelSize = useCallback((viewH: number, viewW: number, dockAllowance = 0) => {
    const MIN_WHEEL = 160;
    const MAX_WHEEL = 200;
    const isMobile = viewW <= 480;
    const chromeAllowance = viewW >= 1024 ? 200 : 140;
    const raw = Math.floor((viewH - chromeAllowance - dockAllowance) / 3);
    const MOBILE_MAX = 188;
    const DESKTOP_MAX = 220;
    const maxAllowed = isMobile ? MOBILE_MAX : DESKTOP_MAX;
    return Math.max(MIN_WHEEL, Math.min(maxAllowed, raw, MAX_WHEEL));
  }, []);

  const [isPtrDragging, setIsPtrDragging] = useState(false);
  const [ptrDragCard, setPtrDragCard] = useState<Card | null>(null);
  const [ptrDragType, setPtrDragType] = useState<"pointer" | "touch" | null>(null);
  const ptrPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const supportsPointerEventsRef = useRef<boolean>(
    typeof window === "undefined" ? true : "PointerEvent" in window,
  );

  useEffect(() => {
    supportsPointerEventsRef.current = typeof window === "undefined" ? true : "PointerEvent" in window;
  }, []);

  const addTouchDragCss = useCallback((on: boolean) => {
    const root = document.documentElement;
    if (on) {
      (root as any).__prevTouchAction = root.style.touchAction;
      (root as any).__prevOverscroll = root.style.overscrollBehavior;
      root.style.touchAction = "none";
      root.style.overscrollBehavior = "contain";
    } else {
      root.style.touchAction = (root as any).__prevTouchAction ?? "";
      root.style.overscrollBehavior = (root as any).__prevOverscroll ?? "";
      delete (root as any).__prevTouchAction;
      delete (root as any).__prevOverscroll;
    }
  }, []);

  const getDropTargetAt = useCallback((x: number, y: number): { kind: "wheel" | "slot"; idx: number } | null => {
    let el = document.elementFromPoint(x, y) as HTMLElement | null;
    while (el) {
      const d = (el as HTMLElement).dataset;
      if (d.drop && d.idx) {
        if (d.drop === "wheel") return { kind: "wheel", idx: Number(d.idx) };
        if (d.drop === "slot") return { kind: "slot", idx: Number(d.idx) };
      }
      el = el.parentElement;
    }
    return null;
  }, []);

  const [wheelSize, setWheelSize] = useState<number>(() =>
    typeof window !== "undefined" ? calcWheelSize(window.innerHeight, window.innerWidth, 0) : 200
  );

  useEffect(() => {
    const onResize = () => {
      if (freezeLayout || lockedWheelSize !== null) return;
      setWheelSize(calcWheelSize(window.innerHeight, window.innerWidth, handClearance));
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    const t = setTimeout(() => {
      if (!freezeLayout && lockedWheelSize === null) onResize();
    }, 350);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      clearTimeout(t);
    };
  }, [calcWheelSize, freezeLayout, handClearance, lockedWheelSize]);

  useEffect(() => {
    if (typeof window !== "undefined" && !freezeLayout && lockedWheelSize === null) {
      setWheelSize(calcWheelSize(window.innerHeight, window.innerWidth, handClearance));
    }
  }, [calcWheelSize, handClearance, freezeLayout, lockedWheelSize]);

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
  const tokensRef = useRef(tokens);
  const roundStartTokensRef = useRef<[number, number, number] | null>([0, 0, 0]);
  const [active] = useState<[boolean, boolean, boolean]>([true, true, true]);
  const [wheelHUD, setWheelHUD] = useState<[string | null, string | null, string | null]>([null, null, null]);
  const [assign, setAssign] = useState<{ player: (Card | null)[]; enemy: (Card | null)[] }>({
    player: [null, null, null],
    enemy: [null, null, null],
  });
  const [laneChillStacks, setLaneChillStacks] = useState<LaneChillStacks>({
    player: [0, 0, 0],
    enemy: [0, 0, 0],
  });
  const laneChillRef = useRef(laneChillStacks);
  const assignRef = useRef(assign);
  const roundAnalysisRef = useRef<RoundAnalysis | null>(null);
  useEffect(() => {
    assignRef.current = assign;
  }, [assign]);
  useEffect(() => {
    laneChillRef.current = laneChillStacks;
  }, [laneChillStacks]);
  useEffect(() => {
    tokensRef.current = tokens;
  }, [tokens]);

  const reserveReportsRef = useRef<
    Record<LegacySide, { reserve: number; round: number } | null>
  >({
    player: null,
    enemy: null,
  });

  const reservePenaltiesRef = useRef<Record<LegacySide, number>>({
    player: 0,
    enemy: 0,
  });

  const applyReservePenalty = useCallback((side: LegacySide, amount: number) => {
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return;
    const currentPenalty = reservePenaltiesRef.current[side] ?? 0;
    const updatedPenalty = Math.max(0, currentPenalty + amount);
    reservePenaltiesRef.current[side] = updatedPenalty;

    const report = reserveReportsRef.current[side];
    if (report) {
      const reduced = Math.max(0, report.reserve - amount);
      if (reduced !== report.reserve) {
        reserveReportsRef.current[side] = { reserve: reduced, round: report.round };
      }
    }
  }, []);

  const storeReserveReport = useCallback(
    (side: LegacySide, reserve: number, roundValue: number) => {
      const prev = reserveReportsRef.current[side];
      if (!prev || prev.reserve !== reserve || prev.round !== roundValue) {
        reserveReportsRef.current[side] = { reserve, round: roundValue };
        return true;
      }
      return false;
    },
    []
  );

  const handleMPIntentRef = useRef<(intent: MPIntent, senderId?: string) => void>(() => {});

  const sendIntent = useCallback(
    (intent: MPIntent) => {
      if (!roomCode) return;
      try {
        void chanRef.current?.publish("intent", intent);
      } catch {}
    },
    [roomCode]
  );

  const [dragCardId, setDragCardId] = useState<string | null>(null);
  const [dragOverWheel, _setDragOverWheel] = useState<number | null>(null);
  const dragOverRef = useRef<number | null>(null);
  const setDragOverWheel = useCallback((i: number | null) => {
    dragOverRef.current = i;
    if ((window as any).requestIdleCallback) {
      (window as any).requestIdleCallback(() => _setDragOverWheel(dragOverRef.current));
    } else {
      setTimeout(() => _setDragOverWheel(dragOverRef.current), 0);
    }
  }, []);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [reserveSums, setReserveSums] = useState<null | { player: number; enemy: number }>(null);

  const START_LOG = `A ${enemyName} eyes your purse...`;
  const [log, setLog] = useState<GameLogEntry[]>(() => [createLogEntry(START_LOG)]);

  const appendLog = useCallback((message: string, options?: { type?: GameLogEntryType }) => {
    const entry = createLogEntry(message, options?.type ?? "general");
    setLog((prev) => [entry, ...prev].slice(0, 60));
  }, []);

  const [spellHighlights, setSpellHighlights] = useState<SpellHighlightState>(() => createEmptySpellHighlights());
  const spellHighlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [skillState, setSkillState] = useState<SkillPhaseState | null>(null);
  const skillStateRef = useRef<SkillPhaseState | null>(skillState);
  const postSkillPhaseRef = useRef<CorePhase>("roundEnd");
  const [skillPhaseView, setSkillPhaseView] = useState<SkillPhaseView | null>(null);
  const [skillTargeting, setSkillTargeting] = useState<SkillTargetingState | null>(null);
  const skillTargetingRef = useRef<SkillTargetingState | null>(skillTargeting);
  const reserveCycleCountsRef = useRef<SideState<number>>({ player: 0, enemy: 0 });
  useEffect(() => {
    skillTargetingRef.current = skillTargeting;
  }, [skillTargeting]);

  useEffect(() => {
    skillStateRef.current = skillState;
  }, [skillState]);

  const clearSpellHighlights = useCallback(() => {
    setSpellHighlights(createEmptySpellHighlights());
  }, []);

  const scheduleSpellHighlightClear = useCallback(() => {
    if (spellHighlightTimeoutRef.current) {
      clearTimeout(spellHighlightTimeoutRef.current);
      spellHighlightTimeoutRef.current = null;
    }

    if (typeof window === "undefined") {
      clearSpellHighlights();
      return;
    }

    const timeoutId = window.setTimeout(() => {
      clearSpellHighlights();
      spellHighlightTimeoutRef.current = null;
    }, 2000);

    spellHighlightTimeoutRef.current = timeoutId;
  }, [clearSpellHighlights]);

  const flashSpellHighlights = useCallback(
    (cardIds: Iterable<string>, reserveSides: Iterable<LegacySide>) => {
      const cardSet = new Set<string>();
      for (const id of cardIds) {
        if (typeof id === "string" && id.length > 0) {
          cardSet.add(id);
        }
      }

      const reserveHighlight: SideState<boolean> = { player: false, enemy: false };
      for (const side of reserveSides) {
        if (side === "player" || side === "enemy") {
          reserveHighlight[side] = true;
        }
      }

      if (cardSet.size === 0 && !reserveHighlight.player && !reserveHighlight.enemy) {
        return;
      }

      setSpellHighlights({ cards: Array.from(cardSet), reserve: reserveHighlight });
      scheduleSpellHighlightClear();
    },
    [scheduleSpellHighlightClear],
  );

  const getFighterSnapshot = useCallback(
    (side: LegacySide): Fighter => (side === "player" ? playerRef.current : enemyRef.current),
    [],
  );

  const updateFighter = useCallback(
    (side: LegacySide, mutator: (prev: Fighter) => Fighter) => {
      if (side === "player") {
        setPlayer((prev) => {
          const next = mutator(prev);
          playerRef.current = next;
          return next;
        });
      } else {
        setEnemy((prev) => {
          const next = mutator(prev);
          enemyRef.current = next;
          return next;
        });
      }
    },
    [setEnemy, setPlayer],
  );

  const boostLaneCard = useCallback(
    (side: LegacySide, laneIndex: number, amount: number): boolean => {
      if (!Number.isFinite(amount) || amount === 0) return false;
      let applied = false;
      setAssign((prev) => {
        const lane = side === "player" ? [...prev.player] : [...prev.enemy];
        const target = lane[laneIndex];
        if (!target) return prev;
        const baseValue = getSkillCardValue(target);
        if (baseValue === null) return prev;
        const currentValue = typeof target.number === "number" ? target.number : baseValue;
        const updatedCard: Card = {
          ...target,
          number: Math.max(0, currentValue + amount),
        };
        lane[laneIndex] = updatedCard;
        const next = side === "player" ? { ...prev, player: lane } : { ...prev, enemy: lane };
        assignRef.current = next;
        applied = true;
        return next;
      });
      return applied;
    },
    [setAssign],
  );

  const swapCardWithReserve = useCallback(
    (
      side: LegacySide,
      laneIndex: number,
      preferredCardId?: string,
    ): { swapped: boolean; incoming?: Card; outgoing?: Card } => {
      const lane = side === "player" ? assignRef.current.player : assignRef.current.enemy;
      const boardCard = lane[laneIndex];
      if (!boardCard) return { swapped: false };
      const fighter = getFighterSnapshot(side);
      if (!fighter.hand.length) return { swapped: false };
      let chosen: Card | null = null;

      if (preferredCardId) {
        chosen = fighter.hand.find((card) => card.id === preferredCardId) ?? null;
        if (!chosen) {
          return { swapped: false };
        }
      }

      if (!chosen) {
        let bestValue = Number.NEGATIVE_INFINITY;
        for (const card of fighter.hand) {
          const value = getSkillCardValue(card) ?? 0;
          if (value > bestValue) {
            bestValue = value;
            chosen = card;
          }
        }
      }

      if (!chosen) {
        chosen = fighter.hand[0] ?? null;
      }

      if (!chosen) return { swapped: false };

      const incoming = chosen;
      const outgoing = boardCard;

      updateFighter(side, (prev) => {
        const hand = prev.hand.filter((c) => c.id !== incoming.id);
        const nextHand = [...hand, outgoing];
        return { ...prev, hand: nextHand };
      });

      setAssign((prev) => {
        const laneArr = side === "player" ? [...prev.player] : [...prev.enemy];
        laneArr[laneIndex] = incoming;
        const next = side === "player" ? { ...prev, player: laneArr } : { ...prev, enemy: laneArr };
        assignRef.current = next;
        return next;
      });

      return { swapped: true, incoming, outgoing };
    },
    [getFighterSnapshot, setAssign, updateFighter],
  );

  const rerollReserve = useCallback(
    (
      side: LegacySide,
      preferredCardId?: string,
    ): { discarded: Card | null; drawn: Card | null } => {
      let discardedCard: Card | null = null;
      let drawnCard: Card | null = null;

      updateFighter(side, (prev) => {
        if (prev.hand.length === 0) return prev;

        const hand = [...prev.hand];
        let targetIndex = -1;

        if (preferredCardId) {
          targetIndex = hand.findIndex((card) => card.id === preferredCardId);
        }

        if (targetIndex === -1) {
          let lowestValue = Number.POSITIVE_INFINITY;
          for (let i = 0; i < hand.length; i++) {
            const card = hand[i];
            const cardValue = getSkillCardValue(card);
            const comparableValue = cardValue ?? Number.POSITIVE_INFINITY;
            if (comparableValue < lowestValue) {
              lowestValue = comparableValue;
              targetIndex = i;
            }
          }
          if (targetIndex === -1) {
            targetIndex = 0;
          }
        }

        const targetCard = hand[targetIndex];
        if (!targetCard) {
          return prev;
        }

        discardedCard = targetCard;
        const nextHand = hand.filter((_, idx) => idx !== targetIndex);
        const beforeDrawCount = nextHand.length;
        let next: Fighter = {
          ...prev,
          hand: nextHand,
          deck: [...prev.deck],
          discard: [...prev.discard, targetCard],
        };

        next = drawOne(next);

        if (next.hand.length > beforeDrawCount) {
          drawnCard = next.hand[next.hand.length - 1] ?? null;
        }

        return next;
      });

      return { discarded: discardedCard, drawn: drawnCard };
    },
    [updateFighter],
  );

  const exhaustReserveForBoost = useCallback(
    (side: LegacySide, preferredCardId?: string): { value: number; card: Card | null } => {
      const fighter = getFighterSnapshot(side);
      const reserveCards = fighter.hand.filter((card) => isReserveBoostTarget(card));
      if (reserveCards.length === 0) {
        return { value: 0, card: null };
      }
      let chosenCard: Card = reserveCards[0];
      let bestValue = getSkillCardValue(chosenCard) ?? Number.NEGATIVE_INFINITY;
      if (preferredCardId) {
        const match = reserveCards.find((card) => card.id === preferredCardId);
        if (!match) {
          return { value: 0, card: null };
        }
        chosenCard = match;
        bestValue = getSkillCardValue(chosenCard) ?? Number.NEGATIVE_INFINITY;
      } else {
        for (const candidate of reserveCards) {
          const value = getSkillCardValue(candidate) ?? Number.NEGATIVE_INFINITY;
          if (value > bestValue) {
            chosenCard = candidate;
            bestValue = value;
          }
        }
      }
      updateFighter(side, (prev) => {
        const hand = prev.hand.filter((card) => card.id !== chosenCard.id);
        const discard = [...prev.discard, chosenCard];
        return { ...prev, hand, discard };
      });
      const boostValue = getSkillCardValue(chosenCard) ?? 0;
      return { value: boostValue, card: chosenCard };
    },
    [getFighterSnapshot, updateFighter],
  );

  const canUseSkillAbility = useCallback(
    (side: LegacySide, laneIndex: number, ability: SkillAbility, state: SkillPhaseState): {
      ok: boolean;
      reason?: string;
    } => {
      const exhausted = state.exhausted[side][laneIndex];
      if (exhausted) {
        return { ok: false, reason: "Exhausted." };
      }
      const fighter = getFighterSnapshot(side);
      const reserveCards = fighter.hand;

      switch (ability) {
        case "swapReserve": {
          if (!reserveCards.length) {
            return { ok: false, reason: "No reserve cards." };
          }
          return { ok: true };
        }
        case "rerollReserve": {
          if (!reserveCards.length) {
            return { ok: false, reason: "Reserve is empty." };
          }
          return { ok: true };
        }
        case "boostCard": {
          const lane = side === "player" ? assignRef.current.player : assignRef.current.enemy;
          const source = lane[laneIndex];
          const boostValue = getSkillCardValue(source) ?? 0;
          if (boostValue <= 0) {
            return { ok: false, reason: "No boost value." };
          }
          const hasTarget = lane.some((card) => !!card);
          if (!hasTarget) {
            return { ok: false, reason: "No cards to boost." };
          }
          return { ok: true };
        }
        case "reserveBoost": {
          const hasReserveTarget = reserveCards.some((card) => isReserveBoostTarget(card));
          if (!hasReserveTarget) {
            return { ok: false, reason: "Need an eligible reserve card." };
          }
          return { ok: true };
        }
        default:
          return { ok: false };
      }
    },
    [getFighterSnapshot],
  );

  const computeSkillPhaseView = useCallback(
    (state: SkillPhaseState | null): SkillPhaseView | null => {
      if (!state) return null;
      const activeSide = state.activeSide;
      const options: SkillOption[] = [];
      if (activeSide === localLegacySide) {
        const lane = activeSide === "player" ? assignRef.current.player : assignRef.current.enemy;
        lane.forEach((card, laneIndex) => {
          if (!card) return;
          const ability = determineSkillAbility(card);
          if (!ability) return;
          const availability = canUseSkillAbility(activeSide, laneIndex, ability, state);
          options.push({
            lane: laneIndex,
            card,
            ability,
            description: describeSkillAbility(ability, card),
            canActivate: availability.ok,
            reason: availability.ok ? undefined : availability.reason,
          });
        });
      }
      return {
        activeSide,
        exhausted: state.exhausted,
        passed: state.passed,
        options,
      };
    },
    [assignRef, canUseSkillAbility, localLegacySide],
  );

  useEffect(() => {
    setSkillPhaseView(computeSkillPhaseView(skillState));
  }, [assign, player, enemy, skillState, computeSkillPhaseView]);

  useEffect(() => {
    if (!skillState || phaseRef.current !== "skill") {
      setSkillTargeting(null);
    }
  }, [skillState]);

  useEffect(() => {
    if (phase !== "skill") {
      setSkillTargeting(null);
    }
  }, [phase]);

  const hasSkillActions = useCallback(
    (side: LegacySide, state: SkillPhaseState): boolean => {
      if (state.passed[side]) return false;
      const lane = side === "player" ? assignRef.current.player : assignRef.current.enemy;
      for (let i = 0; i < lane.length; i++) {
        const card = lane[i];
        if (!card) continue;
        const ability = determineSkillAbility(card);
        if (!ability) continue;
        const availability = canUseSkillAbility(side, i, ability, state);
        if (availability.ok) {
          return true;
        }
      }
      return false;
    },
    [assignRef, canUseSkillAbility],
  );

  const finishSkillPhase = useCallback(() => {
    setSkillState(null);
    const nextPhase = postSkillPhaseRef.current ?? "roundEnd";
    postSkillPhaseRef.current = "roundEnd";
    setPhase(nextPhase);
    if (nextPhase === "ended") {
      clearRematchVotes();
    }
    reserveCycleCountsRef.current = { player: 0, enemy: 0 };
  }, [clearRematchVotes, setPhase]);

  const advanceSkillTurn = useCallback(
    (state: SkillPhaseState): SkillPhaseState | null => {
      const current = state.activeSide;
      const other: LegacySide = current === "player" ? "enemy" : "player";
      const currentHas = hasSkillActions(current, state);
      const otherHas = hasSkillActions(other, state);
      if (!currentHas && !otherHas) {
        finishSkillPhase();
        return null;
      }
      let nextSide: LegacySide;
      if (!currentHas && otherHas) {
        nextSide = other;
      } else if (currentHas && !otherHas) {
        nextSide = current;
      } else if (otherHas) {
        nextSide = other;
      } else {
        nextSide = current;
      }
      if (!hasSkillActions(nextSide, state)) {
        const fallback: LegacySide = nextSide === current ? other : current;
        if (hasSkillActions(fallback, state)) {
          nextSide = fallback;
        } else {
          finishSkillPhase();
          return null;
        }
      }
      if (nextSide !== state.activeSide) {
        return { ...state, activeSide: nextSide };
      }
      return state;
    },
    [finishSkillPhase, hasSkillActions],
  );

  const createInitialSkillExhausted = useCallback((): SideState<[boolean, boolean, boolean]> => {
    const playerFlags = assignRef.current.player.map((card) => !card || !determineSkillAbility(card)) as [
      boolean,
      boolean,
      boolean,
    ];
    const enemyFlags = assignRef.current.enemy.map((card) => !card || !determineSkillAbility(card)) as [
      boolean,
      boolean,
      boolean,
    ];
    return { player: playerFlags, enemy: enemyFlags };
  }, [assignRef]);

  const updateReservePreview = useCallback(() => {
    const playerReserve = computeReserveSum("player", assignRef.current.player);
    const enemyReserve = computeReserveSum("enemy", assignRef.current.enemy);
    setReserveSums({ player: playerReserve, enemy: enemyReserve });
  }, [setReserveSums]);

  const startSkillPhase = useCallback(
    (options?: { activeSide?: LegacySide }): boolean => {
      if (isMultiplayer) {
        setSkillState(null);
        return false;
      }

      const exhausted = createInitialSkillExhausted();
      const initialActive = options?.activeSide ?? initiative;
      const initialState: SkillPhaseState = {
        activeSide: initialActive,
        exhausted,
        passed: { player: false, enemy: false },
      };
      const currentHas = hasSkillActions(initialState.activeSide, initialState);
      const otherSide: LegacySide = initialState.activeSide === "player" ? "enemy" : "player";
      const otherHas = hasSkillActions(otherSide, initialState);
      if (!currentHas && !otherHas) {
        setSkillState(null);
        return false;
      }

      let nextState = initialState;
      if (!currentHas && otherHas) {
        nextState = { ...initialState, activeSide: otherSide };
      }

      reserveCycleCountsRef.current = { player: 0, enemy: 0 };
      updateReservePreview();
      setSkillState(nextState);
      setPhase("skill");
      return true;
    },
    [createInitialSkillExhausted, hasSkillActions, initiative, isMultiplayer, setPhase, updateReservePreview],
  );

  const activateSkillOption = useCallback(
    (laneIndex: number) => {
      setSkillState((prev) => {
        if (!prev) return prev;
        if (phaseRef.current !== "skill") return prev;
        if (skillTargetingRef.current) return prev;
        const side = prev.activeSide;
        const lane = side === "player" ? assignRef.current.player : assignRef.current.enemy;
        const card = lane[laneIndex];
        if (!card) return prev;
        const ability = determineSkillAbility(card);
        if (!ability) return prev;
        const availability = canUseSkillAbility(side, laneIndex, ability, prev);
        if (!availability.ok) return prev;

        const requiresReserveTarget =
          ability === "swapReserve" || ability === "reserveBoost" || ability === "rerollReserve";
        const requiresLaneTarget = ability === "boostCard";
        if (requiresReserveTarget && side === localLegacySide) {
          setSkillTargeting({ kind: "reserve", ability, side, laneIndex });
          return prev;
        }
        if (requiresLaneTarget && side === localLegacySide) {
          setSkillTargeting({ kind: "lane", ability: "boostCard", side, laneIndex });
          return prev;
        }

        let success = false;

        switch (ability) {
          case "swapReserve": {
            const result = swapCardWithReserve(side, laneIndex);
            if (result.swapped) {
              const incomingValue = getSkillCardValue(result.incoming) ?? 0;
              const outgoingValue = getSkillCardValue(result.outgoing) ?? 0;
              appendLog(
                `${namesByLegacy[side]} swapped a reserve card (${fmtNum(incomingValue)}) with ${fmtNum(outgoingValue)} in lane ${
                  laneIndex + 1
                }.`,
              );
              success = true;
            }
            break;
          }
          case "rerollReserve": {
            const { discarded, drawn } = rerollReserve(side);
            if (discarded) {
              const discardedName = discarded.name ?? fmtNum(discarded.number ?? 0);
              const drawnName = drawn ? drawn.name ?? fmtNum(drawn.number ?? 0) : null;
              const drawnSuffix = drawnName ? ` and drew ${drawnName}` : "";
              appendLog(`${namesByLegacy[side]} cycled ${discardedName}${drawnSuffix}.`);
              success = true;
            }
            break;
          }
          case "boostCard": {
            const currentCard = side === "player" ? assignRef.current.player[laneIndex] : assignRef.current.enemy[laneIndex];
            const value = currentCard ? getSkillCardValue(currentCard) ?? 0 : 0;
            if (value !== 0) {
              success = boostLaneCard(side, laneIndex, value);
            }
            if (success) {
              appendLog(
                `${namesByLegacy[side]} boosted lane ${laneIndex + 1} by ${fmtNum(value)} power.`,
              );
            }
            break;
          }
          case "reserveBoost": {
            const { value, card: reserveCard } = exhaustReserveForBoost(side);
            success = value > 0 ? boostLaneCard(side, laneIndex, value) : false;
            if (success) {
              appendLog(
                `${namesByLegacy[side]} exhausted ${reserveCard?.name ?? "a reserve"} for +${fmtNum(value)} power.`,
              );
            }
            break;
          }
          default:
            break;
        }

        if (!success) {
          return prev;
        }

        if (ability === "swapReserve" || ability === "rerollReserve" || ability === "reserveBoost") {
          updateReservePreview();
        }

        const updatedExhaustedSide = [...prev.exhausted[side]] as [boolean, boolean, boolean];
        updatedExhaustedSide[laneIndex] = true;
        let updatedState: SkillPhaseState = {
          ...prev,
          exhausted: { ...prev.exhausted, [side]: updatedExhaustedSide },
        };

        if (ability === "rerollReserve") {
          const currentCounts = reserveCycleCountsRef.current;
          const nextCount = (currentCounts[side] ?? 0) + 1;
          reserveCycleCountsRef.current = { ...currentCounts, [side]: nextCount };
          if (nextCount >= 2 && !prev.passed[side]) {
            appendLog(`${namesByLegacy[side]} passes their skill activations.`);
            updatedState = {
              ...updatedState,
              passed: { ...updatedState.passed, [side]: true },
            };
          }
        }

        const advanced = advanceSkillTurn(updatedState);
        return advanced ?? null;
      });
    },
    [
      advanceSkillTurn,
      appendLog,
      boostLaneCard,
      canUseSkillAbility,
      exhaustReserveForBoost,
      namesByLegacy,
      rerollReserve,
      swapCardWithReserve,
      updateReservePreview,
      localLegacySide,
    ],
  );

  const resolveSkillTargeting = useCallback(
    (selection: SkillTargetSelection) => {
      let completed = false;
      setSkillState((prev) => {
        if (!prev) return prev;
        if (phaseRef.current !== "skill") return prev;
        const targeting = skillTargetingRef.current;
        if (!targeting) return prev;
        if (targeting.side !== prev.activeSide) return prev;
        if (selection.kind !== targeting.kind) return prev;

        const side = targeting.side;
        const laneIndex = targeting.laneIndex;
        let success = false;

        switch (targeting.ability) {
          case "swapReserve": {
            const result = swapCardWithReserve(side, laneIndex, selection.cardId);
            if (result.swapped) {
              const incomingValue = getSkillCardValue(result.incoming) ?? 0;
              const outgoingValue = getSkillCardValue(result.outgoing) ?? 0;
              appendLog(
                `${namesByLegacy[side]} swapped a reserve card (${fmtNum(incomingValue)}) with ${fmtNum(outgoingValue)} in lane ${
                  laneIndex + 1
                }.`,
              );
              success = true;
            }
            break;
          }
          case "rerollReserve": {
            const { discarded, drawn } = rerollReserve(side, selection.cardId);
            if (discarded) {
              const discardedName = discarded.name ?? fmtNum(discarded.number ?? 0);
              const drawnName = drawn ? drawn.name ?? fmtNum(drawn.number ?? 0) : null;
              const drawnSuffix = drawnName ? ` and drew ${drawnName}` : "";
              appendLog(`${namesByLegacy[side]} cycled ${discardedName}${drawnSuffix}.`);
              success = true;
            }
            break;
          }
          case "reserveBoost": {
            const fighter = getFighterSnapshot(side);
            const candidate = fighter.hand.find((card) => card.id === selection.cardId);
            const candidateValue = candidate ? getSkillCardValue(candidate) ?? 0 : 0;
            if (candidateValue <= 0) {
              success = false;
              break;
            }
            const { value, card: reserveCard } = exhaustReserveForBoost(side, selection.cardId);
            success = value > 0 ? boostLaneCard(side, laneIndex, value) : false;
            if (success) {
              appendLog(
                `${namesByLegacy[side]} exhausted ${reserveCard?.name ?? "a reserve"} for +${fmtNum(value)} power.`,
              );
            }
            break;
          }
          case "boostCard": {
            if (selection.kind !== "lane") {
              success = false;
              break;
            }
            const lane = side === "player" ? assignRef.current.player : assignRef.current.enemy;
            const source = lane[laneIndex];
            const boostValue = source ? getSkillCardValue(source) ?? 0 : 0;
            if (boostValue <= 0) {
              success = false;
              break;
            }
            const targetLaneIndex = selection.laneIndex;
            const targetCard = lane[targetLaneIndex];
            if (!targetCard) {
              success = false;
              break;
            }
            success = boostLaneCard(side, targetLaneIndex, boostValue);
            if (success) {
              appendLog(
                `${namesByLegacy[side]} boosted lane ${targetLaneIndex + 1} by ${fmtNum(boostValue)} power.`,
              );
            }
            break;
          }
          default:
            break;
        }

        if (!success) {
          return prev;
        }

        if (
          targeting.ability === "swapReserve" ||
          targeting.ability === "reserveBoost" ||
          targeting.ability === "rerollReserve"
        ) {
          updateReservePreview();
        }

        const updatedExhaustedSide = [...prev.exhausted[side]] as [boolean, boolean, boolean];
        updatedExhaustedSide[laneIndex] = true;
        let updatedState: SkillPhaseState = {
          ...prev,
          exhausted: { ...prev.exhausted, [side]: updatedExhaustedSide },
        };

        if (targeting.ability === "rerollReserve") {
          const currentCounts = reserveCycleCountsRef.current;
          const nextCount = (currentCounts[side] ?? 0) + 1;
          reserveCycleCountsRef.current = { ...currentCounts, [side]: nextCount };
          if (nextCount >= 2 && !prev.passed[side]) {
            appendLog(`${namesByLegacy[side]} passes their skill activations.`);
            updatedState = {
              ...updatedState,
              passed: { ...updatedState.passed, [side]: true },
            };
          }
        }

        const advanced = advanceSkillTurn(updatedState);
        completed = true;
        return advanced ?? null;
      });

      if (completed) {
        setSkillTargeting(null);
      }
    },
    [
      advanceSkillTurn,
      appendLog,
      boostLaneCard,
      exhaustReserveForBoost,
      getFighterSnapshot,
      namesByLegacy,
      swapCardWithReserve,
      updateReservePreview,
    ],
  );

  const cancelSkillTargeting = useCallback(() => {
    setSkillTargeting(null);
  }, []);

  const passSkillTurn = useCallback(() => {
    setSkillState((prev) => {
      if (!prev) return prev;
      if (phaseRef.current !== "skill") return prev;
      const side = prev.activeSide;
      if (prev.passed[side]) return prev;
      appendLog(`${namesByLegacy[side]} passes their skill activations.`);
      const updatedState: SkillPhaseState = {
        ...prev,
        passed: { ...prev.passed, [side]: true },
      };
      if (reserveCycleCountsRef.current[side]) {
        reserveCycleCountsRef.current = { ...reserveCycleCountsRef.current, [side]: 0 };
      }
      const advanced = advanceSkillTurn(updatedState);
      return advanced ?? null;
    });
    setSkillTargeting(null);
  }, [advanceSkillTurn, appendLog, namesByLegacy]);

  useEffect(() => {
    if (!isSkillMode) return;
    if (isMultiplayer) return;
    if (phase !== "skill") return;
    if (!skillState) return;
    if (skillState.activeSide === localLegacySide) return;

    const side = skillState.activeSide;
    const opponentSide: LegacySide = side === "player" ? "enemy" : "player";
    const lane = side === "player" ? assignRef.current.player : assignRef.current.enemy;
    const opponentLane = opponentSide === "player" ? assignRef.current.player : assignRef.current.enemy;
    const fighter = getFighterSnapshot(side);
    const reserveCards = fighter.hand;

    const getCardPower = (card: Card | null | undefined): number => {
      if (!card) return 0;
      if (typeof card.number === "number") {
        return card.number;
      }
      return getSkillCardValue(card) ?? 0;
    };

    let highestReserveValue = Number.NEGATIVE_INFINITY;
    let lowestReserveValue = Number.POSITIVE_INFINITY;
    let bestPositiveReserve = Number.NEGATIVE_INFINITY;

    for (const reserve of reserveCards) {
      const value = getSkillCardValue(reserve);
      if (value === null) continue;
      if (value > highestReserveValue) {
        highestReserveValue = value;
      }
      if (value < lowestReserveValue) {
        lowestReserveValue = value;
      }
      if (value > 0 && value > bestPositiveReserve) {
        bestPositiveReserve = value;
      }
    }

    if (!Number.isFinite(highestReserveValue)) {
      highestReserveValue = Number.NEGATIVE_INFINITY;
    }
    if (!Number.isFinite(lowestReserveValue)) {
      lowestReserveValue = Number.POSITIVE_INFINITY;
    }
    if (!Number.isFinite(bestPositiveReserve)) {
      bestPositiveReserve = Number.NEGATIVE_INFINITY;
    }

    let targetLane = -1;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < lane.length; i++) {
      const card = lane[i];
      const ability = determineSkillAbility(card);
      if (!ability) continue;
      const availability = canUseSkillAbility(side, i, ability, skillState);
      if (!availability.ok) continue;

      const currentPower = getCardPower(card);
      const opposingPower = getCardPower(opponentLane[i]);

      let score = Number.NEGATIVE_INFINITY;

      switch (ability) {
        case "swapReserve": {
          if (highestReserveValue === Number.NEGATIVE_INFINITY) {
            score = Number.NEGATIVE_INFINITY;
            break;
          }
          const improvement = highestReserveValue - currentPower;
          if (improvement <= 0) {
            score = Number.NEGATIVE_INFINITY;
            break;
          }
          score = improvement;
          if (currentPower <= opposingPower && highestReserveValue > opposingPower) {
            score += highestReserveValue - opposingPower;
          }
          if (currentPower <= 0 && highestReserveValue > 0) {
            score += 1;
          }
          break;
        }
        case "rerollReserve": {
          if (lowestReserveValue === Number.POSITIVE_INFINITY) {
            score = Number.NEGATIVE_INFINITY;
            break;
          }
          const expectedGain = 3 - lowestReserveValue;
          if (expectedGain <= 0) {
            score = Number.NEGATIVE_INFINITY;
            break;
          }
          score = expectedGain;
          break;
        }
        case "boostCard": {
          const boostValue = getSkillCardValue(card) ?? 0;
          if (boostValue <= 0) {
            score = Number.NEGATIVE_INFINITY;
            break;
          }
          const boostedPower = currentPower + boostValue;
          score = boostValue;
          if (currentPower <= opposingPower && boostedPower > opposingPower) {
            score += boostedPower - opposingPower + 1;
          } else if (boostedPower > opposingPower) {
            score += 0.5;
          }
          break;
        }
        case "reserveBoost": {
          if (bestPositiveReserve === Number.NEGATIVE_INFINITY) {
            score = Number.NEGATIVE_INFINITY;
            break;
          }
          const boostedPower = currentPower + bestPositiveReserve;
          score = bestPositiveReserve;
          if (currentPower <= opposingPower && boostedPower > opposingPower) {
            score += boostedPower - opposingPower + 1.5;
          } else if (boostedPower > opposingPower) {
            score += 0.5;
          }
          break;
        }
        default:
          score = Number.NEGATIVE_INFINITY;
          break;
      }

      if (score > bestScore) {
        bestScore = score;
        targetLane = i;
      }
    }

    if (bestScore <= 0) {
      targetLane = -1;
    }

    const timeout = window.setTimeout(() => {
      if (phaseRef.current !== "skill") return;
      if (targetLane >= 0) activateSkillOption(targetLane);
      else passSkillTurn();
    }, 500);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    activateSkillOption,
    assignRef,
    canUseSkillAbility,
    getFighterSnapshot,
    isMultiplayer,
    isSkillMode,
    localLegacySide,
    passSkillTurn,
    phase,
    skillState,
  ]);

  useEffect(() => {
    return () => {
      if (spellHighlightTimeoutRef.current) {
        clearTimeout(spellHighlightTimeoutRef.current);
        spellHighlightTimeoutRef.current = null;
      }
    };
  }, []);

  const canReveal = useMemo(() => {
    const lane = localLegacySide === "player" ? assign.player : assign.enemy;
    return lane.every((c, i) => !active[i] || !!c);
  }, [assign, active, localLegacySide]);

  const wheelRefs = [
    useRef<WheelHandle | null>(null),
    useRef<WheelHandle | null>(null),
    useRef<WheelHandle | null>(null),
  ];

  const assignToWheelFor = useCallback(
    (side: LegacySide, laneIndex: number, card: Card) => {
      if (phaseRef.current !== "choose") return false;
      if (!active[laneIndex]) return false;

      const lane = side === "player" ? assignRef.current.player : assignRef.current.enemy;
      const prevAtLane = lane[laneIndex];
      const fromIdx = lane.findIndex((c) => c?.id === card.id);
      const chillStacks = side === "player" ? laneChillRef.current.player : laneChillRef.current.enemy;

      if (chillStacks[laneIndex] > 0 && prevAtLane && prevAtLane.id !== card.id) {
        return false;
      }
      if (fromIdx !== -1 && chillStacks[fromIdx] > 0 && fromIdx !== laneIndex) {
        return false;
      }
      if (chillStacks[laneIndex] > 0 && !prevAtLane) {
        return false;
      }

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
          if (existingIdx !== -1) {
            const stacks = chillStacks[existingIdx] ?? 0;
            if (stacks > 0) return prev;
            nextLane[existingIdx] = null;
          }
          nextLane[laneIndex] = card;
          return isPlayer ? { ...prev, player: nextLane } : { ...prev, enemy: nextLane };
        });

        if (isPlayer) {
          setPlayer((p) => {
            let hand = p.hand.filter((c) => c.id !== card.id);
            if (prevAtLane && prevAtLane.id !== card.id && !hand.some((c) => c.id === prevAtLane.id)) {
              hand = [...hand, prevAtLane];
            }
            return { ...p, hand };
          });
        } else {
          setEnemy((e) => {
            let hand = e.hand.filter((c) => c.id !== card.id);
            if (prevAtLane && prevAtLane.id !== card.id && !hand.some((c) => c.id === prevAtLane.id)) {
              hand = [...hand, prevAtLane];
            }
            return { ...e, hand };
          });
        }
      });

      clearResolveVotes(side);

      return true;
    },
    [active, clearResolveVotes, laneChillRef, localLegacySide]
  );

  const clearAssignFor = useCallback(
    (side: LegacySide, laneIndex: number) => {
      if (phaseRef.current !== "choose") return false;
      const lane = side === "player" ? assignRef.current.player : assignRef.current.enemy;
      const prev = lane[laneIndex];
      if (!prev) return false;
      const chillStacks = side === "player" ? laneChillRef.current.player : laneChillRef.current.enemy;
      if (chillStacks[laneIndex] > 0) {
        return false;
      }

      startTransition(() => {
        setAssign((prevAssign) => {
          const laneArr = side === "player" ? prevAssign.player : prevAssign.enemy;
          const nextLane = [...laneArr];
          nextLane[laneIndex] = null;
          return side === "player" ? { ...prevAssign, player: nextLane } : { ...prevAssign, enemy: nextLane };
        });

        if (side === "player") {
          setPlayer((p) => {
            if (p.hand.some((c) => c.id === prev.id)) return p;
            return { ...p, hand: [...p.hand, prev] };
          });
        } else {
          setEnemy((e) => {
            if (e.hand.some((c) => c.id === prev.id)) return e;
            return { ...e, hand: [...e.hand, prev] };
          });
        }

        if (side === localLegacySide) {
          setSelectedCardId((sel) => (sel === prev.id ? null : sel));
        }
      });

      clearResolveVotes(side);

      return true;
    },
    [clearResolveVotes, laneChillRef, localLegacySide]
  );

  const assignToWheelLocal = useCallback(
    (i: number, card: Card) => {
      const changed = assignToWheelFor(localLegacySide, i, card);
      if (changed && isMultiplayer) {
        sendIntent({ type: "assign", lane: i, side: localLegacySide, card });
      }
    },
    [assignToWheelFor, isMultiplayer, localLegacySide, sendIntent]
  );

 function autoPickEnemy(): (Card | null)[] {
    const hand = [...enemy.hand].filter(isNormal);
    const picks: (Card | null)[] = [null, null, null];
    const take = (c: typeof hand[number]) => {
      const k = hand.indexOf(c);
      if (k >= 0) hand.splice(k, 1);
      return c;
    };
    const best = [...hand].sort((a, b) => b.number - a.number)[0];
    if (best) picks[0] = take(best);
    const low = [...hand].sort((a, b) => a.number - b.number)[0];
    if (low) picks[1] = take(low);
    const sorted = [...hand].sort((a, b) => a.number - b.number);
    const mid = sorted[Math.floor(sorted.length / 2)];
    if (mid) picks[2] = take(mid);
    for (let i = 0; i < 3; i++) if (!picks[i] && hand.length) picks[i] = take(hand[0]);
    return picks;
  }

  function computeReserveSum(who: LegacySide, used: (Card | null)[]) {
    const handCards = who === "player" ? player.hand : enemy.hand;
    const usedIds = new Set((used.filter(Boolean) as Card[]).map((c) => c.id));
    const left = handCards.filter((c) => !usedIds.has(c.id));
    const base = left.slice(0, 2).reduce((a, c) => a + (isNormal(c) ? c.number : 0), 0);
    const penalty = reservePenaltiesRef.current[who] ?? 0;
    return Math.max(0, base - penalty);
  }

  const modSlice = (value: number) => ((value % SLICES) + SLICES) % SLICES;

  const cardWheelValue = (card: Card | null) => {
    if (!card) return 0;
    if (typeof card.number === "number" && Number.isFinite(card.number)) return card.number;
    if (typeof card.leftValue === "number" && Number.isFinite(card.leftValue)) return card.leftValue;
    if (typeof card.rightValue === "number" && Number.isFinite(card.rightValue)) return card.rightValue;
    return 0;
  };

  function analyzeRound(played: { p: Card | null; e: Card | null }[]): RoundAnalysis {
    const localPlayed =
      localLegacySide === "player" ? played.map((pe) => pe.p) : played.map((pe) => pe.e);
    const remotePlayed =
      localLegacySide === "player" ? played.map((pe) => pe.e) : played.map((pe) => pe.p);

    const localReport = reserveReportsRef.current[localLegacySide];
    const localReserve =
      localReport && localReport.round === round
        ? localReport.reserve
        : computeReserveSum(localLegacySide, localPlayed);
    let remoteReserve: number;
    let usedRemoteReport = false;

    if (isMultiplayer) {
      const report = reserveReportsRef.current[remoteLegacySide];
      if (report && report.round === round) {
        remoteReserve = report.reserve;
        usedRemoteReport = true;
      } else {
        remoteReserve = computeReserveSum(remoteLegacySide, remotePlayed);
      }
    } else {
      remoteReserve = computeReserveSum(remoteLegacySide, remotePlayed);
    }

    const pReserve = localLegacySide === "player" ? localReserve : remoteReserve;
    const eReserve = localLegacySide === "enemy" ? localReserve : remoteReserve;

    const outcomes: WheelOutcome[] = [];
    const tokensSnapshot =
      roundStartTokensRef.current ?? tokensRef.current ?? tokens;

    for (let w = 0; w < 3; w++) {
      const secList = wheelSections[w];
      const baseP = cardWheelValue(played[w].p ?? null);
      const baseE = cardWheelValue(played[w].e ?? null);
      const steps = modSlice(modSlice(baseP) + modSlice(baseE));
      const startToken = tokensSnapshot[w] ?? 0;
      const targetSlice = (startToken + steps) % SLICES;
      const section =
        secList.find((s) => targetSlice !== 0 && inSection(targetSlice, s)) ||
        ({ id: "Strongest", color: "transparent", start: 0, end: 0 } as Section);

      const pVal = baseP;
      const eVal = baseE;
      let winner: LegacySide | null = null;
      let tie = false;
      let detail = "";
      if (targetSlice === 0) {
        tie = true;
        detail = "Slice 0: no win";
      } else {
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
            const t = targetSlice === 0 ? section.target ?? 0 : targetSlice;
            const pd = Math.abs(pVal - t);
            const ed = Math.abs(eVal - t);
            if (pd === ed) tie = true;
            else winner = pd < ed ? "player" : "enemy";
            detail = `Closest to ${t}: ${pVal} vs ${eVal}`;
            break;
          }
          case "Initiative":
            winner = initiative;
            detail = `Initiative -> ${winner}`;
            break;
          default:
            tie = true;
            detail = `Slice 0: no section`;
            break;
        }
      }
      outcomes.push({ steps, targetSlice, section, winner, tie, wheel: w, detail });
    }

    return { outcomes, localReserve, remoteReserve, pReserve, eReserve, usedRemoteReport };
  }

  const broadcastLocalReserve = useCallback(() => {
    const lane = localLegacySide === "player" ? assignRef.current.player : assignRef.current.enemy;
    const reserve = computeReserveSum(localLegacySide, lane);
    const updated = storeReserveReport(localLegacySide, reserve, round);
    if (isMultiplayer && updated) {
      sendIntent({ type: "reserve", side: localLegacySide, reserve, round });
    }
  }, [isMultiplayer, localLegacySide, round, sendIntent, storeReserveReport]);

  useEffect(() => {
    broadcastLocalReserve();
  }, [broadcastLocalReserve, assign, player, enemy, localLegacySide, round, isMultiplayer]);

  const applySpellEffects = useCallback(
    (payload: SpellEffectPayload, options?: { broadcast?: boolean }) => {
      let latestAssignments: AssignmentState<Card> = assignRef.current;
      let snapshotTokens: [number, number, number] =
        roundStartTokensRef.current ?? (tokensRef.current ?? tokens);
      let assignmentsChanged = false;
      let tokensAdjusted = false;

      const affectedCardIds = new Set<string>();
      const affectedReserveSides = new Set<LegacySide>();

      const noteCardId = (value?: string | null) => {
        if (typeof value === "string" && value.length > 0) {
          affectedCardIds.add(value);
        }
      };

      const noteReserveSide = (side?: LegacySide | null) => {
        if (side === "player" || side === "enemy") {
          affectedReserveSides.add(side);
        }
      };

      payload.cardAdjustments?.forEach((adj) => noteCardId(adj?.cardId));
      payload.chilledCards?.forEach((entry) => noteCardId(entry?.cardId));
      payload.handAdjustments?.forEach((entry) => noteCardId(entry?.cardId));
      payload.handDiscards?.forEach((entry) => noteCardId(entry?.cardId));
      payload.initiativeChallenges?.forEach((entry) => noteCardId(entry?.cardId));
      payload.mirrorCopyEffects?.forEach((entry) => noteCardId(entry?.targetCardId));
      payload.reserveDrains?.forEach((entry) => noteReserveSide(entry?.side));

      runSpellEffects(
        payload,
        {
          assignSnapshot: assignRef.current,
          updateAssignments: (updater) => {
            setAssign((prev) => {
              const next = updater(prev);
              if (next !== prev) assignmentsChanged = true;
              assignRef.current = next;
              latestAssignments = next;
              return next;
            });
          },
          updateReserveSums: setReserveSums,
          updateTokens: (updater) => {
            setTokens((prev) => {
              const next = updater(prev);
              if (next !== prev) tokensAdjusted = true;
              tokensRef.current = next;
              roundStartTokensRef.current = next;
              snapshotTokens = next;
              return next;
            });
          },
          updateLaneChillStacks: setLaneChillStacks,
          setInitiative,
          appendLog,
          initiative,
          isMultiplayer,
          broadcastEffects: (outgoing) => {
            sendIntent({ type: "spellEffects", payload: outgoing });
          },
          updateTokenVisual: (index, value) => {
            wheelRefs[index]?.current?.setVisualToken?.(value);
          },
          applyReservePenalty,
          startingTokens: roundStartTokensRef.current ?? (tokensRef.current ?? tokens),
          updateRoundStartTokens: (nextTokens) => {
            roundStartTokensRef.current = nextTokens;
            snapshotTokens = nextTokens;
            tokensAdjusted = true;
          },
          updateFighter: (side, updater) => {
            if (side === "player") {
              setPlayer((prev) => {
                const next = updater(prev);
                playerRef.current = next;
                return next;
              });
            } else {
              setEnemy((prev) => {
                const next = updater(prev);
                enemyRef.current = next;
                return next;
              });
            }
          },
        },
        options,
      );

      if (assignmentsChanged && !tokensAdjusted) {
        for (let i = 0; i < 3; i++) {
          const laneTotal = modSlice(
            modSlice(cardWheelValue(latestAssignments.player[i] as Card | null)) +
              modSlice(cardWheelValue(latestAssignments.enemy[i] as Card | null)),
          );
          wheelRefs[i]?.current?.setVisualToken?.(laneTotal);
        }
      }

      if (affectedCardIds.size > 0 || affectedReserveSides.size > 0) {
        flashSpellHighlights(affectedCardIds, affectedReserveSides);
      }

      if (phaseRef.current === "anim" || phaseRef.current === "roundEnd") {
        resolveRound(undefined, {
          skipAnimation: true,
          snapshot: { assign: latestAssignments, tokens: snapshotTokens },
        });
      }
    },
    [
      appendLog,
      initiative,
      isMultiplayer,
      sendIntent,
      setAssign,
      setReserveSums,
      setTokens,
      setLaneChillStacks,
      setInitiative,
      applyReservePenalty,
      resolveRound,
      wheelRefs,
      tokens,
      flashSpellHighlights,
    ],
  );

  function settleFighterAfterRound(f: Fighter, played: Card[]): Fighter {
    const playedIds = new Set(played.map((c) => c.id));
    const leftovers = f.hand.filter((c) => !playedIds.has(c.id));
    const next: Fighter = {
      name: f.name,
      deck: [...f.deck],
      hand: [],
      discard: [...f.discard, ...played, ...leftovers],
    };

    const refilled = refillTo(next, 5);

    return ensureFiveHand(refilled, 5);
  }

  function ensureFiveHand<T extends Fighter>(f: T, TARGET = 5): T {
    if (f.hand.length >= TARGET) return f;

    const padded = [...f.hand];
    while (padded.length < TARGET) {
      padded.push({
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `pad-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: "Reserve",
        number: 0,
        baseNumber: 0,
        kind: "normal",
      } as unknown as Card);
    }
    return { ...f, hand: padded } as T;
  }

  const revealRoundCore = useCallback(
    (opts?: { force?: boolean }) => {
      if (!opts?.force && !canReveal) return false;

      if (isMultiplayer) {
        broadcastLocalReserve();
      }

      setLockedWheelSize((s) => s ?? wheelSize);
      setFreezeLayout(true);

      let enemyPicks: (Card | null)[];

      if (isMultiplayer) {
        enemyPicks = [...assignRef.current.enemy];
      } else {
        enemyPicks = autoPickEnemy();
        if (enemyPicks.some(Boolean)) {
          const pickIds = new Set((enemyPicks.filter(Boolean) as Card[]).map((c) => c.id));
          setEnemy((prev) => ({
            ...prev,
            hand: prev.hand.filter((card) => !pickIds.has(card.id)),
          }));
        }
        setAssign((a) => ({ ...a, enemy: enemyPicks }));
      }

      setPhase("showEnemy");
      setSafeTimeout(() => {
        if (!mountedRef.current) return;
        setPhase("anim");
        resolveRound(enemyPicks);
      }, 600);

      return true;
    },
    [broadcastLocalReserve, canReveal, isMultiplayer, wheelSize]
  );

  const onReveal = useCallback(() => {
    revealRoundCore();
  }, [revealRoundCore]);

  const attemptAutoReveal = useCallback(() => {
    if (!isMultiplayer) return;
    if (phase !== "choose") return;
    if (!canReveal) return;
    const votes = resolveVotesRef.current;
    if (!votes.player || !votes.enemy) return;
    revealRoundCore();
  }, [canReveal, isMultiplayer, phase, revealRoundCore]);

  useEffect(() => {
    attemptAutoReveal();
  }, [attemptAutoReveal, resolveVotes]);

  function resolveRound(
    enemyPicks?: (Card | null)[],
    options?: {
      skipAnimation?: boolean;
      snapshot?: { assign: AssignmentState<Card>; tokens: [number, number, number] };
    },
  ) {
    const currentAssign = options?.snapshot?.assign ?? assignRef.current;
    const startingTokens =
      options?.snapshot?.tokens ??
      roundStartTokensRef.current ??
      (tokensRef.current ?? tokens);
    roundStartTokensRef.current = startingTokens;
    const played = [0, 1, 2].map((i) => ({
      p: currentAssign.player[i] as Card | null,
      e: (enemyPicks?.[i] ?? currentAssign.enemy[i]) as Card | null,
    }));

    const analysis = analyzeRound(played);
    roundAnalysisRef.current = analysis;

    storeReserveReport(localLegacySide, analysis.localReserve, round);
    if (!isMultiplayer || !analysis.usedRemoteReport) {
      storeReserveReport(remoteLegacySide, analysis.remoteReserve, round);
    }

    const applyRoundOutcome = (
      finalAnalysis: RoundAnalysis,
      finalTokens: [number, number, number],
    ) => {
      tokensRef.current = finalTokens;
      setTokens(finalTokens);
      finalTokens.forEach((value, index) => {
        wheelRefs[index]?.current?.setVisualToken?.(value);
      });

      const summary = summarizeRoundOutcome({
        analysis: finalAnalysis,
        wins,
        initiative,
        round,
        namesByLegacy,
        HUD_COLORS,
        isAnteMode,
        anteState: anteStateRef.current,
        winGoal,
        localLegacySide,
        remoteLegacySide,
      });

      const skillStartSide = initiative;
      setInitiative(summary.nextInitiative);
      summary.logs.forEach((entry) => {
        appendLog(entry);
      });

      setWheelHUD(summary.hudColors);
      pendingWinsRef.current = summary.wins;
      if (summary.matchEnded) {
        commitPendingWins();
      }
      setReserveSums({ player: finalAnalysis.pReserve, enemy: finalAnalysis.eReserve });

      if (summary.shouldResetAnte) {
        setAnteState((prev) => {
          if (prev.round !== round) return prev;
          if (prev.bets.player === 0 && prev.bets.enemy === 0) return prev;
          return { ...prev, bets: { player: 0, enemy: 0 } };
        });
      }

      clearAdvanceVotes();

      if (summary.matchEnded) {
        clearRematchVotes();
        setPhase("ended");
        return;
      }

      if (isSkillMode) {
        postSkillPhaseRef.current = "roundEnd";
        const started = startSkillPhase({ activeSide: skillStartSide });
        if (started) {
          return;
        }
      }

      setPhase("roundEnd");
    };

    if (options?.skipAnimation) {
      const finalAnalysis = roundAnalysisRef.current ?? analysis;
      const finalTokens = [...startingTokens] as [number, number, number];
      finalAnalysis.outcomes.forEach((outcome) => {
        if (outcome.steps > 0) {
          finalTokens[outcome.wheel] = (finalTokens[outcome.wheel] + outcome.steps) % SLICES;
        }
      });
      applyRoundOutcome(finalAnalysis, finalTokens);
      return;
    }

    const animateSpins = async () => {
      let finalTokens = [...(tokensRef.current ?? tokens)] as [number, number, number];

      for (let w = 0; w < 3; w++) {
        const latestAnalysis = roundAnalysisRef.current ?? analysis;
        const outcome = latestAnalysis.outcomes.find((entry) => entry.wheel === w);
        if (!outcome) continue;
        const start = finalTokens[w];
        const steps = outcome.steps;
        if (steps <= 0) continue;
        const total = Math.max(220, Math.min(1000, 110 + 70 * steps));
        const t0 = performance.now();
        await new Promise<void>((resolve) => {
          const frame = (now: number) => {
            if (!mountedRef.current) return resolve();
            const tt = Math.max(0, Math.min(1, (now - t0) / total));
            const progressed = Math.floor(easeInOutCubic(tt) * steps);
            wheelRefs[w].current?.setVisualToken((start + progressed) % SLICES);
            if (tt < 1) requestAnimationFrame(frame);
            else {
              wheelRefs[w].current?.setVisualToken((start + steps) % SLICES);
              resolve();
            }
          };
          requestAnimationFrame(frame);
        });
        finalTokens[w] = (start + steps) % SLICES;
        await new Promise((r) => setTimeout(r, 90));
      }

      if (!mountedRef.current) return;

      const finalAnalysis = roundAnalysisRef.current ?? analysis;
      applyRoundOutcome(finalAnalysis, finalTokens);
    };

    void animateSpins();
  }


  const nextRoundCore = useCallback(
    (opts?: { force?: boolean }) => {
      const allow = opts?.force || phase === "roundEnd";
      if (!allow) return false;

      commitPendingWins();

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
      setLaneChillStacks({ player: [0, 0, 0], enemy: [0, 0, 0] });

      setSelectedCardId(null);
      setDragCardId(null);
      setDragOverWheel(null);
      setTokens([0, 0, 0]);
      roundStartTokensRef.current = [0, 0, 0];
      setReserveSums(null);
      setWheelHUD([null, null, null]);
      reservePenaltiesRef.current = { player: 0, enemy: 0 };
      reserveReportsRef.current = { player: null, enemy: null };
      setSkillState(null);

      setPhase("choose");
      setRound((r) => r + 1);

      return true;
    },
    [
      clearResolveVotes,
      clearAdvanceVotes,
      commitPendingWins,
      generateWheelSet,
      phase,
      setDragOverWheel,
    ]
  );

  const nextRound = useCallback(() => nextRoundCore({ force: true }), [nextRoundCore]);

  const handleMPIntent = useCallback(
    (msg: MPIntent, senderId?: string) => {
      switch (msg.type) {
        case "assign": {
          if (senderId && senderId === localPlayerId) break;
          assignToWheelFor(msg.side, msg.lane, msg.card);
          break;
        }
        case "clear": {
          if (senderId && senderId === localPlayerId) break;
          clearAssignFor(msg.side, msg.lane);
          break;
        }
        case "reveal": {
          if (senderId && senderId === localPlayerId) break;
          markResolveVote(msg.side);
          setTimeout(() => {
            attemptAutoReveal();
          }, 0);
          break;
        }
        case "nextRound": {
          if (senderId && senderId === localPlayerId) break;
          markAdvanceVote(msg.side);
          break;
        }
        case "ante": {
          if (!isAnteMode) break;
          if (typeof msg.round !== "number") break;
          if (roundRef.current !== msg.round) break;
          const clamped = clampAnteValue(msg.side, msg.bet);
          setAnteState((prev) => {
            if (prev.round !== msg.round) {
              return {
                round: msg.round,
                bets: { ...prev.bets, [msg.side]: clamped },
                odds: calculateAnteOdds({ wins, winGoal, initiative }),
              };
            }
            if (prev.bets[msg.side] === clamped) return prev;
            return { ...prev, bets: { ...prev.bets, [msg.side]: clamped } };
          });
          break;
        }
        case "rematch": {
          if (senderId && senderId === localPlayerId) break;
          markRematchVote(msg.side);
          break;
        }
        case "reserve": {
          if (senderId && senderId === localPlayerId) break;
          if (typeof msg.reserve === "number" && typeof msg.round === "number") {
            storeReserveReport(msg.side, msg.reserve, msg.round);
          }
          break;
        }
        case "spellEffects": {
          if (senderId && senderId === localPlayerId) break;
          applySpellEffects(msg.payload, { broadcast: false });
          break;
        }
        default:
          break;
      }
    },
    [
      assignToWheelFor,
      clearAssignFor,
      localPlayerId,
      markAdvanceVote,
      markRematchVote,
      markResolveVote,
      attemptAutoReveal,
      applySpellEffects,
      storeReserveReport,
    ]
  );

  useEffect(() => {
    handleMPIntentRef.current = handleMPIntent;
  }, [handleMPIntent]);

  useEffect(() => {
    if (!roomCode) {
      try {
        chanRef.current?.unsubscribe();
      } catch {}
      try {
        chanRef.current?.detach();
      } catch {}
      chanRef.current = null;
      if (ablyRef.current) {
        try {
          ablyRef.current.close();
        } catch {}
        ablyRef.current = null;
      }
      return;
    }

    const key = import.meta.env.VITE_ABLY_API_KEY;
    if (!key) return;

    const ably = new Realtime({ key, clientId: localPlayerId });
    ablyRef.current = ably;
    const channel = ably.channels.get(`rw:v1:rooms:${roomCode}`);
    chanRef.current = channel;

    let activeSub = true;

    (async () => {
      try {
        await channel.attach();
        channel.subscribe("intent", (msg) => {
          if (!activeSub) return;
          const intent = msg?.data as MPIntent;
          const sender = typeof msg?.clientId === "string" ? msg.clientId : undefined;
          handleMPIntentRef.current(intent, sender);
        });
      } catch {}
    })();

    return () => {
      activeSub = false;
      try {
        channel.unsubscribe();
      } catch {}
      try {
        channel.detach();
      } catch {}
      try {
        ably.close();
      } catch {}
      if (chanRef.current === channel) {
        chanRef.current = null;
      }
      if (ablyRef.current === ably) {
        ablyRef.current = null;
      }
    };
    // handleMPIntent is intentionally omitted: handleMPIntentRef keeps the latest callback.
  }, [roomCode, localPlayerId]);

  const handleRevealClick = useCallback(() => {
    if (phase !== "choose" || !canReveal) return;

    if (!isMultiplayer) {
      onReveal();
      return;
    }

    markResolveVote(localLegacySide);
    sendIntent({ type: "reveal", side: localLegacySide });
    setTimeout(() => {
      attemptAutoReveal();
    }, 0);
  }, [
    attemptAutoReveal,
    canReveal,
    isMultiplayer,
    localLegacySide,
    markResolveVote,
    onReveal,
    phase,
    resolveVotes,
    sendIntent,
  ]);

  const handleNextClick = useCallback(() => {
    if (phase === "skill") {
      if (skillStateRef.current?.activeSide === localLegacySide) {
        passSkillTurn();
      }
      return;
    }

    if (phase !== "roundEnd") return;

    if (!isMultiplayer) {
      nextRound();
      return;
    }

    if (advanceVotes[localLegacySide]) return;

    markAdvanceVote(localLegacySide);
    sendIntent({ type: "nextRound", side: localLegacySide });
  }, [
    advanceVotes,
    isMultiplayer,
    localLegacySide,
    markAdvanceVote,
    nextRound,
    passSkillTurn,
    phase,
    sendIntent,
    skillStateRef,
  ]);

  useEffect(() => {
    if (!isMultiplayer) return;
    if (phase !== "roundEnd") return;
    if (!advanceVotes.player || !advanceVotes.enemy) return;
    nextRound();
  }, [advanceVotes, isMultiplayer, nextRound, phase]);

  const resetMatch = useCallback(() => {
    clearResolveVotes();
    clearAdvanceVotes();
    clearRematchVotes();

    reserveReportsRef.current = { player: null, enemy: null };
    reservePenaltiesRef.current = { player: 0, enemy: 0 };

    wheelRefs.forEach((ref) => ref.current?.setVisualToken(0));

    setFreezeLayout(false);
    setLockedWheelSize(null);

    setPlayer(() => makeFighter(playerName));
    setEnemy(() => makeFighter(enemyName));

    setInitiative(hostId ? hostLegacySide : localLegacySide);

    setWins({ player: 0, enemy: 0 });
    pendingWinsRef.current = null;
    setRound(1);
    setAnteState({ round: 0, bets: { player: 0, enemy: 0 }, odds: { player: 1.2, enemy: 1.2 } });
    setPhase("choose");

    const emptyAssign: { player: (Card | null)[]; enemy: (Card | null)[] } = {
      player: [null, null, null],
      enemy: [null, null, null],
    };
    assignRef.current = emptyAssign;
    setAssign(emptyAssign);
    setLaneChillStacks({ player: [0, 0, 0], enemy: [0, 0, 0] });

    setSelectedCardId(null);
    setDragCardId(null);
    dragOverRef.current = null;
    _setDragOverWheel(null);

    setTokens([0, 0, 0]);
    setReserveSums(null);
    setWheelHUD([null, null, null]);
    setSkillState(null);

    setLog([createLogEntry(START_LOG)]);

    wheelRngRef.current = createSeededRng(seed);
    setWheelSections(generateWheelSet());
  }, [
    clearAdvanceVotes,
    clearRematchVotes,
    clearResolveVotes,
    generateWheelSet,
    hostId,
    enemyName,
    hostLegacySide,
    localLegacySide,
    playerName,
    seed,
    setAssign,
    setDragCardId,
    setEnemy,
    setFreezeLayout,
    setInitiative,
    setLockedWheelSize,
    setLog,
    setPhase,
    setPlayer,
    setReserveSums,
    setRound,
    setSelectedCardId,
    setTokens,
    setWheelHUD,
    setWheelSections,
    setWins,
    _setDragOverWheel,
    wheelRefs,
  ]);

  useEffect(() => {
    if (!isMultiplayer) return;
    if (phase !== "ended") return;
    if (!rematchVotes.player || !rematchVotes.enemy) return;
    resetMatch();
  }, [isMultiplayer, phase, rematchVotes, resetMatch]);

  const handleRematchClick = useCallback(() => {
    if (phase !== "ended") return;

    if (!isMultiplayer) {
      resetMatch();
      return;
    }

    if (rematchVotes[localLegacySide]) return;

    markRematchVote(localLegacySide);
    sendIntent({ type: "rematch", side: localLegacySide });
  }, [isMultiplayer, localLegacySide, markRematchVote, phase, rematchVotes, resetMatch, sendIntent]);

  const setAnteBet = useCallback(
    (bet: number) => {
      if (!isAnteMode) return;
      if (phase !== "choose") return;

      const clamped = clampAnteValue(localLegacySide, bet);
      const prevBet = anteStateRef.current.bets[localLegacySide];
      if (prevBet === clamped) return;

      setAnteState((prev) => {
        if (prev.round !== round) return prev;
        return { ...prev, bets: { ...prev.bets, [localLegacySide]: clamped } };
      });

      if (isMultiplayer) {
        sendIntent({ type: "ante", side: localLegacySide, bet: clamped, round });
      }
    },
    [clampAnteValue, isAnteMode, isMultiplayer, localLegacySide, phase, round, sendIntent]
  );

  const handleExitClick = useCallback(() => {
    onExit?.();
  }, [onExit]);

  const startPointerDrag = useCallback(
    (card: Card, e: ReactPointerEvent) => {
      if (phaseRef.current !== "choose") return;
      if (e.pointerType === "mouse") return;
      if (e.pointerType === "touch") return;
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setSelectedCardId(card.id);
      setDragCardId(card.id);
      setPtrDragCard(card);
      setIsPtrDragging(true);
      setPtrDragType("pointer");
      addTouchDragCss(true);
      ptrPos.current = { x: e.clientX, y: e.clientY };

      const onMove = (ev: PointerEvent) => {
        ptrPos.current = { x: ev.clientX, y: ev.clientY };
        const t = getDropTargetAt(ev.clientX, ev.clientY);
        setDragOverWheel(t && (t.kind === "wheel" || t.kind === "slot") ? t.idx : null);
        ev.preventDefault?.();
      };

      const onUp = (ev: PointerEvent) => {
        const t = getDropTargetAt(ev.clientX, ev.clientY);
        if (t && active[t.idx]) {
          assignToWheelLocal(t.idx, card);
        }
        cleanup();
      };

      const onCancel = () => cleanup();

      function cleanup() {
        window.removeEventListener("pointermove", onMove, { capture: true } as any);
        window.removeEventListener("pointerup", onUp, { capture: true } as any);
        window.removeEventListener("pointercancel", onCancel, { capture: true } as any);
        setIsPtrDragging(false);
        setPtrDragCard(null);
        setDragOverWheel(null);
        setDragCardId(null);
        setPtrDragType(null);
        addTouchDragCss(false);
      }

      window.addEventListener("pointermove", onMove, { passive: false, capture: true });
      window.addEventListener("pointerup", onUp, { passive: false, capture: true });
      window.addEventListener("pointercancel", onCancel, { passive: false, capture: true });
    },
    [active, addTouchDragCss, assignToWheelLocal, getDropTargetAt, setDragOverWheel]
  );

  const startTouchDrag = useCallback(
    (card: Card, e: ReactTouchEvent<HTMLButtonElement>) => {
      if (phaseRef.current !== "choose") return;
      if (e.touches.length === 0) return;

      const touch = e.touches[0];
      const identifier = touch.identifier;

      const updatePosition = (clientX: number, clientY: number) => {
        ptrPos.current = { x: clientX, y: clientY };
        const t = getDropTargetAt(clientX, clientY);
        setDragOverWheel(t && (t.kind === "wheel" || t.kind === "slot") ? t.idx : null);
      };

      const getTouchById = (list: TouchList) => {
        for (let i = 0; i < list.length; i++) {
          const item = list.item(i);
          if (item && item.identifier === identifier) return item;
        }
        return null;
      };

      e.stopPropagation();
      e.preventDefault();

      setSelectedCardId(card.id);
      setDragCardId(card.id);
      setPtrDragCard(card);
      setIsPtrDragging(true);
      setPtrDragType("touch");
      addTouchDragCss(true);
      updatePosition(touch.clientX, touch.clientY);

      const onMove = (ev: TouchEvent) => {
        const next = getTouchById(ev.touches);
        if (!next) return;
        updatePosition(next.clientX, next.clientY);
        ev.preventDefault();
      };

      const onEnd = (ev: TouchEvent) => {
        const ended = getTouchById(ev.changedTouches);
        if (!ended) return;
        const t = getDropTargetAt(ended.clientX, ended.clientY);
        if (t && active[t.idx]) {
          assignToWheelLocal(t.idx, card);
        }
        cleanup();
      };

      const onCancel = () => cleanup();

      function cleanup() {
        window.removeEventListener("touchmove", onMove, { capture: true } as any);
        window.removeEventListener("touchend", onEnd, { capture: true } as any);
        window.removeEventListener("touchcancel", onCancel, { capture: true } as any);
        setIsPtrDragging(false);
        setPtrDragCard(null);
        setDragOverWheel(null);
        setDragCardId(null);
        setPtrDragType(null);
        addTouchDragCss(false);
      }

      window.addEventListener("touchmove", onMove, { passive: false, capture: true });
      window.addEventListener("touchend", onEnd, { passive: false, capture: true });
      window.addEventListener("touchcancel", onCancel, { passive: false, capture: true });
    },
    [active, addTouchDragCss, assignToWheelLocal, getDropTargetAt, setDragOverWheel]
  );

  const state: ThreeWheelGameState = {
    player,
    enemy,
    initiative,
    wins,
    round,
    ante: anteState,
    freezeLayout,
    lockedWheelSize,
    phase,
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
    laneChillStacks,
    dragCardId,
    dragOverWheel,
    selectedCardId,
    reserveSums,
    isPtrDragging,
    ptrDragCard,
    ptrDragType,
    log,
    spellHighlights,
    skillPhase: skillPhaseView,
    skillTargeting,
  };

  const derived: ThreeWheelGameDerived = {
    localLegacySide,
    remoteLegacySide,
    hostLegacySide,
    namesByLegacy,
    HUD_COLORS: { player: HUD_COLORS.player, enemy: HUD_COLORS.enemy },
    winGoal,
    isMultiplayer,
    isSkillMode,
    matchWinner,
    localWinsCount,
    remoteWinsCount,
    localWon,
    winnerName,
    localName,
    remoteName,
    canReveal,
  };

  const refs: ThreeWheelGameRefs = {
    wheelRefs,
    ptrPos,
  };

  const actions: ThreeWheelGameActions = {
    setHandClearance,
    setSelectedCardId,
    setDragCardId,
    setDragOverWheel,
    startPointerDrag,
    startTouchDrag,
    assignToWheelLocal,
    handleRevealClick,
    handleNextClick,
    handleRematchClick,
    handleExitClick,
    applySpellEffects,
    setAnteBet,
    activateSkillOption,
    passSkillTurn,
    resolveSkillTargeting,
    cancelSkillTargeting,
  };

  return { state, derived, refs, actions };
}

function calculateAnteOdds({
  wins,
  winGoal,
  initiative,
}: {
  wins: { player: number; enemy: number };
  winGoal: number;
  initiative: LegacySide;
}): Record<LegacySide, number> {
  const result: Record<LegacySide, number> = { player: 1.2, enemy: 1.2 };
  (Object.keys(result) as LegacySide[]).forEach((side) => {
    const other: LegacySide = side === "player" ? "enemy" : "player";
    const winsLeftSelf = Math.max(0, winGoal - wins[side]);
    const winsLeftOpp = Math.max(0, winGoal - wins[other]);
    const totalLeft = winsLeftSelf + winsLeftOpp;
    let probability = totalLeft === 0 ? 0.5 : winsLeftOpp / totalLeft;

    if (initiative === side) probability += 0.05;
    else probability -= 0.05;

    probability = Math.max(0.15, Math.min(0.85, probability));
    const payout = Math.max(1.1, Math.round((1 / probability) * 100) / 100);
    result[side] = payout;
  });
  return result;
}
