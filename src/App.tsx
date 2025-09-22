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
} from "react";
import { Realtime } from "ably";
import { motion } from "framer-motion";
import type { GameMode } from "./gameModes";


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
  TARGET_WINS,
  type Side as TwoSide,
  type Card,
  type Section,
  type Fighter,
  type SplitChoiceMap,
  type Players,
  type Phase,
  type GameMode,
  LEGACY_FROM_SIDE,
} from "./game/types";
import { easeInOutCubic, inSection, createSeededRng } from "./game/math";
import { VC_META, genWheelSections } from "./game/wheel";
import {
  makeFighter,
  drawOne,
  refillTo,
  freshFive,
  recordMatchResult,
  type MatchResultSummary,
  type LevelProgress,
} from "./player/profileStore";
import { isSplit, isNormal, effectiveValue, fmtNum } from "./game/values";

// components
import CanvasWheel, { WheelHandle } from "./components/CanvasWheel";
import StSCard from "./components/StSCard";
import {
  getLearnedSpellsForFighter,
  type SpellDefinition,
} from "./game/spells";

type AblyRealtime = InstanceType<typeof Realtime>;
type AblyChannel = ReturnType<AblyRealtime["channels"]["get"]>;

// keep your local alias
type LegacySide = "player" | "enemy";

// your existing MPIntent union (merged from conflict)
type MPIntent =
  | { type: "assign"; lane: number; side: LegacySide; card: Card }
  | { type: "clear"; lane: number; side: LegacySide }
  | { type: "reveal"; side: LegacySide }
  | { type: "nextRound"; side: LegacySide }
  | { type: "rematch"; side: LegacySide }
  | { type: "reserve"; side: LegacySide; reserve: number; round: number };

// ---------------- Constants ----------------
const MIN_WHEEL = 160;
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
  roomCode,
  hostId,
  targetWins,
  onExit,
  gameMode = "classic",
}: {
  localSide: TwoSide;
  localPlayerId: string;
  players: Players;
  seed: number;
  roomCode?: string;
  hostId?: string;
  targetWins?: number;
  onExit?: () => void;
  gameMode?: GameMode;
}) {
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; timeoutsRef.current.forEach(clearTimeout); timeoutsRef.current.clear(); }; }, []);
  const timeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const setSafeTimeout = (fn: () => void, ms: number) => { const id = setTimeout(() => { if (mountedRef.current) fn(); }, ms); timeoutsRef.current.add(id); return id; };

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


  const isGrimoireMode = useMemo(() => {
    const markerValues = [
      players.left.id,
      players.right.id,
      players.left.name,
      players.right.name,
    ];
    if (markerValues.some((value) => value.toLowerCase().includes("grimoire"))) {
      return true;
    }

    if (typeof window !== "undefined") {
      try {
        const params = new URLSearchParams(window.location.search);
        const modeParam = (params.get("mode") ?? params.get("ruleset") ?? "").toLowerCase();
        if (modeParam.includes("grimoire")) {
          return true;
        }
      } catch {
        // ignore query parsing errors
      }

      const hash = (window.location.hash ?? "").toLowerCase();
      if (hash.includes("grimoire")) {
        return true;
      }
    }

    return false;
  }, [players.left.id, players.left.name, players.right.id, players.right.name]);

  const rawGameMode =
    (players as Players & { gameMode?: unknown }).gameMode ??
    (players.left as Players["left"] & { gameMode?: unknown }).gameMode ??
    (players.right as Players["right"] & { gameMode?: unknown }).gameMode;
  const gameMode: GameMode = rawGameMode === "grimoire" ? "grimoire" : "classic";


  const winGoal =
    typeof targetWins === "number" && Number.isFinite(targetWins)
      ? Math.max(1, Math.min(15, Math.round(targetWins)))
      : TARGET_WINS;


  const hostLegacySide: LegacySide = (() => {
    if (!hostId) return "player";
    if (players.left.id === hostId) return "player";
    if (players.right.id === hostId) return "enemy";
    return "player";
  })();

  const isMultiplayer = !!roomCode;
  const isGrimoireMode = gameMode === "grimoire";
  const ablyRef = useRef<AblyRealtime | null>(null);
  const chanRef = useRef<AblyChannel | null>(null);

  // Fighters & initiative
  const [player, setPlayer] = useState<Fighter>(() => makeFighter("Wanderer"));
  const [enemy, setEnemy] = useState<Fighter>(() => makeFighter("Shade Bandit"));
  const [initiative, setInitiative] = useState<LegacySide>(() =>
    hostId ? hostLegacySide : localLegacySide
  );
  const [wins, setWins] = useState<{ player: number; enemy: number }>({ player: 0, enemy: 0 });
  const [mana, setMana] = useState<{ player: number; enemy: number }>({ player: 0, enemy: 0 });
  const [round, setRound] = useState(1);

  // Freeze layout during resolution
  const [freezeLayout, setFreezeLayout] = useState(false);
  const [lockedWheelSize, setLockedWheelSize] = useState<number | null>(null);

  // Phase state
  const [phase, setPhase] = useState<Phase>("choose");

  const [resolveVotes, setResolveVotes] = useState<{ player: boolean; enemy: boolean }>({
    player: false,
    enemy: false,
  });

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

  const [advanceVotes, setAdvanceVotes] = useState<{ player: boolean; enemy: boolean }>({
    player: false,
    enemy: false,
  });

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

  const [rematchVotes, setRematchVotes] = useState<{ player: boolean; enemy: boolean }>({
    player: false,
    enemy: false,
  });

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
  }, [phase, localWon, wins.player, wins.enemy]);

  const [handClearance, setHandClearance] = useState<number>(0);

function calcWheelSize(viewH: number, viewW: number, dockAllowance = 0) {
  const isMobile = viewW <= 480;
  const chromeAllowance = viewW >= 1024 ? 200 : 140;
  const raw = Math.floor((viewH - chromeAllowance - dockAllowance) / 3);
  const MOBILE_MAX = 188;
  const DESKTOP_MAX = 220;
  const maxAllowed = isMobile ? MOBILE_MAX : DESKTOP_MAX;
  return Math.max(MIN_WHEEL, Math.min(maxAllowed, raw));
}
  
  
  // --- Mobile pointer-drag support ---
const [isPtrDragging, setIsPtrDragging] = useState(false);
const [ptrDragCard, setPtrDragCard] = useState<Card | null>(null);
const ptrPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

function addTouchDragCss(on: boolean) {
  const root = document.documentElement;
  if (on) {
    // store previous to restore later
    (root as any).__prevTouchAction = root.style.touchAction;
    (root as any).__prevOverscroll = root.style.overscrollBehavior;
    root.style.touchAction = 'none';
    root.style.overscrollBehavior = 'contain';
  } else {
    root.style.touchAction = (root as any).__prevTouchAction ?? '';
    root.style.overscrollBehavior = (root as any).__prevOverscroll ?? '';
    delete (root as any).__prevTouchAction;
    delete (root as any).__prevOverscroll;
  }
}

function getDropTargetAt(x: number, y: number): { kind: 'wheel' | 'slot'; idx: number } | null {
  let el = document.elementFromPoint(x, y) as HTMLElement | null;
  while (el) {
    const d = (el as HTMLElement).dataset;
    if (d.drop && d.idx) {
      if (d.drop === 'wheel') return { kind: 'wheel', idx: Number(d.idx) };
      if (d.drop === 'slot')  return { kind: 'slot',  idx: Number(d.idx) };
    }
    el = el.parentElement;
  }
  return null;
}

