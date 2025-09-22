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
  resolveMatchMode,
  type Side as TwoSide,
  type Card,
  type Section,
  type VC,
  type Fighter,
  type SplitChoiceMap,
  type Players,

  type WheelArchetype,

  type MatchModeId,

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
  getWheelLoadout,
} from "./player/profileStore";
import { fmtNum } from "./game/values";

// components
import CanvasWheel, { WheelHandle } from "./components/CanvasWheel";
import StSCard from "./components/StSCard";

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

// ==== Merged: Spell planning + Combo evaluation ====

/** Spell planning for pre-spin effects. */
type PreSpinPlan = {
  notes: string[];
  fireball: Partial<Record<number, number>>;
  iceShard: Partial<Record<number, boolean>>;
  mirrorImage: Partial<Record<number, boolean>>;
  arcaneShift: Partial<Record<number, number>>;
  hexPenalty: number;
  initiativeSwapped: boolean;
};

const createEmptyPlan = (): PreSpinPlan => ({
  notes: [],
  fireball: {},
  iceShard: {},
  mirrorImage: {},
  arcaneShift: {},
  hexPenalty: 0,
  initiativeSwapped: false,
});

/** Reserve HUD breakdown for UI. */
type ReserveHUD = {
  total: number;
  base: number;
  bonus: number;
  notes: string[];
};

/** Per-lane combo results (bonuses + notes) used by wheels. */
type ComboLaneResult = {
  laneBonus: number[];
  laneNotes: string[][];
};

/**
 * Evaluate link/number-match combos for each side and lane.
 * Produces additional step bonuses and human-readable lane notes.
 */
function evaluateCombos(assignments: {
  player: (Card | null)[];
  enemy: (Card | null)[];
}): Record<LegacySide, ComboLaneResult> {
  const base: Record<LegacySide, ComboLaneResult> = {
    player: {
      laneBonus: Array(assignments.player.length).fill(0),
      laneNotes: Array.from({ length: assignments.player.length }, () => [] as string[]),
    },
    enemy: {
      laneBonus: Array(assignments.enemy.length).fill(0),
      laneNotes: Array.from({ length: assignments.enemy.length }, () => [] as string[]),
    },
  };

  (Object.keys(base) as LegacySide[]).forEach((side) => {
    const slots = assignments[side];
    const laneBonus = base[side].laneBonus;
    const laneNotes = base[side].laneNotes;

    const byCard = new Map<string, { card: Card; lanes: number[] }>();
    const byNumber = new Map<number, { cards: Card[]; lanes: number[] }>();

    // Group by exact card (for multi-lane links) and by number (for number matches)
    slots.forEach((card, laneIdx) => {
      if (!card) return;

      if (!byCard.has(card.id)) byCard.set(card.id, { card, lanes: [] });
      byCard.get(card.id)!.lanes.push(laneIdx);

      // Safe property check: only treat cards with a numeric value as "number" combos
      if (typeof card.number === "number") {
        if (!byNumber.has(card.number)) byNumber.set(card.number, { cards: [], lanes: [] });
        const entry = byNumber.get(card.number)!;
        entry.cards.push(card);
        entry.lanes.push(laneIdx);
      }
    });

    // Multi-lane same-card link bonus
    byCard.forEach(({ card, lanes }) => {
      if (!card.multiLane || lanes.length <= 1) return;
      const descriptor = card.linkDescriptors?.find((d) => d.kind === "lane");
      const bonus = descriptor?.bonusSteps ?? 2;
      const label = descriptor?.label ?? "Lane link";
      lanes.forEach((i) => {
        if (i >= laneBonus.length) return;
        laneBonus[i] += bonus;
        laneNotes[i].push(`${label} +${bonus}`);
      });
    });

    // Same-number across lanes bonus
    byNumber.forEach(({ cards, lanes }, number) => {
      if (lanes.length <= 1) return;
      const descriptor = cards
        .map((c) => c.linkDescriptors?.find((d) => d.kind === "numberMatch"))
        .find((d): d is NonNullable<typeof d> => !!d);
      const bonus = descriptor?.bonusSteps ?? 1;
      const label = descriptor?.label ?? `Match ${fmtNum(number)}`;
      lanes.forEach((i) => {
        if (i >= laneBonus.length) return;
        laneBonus[i] += bonus;
        laneNotes[i].push(`${label} +${bonus}`);
      });
    });
  });

  return base;
}


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

const OPPOSITE_SIDE: Record<LegacySide, LegacySide> = {
  player: "enemy",
  enemy: "player",
};

const uniqueSorted = (values: number[]) => Array.from(new Set(values)).sort((a, b) => a - b);

