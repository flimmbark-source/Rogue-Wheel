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
} from "../../../game/types.js";
import { DEFAULT_GAME_MODE, normalizeGameMode, type GameMode } from "../../../gameModes.js";
import { easeInOutCubic, inSection, createSeededRng } from "../../../game/math.js";
import { genWheelSections } from "../../../game/wheel.js";
import { getSkillCardValue, type AbilityKind } from "../../../game/skills.js";
import {
  makeFighter,
  refillTo,
  drawOne,
  recordMatchResult,
  type MatchResultSummary,
  type LevelProgress,
} from "../../../player/profileStore.js";
import { fmtNum, isNormal } from "../../../game/values.js";
import type { WheelHandle } from "../../../components/CanvasWheel.js";
import {
  applySpellEffects as runSpellEffects,
  type AssignmentState,
  type LaneChillStacks,
  type LegacySide,
  type SpellEffectPayload,
} from "../../../game/spellEngine.js";
import {
  summarizeRoundOutcome,
  type RoundAnalysis,
  type RoundOutcomeSummary,
  type WheelOutcome,
} from "./roundOutcomeSummary.js";
import { determinePostResolvePhase } from "../utils/skillPhase.js";
import {
  applySkillAbilityEffect,
  type SkillAbilityTarget,
} from "../utils/skillAbilityExecution.js";
import {
  createSkillState,
  getSkillCardStatusKey,
  reconcileSkillStateWithAssignments,
  type SkillLane,
  type SkillState,
} from "./skillState.js";

export type { LegacySide, SpellEffectPayload } from "../../../game/spellEngine.js";
export type { SkillAbilityTarget } from "../utils/skillAbilityExecution.js";

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
  easyMode?: boolean;
  onExit?: () => void;
};

type AnteState = {
  round: number;
  bets: Record<LegacySide, number>;
  odds: Record<LegacySide, number>;
};

export type GameLogEntryType = "general" | "spell" | "skill";

export type GameLogEntry = {
  id: string;
  message: string;
  type: GameLogEntryType;
  meta?: GameLogEntryMeta;
};

type SkillEffectMeta = {
  side: LegacySide;
  ability: AbilityKind;
  affectedLanes?: number[];
  affectedReserve?: boolean;
};

type GameLogEntryMeta = {
  skillEffect?: SkillEffectMeta;
};