function startPointerDrag(card: Card, e: React.PointerEvent) {
  // only trigger for touch/pen; mouse still uses native DnD you already have
  if (e.pointerType === 'mouse') return;
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
    setDragOverWheel(t && (t.kind === 'wheel' || t.kind === 'slot') ? t.idx : null);
    // avoid scroll while dragging
    ev.preventDefault?.();
  };

  const onUp = (ev: PointerEvent) => {
    const t = getDropTargetAt(ev.clientX, ev.clientY);
    if (t && active[t.idx]) {
      // assign card to that wheel index (slot clicks already map to a wheel index)
      assignToWheelLocal(t.idx, card);
    }
    cleanup();
  };

  const onCancel = () => cleanup();

  function cleanup() {
    window.removeEventListener('pointermove', onMove, { capture: true } as any);
    window.removeEventListener('pointerup', onUp, { capture: true } as any);
    window.removeEventListener('pointercancel', onCancel, { capture: true } as any);
    setIsPtrDragging(false);
    setPtrDragCard(null);
    setDragOverWheel(null);
    setDragCardId(null);
    addTouchDragCss(false);
  }

  window.addEventListener('pointermove', onMove, { passive: false, capture: true });
  window.addEventListener('pointerup', onUp, { passive: false, capture: true });
  window.addEventListener('pointercancel', onCancel, { passive: false, capture: true });
}
  
  // Responsive wheel size
  const [wheelSize, setWheelSize] = useState<number>(() => (typeof window !== 'undefined' ? calcWheelSize(window.innerHeight, window.innerWidth, 0) : MAX_WHEEL));
  useEffect(() => {
    const onResize = () => { if (freezeLayout || lockedWheelSize !== null) return; setWheelSize(calcWheelSize(window.innerHeight, window.innerWidth, handClearance)); };
    window.addEventListener('resize', onResize); window.addEventListener('orientationchange', onResize);
    const t = setTimeout(() => { if (!freezeLayout && lockedWheelSize === null) onResize(); }, 350);
    return () => { window.removeEventListener('resize', onResize); window.removeEventListener('orientationchange', onResize); clearTimeout(t); };
  }, [freezeLayout, handClearance, lockedWheelSize]);
  useEffect(() => { if (typeof window !== 'undefined' && !freezeLayout && lockedWheelSize === null) { setWheelSize(calcWheelSize(window.innerHeight, window.innerWidth, handClearance)); } }, [handClearance, freezeLayout, lockedWheelSize]);

  // Per-wheel sections & tokens & active
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

  // Assignments
  const [assign, setAssign] = useState<{ player: (Card | null)[]; enemy: (Card | null)[] }>({ player: [null, null, null], enemy: [null, null, null] });
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
  []
);

  const handleMPIntentRef = useRef<(intent: MPIntent) => void>(() => {});
  const spellCastRequestRef = useRef<(spell: SpellDefinition) => void>(() => {});
  const infoPopoverRootRef = useRef<HTMLDivElement | null>(null);

  const sendIntent = useCallback(
    (intent: MPIntent) => {
      if (!roomCode) return;
      try {
        void chanRef.current?.publish("intent", intent);
      } catch {}
    },
    [roomCode]
  );


  const broadcastLocalReserve = useCallback(() => {
    const lane = localLegacySide === "player" ? assignRef.current.player : assignRef.current.enemy;
    const reserve = computeReserveSum(localLegacySide, lane);
    const updated = storeReserveReport(localLegacySide, reserve, round);
    if (isMultiplayer && updated) {
      sendIntent({ type: "reserve", side: localLegacySide, reserve, round });
    }
  }, [isMultiplayer, localLegacySide, round, sendIntent, storeReserveReport, player, enemy]);


  // Drag state + tap-to-assign selected id
  const [dragCardId, setDragCardId] = useState<string | null>(null);
  const [dragOverWheel, _setDragOverWheel] = useState<number | null>(null);
  const dragOverRef = useRef<number | null>(null);
  const setDragOverWheel = (i: number | null) => { dragOverRef.current = i; (window as any).requestIdleCallback ? (window as any).requestIdleCallback(() => _setDragOverWheel(dragOverRef.current)) : setTimeout(() => _setDragOverWheel(dragOverRef.current), 0); };
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  // Reserve sums after resolve (HUD only)
  const [reserveSums, setReserveSums] = useState<null | { player: number; enemy: number }>(null);

  // Reference popover
  const [showRef, setShowRef] = useState(false);
  const [showGrimoire, setShowGrimoire] = useState(false);

  const appendLog = (s: string) => setLog((prev) => [s, ...prev].slice(0, 60));
  const START_LOG = "A Shade Bandit eyes your purse...";
  const [log, setLog] = useState<string[]>([START_LOG]);

  const playerMana = useMemo(() => {
    const maybe = (player as Fighter & { mana?: unknown }).mana;
    return typeof maybe === "number" && Number.isFinite(maybe) ? maybe : 0;
  }, [player]);

  const playerSpells = useMemo(() => {
    if (gameMode !== "grimoire") return [] as SpellDefinition[];
    return getLearnedSpellsForFighter(player);
  }, [gameMode, player]);

  useEffect(() => {
    if (gameMode !== "grimoire" && showGrimoire) {
      setShowGrimoire(false);
    }
  }, [gameMode, showGrimoire]);

  useEffect(() => {
    if (!showRef && !showGrimoire) return;

    const handlePointer = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (infoPopoverRootRef.current?.contains(target)) return;
      setShowRef(false);
      setShowGrimoire(false);
    };

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowRef(false);
        setShowGrimoire(false);
      }
    };

    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("touchstart", handlePointer);
    document.addEventListener("keydown", handleKey);

    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("touchstart", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [showRef, showGrimoire]);

  const handleSpellActivate = useCallback(
    (spell: SpellDefinition) => {
      if (gameMode !== "grimoire") return;
      spellCastRequestRef.current(spell);
      setShowGrimoire(false);
    },
    [gameMode]
  );

  const canReveal = useMemo(() => {
    const lane = localLegacySide === "player" ? assign.player : assign.enemy;
    return lane.every((c, i) => !active[i] || !!c);
  }, [assign, active, localLegacySide]);

  // Wheel refs for imperative token updates
  const wheelRefs = [useRef<WheelHandle | null>(null), useRef<WheelHandle | null>(null), useRef<WheelHandle | null>(null)];

  // ---- Assignment helpers (batched) ----
  const assignToWheelFor = useCallback(
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

        if (side === localLegacySide) {
          setSelectedCardId(null);
        }
      });

      clearResolveVotes();

      return true;
    },
    [active, clearResolveVotes, localLegacySide]

  );

  const clearAssignFor = useCallback(
    (side: LegacySide, laneIndex: number) => {
      const lane = side === "player" ? assignRef.current.player : assignRef.current.enemy;
      const prev = lane[laneIndex];
      if (!prev) return false;

      const isPlayer = side === "player";

      startTransition(() => {
        setAssign((prevState) => {
          const laneArr = isPlayer ? prevState.player : prevState.enemy;
          if (!laneArr[laneIndex]) return prevState;
          const nextLane = [...laneArr];
          nextLane[laneIndex] = null;
          return isPlayer ? { ...prevState, player: nextLane } : { ...prevState, enemy: nextLane };
        });

        if (isPlayer) {
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
    [clearResolveVotes, localLegacySide]
  );

  function assignToWheelLocal(i: number, card: Card) {
    const changed = assignToWheelFor(localLegacySide, i, card);
    if (changed && isMultiplayer) {
      sendIntent({ type: "assign", lane: i, side: localLegacySide, card });
    }
  }

  function clearAssign(i: number) {
    const changed = clearAssignFor(localLegacySide, i);
    if (changed && isMultiplayer) {
      sendIntent({ type: "clear", lane: i, side: localLegacySide });
    }
  }


function autoPickEnemy(): (Card | null)[] {
  const hand = [...enemy.hand].filter(isNormal);   // ← guard
  const picks: (Card | null)[] = [null, null, null];
  const take = (c: typeof hand[number]) => { const k = hand.indexOf(c); if (k >= 0) hand.splice(k, 1); return c; };
  const best = [...hand].sort((a, b) => b.number - a.number)[0]; if (best) picks[0] = take(best);
  const low  = [...hand].sort((a, b) => a.number - b.number)[0]; if (low) picks[1] = take(low);
  const sorted = [...hand].sort((a, b) => a.number - b.number); const mid = sorted[Math.floor(sorted.length / 2)]; if (mid) picks[2] = take(mid);
  for (let i = 0; i < 3; i++) if (!picks[i] && hand.length) picks[i] = take(hand[0]);
  return picks;
}

function computeReserveSum(who: LegacySide, used: (Card | null)[]) {
  const hand = who === "player" ? player.hand : enemy.hand;
  const usedIds = new Set((used.filter(Boolean) as Card[]).map((c) => c.id));
  const left = hand.filter((c) => !usedIds.has(c.id));
  return left.slice(0, 2).reduce((a, c) => a + (isNormal(c) ? c.number : 0), 0);
}

  useEffect(() => {
    broadcastLocalReserve();
  }, [broadcastLocalReserve, assign, player, enemy, localLegacySide, round, isMultiplayer]);

// Keep this: after a round, move only played cards out of hand, discard them, then draw.
function settleFighterAfterRound(f: Fighter, played: Card[]): Fighter {
  const playedIds = new Set(played.map((c) => c.id));
  const next: Fighter = {
    name: f.name,
    deck: [...f.deck],
    hand: f.hand.filter((c) => !playedIds.has(c.id)), // keep reserves in hand
    discard: [...f.discard, ...played],
  };

  // First, try to draw back to 5 using your existing deck util.
  const refilled = refillTo(next, 5);

  // Then, as a safety net, pad with neutral 0-cards if still short.
  return ensureFiveHand(refilled, 5);
}

// Small helper to top-up a hand with neutral 0-value cards if needed.
// Uses crypto.randomUUID() when available to avoid ID collisions.
function ensureFiveHand<T extends Fighter>(f: T, TARGET = 5): T {
  if (f.hand.length >= TARGET) return f;

  const padded = [...f.hand];
  while (padded.length < TARGET) {
    padded.push({
      id: typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `pad-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: "Reserve",
      number: 0,
      kind: "normal",
    } as unknown as Card);
  }
  return { ...f, hand: padded } as T;
}

  // ---------------- Reveal / Resolve ----------------
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

    [broadcastLocalReserve, canReveal, clearResolveVotes, isMultiplayer, resolveRound, setAssign, setEnemy, setFreezeLayout, setLockedWheelSize, setPhase, setSafeTimeout, wheelSize]

  );

  const onReveal = useCallback(() => revealRoundCore(), [revealRoundCore]);

  useEffect(() => {
    if (!isMultiplayer) return;
    if (phase !== "choose") return;
    if (!canReveal) return;
    if (!resolveVotes.player || !resolveVotes.enemy) return;
    revealRoundCore();
  }, [canReveal, isMultiplayer, phase, resolveVotes, revealRoundCore]);

  function resolveRound(enemyPicks?: (Card | null)[]) {
    const played = [0, 1, 2].map((i) => ({ p: assign.player[i] as Card | null, e: (enemyPicks?.[i] ?? assign.enemy[i]) as Card | null }));

    const localPlayed = localLegacySide === "player"
      ? played.map((pe) => pe.p)
      : played.map((pe) => pe.e);
    const remotePlayed = remoteLegacySide === "player"
      ? played.map((pe) => pe.p)
      : played.map((pe) => pe.e);

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

    // 🔸 show these during showEnemy/anim immediately
    setReserveSums({ player: pReserve, enemy: eReserve });

    type Outcome = { steps: number; targetSlice: number; section: Section; winner: LegacySide | null; tie: boolean; wheel: number; detail: string };
    const outcomes: Outcome[] = [];

    for (let w = 0; w < 3; w++) {
      const secList = wheelSections[w];
      const baseP = (played[w].p?.number ?? 0);
      const baseE = (played[w].e?.number ?? 0);
      const steps = ((baseP % SLICES) + (baseE % SLICES)) % SLICES;
      const targetSlice = (tokens[w] + steps) % SLICES;
      const section = secList.find((s) => targetSlice !== 0 && inSection(targetSlice, s)) || ({ id: "Strongest", color: "transparent", start: 0, end: 0 } as Section);

      const pVal = baseP; const eVal = baseE;
      let winner: LegacySide | null = null; let tie = false; let detail = "";
      switch (section.id) {
        case "Strongest": if (pVal === eVal) tie = true; else winner = pVal > eVal ? "player" : "enemy"; detail = `Strongest ${pVal} vs ${eVal}`; break;
        case "Weakest": if (pVal === eVal) tie = true; else winner = pVal < eVal ? "player" : "enemy"; detail = `Weakest ${pVal} vs ${eVal}`; break;
        case "ReserveSum": if (pReserve === eReserve) tie = true; else winner = pReserve > eReserve ? "player" : "enemy"; detail = `Reserve ${pReserve} vs ${eReserve}`; break;
        case "ClosestToTarget": {
          const t = targetSlice === 0 ? (section.target ?? 0) : targetSlice;
          const pd = Math.abs(pVal - t);
          const ed = Math.abs(eVal - t);
          if (pd === ed) tie = true;
          else winner = pd < ed ? "player" : "enemy";
          detail = `Closest to ${t}: ${pVal} vs ${eVal}`;
          break;
        }
        case "Initiative": winner = initiative; detail = `Initiative -> ${winner}`; break;
        default: tie = true; detail = `Slice 0: no section`; break;
      }
      outcomes.push({ steps, targetSlice, section, winner, tie, wheel: w, detail });
    }

    const animateSpins = async () => {
      const finalTokens: [number, number, number] = [...tokens] as [number, number, number];

      for (const o of outcomes) {
        const start = finalTokens[o.wheel]; const steps = o.steps; if (steps <= 0) continue;
        const total = Math.max(220, Math.min(1000, 110 + 70 * steps));
        const t0 = performance.now();
        await new Promise<void>((resolve) => {
          const frame = (now: number) => {
            if (!mountedRef.current) return resolve();
            const tt = Math.max(0, Math.min(1, (now - t0) / total));
            const progressed = Math.floor(easeInOutCubic(tt) * steps);
            wheelRefs[o.wheel].current?.setVisualToken((start + progressed) % SLICES);
            if (tt < 1) requestAnimationFrame(frame); else { wheelRefs[o.wheel].current?.setVisualToken((start + steps) % SLICES); resolve(); }
          };
          requestAnimationFrame(frame);
        });
        finalTokens[o.wheel] = (start + steps) % SLICES;
        await new Promise((r) => setTimeout(r, 90));
      }

      // Single commit after all wheels have finished
      setTokens(finalTokens);

      let pWins = wins.player, eWins = wins.enemy;
      let pMana = mana.player, eMana = mana.enemy;
      let hudColors: [string | null, string | null, string | null] = [null, null, null];
      const roundWinsCount: Record<LegacySide, number> = { player: 0, enemy: 0 };
      outcomes.forEach((o) => {
        if (o.tie) { appendLog(`Wheel ${o.wheel + 1} tie: ${o.detail} — no win.`); }
        else if (o.winner) {
          hudColors[o.wheel] = HUD_COLORS[o.winner];
          roundWinsCount[o.winner] += 1;
          if (o.winner === "player") {
            pWins++;
            pMana++;
          } else {
            eWins++;
            eMana++;
          }
          appendLog(`Wheel ${o.wheel + 1} win -> ${o.winner} (${o.detail}).`);
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
      setMana({ player: pMana, enemy: eMana });
      setReserveSums({ player: pReserve, enemy: eReserve });
      clearAdvanceVotes();
      setPhase("roundEnd");
      if (pWins >= winGoal || eWins >= winGoal) {
        clearRematchVotes();
        setPhase("ended");
        const localWins = localLegacySide === "player" ? pWins : eWins;
        appendLog(
          localWins >= winGoal
            ? "You win the match!"
            : `${namesByLegacy[remoteLegacySide]} wins the match!`
        );
      }
    };

    animateSpins();
  }

  const nextRoundCore = useCallback(
    (opts?: { force?: boolean }) => {
      const allow = opts?.force || phase === "roundEnd";
      if (!allow) return false;

      clearResolveVotes();
      clearAdvanceVotes();

      const currentAssign = assignRef.current;
      const playerPlayed = currentAssign.player.filter((c): c is Card => !!c);
      const enemyPlayed  = currentAssign.enemy.filter((c): c is Card => !!c);

      wheelRefs.forEach(ref => ref.current?.setVisualToken(0));

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
      setRound((r) => r + 1);

      return true;
    },
    [
      clearResolveVotes,
      clearAdvanceVotes,
      generateWheelSet,
      phase,
      setAssign,
      setDragCardId,
      setDragOverWheel,
      setEnemy,
      setFreezeLayout,
      setLockedWheelSize,
      setPhase,
      setPlayer,
      setReserveSums,
      setSelectedCardId,
      setTokens,
      setWheelHUD,
      setWheelSections,
      setRound,
      wheelRefs
    ]
  );

  // ✅ stable wrapper (pick ONE of these)

  // Option A: alias (simplest; same identity as memoized core)
  const nextRound = nextRoundCore;

  const handleMPIntent = useCallback(
    (msg: MPIntent) => {
      switch (msg.type) {
        case "assign": {
          if (msg.side === localLegacySide) break;
          assignToWheelFor(msg.side, msg.lane, msg.card);
          break;
        }
        case "clear": {
          if (msg.side === localLegacySide) break;
          clearAssignFor(msg.side, msg.lane);
          break;
        }
        case "reveal": {
          if (msg.side === localLegacySide) break;

          markResolveVote(msg.side);
          break;
        }
        case "nextRound": {
          if (msg.side === localLegacySide) break;
          markAdvanceVote(msg.side);
          break;
        }
        case "rematch": {
          if (msg.side === localLegacySide) break;
          markRematchVote(msg.side);
          break;
        }
        case "reserve": {
          if (msg.side === localLegacySide) break;
          if (typeof msg.reserve === "number" && typeof msg.round === "number") {
            storeReserveReport(msg.side, msg.reserve, msg.round);
          }
          break;
        }
        default:
          break;
      }
    },
    [assignToWheelFor, clearAssignFor, localLegacySide, markAdvanceVote, markRematchVote, markResolveVote, storeReserveReport]
  );

  useEffect(() => {
    handleMPIntentRef.current = handleMPIntent;
  }, [handleMPIntent]);

  useEffect(() => {
    if (!roomCode) {
      try { chanRef.current?.unsubscribe(); } catch {}
      try { chanRef.current?.detach(); } catch {}
      chanRef.current = null;
      if (ablyRef.current) {
        try { ablyRef.current.close(); } catch {}
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
          handleMPIntentRef.current(intent);
        });
      } catch {}
    })();

    return () => {
      activeSub = false;
      try { channel.unsubscribe(); } catch {}
      try { channel.detach(); } catch {}
      try { ably.close(); } catch {}
      if (chanRef.current === channel) {
        chanRef.current = null;
      }
      if (ablyRef.current === ably) {
        ablyRef.current = null;
      }
    };
  }, [roomCode, localPlayerId]);

  const handleRevealClick = useCallback(() => {
    if (phase !== "choose" || !canReveal) return;

    if (!isMultiplayer) {
      onReveal();
      return;
    }

    if (resolveVotes[localLegacySide]) return;

    markResolveVote(localLegacySide);
    sendIntent({ type: "reveal", side: localLegacySide });
  }, [canReveal, isMultiplayer, localLegacySide, markResolveVote, onReveal, phase, resolveVotes, sendIntent]);

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
    setMana({ player: 0, enemy: 0 });
    setRound(1);
    setPhase("choose");

    const emptyAssign: { player: (Card | null)[]; enemy: (Card | null)[] } = {
      player: [null, null, null],
      enemy: [null, null, null],
    };
    assignRef.current = emptyAssign;
    setAssign(emptyAssign);

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
    setMana,
    setTokens,
    setWheelHUD,
    setWheelSections,
    setWins,
    _setDragOverWheel,
    wheelRefs
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
  }, [
    isMultiplayer,
    localLegacySide,
    markRematchVote,
    phase,
    rematchVotes,
    resetMatch,
    sendIntent
  ]);

  const handleExitClick = useCallback(() => {
    onExit?.();
  }, [onExit]);



  // ---------------- UI ----------------

  const renderWheelPanel = (i: number) => {
  const pc = assign.player[i];
  const ec = assign.enemy[i];

  const leftSlot = { side: "player" as const, card: pc, name: namesByLegacy.player };
  const rightSlot = { side: "enemy" as const, card: ec, name: namesByLegacy.enemy };

  const ws = Math.round(lockedWheelSize ?? wheelSize);

  const isLeftSelected = !!leftSlot.card && selectedCardId === leftSlot.card.id;
  const isRightSelected = !!rightSlot.card && selectedCardId === rightSlot.card.id;

  const shouldShowLeftCard =
    !!leftSlot.card && (leftSlot.side === localLegacySide || phase !== "choose");
  const shouldShowRightCard =
    !!rightSlot.card && (rightSlot.side === localLegacySide || phase !== "choose");

  // --- layout numbers that must match the classes below ---
  const slotW    = 80;   // w-[80px] on both slots
  const gapX     = 16;   // gap-2 => 8px, two gaps between three items => 16
  const paddingX = 16;   // p-2 => 8px left + 8px right
  const borderX  = 4;    // border-2 => 2px left + 2px right
  const EXTRA_H  = 16;   // extra breathing room inside the panel (change to tweak height)

  // panel width (border-box) so wheel is visually centered
  const panelW = ws + slotW * 2 + gapX + paddingX + borderX;

  const renderSlotCard = (slot: typeof leftSlot, isSlotSelected: boolean) => {
    if (!slot.card) return null;
    const card = slot.card;
    const interactable = slot.side === localLegacySide && phase === "choose";

    const handlePick = () => {
      if (!interactable) return;
      if (selectedCardId) {
        tapAssignIfSelected();
      } else {
        setSelectedCardId(card.id);
      }
    };

    const handleDragStart = (e: React.DragEvent<HTMLButtonElement>) => {
      if (!interactable) return;
      setSelectedCardId(card.id);
      setDragCardId(card.id);
      try { e.dataTransfer.setData("text/plain", card.id); } catch {}
      e.dataTransfer.effectAllowed = "move";
    };

    const handleDragEnd = () => {
      setDragCardId(null);
      setDragOverWheel(null);
    };

    const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!interactable) return;
      e.stopPropagation();
      startPointerDrag(card, e);
    };

    return (
      <StSCard
        card={card}
        size="sm"
        disabled={!interactable}
        selected={isSlotSelected}
        onPick={handlePick}
        draggable={interactable}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onPointerDown={handlePointerDown}
      />
    );
  };

  const onZoneDragOver = (e: React.DragEvent) => { e.preventDefault(); if (dragCardId && active[i]) setDragOverWheel(i); };
  const onZoneLeave = () => { if (dragCardId) setDragOverWheel(null); };
  const handleDropCommon = (id: string | null, targetSide?: LegacySide) => {
    if (!id || !active[i]) return;
    const intendedSide = targetSide ?? localLegacySide;
    if (intendedSide !== localLegacySide) {
      setDragOverWheel(null);
      setDragCardId(null);
      return;
    }

    const isLocalPlayer = localLegacySide === "player";
    const fromHand = (isLocalPlayer ? player.hand : enemy.hand).find((c) => c.id === id);
    const fromSlots = (isLocalPlayer ? assign.player : assign.enemy).find((c) => c && c.id === id) as Card | undefined;
    const card = fromHand || fromSlots || null;
    if (card) assignToWheelLocal(i, card as Card);
    setDragOverWheel(null);
    setDragCardId(null);
  };
  const onZoneDrop = (e: React.DragEvent, targetSide?: LegacySide) => {
    e.preventDefault();
    handleDropCommon(e.dataTransfer.getData("text/plain") || dragCardId, targetSide);
  };

  const tapAssignIfSelected = () => {
    if (!selectedCardId) return;
    const isLocalPlayer = localLegacySide === "player";
    const card =
      (isLocalPlayer ? player.hand : enemy.hand).find(c => c.id === selectedCardId) ||
      (isLocalPlayer ? assign.player : assign.enemy).find(c => c?.id === selectedCardId) ||
      null;
    if (card) assignToWheelLocal(i, card as Card);
  };

  const panelShadow = '0 2px 8px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.04)';

  return (
    <div
      className="relative rounded-xl border p-2 shadow flex-none"
      style={{
        width: panelW,
        height: ws + EXTRA_H,
        background: `linear-gradient(180deg, rgba(255,255,255,.04) 0%, rgba(0,0,0,.14) 100%), ${THEME.panelBg}`,
        borderColor: THEME.panelBorder,
        borderWidth: 2,
        boxShadow: panelShadow,
        contain: 'paint',
        backfaceVisibility: 'hidden',
        transform: 'translateZ(0)',
        isolation: 'isolate'
      }}
    >
  {/* ADD: winner dots (don’t affect layout) */}
  { (phase === "roundEnd" || phase === "ended") && (
    <>
      {/* Player dot (top-left) */}
      <span
        aria-label={`Wheel ${i+1} player result`}
        className="absolute top-1 left-1 rounded-full border"
        style={{
          width: 10,
          height: 10,
          background: wheelHUD[i] === HUD_COLORS.player ? HUD_COLORS.player : 'transparent',
          borderColor: wheelHUD[i] === HUD_COLORS.player ? HUD_COLORS.player : THEME.panelBorder,
          boxShadow: '0 0 0 1px rgba(0,0,0,0.4)'
        }}
      />

      {/* Enemy dot (top-right) */}
      <span
        aria-label={`Wheel ${i+1} enemy result`}
        className="absolute top-1 right-1 rounded-full border"
        style={{
          width: 10,
          height: 10,
          background: wheelHUD[i] === HUD_COLORS.enemy ? HUD_COLORS.enemy : 'transparent',
          borderColor: wheelHUD[i] === HUD_COLORS.enemy ? HUD_COLORS.enemy : THEME.panelBorder,
          boxShadow: '0 0 0 1px rgba(0,0,0,0.4)'
        }}
      />
    </>
  )}

  {/* the row: slots + centered wheel */}
  <div
    className="flex items-center justify-center gap-2"
    style={{ height: (ws + EXTRA_H) /* removed the - 3 */ }}
  >
        {/* Player slot */}
        <div
          data-drop="slot"
          data-idx={i}
          onDragOver={onZoneDragOver}
          onDragEnter={onZoneDragOver}
          onDragLeave={onZoneLeave}
          onDrop={(e) => onZoneDrop(e, "player")}
          onClick={(e) => {
            e.stopPropagation();
            if (leftSlot.side !== localLegacySide) return;
            if (selectedCardId) {
              // If a hand card is already selected, assign it here (this also swaps)
              tapAssignIfSelected();
            } else if (leftSlot.card) {
              // 🔸 Arm this placed card for swapping (select it)
              setSelectedCardId(leftSlot.card.id);
            }
          }}
          className="w-[80px] h-[92px] rounded-md border px-1 py-0 flex items-center justify-center flex-none"
          style={{
            backgroundColor: dragOverWheel === i || isLeftSelected ? 'rgba(182,138,78,.12)' : THEME.slotBg,
            borderColor:     dragOverWheel === i || isLeftSelected ? THEME.brass          : THEME.slotBorder,
            boxShadow: isLeftSelected ? '0 0 0 1px rgba(251,191,36,0.7)' : 'none',
          }}
          aria-label={`Wheel ${i+1} left slot`}
        >
          {shouldShowLeftCard
            ? renderSlotCard(leftSlot, isLeftSelected)
            : <div className="text-[11px] opacity-80 text-center">
                {leftSlot.side === localLegacySide ? "Your card" : leftSlot.name}
              </div>}
        </div>

  {/* Wheel face (fixed width equals wheel size; centers wheel exactly) */}
  <div
  data-drop="wheel"
  data-idx={i}
  className="relative flex-none flex items-center justify-center rounded-full overflow-hidden"
  style={{ width: ws, height: ws }}
  onDragOver={onZoneDragOver}
  onDragEnter={onZoneDragOver}
  onDragLeave={onZoneLeave}
  onDrop={onZoneDrop}
  onClick={(e) => { e.stopPropagation(); tapAssignIfSelected(); }}
  aria-label={`Wheel ${i+1}`}
>
    <CanvasWheel ref={wheelRefs[i]} sections={wheelSections[i]} size={ws} />
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 rounded-full"
      style={{ boxShadow: dragOverWheel === i ? '0 0 0 2px rgba(251,191,36,0.7) inset' : 'none' }}
    />
  </div>
    
        {/* Enemy slot */}
        <div
          className="w-[80px] h-[92px] rounded-md border px-1 py-0 flex items-center justify-center flex-none"
          style={{
            backgroundColor: dragOverWheel === i || isRightSelected ? 'rgba(182,138,78,.12)' : THEME.slotBg,
            borderColor:     dragOverWheel === i || isRightSelected ? THEME.brass          : THEME.slotBorder,
            boxShadow: isRightSelected ? '0 0 0 1px rgba(251,191,36,0.7)' : 'none',
          }}
          aria-label={`Wheel ${i+1} right slot`}
          data-drop="slot"
          data-idx={i}
          onDragOver={onZoneDragOver}
          onDragEnter={onZoneDragOver}
          onDragLeave={onZoneLeave}
          onDrop={(e) => onZoneDrop(e, "enemy")}
          onClick={(e) => {
            e.stopPropagation();
            if (rightSlot.side !== localLegacySide) return;
            if (selectedCardId) {
              tapAssignIfSelected();
            } else if (rightSlot.card) {
              setSelectedCardId(rightSlot.card.id);
            }
          }}
        >
          {shouldShowRightCard
            ? renderSlotCard(rightSlot, isRightSelected)
            : <div className="text-[11px] opacity-60 text-center">
                {rightSlot.side === localLegacySide ? "Your card" : rightSlot.name}
              </div>}
        </div>
      </div>
    </div>
  );
};

  const HandDock = ({ onMeasure }: { onMeasure?: (px: number) => void }) => {
    const dockRef = useRef<HTMLDivElement | null>(null);
    const [liftPx, setLiftPx] = useState<number>(18);
    useEffect(() => {
      const compute = () => {
        const root = dockRef.current; if (!root) return;
        const sample = root.querySelector('[data-hand-card]') as HTMLElement | null; if (!sample) return;
        const h = sample.getBoundingClientRect().height || 96;
        const nextLift = Math.round(Math.min(44, Math.max(12, h * 0.34)));
        setLiftPx(nextLift);
        const clearance = Math.round(h + nextLift + 12);
        onMeasure?.(clearance);
      };
      compute(); window.addEventListener('resize', compute); window.addEventListener('orientationchange', compute);
      return () => { window.removeEventListener('resize', compute); window.removeEventListener('orientationchange', compute); };
    }, [onMeasure]);

    const localFighter: Fighter = localLegacySide === "player" ? player : enemy;

    return (
      <div ref={dockRef} className="fixed left-0 right-0 bottom-0 z-50 pointer-events-none select-none" style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + -30px)' }}>
        <div className="mx-auto max-w-[1400px] flex justify-center gap-1.5 py-0.5">
          {localFighter.hand.map((card, idx) => {
            const isSelected = selectedCardId === card.id;
            return (
              <div key={card.id} className="group relative pointer-events-auto" style={{ zIndex: 10 + idx }}>
                <motion.div data-hand-card initial={false} animate={{ y: isSelected ? -Math.max(8, liftPx - 10) : -liftPx, opacity: 1, scale: isSelected ? 1.06 : 1 }} whileHover={{ y: -Math.max(8, liftPx - 10), opacity: 1, scale: 1.04 }} transition={{ type: 'spring', stiffness: 320, damping: 22 }} className={`drop-shadow-xl ${isSelected ? 'ring-2 ring-amber-300' : ''}`}>
                  <button
  data-hand-card
  className="pointer-events-auto"
  onClick={(e) => {
    e.stopPropagation();
    if (!selectedCardId) {
      setSelectedCardId(card.id);
      return;
    }

    if (selectedCardId === card.id) {
      setSelectedCardId(null);
      return;
    }

    const lane = localLegacySide === "player" ? assign.player : assign.enemy;
    const slotIdx = lane.findIndex((c) => c?.id === selectedCardId);
    if (slotIdx !== -1) {
      assignToWheelLocal(slotIdx, card);
      return;
    }

    setSelectedCardId(card.id);
  }}
  draggable
  onDragStart={(e) => {
    // Desktop HTML5 drag
    setDragCardId(card.id);
    try { e.dataTransfer.setData("text/plain", card.id); } catch {}
    e.dataTransfer.effectAllowed = "move";
  }}
  onDragEnd={() => setDragCardId(null)}
  onPointerDown={(e) => startPointerDrag(card, e)}   // ← NEW: touch/pen drag
  aria-pressed={isSelected}
  aria-label={`Select ${card.name}`}
>
  <StSCard card={card} />
</button>

                </motion.div>
              </div>
            );
          })}
        </div>
{/* Touch drag ghost (mobile) */}
{isPtrDragging && ptrDragCard && (
  <div
    style={{
      position: 'fixed',
      left: 0,
      top: 0,
      transform: `translate(${ptrPos.current.x - 48}px, ${ptrPos.current.y - 64}px)`,
      pointerEvents: 'none',
      zIndex: 9999,
    }}
    aria-hidden
  >
    <div style={{ transform: 'scale(0.9)', filter: 'drop-shadow(0 6px 8px rgba(0,0,0,.35))' }}>
      <StSCard card={ptrDragCard} />
    </div>
  </div>
)}

      </div>
    );
  };

const HUDPanels = ({
  mana,
  isGrimoireMode,
}: {
  mana: { player: number; enemy: number };
  isGrimoireMode: boolean;
}) => {
  const rsP = reserveSums ? reserveSums.player : null;
  const rsE = reserveSums ? reserveSums.enemy : null;

  const Panel = ({ side }: { side: LegacySide }) => {
    const isPlayer = side === 'player';
    const color = isPlayer ? (players.left.color ?? HUD_COLORS.player) : (players.right.color ?? HUD_COLORS.enemy);
    const name = isPlayer ? players.left.name : players.right.name;
    const win = isPlayer ? wins.player : wins.enemy;
    const manaCount = isPlayer ? mana.player : mana.enemy;
    const rs = isPlayer ? rsP : rsE;
    const hasInit = initiative === side;
    const isReserveVisible =
      (phase === 'showEnemy' || phase === 'anim' || phase === 'roundEnd' || phase === 'ended') &&
      rs !== null;

    return (
      <div className="flex h-full flex-col items-center w-full">
        {/* HUD row (flag moved inside; absolute to avoid layout shift) */}
        <div
          className="relative flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1 text-[12px] shadow w-full"
          style={{
            maxWidth: '100%',
            background: THEME.panelBg,
            borderColor: THEME.panelBorder,
            color: THEME.textWarm,
          }}
        >
          <div className="w-1.5 h-6 rounded" style={{ background: color }} />
          <div className="flex items-center min-w-0 flex-1">
            <span className="truncate block font-semibold">{name}</span>
            {(isPlayer ? "player" : "enemy") === localLegacySide && (
              <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px]">You</span>
            )}
          </div>
          <div className="flex items-center gap-3 ml-1 flex-shrink-0">
            <div className="flex items-center gap-1">
              <span className="opacity-80">Wins</span>
              <span className="text-base font-extrabold tabular-nums">{win}</span>
            </div>
            <div
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-opacity ${
                isGrimoireMode ? 'opacity-100 visible' : 'opacity-0 invisible'
              }`}
              style={{
                background: '#1b1209ee',
                borderColor: THEME.slotBorder,
                color: THEME.textWarm,
                minWidth: '62px',
                justifyContent: 'center',
              }}
              aria-hidden={!isGrimoireMode}
              title={isGrimoireMode ? `Mana: ${manaCount}` : undefined}
            >
              <span role="img" aria-label="Mana" className="text-sm leading-none">
                🔮
              </span>
              <span className="tabular-nums text-sm leading-none">{manaCount}</span>
            </div>
          </div>
          <div
            className={`ml-2 hidden sm:flex rounded-full border px-2 py-0.5 text-[11px] overflow-hidden text-ellipsis whitespace-nowrap transition-opacity ${
              isReserveVisible ? 'opacity-100 visible' : 'opacity-0 invisible'
            }`}
            style={{
              maxWidth: '44vw',
              minWidth: '90px',
              background: '#1b1209ee',
              borderColor: THEME.slotBorder,
              color: THEME.textWarm,
            }}
            title={rs !== null ? `Reserve: ${rs}` : undefined}
          >
            Reserve: <span className="font-bold tabular-nums">{rs ?? 0}</span>
          </div>

          {/* Initiative flag — absolute, no extra height */}
          {hasInit && (
            <span
              aria-label="Has initiative"
              className="absolute -top-1 -right-1 leading-none select-none"
              style={{
                fontSize: 24,
                filter: 'drop-shadow(0 1px 1px rgba(0,0,0,.6))',
              }}
            >
              ⚑
            </span>
          )}
        </div>

        {isReserveVisible && (
          <div className="mt-1 w-full sm:hidden">
            <div className="w-full flex flex-col gap-1">
              <div
                className="w-full rounded-full border px-3 py-1 text-[11px] text-center"
                style={{
                  background: '#1b1209ee',
                  borderColor: THEME.slotBorder,
                  color: THEME.textWarm,
                }}
                title={rs !== null ? `Reserve: ${rs}` : undefined}
              >
                Reserve: <span className="font-bold tabular-nums">{rs ?? 0}</span>
              </div>
              <div
                className={`w-full rounded-full border px-3 py-1 text-[11px] text-center transition-opacity ${
                  isGrimoireMode ? 'opacity-100 visible' : 'opacity-0 invisible'
                }`}
                style={{
                  background: '#1b1209ee',
                  borderColor: THEME.slotBorder,
                  color: THEME.textWarm,
                }}
                aria-hidden={!isGrimoireMode}
                title={isGrimoireMode ? `Mana: ${manaCount}` : undefined}
              >
                <span className="font-semibold">Mana:</span>{' '}
                <span className="font-bold tabular-nums">{manaCount}</span>
              </div>
            </div>
          </div>
        )}

        {/* (removed) old outside flag that was pushing layout down */}
        {/* {hasInit && <span className="mt-1" aria-label="Has initiative">⚑</span>} */}
      </div>
    );
  };

  return (
    <div className="w-full flex flex-col items-center">
      <div className="grid w-full max-w-[900px] grid-cols-2 items-stretch gap-2 overflow-x-hidden">
        <div className="min-w-0 w-full max-w-[420px] mx-auto h-full">
          <Panel side="player" />
        </div>
        <div className="min-w-0 w-full max-w-[420px] mx-auto h-full">
          <Panel side="enemy" />
        </div>
      </div>
    </div>
  );
};


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
  const [victoryCollapsed, setVictoryCollapsed] = useState(false); // or true if you want banner-first
  useEffect(() => {
    if (phase !== "ended") setVictoryCollapsed(false); // reset when leaving "ended"
  }, [phase]);

  const rootModeClassName = isGrimoireMode ? "grimoire-mode" : "classic-mode";
  const grimoireAttrValue = isGrimoireMode ? "true" : "false";

  return (
    <div
      className={`h-screen w-screen overflow-x-hidden overflow-y-hidden text-slate-100 p-1 grid gap-2 ${rootModeClassName}`}
      style={{ gridTemplateRows: "auto auto 1fr auto" }}
      data-game-mode={gameMode}
      data-mana-enabled={grimoireAttrValue}
      data-spells-enabled={grimoireAttrValue}
      data-archetypes-enabled={grimoireAttrValue}
    >
      {/* Controls */}
      <div className="flex items-center justify-between text-[12px] min-h-[24px]">
        <div className="flex items-center gap-3">
          <div><span className="opacity-70">Round</span> <span className="font-semibold">{round}</span></div>
          <div><span className="opacity-70">Phase</span> <span className="font-semibold">{phase}</span></div>
          <div><span className="opacity-70">Goal</span> <span className="font-semibold">First to {winGoal} wins</span></div>
        </div>
        <div ref={infoPopoverRootRef} className="flex items-center gap-2 relative">
          <div className="relative">
            <button
              onClick={() =>
                setShowRef((prev) => {
                  const next = !prev;
                  if (next) setShowGrimoire(false);
                  return next;
                })
              }
              className="px-2.5 py-0.5 rounded bg-slate-700 text-white border border-slate-600 hover:bg-slate-600"
            >
              Reference
            </button>
            {showRef && (
              <div className="absolute top-[110%] right-0 w-80 rounded-lg border border-slate-700 bg-slate-800/95 shadow-xl p-3 z-50">
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
                    Place <span className="font-semibold">1 card next to each wheel</span>, then <span className="font-semibold">press the Resolve button</span>. Where the <span className="font-semibold">token stops</span> decides the winnning rule, and the player who matches it gets <span className="font-semibold">1 win</span>. First to <span className="font-semibold">{winGoal}</span> wins takes the match.
                  </div>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>💥 Strongest — higher value wins</li>
                    <li>🦊 Weakest — lower value wins</li>
                    <li>🗃️ Reserve — compare the two cards left in hand</li>
                    <li>🎯 Closest — value closest to target wins</li>
                    <li>⚑ Initiative — initiative holder wins</li>
                    <li>
                      <span className="font-semibold">0 Start</span> — no one wins
                    </li>
                  </ul>
                </div>
              </div>
            )}
          </div>
          {gameMode === "grimoire" && (
            <div className="relative">
              <button
                onClick={() =>
                  setShowGrimoire((prev) => {
                    const next = !prev;
                    if (next) setShowRef(false);
                    return next;
                  })
                }
                className="px-2.5 py-0.5 rounded bg-slate-700 text-white border border-slate-600 hover:bg-slate-600"
              >
                Grimoire
              </button>
              {showGrimoire && (
                <div className="absolute top-[110%] left-0 w-80 rounded-lg border border-slate-700 bg-slate-800/95 shadow-xl p-3 z-50">
                  <div className="flex items-center justify-between mb-1">
                    <div className="font-semibold">Grimoire</div>
                    <button
                      onClick={() => setShowGrimoire(false)}
                      className="text-xl leading-none text-slate-300 hover:text-white"
                    >
                      ×
                    </button>
                  </div>
                  <div className="text-[12px] space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-slate-300">
                      <span className="flex items-center gap-1">
                        <span aria-hidden className="text-sky-300">🔹</span>
                        <span>Mana</span>
                      </span>
                      <span className="font-semibold text-slate-100">{playerMana}</span>
                    </div>
                    {playerSpells.length === 0 ? (
                      <div className="italic text-slate-400">No spells learned yet.</div>
                    ) : (
                      <ul className="space-y-1">
                        {playerSpells.map((spell) => {
                          const allowedPhases = spell.allowedPhases ?? ["choose"];
                          const phaseAllowed = allowedPhases.includes(phase);
                          const canAfford = playerMana >= spell.cost;
                          const disabled = !phaseAllowed || !canAfford;
                          return (
                            <li key={spell.id}>
                              <button
                                type="button"
                                onClick={() => handleSpellActivate(spell)}
                                disabled={disabled}
                                className={`w-full rounded border border-slate-700/70 bg-slate-900/60 px-2 py-1.5 text-left transition ${
                                  disabled
                                    ? "cursor-not-allowed opacity-50"
                                    : "hover:bg-slate-800/80 focus:outline-none focus:ring-2 focus:ring-slate-500/50"
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-1 font-semibold text-[13px]">
                                    {spell.icon ? (
                                      <span aria-hidden>{spell.icon}</span>
                                    ) : null}
                                    <span>{spell.name}</span>
                                  </div>
                                  <div className="flex items-center gap-1 text-[11px] text-sky-200">
                                    <span aria-hidden className="text-[14px] leading-none">🔹</span>
                                    <span>{spell.cost}</span>
                                  </div>
                                </div>
                                <div className="mt-1 text-[11px] leading-snug text-slate-300">{spell.description}</div>
                                {!phaseAllowed && (
                                  <div className="mt-1 text-[10px] uppercase tracking-wide text-amber-200">
                                    Unavailable this phase
                                  </div>
                                )}
                                {!canAfford && (
                                  <div className="mt-1 text-[10px] uppercase tracking-wide text-rose-200">
                                    Not enough mana
                                  </div>
                                )}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          {phase === "choose" && (
            <div className="flex flex-col items-end gap-1">
              <button
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
        </div>
      </div>

      {/* HUD */}
      <div className="relative z-10"><HUDPanels mana={mana} isGrimoireMode={isGrimoireMode} /></div>

      {/* Wheels center */}
      <div className="relative z-0" style={{ paddingBottom: handClearance }}>
        <div className="flex flex-col items-center justify-start gap-1">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex-shrink-0">{renderWheelPanel(i)}</div>
          ))}
        </div>
      </div>

      {/* Docked hand overlay */}
      <HandDock onMeasure={setHandClearance} />

      {/* Ended overlay (banner + modal) */}
      {phase === "ended" && (
        <>
          {victoryCollapsed ? (
            <button
              onClick={() => setVictoryCollapsed(false)}
              className={`fixed top-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border px-4 py-2 text-sm font-semibold shadow-lg transition hover:-translate-y-[1px] focus:outline-none focus:ring-2 focus:ring-emerald-400/60 ${
                localWon
                  ? "border-emerald-500/40 bg-emerald-900/70 text-emerald-100"
                  : "border-slate-700 bg-slate-900/80 text-slate-100"
              }`}
            >
              <span className="rounded-full bg-slate-950/40 px-2 py-0.5 text-xs uppercase tracking-wide">
                {localWon ? "Victory" : "Defeat"}
              </span>
              <span className="text-xs opacity-80">Tap to reopen results</span>
              {localWon && matchSummary?.expGained ? (
                <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] text-emerald-100">
                  +{matchSummary.expGained} XP
                </span>
              ) : null}
            </button>
          ) : null}

          {!victoryCollapsed && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm px-3">
              <div className="relative w-full max-w-sm rounded-lg border border-slate-700 bg-slate-900/95 p-6 text-center shadow-2xl space-y-4">
                {/* Minimize */}
          <button
            onClick={() => setVictoryCollapsed(true)}
            
            className="group absolute top-2 right-2 flex h-10 w-10 items-center justify-center rounded-lg border border-slate-700/70 bg-slate-800/80 text-slate-200 transition hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-400/60"
            aria-label="Minimize results"
            title="Minimize"
          >
            <div className="flex flex-col items-end text-right leading-none">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-200/80 transition group-hover:text-emerald-100">
                Hide
              </span>
              <svg
                aria-hidden
                focusable="false"
                className="mt-1 h-5 w-5 text-emerald-200 transition group-hover:text-emerald-100"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path d="M4 10a1 1 0 0 1 1-1h6.586L9.293 6.707a1 1 0 1 1 1.414-1.414l4.5 4.5a1 1 0 0 1 0 1.414l-4.5 4.5a1 1 0 0 1-1.414-1.414L11.586 11H5a1 1 0 0 1-1-1Z" />
              </svg>
            </div>
            <span className="text-lg font-semibold leading-none text-slate-200 transition group-hover:text-white">–</span>
          </button>

          <div className={`text-3xl font-bold ${localWon ? "text-emerald-300" : "text-rose-300"}`}>
            {localWon ? "Victory" : "Defeat"}
          </div>

          <div className="text-sm text-slate-200">
            {localWon
              ? `You reached ${winGoal} wins.`
              : `${winnerName ?? remoteName} reached ${winGoal} wins.`}
          </div>

          <div className="rounded-md border border-slate-700 bg-slate-800/80 px-4 py-3 text-sm text-slate-100">
            <div className="font-semibold tracking-wide uppercase text-xs text-slate-400">Final Score</div>
            <div className="mt-2 flex items-center justify-center gap-3 text-base font-semibold">
              <span className="text-emerald-300">{localName}</span>
              <span className="px-2 py-0.5 rounded bg-slate-900/60 text-slate-200 tabular-nums">{localWinsCount}</span>
              <span className="text-slate-500">—</span>
              <span className="px-2 py-0.5 rounded bg-slate-900/60 text-slate-200 tabular-nums">{remoteWinsCount}</span>
              <span className="text-rose-300">{remoteName}</span>
            </div>
          </div>

          {localWon && matchSummary?.didWin && xpDisplay && (
            <div className="rounded-md border border-emerald-500/40 bg-emerald-900/15 px-4 py-3 text-sm text-emerald-50">
              <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-emerald-200/80">
                <span>Level {xpDisplay.level}</span>
                <span>
                  {xpDisplay.exp} / {xpDisplay.expToNext} XP
                </span>
              </div>
              <div className="mt-2 h-2 rounded-full bg-emerald-950/50">
                <div
                  className="h-2 rounded-full bg-emerald-400 transition-[width] duration-500"
                  style={{ width: `${xpProgressPercent}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-emerald-100/90">
                <span>+{matchSummary.expGained} XP</span>
                <span>Win streak: {matchSummary.streak}</span>
              </div>
              {levelUpFlash && (
                <div className="mt-2 text-base font-semibold uppercase tracking-wide text-amber-200">
                  Level up!
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <button
              disabled={isMultiplayer && localRematchReady}
              onClick={handleRematchClick}
              className="w-full rounded bg-emerald-500 px-4 py-2 font-semibold text-slate-900 disabled:opacity-50"
            >
              {rematchButtonLabel}
            </button>
            {isMultiplayer && rematchStatusText && (
              <span className="text-[11px] italic text-amber-200 leading-tight">
                {rematchStatusText}
              </span>
            )}
            {onExit && (
              <button
                onClick={handleExitClick}
                className="w-full rounded border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
              >
                Exit to Main Menu
              </button>
            )}
          </div>
        </div>
      </div>
    )}
  </>
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