const cardReserveValue = (card: Card | null | undefined): number => {
  if (!card) return 0;
  if (card.meta?.decoy?.reserveValue !== undefined) return card.meta.decoy.reserveValue ?? 0;
  if (typeof card.number === "number") return card.number;
  return 0;
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
  modeId,
  timerSeconds: timerSecondsProp,
  onExit,
}: {
  localSide: TwoSide;
  localPlayerId: string;
  players: Players;
  seed: number;
  roomCode?: string;
  hostId?: string;
  targetWins?: number;
  modeId?: MatchModeId;
  timerSeconds?: number | null;
  onExit?: () => void;
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

  const sanitizedTargetWins =
    typeof targetWins === "number" && Number.isFinite(targetWins)
      ? Math.max(1, Math.min(25, Math.round(targetWins)))
      : null;

  const sanitizedTimerSeconds =
    typeof timerSecondsProp === "number" && Number.isFinite(timerSecondsProp) && timerSecondsProp > 0
      ? Math.max(1, Math.round(timerSecondsProp))
      : null;

  const matchMode = useMemo(() => {
    const base = resolveMatchMode(modeId ?? null);
    const wins = sanitizedTargetWins ?? base.targetWins ?? TARGET_WINS;
    const timer =
      sanitizedTimerSeconds !== null
        ? sanitizedTimerSeconds
        : typeof base.timerSeconds === "number" && base.timerSeconds > 0
        ? Math.round(base.timerSeconds)
        : null;
    return { ...base, targetWins: wins, timerSeconds: timer };
  }, [modeId, sanitizedTargetWins, sanitizedTimerSeconds]);

  const winGoal = matchMode.targetWins;
  const initialTimerSeconds =
    typeof matchMode.timerSeconds === "number" && matchMode.timerSeconds > 0
      ? matchMode.timerSeconds
      : null;


  const hostLegacySide: LegacySide = (() => {
    if (!hostId) return "player";
    if (players.left.id === hostId) return "player";
    if (players.right.id === hostId) return "enemy";
    return "player";
  })();

  const isMultiplayer = !!roomCode;
  const ablyRef = useRef<AblyRealtime | null>(null);
  const chanRef = useRef<AblyChannel | null>(null);

  // Fighters & initiative
  const [player, setPlayer] = useState<Fighter>(() => makeFighter("Wanderer"));
  const [enemy, setEnemy] = useState<Fighter>(() => makeFighter("Shade Bandit"));
  const [initiative, setInitiative] = useState<LegacySide>(() =>
    hostId ? hostLegacySide : localLegacySide
  );
  const [wins, setWins] = useState<{ player: number; enemy: number }>({ player: 0, enemy: 0 });
  const [round, setRound] = useState(1);
  const [remainingTimer, setRemainingTimer] = useState<number | null>(initialTimerSeconds);
  const timerRemainingRef = useRef<number | null>(initialTimerSeconds);
  const [finalWinMethod, setFinalWinMethod] = useState<"goal" | "timer" | null>(null);

  // Freeze layout during resolution
  const [freezeLayout, setFreezeLayout] = useState(false);
  const [lockedWheelSize, setLockedWheelSize] = useState<number | null>(null);

  // Phase state
  const [phase, setPhase] = useState<"choose" | "showEnemy" | "anim" | "roundEnd" | "ended">("choose");

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

  const timerExpired =
    initialTimerSeconds !== null && (remainingTimer ?? initialTimerSeconds) <= 0;

  const matchWinner: LegacySide | null =
    wins.player >= winGoal
      ? "player"
      : wins.enemy >= winGoal
      ? "enemy"
      : timerExpired && wins.player !== wins.enemy
      ? wins.player > wins.enemy
        ? "player"
        : "enemy"
      : null;
  const localWinsCount = localLegacySide === "player" ? wins.player : wins.enemy;
  const remoteWinsCount = localLegacySide === "player" ? wins.enemy : wins.player;
  const localWon = matchWinner ? matchWinner === localLegacySide : false;
  const winnerName = matchWinner ? namesByLegacy[matchWinner] : null;
  const localName = namesByLegacy[localLegacySide];
  const remoteName = namesByLegacy[remoteLegacySide];
  const finalOutcomeMessage =
    finalWinMethod === "timer"
      ? localWon
        ? "You led when the clock expired."
        : `${winnerName ?? remoteName} led when the clock expired.`
      : localWon
      ? `You reached ${winGoal} wins.`
      : `${winnerName ?? remoteName} reached ${winGoal} wins.`;


  useEffect(() => {
    setInitiative(hostId ? hostLegacySide : localLegacySide);
  }, [hostId, hostLegacySide, localLegacySide]);

  useEffect(() => {
    setRemainingTimer(initialTimerSeconds);
    timerRemainingRef.current = initialTimerSeconds;
  }, [initialTimerSeconds, seed]);

  useEffect(() => {
    timerRemainingRef.current = remainingTimer;
  }, [remainingTimer]);

  useEffect(() => {
    if (initialTimerSeconds === null) return;
    const currentRemaining = timerRemainingRef.current ?? initialTimerSeconds;
    if (currentRemaining === null || currentRemaining <= 0) return;
    if (phase === "ended") return;

    let prev = Date.now();
    const id = window.setInterval(() => {
      setRemainingTimer((prevSecs) => {
        if (prevSecs === null) return prevSecs;
        if (prevSecs <= 0) return 0;
        const now = Date.now();
        const diff = Math.max(1, Math.floor((now - prev) / 1000));
        prev = now;
        const next = Math.max(0, prevSecs - diff);
        timerRemainingRef.current = next;
        return next;
      });
    }, 1000);

    return () => {
      window.clearInterval(id);
    };
  }, [initialTimerSeconds, phase]);

  useEffect(() => {
    if (phase === "ended") {
      if (!hasRecordedResultRef.current) {

        const summary = recordMatchResult({
          didWin: localWon,
          modeId: matchMode.id,
          modeLabel: matchMode.name,
          targetWins: winGoal,
          timerSeconds: initialTimerSeconds,
          winMethod: finalWinMethod ?? (matchWinner ? "goal" : undefined),
        });

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

  }, [
    phase,
    localWon,
    wins.player,
    wins.enemy,
    matchMode.id,
    matchMode.name,
    winGoal,
    initialTimerSeconds,
    finalWinMethod,
    matchWinner,
  ]);


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
if (d.drop && d.idx !== undefined) {
  const idx = Number(d.idx);
  if (d.drop === "wheel") return { kind: "wheel", idx };
  if (d.drop === "slot")  return { kind: "slot",  idx };
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
  const wheelLoadoutRef = useRef<WheelArchetype[] | null>(null);
  if (!wheelLoadoutRef.current) {
    try {
      wheelLoadoutRef.current = getWheelLoadout();
    } catch {
      wheelLoadoutRef.current = ["bandit", "sorcerer", "beast"];
    }
  }

  const wheelRngRef = useRef<() => number>(() => Math.random());
  const [wheelArchetypes, setWheelArchetypes] = useState<WheelArchetype[]>(
    wheelLoadoutRef.current ?? ["bandit", "sorcerer", "beast"]
  );
  const [wheelSections, setWheelSections] = useState<Section[][]>(() => {
    const seeded = createSeededRng(seed);
    wheelRngRef.current = seeded;
    return (wheelLoadoutRef.current ?? ["bandit", "sorcerer", "beast"]).map((arch) =>
      genWheelSections(arch, seeded)
    );
  });

  const generateWheelSet = useCallback((): Section[][] => {
    const rng = wheelRngRef.current ?? Math.random;
    let loadout: WheelArchetype[];
    try {
      loadout = getWheelLoadout();
    } catch {
      loadout = ["bandit", "sorcerer", "beast"];
    }
    wheelLoadoutRef.current = loadout;
    setWheelArchetypes(loadout);
    return loadout.map((arch) => genWheelSections(arch, rng));
  }, []);

  useEffect(() => {
    const seeded = createSeededRng(seed);
    wheelRngRef.current = seeded;
    const loadout = wheelLoadoutRef.current ?? getWheelLoadout();
    wheelLoadoutRef.current = loadout;
    setWheelArchetypes(loadout);
    setWheelSections(loadout.map((arch) => genWheelSections(arch, seeded)));
  }, [seed]);

  const [tokens, setTokens] = useState<[number, number, number]>([0, 0, 0]);
  const [active] = useState<[boolean, boolean, boolean]>([true, true, true]);
  const [wheelHUD, setWheelHUD] = useState<[string | null, string | null, string | null]>([null, null, null]);

  // Assignments
  const [assign, setAssign] = useState<{ player: (Card | null)[]; enemy: (Card | null)[] }>({ player: [null, null, null], enemy: [null, null, null] });
  const assignRef = useRef(assign);
  useEffect(() => {
    assignRef.current = assign;
  }, [assign]);
  const comboSummary = useMemo(() => evaluateCombos(assign), [assign]);

  const [preSpinPlan, setPreSpinPlan] = useState<Record<LegacySide, PreSpinPlan>>({
    player: createEmptyPlan(),
    enemy: createEmptyPlan(),
  });

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
    const plan = preSpinPlan[localLegacySide] ?? createEmptyPlan();
    const opponentPlan = preSpinPlan[remoteLegacySide] ?? createEmptyPlan();
    const reserveCtx = computeReserveContext(localLegacySide, lane, plan, opponentPlan);
    const reserve = reserveCtx.total;
    const updated = storeReserveReport(localLegacySide, reserve, round);
    if (isMultiplayer && updated) {
      sendIntent({ type: "reserve", side: localLegacySide, reserve, round });
    }
  }, [isMultiplayer, localLegacySide, preSpinPlan, round, sendIntent, storeReserveReport, player, enemy]);


  // Drag state + tap-to-assign selected id
  const [dragCardId, setDragCardId] = useState<string | null>(null);
  const [dragOverWheel, _setDragOverWheel] = useState<number | null>(null);
  const dragOverRef = useRef<number | null>(null);
  const setDragOverWheel = (i: number | null) => { dragOverRef.current = i; (window as any).requestIdleCallback ? (window as any).requestIdleCallback(() => _setDragOverWheel(dragOverRef.current)) : setTimeout(() => _setDragOverWheel(dragOverRef.current), 0); };
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  // Reserve sums after resolve (HUD only)
  const [reserveSums, setReserveSums] = useState<null | { player: number; enemy: number }>(null);
  const [revealedDuringChoose, setRevealedDuringChoose] = useState<{ player: number[]; enemy: number[] }>({ player: [], enemy: [] });
  const revealUsedRef = useRef<{ player: boolean; enemy: boolean }>({ player: false, enemy: false });

  // Reference + spell popovers
  const [showRef, setShowRef] = useState(false);
  const [showSpells, setShowSpells] = useState(false);

  useEffect(() => {
    if (phase !== "choose") {
      setShowSpells(false);
    }
  }, [phase]);

  const appendLog = (s: string) => setLog((prev) => [s, ...prev].slice(0, 60));
  const START_LOG = "A Shade Bandit eyes your purse...";
  const [log, setLog] = useState<string[]>([START_LOG]);

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
      const allowsMulti = !!card.multiLane;
      const prevElsewhere = prevAtLane
        ? lane.some((c, idx) => idx !== laneIndex && c?.id === prevAtLane.id)
        : false;
      const shouldReturnPrev = !!(
        prevAtLane &&
        prevAtLane.id !== card.id &&
        !prevElsewhere
      );


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
          if (existingIdx !== -1 && (!allowsMulti || existingIdx === laneIndex)) {
            nextLane[existingIdx] = null;
          }
          nextLane[laneIndex] = card;
          return isPlayer ? { ...prev, player: nextLane } : { ...prev, enemy: nextLane };
        });

        if (isPlayer) {
          setPlayer((p) => {
            let hand = p.hand;
            if (hand.some((c) => c.id === card.id)) {
              hand = hand.filter((c) => c.id !== card.id);
            }
            if (shouldReturnPrev && prevAtLane) {
              if (!hand.some((c) => c.id === prevAtLane.id)) {
                hand = [...hand, prevAtLane];
              }
            }
            if (hand === p.hand) return p;
            return { ...p, hand };
          });
        } else {
          setEnemy((e) => {
            let hand = e.hand;
            if (hand.some((c) => c.id === card.id)) {
              hand = hand.filter((c) => c.id !== card.id);
            }
            if (shouldReturnPrev && prevAtLane) {
              if (!hand.some((c) => c.id === prevAtLane.id)) {
                hand = [...hand, prevAtLane];
              }
            }
            if (hand === e.hand) return e;
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
      const stillAssigned = lane.some((c, idx) => idx !== laneIndex && c?.id === prev.id);

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
            if (stillAssigned || p.hand.some((c) => c.id === prev.id)) return p;
            return { ...p, hand: [...p.hand, prev] };
          });
        } else {
          setEnemy((e) => {
            if (stillAssigned || e.hand.some((c) => c.id === prev.id)) return e;
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
  const hand = [...enemy.hand];
  const picks: (Card | null)[] = [null, null, null];
  const score = (card: Card): number => {
    let value = cardNumericValue(card);
    if (card.tags.includes("steal")) value += 8;
    if (card.tags.includes("swap")) value += 4;
    if (card.tags.includes("reveal")) value += 2;
    if (card.tags.includes("echoreserve")) value += 1.5;
    if (card.tags.includes("decoy")) value -= 5;
    return value;
  };
  const take = (c: Card) => {
    const idx = hand.indexOf(c);
    if (idx >= 0) hand.splice(idx, 1);
    return c;
  };

  const best = [...hand].sort((a, b) => score(b) - score(a))[0];
  if (best) picks[0] = take(best);

  const low = [...hand].sort((a, b) => score(a) - score(b))[0];
  if (low) picks[1] = take(low);

  const midPool = [...hand].sort((a, b) => score(a) - score(b));
  const mid = midPool[Math.floor(midPool.length / 2)];
  if (mid) picks[2] = take(mid);

  for (let i = 0; i < 3; i++) {
    if (!picks[i] && hand.length) picks[i] = take(hand[0]);
  }

  return picks;
}

function computeReserveContext(
  who: LegacySide,
  used: (Card | null)[],
  plan: PreSpinPlan = createEmptyPlan(),
  opponentPlan: PreSpinPlan = createEmptyPlan()
): ReserveHUD {
  const fighter = who === "player" ? player : enemy;

  // Cards left in hand (not used this round)
  const usedIds = new Set((used.filter(Boolean) as Card[]).map(c => c.id));
  const left = fighter.hand.filter(c => !usedIds.has(c.id));

  // Base = sum of first two numeric cards (your original rule of thumb)
  const baseCards = left.slice(0, 2);
  const base = baseCards.reduce((acc, card) => acc + (typeof card.number === "number" ? card.number : 0), 0);

  let total = base;
  const notes: string[] = [];

  const hexPenalty = Math.max(0, opponentPlan.hexPenalty ?? 0);
  if (hexPenalty > 0) {
    total = Math.max(0, total - hexPenalty);
    notes.push(`Hex -${hexPenalty}`);
  }

  const bonus = total - base;

  return { base, bonus, total, notes };
}

  useEffect(() => {
    broadcastLocalReserve();
  }, [broadcastLocalReserve, assign, player, enemy, localLegacySide, round, isMultiplayer]);

// Keep this: after a round, move only played cards out of hand, discard them, then draw.
function settleFighterAfterRound(f: Fighter, played: Card[]): Fighter {
  const playedIds = new Set(played.map((c) => c.id));
  const next: Fighter = {
    ...f,
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
    const played = [0, 1, 2].map((i) => ({
      p: assign.player[i] as Card | null,
      e: (enemyPicks?.[i] ?? assign.enemy[i]) as Card | null,
    }));

    type LaneState = { index: number; player: Card | null; enemy: Card | null };
    const laneStates: LaneState[] = played.map((lane, idx) => ({
      index: idx,
      player: lane.p ? { ...lane.p } : null,
      enemy: lane.e ? { ...lane.e } : null,
    }));

    type MoveAction = { side: LegacySide; from: number; to: number };
    type ParityAction = { side: LegacySide; lane: number; target: "self" | "opponent" | "both"; amount: number };
    type SwapAction = { side: LegacySide; a: number; b: number };
    type StealAction = { side: LegacySide; fromLane: number; targetLane: number };
    type EchoAction = { side: LegacySide; mode: "copy-opponent" | "mirror" | "bonus"; bonus: number };
    type RevealAction = { side: LegacySide; lane: number };

    const oddshiftMoves: MoveAction[] = [];
    const parityActions: ParityAction[] = [];
    const swapActions: SwapAction[] = [];
    const stealActions: StealAction[] = [];
    const echoActions: EchoAction[] = [];
    const revealActions: RevealAction[] = [];
    const effectLogs: string[] = [];

    laneStates.forEach((lane) => {
      ([("player" as const), ("enemy" as const)] as const).forEach((side) => {
        const card = lane[side];
        if (!card) return;
        const meta = card.meta ?? {};

        if (card.tags.includes("oddshift")) {
          const dir = Math.sign(meta.oddshift?.direction ?? 1) || 0;
          if (dir !== 0) {
            const to = (lane.index + dir + laneStates.length) % laneStates.length;
            if (to !== lane.index) oddshiftMoves.push({ side, from: lane.index, to });
          }
        }

        if (card.tags.includes("parityflip")) {
          const amount = Math.abs(meta.parityflip?.amount ?? 1) || 1;
          const target = meta.parityflip?.target ?? "self";
          parityActions.push({ side, lane: lane.index, target, amount });
        }

        if (card.tags.includes("swap")) {
          const withLane = Math.max(0, Math.min(2, meta.swap?.with ?? ((lane.index + 1) % laneStates.length)));
          if (withLane !== lane.index) swapActions.push({ side, a: lane.index, b: withLane });
        }

        if (card.tags.includes("steal")) {
          const fromLane = Math.max(0, Math.min(2, meta.steal?.from ?? lane.index));
          stealActions.push({ side, fromLane, targetLane: lane.index });
        }

        if (card.tags.includes("echoreserve")) {
          const mode = meta.echoreserve?.mode ?? "copy-opponent";
          const bonus = meta.echoreserve?.bonus ?? 0;
          echoActions.push({ side, mode, bonus });
        }

        if (card.tags.includes("reveal")) {
          revealActions.push({ side, lane: lane.index });
        }
      });
    });

    for (const move of oddshiftMoves) {
      const from = laneStates[move.from];
      const to = laneStates[move.to];
      if (!from || !to) continue;
      const moving = from[move.side];
      if (!moving) continue;
      const swap = to[move.side];
      to[move.side] = moving;
      from[move.side] = swap ?? null;
      effectLogs.push(`${namesByLegacy[move.side]} oddshift slides lane ${move.from + 1} → ${move.to + 1}.`);
    }

    const applyParity = (laneIdx: number, targetSide: LegacySide, amount: number) => {
      const lane = laneStates[laneIdx];
      if (!lane) return;
      const card = lane[targetSide];
      if (!card || typeof card.number !== "number") return;
      const delta = (amount % 2 === 0 ? amount + 1 : amount) || 1;
      card.number += card.number % 2 === 0 ? delta : -delta;
      effectLogs.push(`Parity flip twists ${namesByLegacy[targetSide]}'s lane ${laneIdx + 1}.`);
    };

    for (const action of parityActions) {
      const amount = action.amount;
      const targets: LegacySide[] = action.target === "self"
        ? [action.side]
        : action.target === "opponent"
          ? [OPPOSITE_SIDE[action.side]]
          : [action.side, OPPOSITE_SIDE[action.side]];
      targets.forEach((target) => applyParity(action.lane, target, amount));
    }

    for (const action of swapActions) {
      const laneA = laneStates[action.a];
      const laneB = laneStates[action.b];
      if (!laneA || !laneB) continue;
      const cardA = laneA[action.side];
      const cardB = laneB[action.side];
      laneA[action.side] = cardB ?? null;
      laneB[action.side] = cardA ?? null;
      effectLogs.push(`${namesByLegacy[action.side]} swaps lanes ${action.a + 1} and ${action.b + 1}.`);
    }

    for (const action of stealActions) {
      const fromLane = laneStates[action.fromLane];
      const targetLane = laneStates[action.targetLane];
      if (!fromLane || !targetLane) continue;
      const opponentSide = OPPOSITE_SIDE[action.side];
      const opponentCard = fromLane[opponentSide];
      if (!opponentCard) continue;
      const myCard = targetLane[action.side];
      fromLane[opponentSide] = myCard ?? null;
      targetLane[action.side] = opponentCard;
      effectLogs.push(`${namesByLegacy[action.side]} steals from lane ${action.fromLane + 1}.`);
    }

    const revealAdds: Partial<Record<LegacySide, number[]>> = {};
    for (const action of revealActions) {
      if (revealUsedRef.current[action.side]) continue;
      revealUsedRef.current[action.side] = true;
      const target = OPPOSITE_SIDE[action.side];
      revealAdds[target] = [...(revealAdds[target] ?? []), action.lane];
      effectLogs.push(`${namesByLegacy[action.side]} scouts lane ${action.lane + 1}.`);
    }

    if (Object.keys(revealAdds).length) {
      setRevealedDuringChoose((prev) => {
        let changed = false;
        const next = { player: prev.player, enemy: prev.enemy };
        (Object.entries(revealAdds) as [LegacySide, number[]][]).forEach(([side, lanes]) => {
          if (!lanes.length) return;
          const merged = uniqueSorted([...prev[side], ...lanes]);
          if (merged.length !== prev[side].length) {
            changed = true;
            if (side === "player") next.player = merged;
            else next.enemy = merged;
          }
        });
        return changed ? next : prev;
      });
    }

    const localPlayed = localLegacySide === "player"
      ? played.map((pe) => pe.p)
      : played.map((pe) => pe.e);
    const remotePlayed = remoteLegacySide === "player"
      ? played.map((pe) => pe.p)
      : played.map((pe) => pe.e);
// ==== Merged: reserve context + echo interactions + outcome ====

const localPlan = preSpinPlan[localLegacySide] ?? createEmptyPlan();
const remotePlan = preSpinPlan[remoteLegacySide] ?? createEmptyPlan();

// Build reserve contexts (base/bonus/total/notes) for each side
const localReserveCtx = computeReserveContext(localLegacySide, localPlayed, localPlan, remotePlan);

let remoteReserveCtx: ReserveHUD;
let usedRemoteReport = false;

if (!isMultiplayer) {
  remoteReserveCtx = computeReserveContext(remoteLegacySide, remotePlayed, remotePlan, localPlan);
} else {
  const report = reserveReportsRef.current[remoteLegacySide];
  if (report && report.round === round) {
    // Use the reported total from the other client (don’t recalc to avoid desync)
    remoteReserveCtx = { base: report.reserve, bonus: 0, total: report.reserve, notes: [] };
    usedRemoteReport = true;
  } else {
    remoteReserveCtx = computeReserveContext(remoteLegacySide, remotePlayed, remotePlan, localPlan);
  }
}

// Apply echo-reserve effects on top of the contexts (mirror/bonus/copy-opponent)
const reserveCtxBySide: Record<LegacySide, ReserveHUD> = {
  player: localLegacySide === "player" ? { ...localReserveCtx } : { ...remoteReserveCtx },
  enemy:  localLegacySide === "enemy"  ? { ...localReserveCtx } : { ...remoteReserveCtx },
};

for (const action of echoActions) {
  const me = action.side;
  const opp = OPPOSITE_SIDE[me];

  const mine = reserveCtxBySide[me];
  const theirs = reserveCtxBySide[opp];

  switch (action.mode) {
    case "mirror": {
      // bump my total to at least opponent total
      if (mine.total < theirs.total) {
        const inc = theirs.total - mine.total;
        mine.total += inc;
        mine.bonus += inc;
      }
      mine.notes.push("Echo: mirror opponent reserve");
      effectLogs.push(`${namesByLegacy[me]}'s reserve mirrors the foe.`);
      break;
    }
    case "bonus": {
      mine.total += action.bonus;
      mine.bonus += action.bonus;
      mine.notes.push(`Echo: +${action.bonus} reserve`);
      effectLogs.push(`${namesByLegacy[me]} gains ${action.bonus} reserve.`);
      break;
    }
    default: {
      // copy-opponent
      const delta = Math.max(0, theirs.total - mine.base); // informational only
      mine.total = theirs.total;
      // We don’t change base; treat the change as “bonus” so HUD can show the delta
      mine.bonus = mine.total - mine.base;
      mine.notes.push("Echo: copy opponent reserve");
      effectLogs.push(`${namesByLegacy[me]} echoes the opponent's reserve.`);
      break;
    }
  }
}

// Persist reports for both sides
storeReserveReport(localLegacySide, localReserveCtx.total, round);
if (!isMultiplayer || !usedRemoteReport) {
  const remoteTotal =
    localLegacySide === "player" ? reserveCtxBySide.enemy.total : reserveCtxBySide.player.total;
  storeReserveReport(remoteLegacySide, remoteTotal, round);
}

// Map back to player/enemy for HUD (relative to legacy sides)
const playerReserveCtx = reserveCtxBySide.player;
const enemyReserveCtx  = reserveCtxBySide.enemy;
const pReserveTotal    = playerReserveCtx.total;
const eReserveTotal    = enemyReserveCtx.total;

// 🔸 Show full contexts (with notes) during showEnemy/anim immediately
setReserveSums({ player: playerReserveCtx, enemy: enemyReserveCtx });

// keep any accumulated effect logs
effectLogs.forEach((msg) => appendLog(msg));

type Outcome = {
  steps: number;
  targetSlice: number;
  section: Section;
  winner: LegacySide | null;
  tie: boolean;
  wheel: number;
  detail: string;
  /** Optional VC override from pre-spin planning (e.g., mana/recall effects) */
  override: VC | null;
  /** (If you already include combo notes in details elsewhere, you can add them here) */
  comboNotes?: string[];
};

    const outcomes: Outcome[] = [];
    const combosForResolve = evaluateCombos({
      player: played.map((pe) => pe.p ?? null),
      enemy: played.map((pe) => pe.e ?? null),
    });

    const planBySide: Record<LegacySide, PreSpinPlan> = {
      player: preSpinPlan.player ?? createEmptyPlan(),
      enemy: preSpinPlan.enemy ?? createEmptyPlan(),
    };

    for (let w = 0; w < 3; w++) {
      const secList = wheelSections[w];
      const playerCard = played[w].p;
      const enemyCard = played[w].e;
      const baseP = playerCard?.number ?? 0;
      const baseE = enemyCard?.number ?? 0;
      const bonusP = combosForResolve.player.laneBonus[w] ?? 0;
      const bonusE = combosForResolve.enemy.laneBonus[w] ?? 0;

      const playerPlanForWheel = planBySide.player;
      const enemyPlanForWheel = planBySide.enemy;

      const playerLocked = !!enemyPlanForWheel.iceShard[w];
      const enemyLocked = !!playerPlanForWheel.iceShard[w];

      let effectiveBaseP = baseP;
      let effectiveBaseE = baseE;

      const comboNotes = [
        ...((combosForResolve.player.laneNotes[w] ?? []).map((note) => `${namesByLegacy.player}: ${note}`)),
        ...((combosForResolve.enemy.laneNotes[w] ?? []).map((note) => `${namesByLegacy.enemy}: ${note}`)),
      ];

      if (playerLocked) {
        comboNotes.push(`${namesByLegacy.enemy}: Ice Shard (lane ${w + 1})`);
      }
      if (enemyLocked) {
        comboNotes.push(`${namesByLegacy.player}: Ice Shard (lane ${w + 1})`);
      }

      if (!playerLocked && playerPlanForWheel.mirrorImage[w] && enemyCard) {
        effectiveBaseP = enemyCard.number ?? 0;
        comboNotes.push(`${namesByLegacy.player}: Mirror Image (lane ${w + 1})`);
      }

      if (!enemyLocked && enemyPlanForWheel.mirrorImage[w] && playerCard) {
        effectiveBaseE = playerCard.number ?? 0;
        comboNotes.push(`${namesByLegacy.enemy}: Mirror Image (lane ${w + 1})`);
      }

      let pVal = playerLocked ? effectiveBaseP : effectiveBaseP + bonusP;
      let eVal = enemyLocked ? effectiveBaseE : effectiveBaseE + bonusE;

      if (!enemyLocked) {
        const fireball = playerPlanForWheel.fireball[w] ?? 0;
        if (fireball > 0) {
          eVal -= fireball;
          comboNotes.push(`${namesByLegacy.player}: Fireball -${fireball} (lane ${w + 1})`);
        }
      }

      if (!playerLocked) {
        const fireball = enemyPlanForWheel.fireball[w] ?? 0;
        if (fireball > 0) {
          pVal -= fireball;
          comboNotes.push(`${namesByLegacy.enemy}: Fireball -${fireball} (lane ${w + 1})`);
        }
      }

      const playerShift = playerPlanForWheel.arcaneShift[w] ?? 0;
      const enemyShift = enemyPlanForWheel.arcaneShift[w] ?? 0;
      if (playerShift !== 0) {
        comboNotes.push(`${namesByLegacy.player}: Arcane Shift ${playerShift > 0 ? "+" : ""}${playerShift} (wheel ${w + 1})`);
      }
      if (enemyShift !== 0) {
        comboNotes.push(`${namesByLegacy.enemy}: Arcane Shift ${enemyShift > 0 ? "+" : ""}${enemyShift} (wheel ${w + 1})`);
      }
      const totalShift = playerShift + enemyShift;

      const stepsBase = (((pVal % SLICES) + (eVal % SLICES)) % SLICES + SLICES) % SLICES;
      const steps = (((stepsBase + totalShift) % SLICES) + SLICES) % SLICES;
      const targetSlice = (tokens[w] + steps) % SLICES;
      let section =
        secList.find((s) => targetSlice !== 0 && inSection(targetSlice, s)) ||
        ({ id: "Strongest", color: "transparent", start: 0, end: 0 } as Section);

      let winner: LegacySide | null = null; let tie = false; let detail = "";

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

case "ReserveSum": {
  // use totals from the ReserveHUD contexts (mana/recall-aware)
  if (pReserveTotal === eReserveTotal) tie = true;
  else winner = pReserveTotal > eReserveTotal ? "player" : "enemy";
  detail = `Reserve ${pReserveTotal} vs ${eReserveTotal}`;
  break;
}
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
      if (comboNotes.length) {
        detail = `${detail} | ${comboNotes.join("; ")}`;
      }

      outcomes.push({ steps, targetSlice, section, winner, tie, wheel: w, detail, override: null, comboNotes });

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

const hudColors: [string | null, string | null, string | null] = [null, null, null];
const roundWins: Record<LegacySide, number> = { player: 0, enemy: 0 };
const manaGains: Record<LegacySide, number> = { player: 0, enemy: 0 };

outcomes.forEach((o) => {
  const wheelLabel = `Wheel ${o.wheel + 1}`;

  if (o.tie) {
    appendLog(`${wheelLabel} tie: ${o.detail} — no win.`);
    return;
  }

  if (!o.winner) return;

  hudColors[o.wheel] = HUD_COLORS[o.winner];

  roundWins[o.winner] += 1;
  manaGains[o.winner] += 1;

  appendLog(`${wheelLabel} win -> ${o.winner} (${o.detail}).`);

  
}); // <— exactly one closing brace + parenthesis here

      if (!mountedRef.current) return;

      const prevInitiative = initiative;
      const roundWinsCount = roundWins;
      const pWins = wins.player + roundWinsCount.player;
      const eWins = wins.enemy + roundWinsCount.enemy;
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

      if (manaGains.player > 0) {
        setPlayer((prev) => ({ ...prev, mana: prev.mana + manaGains.player }));
        appendLog(`${namesByLegacy.player} gains ${manaGains.player} mana.`);
      }
      if (manaGains.enemy > 0) {
        setEnemy((prev) => ({ ...prev, mana: prev.mana + manaGains.enemy }));
        appendLog(`${namesByLegacy.enemy} gains ${manaGains.enemy} mana.`);
      }

      setWheelHUD(hudColors);
      setWins({ player: pWins, enemy: eWins });
      setReserveSums({ player: playerReserveCtx, enemy: enemyReserveCtx });
      clearAdvanceVotes();
// Compute winner/method once
let winner: LegacySide | null = null;
let method: "goal" | "timer" | null = null;

if (pWins >= winGoal || eWins >= winGoal) {
  winner = pWins >= winGoal ? "player" : "enemy";
  method = "goal";
} else {
  const timerNow = timerRemainingRef.current ?? remainingTimer ?? initialTimerSeconds;
  if (initialTimerSeconds !== null && (timerNow ?? 0) <= 0 && pWins !== eWins) {
    winner = pWins > eWins ? "player" : "enemy";
    method = "timer";
  }
}

// Handle outcome once
if (winner && method) {
  clearRematchVotes();
  setFinalWinMethod(method);
  setPhase("ended");

  if (method === "timer") {
    const leadLog =
      winner === localLegacySide
        ? `Time expired — you led ${pWins}-${eWins}.`
        : `Time expired — ${namesByLegacy[winner]} led ${pWins}-${eWins}.`;
    appendLog(leadLog);
  } else {
    appendLog(
      winner === localLegacySide
        ? "You win the match!"
        : `${namesByLegacy[remoteLegacySide]} wins the match!`
    );
  }
} else {
  // No match end: reset spell planning for the next round
  setPreSpinPlan({ player: createEmptyPlan(), enemy: createEmptyPlan() });
  setPhase("roundEnd");
}
};   
animateSpins();    // <-- CALL IT
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
      setPreSpinPlan({ player: createEmptyPlan(), enemy: createEmptyPlan() });

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

  const spendMana = useCallback((side: LegacySide, amount: number) => {
    if (amount <= 0) return;
    if (side === "player") {
      setPlayer((prev) => ({ ...prev, mana: Math.max(0, prev.mana - amount) }));
    } else {
      setEnemy((prev) => ({ ...prev, mana: Math.max(0, prev.mana - amount) }));
    }
  }, [setEnemy, setPlayer]);

  const handleFireballCast = useCallback(() => {
    if (phase !== "choose") return;
    if (isMultiplayer) {
      appendLog("Mana actions are disabled during multiplayer matches.");
      return;
    }
    const casterSide = localLegacySide;
    const opponentSide = casterSide === "player" ? "enemy" : "player";
    const fighter = casterSide === "player" ? player : enemy;
    if (fighter.mana < 1) {
      appendLog(`${namesByLegacy[casterSide]} lacks the mana to cast Fireball.`);
      return;
    }
    if (typeof window === "undefined") return;
    const laneStr = window.prompt("Select target lane (1-3) for Fireball:", "1");
    if (laneStr === null) return;
    const laneIdx = Number.parseInt(laneStr, 10) - 1;
    if (!(laneIdx >= 0 && laneIdx < 3)) {
      appendLog("Fireball fizzles without a valid target.");
      return;
    }
    const opponentAssignments = opponentSide === "player" ? assign.player : assign.enemy;
    if (!opponentAssignments[laneIdx]) {
      appendLog("No opposing card to scorch in that lane.");
      return;
    }
    const maxMana = fighter.mana;
    const amountStr = window.prompt(`Spend how much mana? (1-${maxMana})`, "1");
    if (amountStr === null) return;
    const parsed = Number.parseInt(amountStr, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      appendLog("The spell fails without fuel.");
      return;
    }
    const amount = Math.min(parsed, maxMana);
    const echoBonus = fighter.perks.includes("spellEcho") ? 1 : 0;
    const totalDamage = amount + echoBonus;
    setPreSpinPlan((prev) => {
      const cur = prev[casterSide] ?? createEmptyPlan();
      const fireball = { ...cur.fireball, [laneIdx]: (cur.fireball[laneIdx] ?? 0) + totalDamage };
      const notes = [...cur.notes, `Fireball lane ${laneIdx + 1} -${totalDamage}`];
      return { ...prev, [casterSide]: { ...cur, fireball, notes } };
    });
    spendMana(casterSide, amount);
    const bonusNote = echoBonus > 0 ? ` (echo +${echoBonus})` : "";
    appendLog(`${namesByLegacy[casterSide]} hurls a fireball at lane ${laneIdx + 1}, reducing it by ${totalDamage}${bonusNote}.`);
  }, [appendLog, assign, enemy, isMultiplayer, localLegacySide, namesByLegacy, phase, player, spendMana]);

  const handleIceShardCast = useCallback(() => {
    if (phase !== "choose") return;
    if (isMultiplayer) {
      appendLog("Mana actions are disabled during multiplayer matches.");
      return;
    }
    const casterSide = localLegacySide;
    const opponentSide = casterSide === "player" ? "enemy" : "player";
    const fighter = casterSide === "player" ? player : enemy;
    if (fighter.mana < 1) {
      appendLog(`${namesByLegacy[casterSide]} lacks the mana to cast Ice Shard.`);
      return;
    }
    if (typeof window === "undefined") return;
    const laneStr = window.prompt("Select target lane (1-3) to freeze:", "1");
    if (laneStr === null) return;
    const laneIdx = Number.parseInt(laneStr, 10) - 1;
    if (!(laneIdx >= 0 && laneIdx < 3)) {
      appendLog("The shard misses its mark.");
      return;
    }
    const opponentAssignments = opponentSide === "player" ? assign.player : assign.enemy;
    if (!opponentAssignments[laneIdx]) {
      appendLog("There is no enemy card to freeze there.");
      return;
    }
    const plan = preSpinPlan[casterSide] ?? createEmptyPlan();
    if (plan.iceShard[laneIdx]) {
      appendLog("That lane is already frozen.");
      return;
    }
    setPreSpinPlan((prev) => {
      const cur = prev[casterSide] ?? createEmptyPlan();
      const iceShard = { ...cur.iceShard, [laneIdx]: true };
      const notes = [...cur.notes, `Ice Shard lane ${laneIdx + 1}`];
      return { ...prev, [casterSide]: { ...cur, iceShard, notes } };
    });
    spendMana(casterSide, 1);
    appendLog(`${namesByLegacy[casterSide]} freezes lane ${laneIdx + 1} with an ice shard.`);
  }, [appendLog, assign, enemy, isMultiplayer, localLegacySide, namesByLegacy, phase, player, preSpinPlan, spendMana]);

  const handleMirrorImageCast = useCallback(() => {
    if (phase !== "choose") return;
    if (isMultiplayer) {
      appendLog("Mana actions are disabled during multiplayer matches.");
      return;
    }
    const casterSide = localLegacySide;
    const opponentSide = casterSide === "player" ? "enemy" : "player";
    const fighter = casterSide === "player" ? player : enemy;
    if (fighter.mana < 1) {
      appendLog(`${namesByLegacy[casterSide]} lacks the mana to cast Mirror Image.`);
      return;
    }
    if (typeof window === "undefined") return;
    const laneStr = window.prompt("Select your lane (1-3) to mirror:", "1");
    if (laneStr === null) return;
    const laneIdx = Number.parseInt(laneStr, 10) - 1;
    if (!(laneIdx >= 0 && laneIdx < 3)) {
      appendLog("Mirror Image finds no focus.");
      return;
    }
    const myAssignments = casterSide === "player" ? assign.player : assign.enemy;
    const opponentAssignments = opponentSide === "player" ? assign.player : assign.enemy;
    if (!myAssignments[laneIdx]) {
      appendLog("You must commit a card to mirror there.");
      return;
    }
    if (!opponentAssignments[laneIdx]) {
      appendLog("There is no opposing card to copy there.");
      return;
    }
    const plan = preSpinPlan[casterSide] ?? createEmptyPlan();
    if (plan.mirrorImage[laneIdx]) {
      appendLog("That lane is already mirrored.");
      return;
    }
    setPreSpinPlan((prev) => {
      const cur = prev[casterSide] ?? createEmptyPlan();
      const mirrorImage = { ...cur.mirrorImage, [laneIdx]: true };
      const notes = [...cur.notes, `Mirror lane ${laneIdx + 1}`];
      return { ...prev, [casterSide]: { ...cur, mirrorImage, notes } };
    });
    spendMana(casterSide, 1);
    appendLog(`${namesByLegacy[casterSide]} mirrors the foe on lane ${laneIdx + 1}.`);
  }, [appendLog, assign, enemy, isMultiplayer, localLegacySide, namesByLegacy, phase, player, preSpinPlan, spendMana]);

  const handleArcaneShiftCast = useCallback(() => {
    if (phase !== "choose") return;
    if (isMultiplayer) {
      appendLog("Mana actions are disabled during multiplayer matches.");
      return;
    }
    const casterSide = localLegacySide;
    const fighter = casterSide === "player" ? player : enemy;
    if (fighter.mana < 1) {
      appendLog(`${namesByLegacy[casterSide]} lacks the mana to weave an Arcane Shift.`);
      return;
    }
    if (typeof window === "undefined") return;
    const wheelStr = window.prompt("Choose a wheel to shift (1-3):", "1");
    if (wheelStr === null) return;
    const wheelIdx = Number.parseInt(wheelStr, 10) - 1;
    if (!(wheelIdx >= 0 && wheelIdx < 3)) {
      appendLog("The weave slips; no wheel selected.");
      return;
    }
    const dirStr = window.prompt("Shift direction? Enter +1 or -1:", "+1");
    if (dirStr === null) return;
    const dir = Number.parseInt(dirStr, 10);
    if (!(dir === 1 || dir === -1)) {
      appendLog("Arcane Shift needs a direction of +1 or -1.");
      return;
    }
    const magnitude = fighter.perks.includes("planarSwap") ? 2 : 1;
    const appliedDir = dir * magnitude;
    setPreSpinPlan((prev) => {
      const cur = prev[casterSide] ?? createEmptyPlan();
      const arcaneShift = { ...cur.arcaneShift, [wheelIdx]: (cur.arcaneShift[wheelIdx] ?? 0) + appliedDir };
      const notes = [...cur.notes, `Shift wheel ${wheelIdx + 1} ${appliedDir > 0 ? "+" : ""}${appliedDir}`];
      return { ...prev, [casterSide]: { ...cur, arcaneShift, notes } };
    });
    spendMana(casterSide, 1);
    const shiftLabel = appliedDir > 0 ? `+${appliedDir}` : `${appliedDir}`;
    appendLog(`${namesByLegacy[casterSide]} shifts wheel ${wheelIdx + 1} by ${shiftLabel} slice${Math.abs(appliedDir) > 1 ? "s" : ""}.`);
  }, [appendLog, enemy, isMultiplayer, localLegacySide, namesByLegacy, phase, player, spendMana]);

  const handleHexCast = useCallback(() => {
    if (phase !== "choose") return;
    if (isMultiplayer) {
      appendLog("Mana actions are disabled during multiplayer matches.");
      return;
    }
    const casterSide = localLegacySide;
    const fighter = casterSide === "player" ? player : enemy;
    if (fighter.mana < 1) {
      appendLog(`${namesByLegacy[casterSide]} lacks the mana to unleash a Hex.`);
      return;
    }
    const penalty = fighter.perks.includes("recallMastery") ? 3 : 2;
    setPreSpinPlan((prev) => {
      const cur = prev[casterSide] ?? createEmptyPlan();
      const notes = [...cur.notes, `Hex -${penalty} reserve`];
      return { ...prev, [casterSide]: { ...cur, hexPenalty: cur.hexPenalty + penalty, notes } };
    });
    spendMana(casterSide, 1);
    appendLog(`${namesByLegacy[casterSide]} curses the foe's reserves (-${penalty}).`);
    setTimeout(() => broadcastLocalReserve(), 0);
  }, [appendLog, broadcastLocalReserve, enemy, localLegacySide, namesByLegacy, phase, player, spendMana, isMultiplayer]);

  const handleTimeTwistCast = useCallback(() => {
    if (phase !== "choose") return;
    if (isMultiplayer) {
      appendLog("Mana actions are disabled during multiplayer matches.");
      return;
    }
    const casterSide = localLegacySide;
    const fighter = casterSide === "player" ? player : enemy;
    if (fighter.mana < 1) {
      appendLog(`${namesByLegacy[casterSide]} lacks the mana to twist time.`);
      return;
    }
    const plan = preSpinPlan[casterSide] ?? createEmptyPlan();
    if (plan.initiativeSwapped) {
      appendLog("Time Twist has already altered initiative this round.");
      return;
    }
    const nextInitiative = initiative === "player" ? "enemy" : "player";
    setPreSpinPlan((prev) => {
      const cur = prev[casterSide] ?? createEmptyPlan();
      const notes = [...cur.notes, "Time Twist"];
      return { ...prev, [casterSide]: { ...cur, initiativeSwapped: true, notes } };
    });
    spendMana(casterSide, 1);
    setInitiative(nextInitiative);
    appendLog(`${namesByLegacy[casterSide]} twists time — initiative shifts to ${namesByLegacy[nextInitiative]}.`);
  }, [appendLog, enemy, initiative, isMultiplayer, localLegacySide, namesByLegacy, phase, player, preSpinPlan, spendMana]);

  const resetMatch = useCallback(() => {
    clearResolveVotes();
    clearAdvanceVotes();
    clearRematchVotes();

    reserveReportsRef.current = { player: null, enemy: null };

    setFinalWinMethod(null);
    setRemainingTimer(initialTimerSeconds);
    timerRemainingRef.current = initialTimerSeconds;

    wheelRefs.forEach((ref) => ref.current?.setVisualToken(0));

    setFreezeLayout(false);
    setLockedWheelSize(null);

    setPlayer(() => makeFighter("Wanderer"));
    setEnemy(() => makeFighter("Shade Bandit"));

    setInitiative(hostId ? hostLegacySide : localLegacySide);

    setWins({ player: 0, enemy: 0 });
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
    setRevealedDuringChoose({ player: [], enemy: [] });
    revealUsedRef.current = { player: false, enemy: false };
    setWheelHUD([null, null, null]);
    setPreSpinPlan({ player: createEmptyPlan(), enemy: createEmptyPlan() });

    setLog([START_LOG]);

    wheelRngRef.current = createSeededRng(seed);
    setWheelSections(generateWheelSet());
  }, [
    clearAdvanceVotes,
    clearRematchVotes,
    clearResolveVotes,
    initialTimerSeconds,
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
    setFinalWinMethod,
    setRemainingTimer,
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

    const localNotes = comboSummary[localLegacySide].laneNotes[i] ?? [];
    const remoteNotes = comboSummary[remoteLegacySide].laneNotes[i] ?? [];
    const combinedComboNotes = [
      ...localNotes.map((note) => `${namesByLegacy[localLegacySide]}: ${note}`),
      ...((phase !== "choose") ? remoteNotes.map((note) => `${namesByLegacy[remoteLegacySide]}: ${note}`) : []),
    ];

    let previewNotes: string[] = [];
    if (phase === "choose" && active[i]) {
      const candidateId = dragCardId ?? selectedCardId;
      if (candidateId) {
        const simulated = {
          player: [...assign.player],
          enemy: [...assign.enemy],
        };
        const isLocalPlayer = localLegacySide === "player";
        const handSource = isLocalPlayer ? player.hand : enemy.hand;
        const slotSource = isLocalPlayer ? assign.player : assign.enemy;
        const card =
          handSource.find((c) => c.id === candidateId) ||
          slotSource.find((c) => c?.id === candidateId) ||
          null;
        if (card) {
          const laneArr = isLocalPlayer ? simulated.player : simulated.enemy;
          if (!card.multiLane) {
            const existing = laneArr.findIndex((c) => c?.id === card.id);
            if (existing !== -1) laneArr[existing] = null;
          }
          laneArr[i] = card;
          const simSummary = evaluateCombos(simulated);
          previewNotes = simSummary[localLegacySide].laneNotes[i] ?? [];
        }
      }
    }
    const lanePreviewActive = previewNotes.length > 0;
    const laneComboActive = localNotes.length > 0 || (phase !== "choose" && remoteNotes.length > 0);

    const leftSlot = { side: "player" as const, card: pc, name: namesByLegacy.player };
    const rightSlot = { side: "enemy" as const, card: ec, name: namesByLegacy.enemy };

    const ws = Math.round(lockedWheelSize ?? wheelSize);


  const leftReveal = revealedDuringChoose.player.includes(i);
  const rightReveal = revealedDuringChoose.enemy.includes(i);
  const canSeeLeft = !!leftSlot.card && (leftSlot.side === localLegacySide || phase !== "choose" || leftReveal);
  const canSeeRight = !!rightSlot.card && (rightSlot.side === localLegacySide || phase !== "choose" || rightReveal);
  const leftFaceDown = !!leftSlot.card && !canSeeLeft;
  const rightFaceDown = !!rightSlot.card && !canSeeRight;

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

const renderSlotCard = (
  slot: typeof leftSlot,
  isSlotSelected: boolean,
  faceDown: boolean
) => {
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
      faceDown={faceDown}
      showHint={!faceDown}
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
    const borderColor = lanePreviewActive ? '#facc15' : laneComboActive ? '#fb923c' : THEME.panelBorder;
    const shadowWithCombo = lanePreviewActive
      ? `${panelShadow}, 0 0 12px rgba(250,204,21,0.35)`
      : laneComboActive
        ? `${panelShadow}, 0 0 10px rgba(249,115,22,0.28)`
        : panelShadow;

    return (
      <div
        className="relative rounded-xl border p-2 shadow flex-none"
        style={{
          width: panelW,
          height: ws + EXTRA_H,
          background: `linear-gradient(180deg, rgba(255,255,255,.04) 0%, rgba(0,0,0,.14) 100%), ${THEME.panelBg}`,
          borderColor,
          borderWidth: 2,
          boxShadow: shadowWithCombo,
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
          {leftSlot.card
            ? renderSlotCard(leftSlot, isLeftSelected, leftFaceDown)
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
    <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 text-[11px] font-semibold uppercase tracking-wide text-white/80">
      {(wheelArchetypes[i] ?? `wheel-${i + 1}`).replace(/^(\w)/, (c) => c.toUpperCase())}
    </div>
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
          {rightSlot.card
            ? renderSlotCard(rightSlot, isRightSelected, rightFaceDown)
            : <div className="text-[11px] opacity-60 text-center">
                {rightSlot.side === localLegacySide ? "Your card" : rightSlot.name}
              </div>}
        </div>
      </div>

      {(laneComboActive || lanePreviewActive) && (
        <div className="absolute left-2 right-2 bottom-2 text-[10px] leading-tight text-amber-100 space-y-0.5">
          {combinedComboNotes.map((note, idx) => (
            <div key={`combo-${i}-${idx}`} className="font-semibold drop-shadow">{note}</div>
          ))}
          {lanePreviewActive && previewNotes.map((note, idx) => (
            <div key={`preview-${i}-${idx}`} className="italic text-amber-200/80">Preview: {note}</div>
          ))}
        </div>
      )}
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

const ManaIcon = ({ className = '' }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    className={`fill-current ${className}`.trim()}
    aria-hidden
    focusable="false"
  >
    <path d="M12 2c-4 5.2-6 8.8-6 12a6 6 0 0012 0c0-3.2-2-6.8-6-12z" />
  </svg>
);

const HUDPanels = () => {
  const rsP = reserveSums ? reserveSums.player : null;
  const rsE = reserveSums ? reserveSums.enemy : null;
  const timerSecondsRemaining = remainingTimer ?? initialTimerSeconds ?? 0;
  const timerCritical =
    initialTimerSeconds !== null && timerSecondsRemaining > 0
      ? timerSecondsRemaining <= Math.max(15, Math.floor(initialTimerSeconds * 0.1))
      : false;
  const timerClass = timerExpired
    ? "border-rose-500/80 bg-rose-600/20 text-rose-100"
    : timerCritical
    ? "border-amber-400/80 bg-amber-500/20 text-amber-100"
    : "border-white/20 bg-black/40 text-slate-100";
  const timerDisplay =
    initialTimerSeconds !== null
      ? formatTimerForDisplay(timerSecondsRemaining)
      : "Off";

  const Panel = ({ side }: { side: LegacySide }) => {
    const isPlayer = side === 'player';
    const color = isPlayer ? (players.left.color ?? HUD_COLORS.player) : (players.right.color ?? HUD_COLORS.enemy);
    const name = isPlayer ? players.left.name : players.right.name;
    const win = isPlayer ? wins.player : wins.enemy;
    const rs = isPlayer ? rsP : rsE;
    const mana = isPlayer ? player.mana : enemy.mana;
    const hasInit = initiative === side;
    const isReserveVisible =
      (phase === 'showEnemy' || phase === 'anim' || phase === 'roundEnd' || phase === 'ended') &&
      rs !== null;
    const reserveTooltip = rs
      ? `Reserve total ${rs.total} (base ${rs.base}${rs.bonus ? `, bonus ${rs.bonus}` : ''})${rs.notes.length ? ` — ${rs.notes.join(', ')}` : ''}`
      : undefined;

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
          <div className="flex items-center gap-1 ml-1 flex-shrink-0">
            <span className="opacity-80">Wins</span>
            <span className="text-base font-extrabold tabular-nums">{win}</span>
          </div>
          <div className="flex items-center gap-1 ml-2 flex-shrink-0">
            <ManaIcon className="h-4 w-4 text-sky-300" />
            <span className="sr-only">Mana</span>
            <span className="text-base font-extrabold tabular-nums">{mana}</span>
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
            title={reserveTooltip}
          >
            Reserve: <span className="font-bold tabular-nums">{rs?.total ?? 0}</span>
            {rs && rs.bonus > 0 ? (
              <span className="ml-1 text-[10px] text-amber-200/90">(+{rs.bonus})</span>
            ) : null}
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
            <div
              className="w-full rounded-full border px-3 py-1 text-[11px] text-center"
              style={{
                background: '#1b1209ee',
                borderColor: THEME.slotBorder,
                color: THEME.textWarm,
              }}
              title={reserveTooltip}
            >
              Reserve: <span className="font-bold tabular-nums">{rs?.total ?? 0}</span>
              {rs && rs.bonus > 0 ? (
                <span className="ml-1 text-[10px] text-amber-200/90">(+{rs.bonus})</span>
              ) : null}
            </div>
          </div>
        )}

        {isReserveVisible && rs?.notes.length ? (
          <div className="mt-1 text-[10px] text-amber-200/80 text-center sm:text-left">
            {rs.notes.join(' · ')}
          </div>
        ) : null}

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

const PreSpinControls = () => {
  const fighter = localLegacySide === 'player' ? player : enemy;
  const plan = preSpinPlan[localLegacySide] ?? createEmptyPlan();
  const mana = fighter.mana;
  const canAct = phase === 'choose' && !isMultiplayer;
  const notes = plan.notes.length ? plan.notes.join(' · ') : 'None';
  const timeTwistDisabled = !canAct || mana < 1 || plan.initiativeSwapped;

  const spells = [
    {
      key: 'fireball',
      label: 'Fireball (spend X mana)',
      onClick: handleFireballCast,
      disabled: !canAct || mana < 1,
      help: 'Spend mana to reduce an enemy lane by X (+1 with Spell Echo).',
    },
    {
      key: 'ice-shard',
      label: 'Ice Shard (-1 mana)',
      onClick: handleIceShardCast,
      disabled: !canAct || mana < 1,
      help: 'Freeze an enemy lane; its value can no longer change this round.',
    },
    {
      key: 'mirror-image',
      label: 'Mirror Image (-1 mana)',
      onClick: handleMirrorImageCast,
      disabled: !canAct || mana < 1,
      help: 'Copy the opposing card on a lane you committed to.',
    },
    {
      key: 'arcane-shift',
      label: 'Arcane Shift (-1 mana)',
      onClick: handleArcaneShiftCast,
      disabled: !canAct || mana < 1,
      help: 'Move a wheel’s pointer by ±1 slice (±2 with Planar Swap).',
    },
    {
      key: 'hex',
      label: 'Hex (-1 mana)',
      onClick: handleHexCast,
      disabled: !canAct || mana < 1,
      help: 'Reduce the opponent’s reserve sum by 2 (3 with Recall Mastery).',
    },
    {
      key: 'time-twist',
      label: plan.initiativeSwapped ? 'Time Twist (used)' : 'Time Twist (-1 mana)',
      onClick: handleTimeTwistCast,
      disabled: timeTwistDisabled,
      help: 'Swap initiative for the rest of the round.',
    },
  ];

  return (
    <div className="space-y-3 text-[12px] text-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold">
          Mana: <span className="tabular-nums">{mana}</span>
        </div>
      </div>
      <div className="space-y-2">
        {spells.map((spell) => (
          <div key={spell.key} className="flex flex-col gap-0.5">
            <button
              onClick={spell.onClick}
              disabled={spell.disabled}
              className="rounded bg-amber-400/90 px-2 py-1 font-semibold text-slate-900 transition disabled:opacity-40"
            >
              {spell.label}
            </button>
            <span className="text-[11px] text-slate-300">{spell.help}</span>
          </div>
        ))}
      </div>
      <div className="text-[11px] text-slate-300">Active effects: {notes}</div>
      {!canAct && isMultiplayer ? (
        <div className="text-[11px] text-slate-400 italic">
          Mana actions are disabled during multiplayer.
        </div>
      ) : null}
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

  return (
    <div className="h-screen w-screen overflow-x-hidden overflow-y-hidden text-slate-100 p-1 grid gap-2" style={{ gridTemplateRows: "auto auto 1fr auto" }}>
      {/* Controls */}
      <div className="flex items-center justify-between text-[12px] min-h-[24px]">
        <div className="flex items-center gap-3">
          <div><span className="opacity-70">Round</span> <span className="font-semibold">{round}</span></div>
          <div><span className="opacity-70">Phase</span> <span className="font-semibold">{phase}</span></div>
          <div><span className="opacity-70">Goal</span> <span className="font-semibold">First to {winGoal} wins</span></div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setShowRef((v) => !v)}
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
                    <li><span className="font-semibold">0 Start</span> — no one wins</li>
                  </ul>
                </div>
              </div>
            )}
          </div>
          <div className="relative">
            <button
              onClick={() => setShowSpells((v) => !v)}
              className="px-2.5 py-0.5 rounded bg-slate-700 text-white border border-slate-600 hover:bg-slate-600"
            >
              Spells
            </button>
            {showSpells && (
              <div className="absolute top-[110%] right-0 w-80 rounded-lg border border-slate-700 bg-slate-800/95 shadow-xl p-3 z-50">
                <div className="flex items-center justify-between mb-1">
                  <div className="font-semibold">Spells</div>
                  <button
                    onClick={() => setShowSpells(false)}
                    className="text-xl leading-none text-slate-300 hover:text-white"
                  >
                    ×
                  </button>
                </div>
                <PreSpinControls />
              </div>
            )}
          </div>
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
      <div className="relative z-10"><HUDPanels /></div>

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

          <div className="text-sm text-slate-200">{finalOutcomeMessage}</div>

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

          <div className="rounded-md border border-slate-700 bg-slate-800/70 px-4 py-3 text-sm text-slate-200">
            <div className="font-semibold uppercase tracking-wide text-xs text-slate-400">Match Settings</div>
            <div className="mt-2 space-y-1">
              <div>
                {matchMode.name} · first to {winGoal} wins
                {initialTimerSeconds
                  ? ` · ${formatTimerForDisplay(initialTimerSeconds)} timer`
                  : " · No timer"}
              </div>
              <div className="text-xs text-slate-300/80">
                {finalWinMethod === "timer"
                  ? "Decided by highest score when the clock expired."
                  : "Decided by reaching the win target."}
              </div>
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

function formatTimerForDisplay(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) {
    return "No timer";
  }
  const total = Math.floor(seconds);
  if (total <= 0) {
    return "0:00";
  }
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  }
  const mins = Math.floor(total / 60);
  if (mins > 0) {
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }
  return `${secs}s`;
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