let logIdCounter = 0;
const createLogEntry = (
  message: string,
  type: GameLogEntryType = "general",
  meta?: GameLogEntryMeta,
): GameLogEntry => ({
  id: `log-${Date.now().toString(36)}-${(logIdCounter++).toString(36)}`,
  message,
  type,
  meta,
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


const resetCardNumberToBase = (card: Card): Card => {
  const base = card.baseNumber;
  if (typeof base === "number" && card.number !== base) {
    return { ...card, number: base };
  }
  return card;
};

const resetCardCollectionToBase = (cards: Card[]): Card[] => {
  let changed = false;
  const next = cards.map((card) => {
    const reset = resetCardNumberToBase(card);
    if (reset !== card) changed = true;
    return reset;
  });
  return changed ? next : cards;
};

const resetFighterCardsToBase = (fighter: Fighter): Fighter => {
  const nextDeck = resetCardCollectionToBase(fighter.deck);
  const nextHand = resetCardCollectionToBase(fighter.hand);
  const nextDiscard = resetCardCollectionToBase(fighter.discard);
  const nextExhaust = resetCardCollectionToBase(fighter.exhaust);

  if (
    nextDeck === fighter.deck &&
    nextHand === fighter.hand &&
    nextDiscard === fighter.discard &&
    nextExhaust === fighter.exhaust
  ) {
    return fighter;
  }

  return {
    ...fighter,
    deck: nextDeck,
    hand: nextHand,
    discard: nextDiscard,
    exhaust: nextExhaust,
  };
};

const resetPlayedCardsToBase = (cards: Card[]): Card[] => {
  let changed = false;
  const next = cards.map((card) => {
    const reset = resetCardNumberToBase(card);
    if (reset !== card) changed = true;
    return reset;
  });
  return changed ? next : cards;
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
  wheelCardTotals: SideState<[number, number, number]>;
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
  skill: SkillState;
};

export type ThreeWheelGameDerived = {
  localLegacySide: LegacySide;
  remoteLegacySide: LegacySide;
  hostLegacySide: LegacySide;
  namesByLegacy: Record<LegacySide, string>;
  HUD_COLORS: { player: string; enemy: string };
  winGoal: number;
  isMultiplayer: boolean;
  matchWinner: LegacySide | null;
  localWinsCount: number;
  remoteWinsCount: number;
  localWon: boolean;
  winnerName: string | null;
  localName: string;
  remoteName: string;
  isSkillMode: boolean;
  canReveal: boolean;
};

export type ThreeWheelGameRefs = {
  wheelRefs: Array<React.MutableRefObject<WheelHandle | null>>;
  ptrPos: React.MutableRefObject<{ x: number; y: number }>;
};

export type SkillAbilityUsageResult = {
  success: boolean;
  failureReason?: string;
  exhausted: boolean;
  usesRemaining: number;
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
  useSkillAbility: (
    side: LegacySide,
    laneIndex: number,
    target?: SkillAbilityTarget,
  ) => Promise<SkillAbilityUsageResult>;
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
  easyMode,
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
  const easyModeEnabled = easyMode === true;
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
  const [skillState, setSkillState] = useState<SkillState>(() => createSkillState(isSkillMode));
  const skillStateRef = useRef(skillState);
  useEffect(() => {
    skillStateRef.current = skillState;
  }, [skillState]);
  const lastPlayerSkillUseTimeRef = useRef<number | null>(null);

  const [assign, setAssign] = useState<{ player: (Card | null)[]; enemy: (Card | null)[] }>({
    player: [null, null, null],
    enemy: [null, null, null],
  });
  const assignRef = useRef(assign);
  useEffect(() => {
    assignRef.current = assign;
  }, [assign]);

  useEffect(() => {
    setSkillState((prev) => {
      if (prev.enabled === isSkillMode) {
        return prev;
      }
      if (!isSkillMode) {
        return createSkillState(false);
      }
      return { ...prev, enabled: true };
    });
  }, [isSkillMode]);

  useEffect(() => {
    setSkillState((prev) => reconcileSkillStateWithAssignments(prev, assign, isSkillMode));
  }, [assign, isSkillMode]);
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
      genWheelSections("bandit", seeded, { easyMode: easyModeEnabled }),
      genWheelSections("sorcerer", seeded, { easyMode: easyModeEnabled }),
      genWheelSections("beast", seeded, { easyMode: easyModeEnabled }),
    ];
  });

  const generateWheelSet = useCallback((): Section[][] => {
    const rng = wheelRngRef.current ?? Math.random;
    return [
      genWheelSections("bandit", rng, { easyMode: easyModeEnabled }),
      genWheelSections("sorcerer", rng, { easyMode: easyModeEnabled }),
      genWheelSections("beast", rng, { easyMode: easyModeEnabled }),
    ];
  }, [easyModeEnabled]);

  useEffect(() => {
    wheelRngRef.current = createSeededRng(seed);
    setWheelSections(generateWheelSet());
  }, [seed, generateWheelSet]);

  useEffect(() => {
    setWheelSections(generateWheelSet());
  }, [easyModeEnabled, generateWheelSet]);

  const [tokens, setTokens] = useState<[number, number, number]>([0, 0, 0]);
  const tokensRef = useRef(tokens);
  const roundStartTokensRef = useRef<[number, number, number] | null>([0, 0, 0]);
  const [wheelCardTotals, setWheelCardTotals] = useState<SideState<[number, number, number]>>({
    player: [0, 0, 0],
    enemy: [0, 0, 0],
  });
  const wheelCardTotalsRef = useRef(wheelCardTotals);
  const [active] = useState<[boolean, boolean, boolean]>([true, true, true]);
  const [wheelHUD, setWheelHUD] = useState<[string | null, string | null, string | null]>([null, null, null]);
  const [laneChillStacks, setLaneChillStacks] = useState<LaneChillStacks>({
    player: [0, 0, 0],
    enemy: [0, 0, 0],
  });
  const laneChillRef = useRef(laneChillStacks);
  const roundAnalysisRef = useRef<RoundAnalysis | null>(null);
  useEffect(() => {
    laneChillRef.current = laneChillStacks;
  }, [laneChillStacks]);
  useEffect(() => {
    tokensRef.current = tokens;
  }, [tokens]);
  useEffect(() => {
    wheelCardTotalsRef.current = wheelCardTotals;
  }, [wheelCardTotals]);

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

  const appendLog = useCallback(
    (message: string, options?: { type?: GameLogEntryType; meta?: GameLogEntryMeta }) => {
      const entry = createLogEntry(message, options?.type ?? "general", options?.meta);
      setLog((prev) => [entry, ...prev].slice(0, 60));
    },
    [],
  );

  const [spellHighlights, setSpellHighlights] = useState<SpellHighlightState>(() => createEmptySpellHighlights());
  const spellHighlightTimeoutRef = useRef<number | null>(null);

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

  const updateReservePreview = useCallback(() => {
    const playerFighter = playerRef.current;
    const enemyFighter = enemyRef.current;

    const computeFromFighter = (side: LegacySide, fighter: Fighter) => {
      const used = side === "player" ? assignRef.current.player : assignRef.current.enemy;
      const usedIds = new Set((used.filter(Boolean) as Card[]).map((card) => card.id));
      const remaining = fighter.hand.filter((card) => !usedIds.has(card.id));
      const base = remaining
        .slice(0, 2)
        .reduce((acc, card) => acc + (isNormal(card) ? card.number ?? 0 : 0), 0);
      const penalty = reservePenaltiesRef.current[side] ?? 0;
      return Math.max(0, base - penalty);
    };

    const playerReserve = computeFromFighter("player", playerFighter);
    const enemyReserve = computeFromFighter("enemy", enemyFighter);
    setReserveSums({ player: playerReserve, enemy: enemyReserve });
  }, [setReserveSums]);

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

  const recalcWheelForLane = useCallback(
    (assignments: AssignmentState<Card>, index: number) => {
      if (index < 0 || index >= assignments.player.length) {
        return { value: 0, changed: false };
      }

      const playerCard = assignments.player[index] as Card | null;
      const enemyCard = assignments.enemy[index] as Card | null;
      const playerValueRaw = cardWheelValue(playerCard);
      const enemyValueRaw = cardWheelValue(enemyCard);
      const playerSteps = modSlice(playerValueRaw);
      const enemySteps = modSlice(enemyValueRaw);
      const total = modSlice(playerSteps + enemySteps);
      wheelRefs[index]?.current?.setVisualToken?.(total);

      const totalsSnapshot = wheelCardTotalsRef.current;
      const nextPlayerTotals = [...totalsSnapshot.player] as [number, number, number];
      const nextEnemyTotals = [...totalsSnapshot.enemy] as [number, number, number];
      let totalsChanged = false;
      if (nextPlayerTotals[index] !== playerValueRaw) {
        nextPlayerTotals[index] = playerValueRaw;
        totalsChanged = true;
      }
      if (nextEnemyTotals[index] !== enemyValueRaw) {
        nextEnemyTotals[index] = enemyValueRaw;
        totalsChanged = true;
      }
      if (totalsChanged) {
        const updatedTotals: SideState<[number, number, number]> = {
          player: nextPlayerTotals,
          enemy: nextEnemyTotals,
        };
        wheelCardTotalsRef.current = updatedTotals;
        setWheelCardTotals(updatedTotals);
      }

      const prevTokens = tokensRef.current ?? [0, 0, 0];
      const previous = prevTokens[index] ?? 0;
      if (total === previous) {
        return { value: total, changed: false };
      }

      const nextTokens = [...prevTokens] as [number, number, number];
      nextTokens[index] = total;
      tokensRef.current = nextTokens;
      setTokens(nextTokens);
      return { value: total, changed: true };
    },
    [setTokens, setWheelCardTotals, wheelRefs],
  );

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

  const refreshRoundSummaryAfterSkill = useCallback(
    (
      assignments: AssignmentState<Card>,
      options?: { updateInitiative?: boolean },
    ): RoundOutcomeSummary => {
      const played = [0, 1, 2].map((i) => ({
        p: assignments.player[i] as Card | null,
        e: assignments.enemy[i] as Card | null,
      }));

      const latestAnalysis = analyzeRound(played);
      roundAnalysisRef.current = latestAnalysis;

      const summary = summarizeRoundOutcome({
        analysis: latestAnalysis,
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

      setWheelHUD(summary.hudColors);
      pendingWinsRef.current = summary.wins;

      const shouldUpdateInitiative = options?.updateInitiative ?? isSkillMode;
      if (shouldUpdateInitiative) {
        setInitiative(summary.nextInitiative);
      }

      return summary;
    },
    [
      HUD_COLORS,
      initiative,
      isAnteMode,
      isSkillMode,
      localLegacySide,
      namesByLegacy,
      remoteLegacySide,
      round,
      setInitiative,
      setWheelHUD,
      winGoal,
      wins,
    ],
  );

  const runRecalculationPhase = useCallback(
    (originPhase?: CorePhase | null) => {
      const previousPhase = originPhase ?? phaseRef.current;

      if (previousPhase !== "recalc") {
        phaseRef.current = "recalc";
        setPhase("recalc");
      }

      const assignments = assignRef.current;
      const shouldUpdateCardTotals = previousPhase === "skill" || previousPhase === "choose";

      if (shouldUpdateCardTotals) {
        for (let laneIndex = 0; laneIndex < assignments.player.length; laneIndex++) {
          recalcWheelForLane(assignments, laneIndex);
        }
      }

      updateReservePreview();

      const shouldUpdateInitiative =
        previousPhase === "skill" || previousPhase === "roundEnd" || previousPhase === "anim";
      refreshRoundSummaryAfterSkill(assignments, {
        updateInitiative: shouldUpdateInitiative,
      });

      if (previousPhase !== "recalc") {
        setSafeTimeout(() => {
          phaseRef.current = previousPhase;
          setPhase(previousPhase);
        }, 0);
      }
    },
    [
      recalcWheelForLane,
      refreshRoundSummaryAfterSkill,
      setSafeTimeout,
      updateReservePreview,
    ],
  );

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
          recalcWheelForLane(latestAssignments, i);
        }
      }

      if (affectedCardIds.size > 0 || affectedReserveSides.size > 0) {
        flashSpellHighlights(affectedCardIds, affectedReserveSides);
      }

      if (
        phaseRef.current === "anim" ||
        phaseRef.current === "skill" ||
        phaseRef.current === "roundEnd"
      ) {
        resolveRound(undefined, {
          skipAnimation: true,
          snapshot: { assign: latestAssignments, tokens: snapshotTokens },
        });
      }

      runRecalculationPhase(phaseRef.current);
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
      runRecalculationPhase,
      recalcWheelForLane,
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
      exhaust: [...f.exhaust],
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

  const tryRevealRound = useCallback(
    (opts?: { force?: boolean }) => {
      if (!opts?.force && phaseRef.current !== "choose") {
        return false;
      }
      return revealRoundCore(opts);
    },
    [revealRoundCore],
  );

  const onReveal = useCallback(() => {
    tryRevealRound();
  }, [tryRevealRound]);

  const attemptAutoReveal = useCallback(() => {
    if (!isMultiplayer) return;
    if (phase !== "choose") return;
    if (!canReveal) return;
    const votes = resolveVotesRef.current;
    if (!votes.player || !votes.enemy) return;
    tryRevealRound();
  }, [canReveal, isMultiplayer, phase, tryRevealRound]);

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

      const nextPhase = determinePostResolvePhase({
        isSkillMode,
        skillCompleted: skillStateRef.current.completed,
      });
      setPhase(nextPhase);
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
      const allow = opts?.force || phase === "roundEnd" || phase === "skill";
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

      setPlayer((p) => {
        const basePlayer = isSkillMode ? resetFighterCardsToBase(p) : p;
        const playedForSettlement = isSkillMode
          ? resetPlayedCardsToBase(playerPlayed)
          : playerPlayed;
        return settleFighterAfterRound(basePlayer, playedForSettlement);
      });
      setEnemy((e) => {
        const baseEnemy = isSkillMode ? resetFighterCardsToBase(e) : e;
        const playedForSettlement = isSkillMode
          ? resetPlayedCardsToBase(enemyPlayed)
          : enemyPlayed;
        return settleFighterAfterRound(baseEnemy, playedForSettlement);
      });

      setWheelSections(generateWheelSet());
      setAssign({ player: [null, null, null], enemy: [null, null, null] });
      setLaneChillStacks({ player: [0, 0, 0], enemy: [0, 0, 0] });

      setSelectedCardId(null);
      setDragCardId(null);
      setDragOverWheel(null);
      setTokens([0, 0, 0]);
      setWheelCardTotals({ player: [0, 0, 0], enemy: [0, 0, 0] });
      roundStartTokensRef.current = [0, 0, 0];
      setReserveSums(null);
      setWheelHUD([null, null, null]);
      reservePenaltiesRef.current = { player: 0, enemy: 0 };
      reserveReportsRef.current = { player: null, enemy: null };

      const resetSkill: SkillState = createSkillState(isSkillMode);
      skillStateRef.current = resetSkill;
      setSkillState(resetSkill);

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
      isSkillMode,
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
      tryRevealRound();
      return;
    }

    markResolveVote(localLegacySide);
    sendIntent({ type: "reveal", side: localLegacySide });
    tryRevealRound();
    setTimeout(() => {
      attemptAutoReveal();
    }, 0);
  }, [
    attemptAutoReveal,
    canReveal,
    isMultiplayer,
    localLegacySide,
    markResolveVote,
    phase,
    resolveVotes,
    sendIntent,
    tryRevealRound,
  ]);

  const completeSkillPhase = useCallback(() => {
    let updated = false;
    setSkillState((prev) => {
      if (prev.completed) return prev;
      updated = true;
      const next = { ...prev, completed: true };
      skillStateRef.current = next;
      return next;
    });
    return updated;
  }, [setSkillState]);

  const buildSkillEffectMeta = useCallback(
    (
      ability: AbilityKind,
      side: LegacySide,
      target?: SkillAbilityTarget,
    ): SkillEffectMeta | null => {
      switch (ability) {
        case "swapReserve":
          if (target && target.type === "reserveToLane") {
            return { side, ability, affectedLanes: [target.laneIndex], affectedReserve: true };
          }
          return { side, ability, affectedReserve: true };
        case "rerollReserve":
          return { side, ability, affectedReserve: true };
        case "boostCard":
          if (target && target.type === "lane") {
            return { side, ability, affectedLanes: [target.laneIndex] };
          }
          return { side, ability };
        case "reserveBoost":
          if (target && target.type === "reserveBoost") {
            return { side, ability, affectedLanes: [target.laneIndex], affectedReserve: true };
          }
          return { side, ability, affectedReserve: true };
        default:
          return null;
      }
    },
    [],
  );

  const useSkillAbility = useCallback(
    async (
      side: LegacySide,
      laneIndex: number,
      target?: SkillAbilityTarget,
    ): Promise<SkillAbilityUsageResult> => {
      const isCpuActor = !isMultiplayer && side === remoteLegacySide;
      if (
        isCpuActor &&
        isSkillMode &&
        lastPlayerSkillUseTimeRef.current !== null &&
        lastPlayerSkillUseTimeRef.current !== undefined
      ) {
        const elapsed = Date.now() - lastPlayerSkillUseTimeRef.current;
        const waitMs = Math.max(0, 1000 - elapsed);
        if (waitMs > 0) {
          await new Promise<void>((resolve) => {
            setSafeTimeout(resolve, waitMs);
          });
        }
        lastPlayerSkillUseTimeRef.current = null;
      }

      const assignments = assignRef.current;
      const laneCards = assignments[side];
      const skillCard = laneCards?.[laneIndex] ?? null;
      const storedSkillValue = skillCard ? getSkillCardValue(skillCard) : 0;
      const actorName = namesByLegacy[side];

      const laneState = skillStateRef.current.lanes[side]?.[laneIndex];
      if (!laneState || !laneState.ability) {
        return {
          success: false,
          exhausted: true,
          usesRemaining: 0,
        };
      }

      if (laneState.exhausted) {
        appendLog(`${actorName}'s ${laneState.ability} has already been used.`);
        return {
          success: false,
          failureReason: `${laneState.ability} exhausted`,
          exhausted: true,
          usesRemaining: laneState.usesRemaining,
        };
      }

      const ability = laneState.ability;
      const sideAssignments: AssignmentState<Card> = {
        player: [...assignments.player],
        enemy: [...assignments.enemy],
      };

      const result = applySkillAbilityEffect({
        ability,
        actorName,
        side,
        laneIndex,
        target,
        skillCard,
        storedSkillValue,
        sideAssignments,
        concludeAssignUpdate: (nextAssign) => {
          assignRef.current = nextAssign;
          setAssign(() => nextAssign);
        },
        recalcWheelForLane,
        getFighterSnapshot,
        updateFighter,
        drawOne,
        updateReservePreview,
        appendLog,
      });

      if (!result.success) {
        if (result.failureReason) {
          appendLog(`${actorName}'s ${ability} failed: ${result.failureReason}`);
        }
        return {
          success: false,
          failureReason: result.failureReason,
          exhausted: laneState.exhausted,
          usesRemaining: laneState.usesRemaining,
        };
      }

      const nextUsesRemaining = Math.max(0, laneState.usesRemaining - 1);
      const willExhaust = nextUsesRemaining <= 0;

      setSkillState((prev) => {
        const lanes = prev.lanes[side];
        const lane = lanes?.[laneIndex];
        if (!lane || lane.exhausted || lane.ability !== ability) {
          return prev;
        }
        const cardId = lane.cardId;
        let nextCardStatus = prev.cardStatus;
        if (cardId) {
          const statusKey = getSkillCardStatusKey(side, cardId);
          const existingStatus = prev.cardStatus[statusKey];
          if (
            !existingStatus ||
            existingStatus.ability !== ability ||
            existingStatus.exhausted !== willExhaust ||
            existingStatus.usesRemaining !== nextUsesRemaining
          ) {
            nextCardStatus =
              nextCardStatus === prev.cardStatus ? { ...prev.cardStatus } : nextCardStatus;
            nextCardStatus[statusKey] = {
              ability,
              exhausted: willExhaust,
              usesRemaining: nextUsesRemaining,
            };
          }
        }
        const updatedLane: SkillLane = {
          ...lane,
          exhausted: willExhaust,
          usesRemaining: nextUsesRemaining,
        };
        const updatedLanesForSide = [...lanes];
        updatedLanesForSide[laneIndex] = updatedLane;
        const next: SkillState = {
          ...prev,
          lanes: { ...prev.lanes, [side]: updatedLanesForSide },
          cardStatus: nextCardStatus,
        };
        skillStateRef.current = next;
        return next;
      });

      const cpuSkillMeta = isCpuActor ? buildSkillEffectMeta(ability, side, target) : null;

      if (isCpuActor) {
        appendLog(`${actorName} used ${ability}.`, {
          type: "skill",
          meta: cpuSkillMeta ? { skillEffect: cpuSkillMeta } : undefined,
        });
      }

      if (ability === "rerollReserve") {
        appendLog(
          willExhaust
            ? `${actorName} finished their Reroll Reserve.`
            : `${actorName} can discard another reserve or cancel to finish the skill.`,
        );
      } else if (!isCpuActor) {
        appendLog(`${actorName} used ${ability}.`);
      }

      runRecalculationPhase(phaseRef.current);

      if (!isMultiplayer && isSkillMode && side === localLegacySide) {
        lastPlayerSkillUseTimeRef.current = Date.now();
      }

      return {
        success: true,
        exhausted: willExhaust,
        usesRemaining: nextUsesRemaining,
      };
    },
    [
      appendLog,
      assignRef,
      applySkillAbilityEffect,
      buildSkillEffectMeta,
      getFighterSnapshot,
      getSkillCardValue,
      namesByLegacy,
      localLegacySide,
      isMultiplayer,
      isSkillMode,
      remoteLegacySide,
      setSafeTimeout,
      recalcWheelForLane,
      setAssign,
      setSkillState,
      drawOne,
      updateFighter,
      updateReservePreview,
      runRecalculationPhase,
    ],
  );

  const handleNextClick = useCallback(() => {
    if (!(phase === "roundEnd" || phase === "skill")) return;

    completeSkillPhase();

    if (!isMultiplayer) {
      nextRound();
      return;
    }

    if (advanceVotes[localLegacySide]) return;

    markAdvanceVote(localLegacySide);
    sendIntent({ type: "nextRound", side: localLegacySide });
  }, [
    advanceVotes,
    completeSkillPhase,
    isMultiplayer,
    localLegacySide,
    markAdvanceVote,
    nextRound,
    phase,
    sendIntent,
  ]);

  useEffect(() => {
    if (!isMultiplayer) return;
    if (!(phase === "roundEnd" || phase === "skill")) return;
    if (!advanceVotes.player || !advanceVotes.enemy) return;
    completeSkillPhase();
    nextRound();
  }, [advanceVotes, completeSkillPhase, isMultiplayer, nextRound, phase]);

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
    setWheelCardTotals({ player: [0, 0, 0], enemy: [0, 0, 0] });
    setReserveSums(null);
    setWheelHUD([null, null, null]);

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
    wheelCardTotals,
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
    skill: skillState,
  };

  const derived: ThreeWheelGameDerived = {
    localLegacySide,
    remoteLegacySide,
    hostLegacySide,
    namesByLegacy,
    HUD_COLORS: { player: HUD_COLORS.player, enemy: HUD_COLORS.enemy },
    winGoal,
    isMultiplayer,
    matchWinner,
    localWinsCount,
    remoteWinsCount,
    localWon,
    winnerName,
    localName,
    remoteName,
    isSkillMode,
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
    useSkillAbility,
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
