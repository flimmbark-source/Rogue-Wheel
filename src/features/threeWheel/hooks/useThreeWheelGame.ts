import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  startTransition,
} from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
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
  recordMatchResult,
  type MatchResultSummary,
  type LevelProgress,
} from "../../../player/profileStore";
import { isNormal } from "../../../game/values";
import type { WheelHandle } from "../../../components/CanvasWheel";
import {
  applySpellEffects as runSpellEffects,
  type LaneChillStacks,
  type LegacySide,
  type SpellEffectPayload,
} from "../../../game/spellEngine";

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
  log: string[];
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
  assignToWheelLocal: (index: number, card: Card) => void;
  handleRevealClick: () => void;
  handleNextClick: () => void;
  handleRematchClick: () => void;
  handleExitClick: () => void;
  applySpellEffects: (payload: SpellEffectPayload, options?: { broadcast?: boolean }) => void;
  setAnteBet: (bet: number) => void;
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

  const namesByLegacy: Record<LegacySide, string> = {
    player: players.left.name,
    enemy: players.right.name,
  };

  const winGoal =
    typeof targetWins === "number" && Number.isFinite(targetWins)
      ? Math.max(1, Math.min(25, Math.round(targetWins)))
      : TARGET_WINS;

  const currentGameMode = normalizeGameMode(gameMode ?? DEFAULT_GAME_MODE);
  const isAnteMode = currentGameMode.includes("ante");

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

  const [player, setPlayer] = useState<Fighter>(() => makeFighter("Wanderer"));
  const [enemy, setEnemy] = useState<Fighter>(() => makeFighter("Shade Bandit"));
  const [initiative, setInitiative] = useState<LegacySide>(() =>
    hostId ? hostLegacySide : localLegacySide
  );
  const [wins, setWins] = useState<{ player: number; enemy: number }>({ player: 0, enemy: 0 });
  const [round, setRound] = useState(1);
  const [anteState, setAnteState] = useState<AnteState>(() => ({
    round: 0,
    bets: { player: 0, enemy: 0 },
    odds: { player: 1.2, enemy: 1.2 },
  }));
  const [freezeLayout, setFreezeLayout] = useState(false);
  const [lockedWheelSize, setLockedWheelSize] = useState<number | null>(null);
  const [phase, setPhase] = useState<CorePhase>("choose");
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

  const clearResolveVotes = useCallback(() => {
    setResolveVotes((prev) => {
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
  const ptrPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

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
  useEffect(() => {
    assignRef.current = assign;
  }, [assign]);
  useEffect(() => {
    laneChillRef.current = laneChillStacks;
  }, [laneChillStacks]);

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

  const START_LOG = "A Shade Bandit eyes your purse...";
  const [log, setLog] = useState<string[]>([START_LOG]);

  const appendLog = useCallback((s: string) => {
    setLog((prev) => [s, ...prev].slice(0, 60));
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

      clearResolveVotes();

      return true;
    },
    [active, clearResolveVotes, laneChillRef, localLegacySide]
  );

  const clearAssignFor = useCallback(
    (side: LegacySide, laneIndex: number) => {
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

      clearResolveVotes();

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
    return left.slice(0, 2).reduce((a, c) => a + (isNormal(c) ? c.number : 0), 0);
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
      runSpellEffects(
        payload,
        {
          assignSnapshot: assignRef.current,
          updateAssignments: setAssign,
          updateReserveSums: setReserveSums,
          updateTokens: setTokens,
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
        },
        options,
      );
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
      wheelRefs,
    ],
  );

  function settleFighterAfterRound(f: Fighter, played: Card[]): Fighter {
    const playedIds = new Set(played.map((c) => c.id));
    const next: Fighter = {
      name: f.name,
      deck: [...f.deck],
      hand: f.hand.filter((c) => !playedIds.has(c.id)),
      discard: [...f.discard, ...played],
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
        kind: "normal",
      } as unknown as Card);
    }
    return { ...f, hand: padded } as T;
  }

  const revealRoundCore = useCallback(
    (opts?: { force?: boolean }) => {
      if (!opts?.force && !canReveal) return false;

      clearResolveVotes();

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
    [broadcastLocalReserve, canReveal, clearResolveVotes, isMultiplayer, wheelSize]
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

  function resolveRound(enemyPicks?: (Card | null)[]) {
    const played = [0, 1, 2].map((i) => ({
      p: assign.player[i] as Card | null,
      e: (enemyPicks?.[i] ?? assign.enemy[i]) as Card | null,
    }));

    const localPlayed =
      localLegacySide === "player" ? played.map((pe) => pe.p) : played.map((pe) => pe.e);
    const remotePlayed =
      remoteLegacySide === "player" ? played.map((pe) => pe.p) : played.map((pe) => pe.e);

    const localReserve = computeReserveSum(localLegacySide, localPlayed);
    let remoteReserve: number;
    let usedRemoteReport = false;

    if (!isMultiplayer) {
      remoteReserve = computeReserveSum(remoteLegacySide, remotePlayed);
    } else {
      const report = reserveReportsRef.current[remoteLegacySide];
      if (report && report.round === round) {
        remoteReserve = report.reserve;
        usedRemoteReport = true;
      } else {
        remoteReserve = computeReserveSum(remoteLegacySide, remotePlayed);
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
      const baseP = played[w].p?.number ?? 0;
      const baseE = played[w].e?.number ?? 0;
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
      outcomes.push({ steps, targetSlice, section, winner, tie, wheel: w, detail });
    }

    const animateSpins = async () => {
      const finalTokens: [number, number, number] = [...tokens] as [number, number, number];

      for (const o of outcomes) {
        const start = finalTokens[o.wheel];
        const steps = o.steps;
        if (steps <= 0) continue;
        const total = Math.max(220, Math.min(1000, 110 + 70 * steps));
        const t0 = performance.now();
        await new Promise<void>((resolve) => {
          const frame = (now: number) => {
            if (!mountedRef.current) return resolve();
            const tt = Math.max(0, Math.min(1, (now - t0) / total));
            const progressed = Math.floor(easeInOutCubic(tt) * steps);
            wheelRefs[o.wheel].current?.setVisualToken((start + progressed) % SLICES);
            if (tt < 1) requestAnimationFrame(frame);
            else {
              wheelRefs[o.wheel].current?.setVisualToken((start + steps) % SLICES);
              resolve();
            }
          };
          requestAnimationFrame(frame);
        });
        finalTokens[o.wheel] = (start + steps) % SLICES;
        await new Promise((r) => setTimeout(r, 90));
      }

      setTokens(finalTokens);

      let pWins = wins.player;
      let eWins = wins.enemy;
      const hudColors: [string | null, string | null, string | null] = [null, null, null];
      const roundWinsCount: Record<LegacySide, number> = { player: 0, enemy: 0 };
      outcomes.forEach((o) => {
        if (o.tie) {
          appendLog(`Wheel ${o.wheel + 1} tie: ${o.detail} — no win.`);
        } else if (o.winner) {
          hudColors[o.wheel] = HUD_COLORS[o.winner];
          roundWinsCount[o.winner] += 1;
          if (o.winner === "player") pWins++;
          else eWins++;
          appendLog(`Wheel ${o.wheel + 1} win -> ${o.winner} (${o.detail}).`);
        }
      });

      if (!mountedRef.current) return;

      const prevInitiative = initiative;
      const playerRoundWins = roundWinsCount.player;
      const enemyRoundWins = roundWinsCount.enemy;
      const roundWinner: LegacySide | null =
        playerRoundWins === enemyRoundWins
          ? null
          : playerRoundWins > enemyRoundWins
            ? "player"
            : "enemy";

      if (isAnteMode && anteStateRef.current.round === round) {
        const bets = anteStateRef.current.bets;
        const odds = anteStateRef.current.odds;

        if (roundWinner === "player") {
          const profit = Math.round(bets.player * Math.max(0, odds.player - 1));
          const loss = bets.enemy;
          if (profit > 0) {
            pWins += profit;
            appendLog(`${namesByLegacy.player} wins ante (+${profit}).`);
          }
          if (loss > 0) {
            const nextEnemy = Math.max(0, eWins - loss);
            if (nextEnemy !== eWins) {
              eWins = nextEnemy;
              appendLog(`${namesByLegacy.enemy} loses ante (-${loss}).`);
            }
          }
        } else if (roundWinner === "enemy") {
          const profit = Math.round(bets.enemy * Math.max(0, odds.enemy - 1));
          const loss = bets.player;
          if (profit > 0) {
            eWins += profit;
            appendLog(`${namesByLegacy.enemy} wins ante (+${profit}).`);
          }
          if (loss > 0) {
            const nextPlayer = Math.max(0, pWins - loss);
            if (nextPlayer !== pWins) {
              pWins = nextPlayer;
              appendLog(`${namesByLegacy.player} loses ante (-${loss}).`);
            }
          }
        } else if (bets.player > 0 || bets.enemy > 0) {
          appendLog(`Ante pushes on a tie.`);
        }

        setAnteState((prev) => {
          if (prev.round !== round) return prev;
          if (prev.bets.player === 0 && prev.bets.enemy === 0) return prev;
          return { ...prev, bets: { player: 0, enemy: 0 } };
        });
      }

      const roundScore = `${roundWinsCount.player}-${roundWinsCount.enemy}`;
      let nextInitiative: LegacySide;
      let initiativeLog: string;
      if (roundWinner === null) {
        nextInitiative = prevInitiative === "player" ? "enemy" : "player";
        initiativeLog = `Round ${round} tie (${roundScore}) — initiative swaps to ${namesByLegacy[nextInitiative]}.`;
      } else if (roundWinner === "player") {
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
      clearAdvanceVotes();
      setPhase("roundEnd");
      if (pWins >= winGoal || eWins >= winGoal) {
        clearRematchVotes();
        setPhase("ended");
        const localWins = localLegacySide === "player" ? pWins : eWins;
        appendLog(
          localWins >= winGoal ? "You win the match!" : `${namesByLegacy[remoteLegacySide]} wins the match!`
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
      setLaneChillStacks({ player: [0, 0, 0], enemy: [0, 0, 0] });

      setSelectedCardId(null);
      setDragCardId(null);
      setDragOverWheel(null);
      setTokens([0, 0, 0]);
      setReserveSums(null);
      setWheelHUD([null, null, null]);

      setPhase("choose");
      setRound((r) => r + 1);

      return true;
    },
    [
      clearResolveVotes,
      clearAdvanceVotes,
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
  }, [roomCode, localPlayerId, handleMPIntent]);

  const handleRevealClick = useCallback(() => {
    if (phase !== "choose" || !canReveal) return;

    if (!isMultiplayer) {
      onReveal();
      return;
    }

    if (resolveVotes[localLegacySide]) return;

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
    if (phase !== "roundEnd") return;

    if (!isMultiplayer) {
      nextRound();
      return;
    }

    if (advanceVotes[localLegacySide]) return;

    markAdvanceVote(localLegacySide);
    sendIntent({ type: "nextRound", side: localLegacySide });
  }, [advanceVotes, isMultiplayer, localLegacySide, markAdvanceVote, nextRound, phase, sendIntent]);

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

    wheelRefs.forEach((ref) => ref.current?.setVisualToken(0));

    setFreezeLayout(false);
    setLockedWheelSize(null);

    setPlayer(() => makeFighter("Wanderer"));
    setEnemy(() => makeFighter("Shade Bandit"));

    setInitiative(hostId ? hostLegacySide : localLegacySide);

    setWins({ player: 0, enemy: 0 });
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

    setLog([START_LOG]);

    wheelRngRef.current = createSeededRng(seed);
    setWheelSections(generateWheelSet());
  }, [
    clearAdvanceVotes,
    clearRematchVotes,
    clearResolveVotes,
    generateWheelSet,
    hostId,
    hostLegacySide,
    localLegacySide,
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
      if (e.pointerType === "mouse") return;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setSelectedCardId(card.id);
      setDragCardId(card.id);
      setPtrDragCard(card);
      setIsPtrDragging(true);
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
        addTouchDragCss(false);
      }

      window.addEventListener("pointermove", onMove, { passive: false, capture: true });
      window.addEventListener("pointerup", onUp, { passive: false, capture: true });
      window.addEventListener("pointercancel", onCancel, { passive: false, capture: true });
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
    log,
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
    assignToWheelLocal,
    handleRevealClick,
    handleNextClick,
    handleRematchClick,
    handleExitClick,
    applySpellEffects,
    setAnteBet,
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
