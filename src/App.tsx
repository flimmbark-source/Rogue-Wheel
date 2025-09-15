import React, { useMemo, useRef, useState, useEffect, forwardRef, useImperativeHandle, memo, startTransition } from "react";
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
  Side,
  Card,
  Section,
  Fighter,
  SplitChoiceMap,
} from "./game/types";
import { easeInOutCubic, inSection } from "./game/math";
import { VC_META, genWheelSections } from "./game/wheel";
import { makeFighter, freshFive } from "./game/decks";
import { isSplit, isNormal, effectiveValue, fmtNum } from "./game/values";

// components
import CanvasWheel, { WheelHandle } from "./components/CanvasWheel";
import StSCard from "./components/StSCard";

// ---------------- Constants ----------------
const HUD_COLORS = { player: "#84cc16", enemy: "#d946ef" } as const;
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
export default function ThreeWheel_WinsOnly() {
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; timeoutsRef.current.forEach(clearTimeout); timeoutsRef.current.clear(); }; }, []);
  const timeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const setSafeTimeout = (fn: () => void, ms: number) => { const id = setTimeout(() => { if (mountedRef.current) fn(); }, ms); timeoutsRef.current.add(id); return id; };

  // Fighters & initiative
  const [player, setPlayer] = useState<Fighter>(() => makeFighter("Wanderer"));
  const [enemy, setEnemy] = useState<Fighter>(() => makeFighter("Shade Bandit"));
  const [initiative, setInitiative] = useState<Side>(() => (Math.random() < 0.5 ? "player" : "enemy"));
  const [wins, setWins] = useState<{ player: number; enemy: number }>({ player: 0, enemy: 0 });
  const [round, setRound] = useState(1);

  // Freeze layout during resolution
  const [freezeLayout, setFreezeLayout] = useState(false);
  const [lockedWheelSize, setLockedWheelSize] = useState<number | null>(null);

  // Phase state
  const [phase, setPhase] = useState<"choose" | "showEnemy" | "anim" | "roundEnd" | "ended">("choose");

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
  if (on) root.classList.add('touch-dragging');
  else root.classList.remove('touch-dragging');
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
      assignToWheel(t.idx, card);
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

/* Prevent the page from scrolling during touch drag */
.touch-dragging, .touch-dragging body {
  touch-action: none !important;
  overscroll-behavior: contain !important;
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
  const [wheelSections, setWheelSections] = useState<Section[][]>(() => [genWheelSections("bandit"), genWheelSections("sorcerer"), genWheelSections("beast")]);
  const [tokens, setTokens] = useState<[number, number, number]>([0, 0, 0]);
  const [active] = useState<[boolean, boolean, boolean]>([true, true, true]);
  const [wheelHUD, setWheelHUD] = useState<[string | null, string | null, string | null]>([null, null, null]);

  // Assignments
  const [assign, setAssign] = useState<{ player: (Card | null)[]; enemy: (Card | null)[] }>({ player: [null, null, null], enemy: [null, null, null] });

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

  const appendLog = (s: string) => setLog((prev) => [s, ...prev].slice(0, 60));
  const [log, setLog] = useState<string[]>(["A Shade Bandit eyes your purse..."]);

  const canReveal = useMemo(() => assign.player.every((c, i) => !active[i] || !!c), [assign.player, active]);

  // Wheel refs for imperative token updates
  const wheelRefs = [useRef<WheelHandle | null>(null), useRef<WheelHandle | null>(null), useRef<WheelHandle | null>(null)];

  // ---- Assignment helpers (batched) ----
  function assignToWheel(i: number, card: Card) {
    if (!active[i]) return;
    startTransition(() => {
      const prevAtI = assign.player[i];
      const fromIdx = assign.player.findIndex((c) => c?.id === card.id);
      const next = [...assign.player];
      if (fromIdx !== -1) next[fromIdx] = null;
      next[i] = card;
      setAssign((a) => ({ ...a, player: next }));
      setPlayer((p) => {
        let hand = p.hand.filter((c) => c.id !== card.id);
        if (prevAtI && prevAtI.id !== card.id) hand = [...hand, prevAtI];
        return { ...p, hand };
      });
      setSelectedCardId(null);
    });
  }

  function clearAssign(i: number) {
    const prev = assign.player[i]; if (!prev) return;
    startTransition(() => {
      setAssign((a) => ({ ...a, player: a.player.map((c, idx) => (idx === i ? null : c)) }));
      setPlayer((p) => ({ ...p, hand: [...p.hand, prev] }));
    });
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

function computeReserveSum(who: Side, used: (Card | null)[]) {
  const hand = who === "player" ? player.hand : enemy.hand;
  const usedIds = new Set((used.filter(Boolean) as Card[]).map((c) => c.id));
  const left = hand.filter((c) => !usedIds.has(c.id));
  return left.slice(0, 2).reduce((a, c) => a + (isNormal(c) ? c.number : 0), 0);
}

  // ---------------- Reveal / Resolve ----------------
  function onReveal() {
    if (!canReveal) return;
    setLockedWheelSize((s) => (s ?? wheelSize));
    setFreezeLayout(true);
    const enemyPicks = autoPickEnemy();
    setAssign((a) => ({ ...a, enemy: enemyPicks }));
    setPhase("showEnemy");
    setSafeTimeout(() => {
      if (!mountedRef.current) return;
      setPhase("anim");
      resolveRound(enemyPicks);
    }, 600);
  }

  function resolveRound(enemyPicks?: (Card | null)[]) {
    const played = [0, 1, 2].map((i) => ({ p: assign.player[i] as Card | null, e: (enemyPicks?.[i] ?? assign.enemy[i]) as Card | null }));

    const pReserve = computeReserveSum("player", played.map((pe) => pe.p));
    const eReserve = computeReserveSum("enemy", played.map((pe) => pe.e));

    type Outcome = { steps: number; targetSlice: number; section: Section; winner: Side | null; tie: boolean; wheel: number; detail: string };
    const outcomes: Outcome[] = [];

    for (let w = 0; w < 3; w++) {
      const secList = wheelSections[w];
      const baseP = (played[w].p?.number ?? 0);
      const baseE = (played[w].e?.number ?? 0);
      const steps = ((baseP % SLICES) + (baseE % SLICES)) % SLICES;
      const targetSlice = (tokens[w] + steps) % SLICES;
      const section = secList.find((s) => targetSlice !== 0 && inSection(targetSlice, s)) || ({ id: "Strongest", color: "transparent", start: 0, end: 0 } as Section);

      const pVal = baseP; const eVal = baseE;
      let winner: Side | null = null; let tie = false; let detail = "";
      switch (section.id) {
        case "Strongest": if (pVal === eVal) tie = true; else winner = pVal > eVal ? "player" : "enemy"; detail = `Strongest ${pVal} vs ${eVal}`; break;
        case "Weakest": if (pVal === eVal) tie = true; else winner = pVal < eVal ? "player" : "enemy"; detail = `Weakest ${pVal} vs ${eVal}`; break;
        case "ReserveSum": if (pReserve === eReserve) tie = true; else winner = pReserve > eReserve ? "player" : "enemy"; detail = `Reserve ${pReserve} vs ${eReserve}`; break;
        case "ClosestToTarget": { const t = section.target ?? 0; const pd = Math.abs(pVal - t), ed = Math.abs(eVal - t); if (pd === ed) tie = true; else winner = pd < ed ? "player" : "enemy"; detail = `Closest to ${t}: ${pVal} vs ${eVal}`; break; }
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
      let hudColors: [string | null, string | null, string | null] = [null, null, null];
      outcomes.forEach((o) => {
        if (o.tie) { appendLog(`Wheel ${o.wheel + 1} tie: ${o.detail} — no win.`); }
        else if (o.winner) {
          if (o.section.id === "Initiative") setInitiative(o.winner);
          hudColors[o.wheel] = HUD_COLORS[o.winner];
          if (o.winner === "player") pWins++; else eWins++;
          appendLog(`Wheel ${o.wheel + 1} win -> ${o.winner} (${o.detail}).`);
        }
      });

      if (!mountedRef.current) return;
      setWheelHUD(hudColors);
      setWins({ player: pWins, enemy: eWins });
      setReserveSums({ player: pReserve, enemy: eReserve });
      setPhase("roundEnd");
      if (pWins >= TARGET_WINS || eWins >= TARGET_WINS) { setPhase("ended"); appendLog(pWins >= TARGET_WINS ? "You win the match!" : `${enemy.name} wins the match!`); }
    };

    animateSpins();
  }

  function nextRound() {
  if (!(phase === "roundEnd" || phase === "ended")) return;

  // Reset visual tokens immediately (imperative)
  wheelRefs.forEach(ref => ref.current?.setVisualToken(0));

  setFreezeLayout(false);
  setLockedWheelSize(null);
  setPlayer((p) => freshFive(p));
  setEnemy((e) => freshFive(e));
  setWheelSections([genWheelSections("bandit"), genWheelSections("sorcerer"), genWheelSections("beast")]);
  setAssign({ player: [null, null, null], enemy: [null, null, null] });

  // Keep state in sync
  setTokens([0, 0, 0]);

  setReserveSums(null);
  setWheelHUD([null, null, null]);
  setPhase("choose");
  setRound((r) => r + 1);
  }

  // ---------------- UI ----------------

  const renderWheelPanel = (i: number) => {
  const pc = assign.player[i];
  const ec = assign.enemy[i];

  const ws = Math.round(lockedWheelSize ?? wheelSize);

  // --- layout numbers that must match the classes below ---
  const slotW    = 80;   // w-[80px] on both slots
  const gapX     = 16;   // gap-2 => 8px, two gaps between three items => 16
  const paddingX = 16;   // p-2 => 8px left + 8px right
  const borderX  = 4;    // border-2 => 2px left + 2px right
  const EXTRA_H  = 16;   // extra breathing room inside the panel (change to tweak height)

  // panel width (border-box) so wheel is visually centered
  const panelW = ws + slotW * 2 + gapX + paddingX + borderX;

  const onZoneDragOver = (e: React.DragEvent) => { e.preventDefault(); if (dragCardId && active[i]) setDragOverWheel(i); };
  const onZoneLeave = () => { if (dragCardId) setDragOverWheel(null); };
  const handleDropCommon = (id: string | null) => {
    if (!id || !active[i]) return;
    const fromHand = player.hand.find((c) => c.id === id);
    const fromSlots = assign.player.find((c) => c && c.id === id) as Card | undefined;
    const card = fromHand || fromSlots || null;
    if (card) assignToWheel(i, card as Card);
    setDragOverWheel(null); setDragCardId(null);
  };
  const onZoneDrop = (e: React.DragEvent) => { e.preventDefault(); handleDropCommon(e.dataTransfer.getData("text/plain") || dragCardId); };

  const tapAssignIfSelected = () => {
    if (!selectedCardId) return;
    const card = player.hand.find(c => c.id === selectedCardId) || assign.player.find(c => c?.id === selectedCardId) || null;
    if (card) assignToWheel(i, card as Card);
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
  onDrop={onZoneDrop}
  onClick={(e) => {
    e.stopPropagation();
    if (selectedCardId) tapAssignIfSelected();
    else if (pc)      clearAssign(i);
  }}
  className="w-[80px] h-[92px] rounded-md border px-1 py-0 flex items-center justify-center flex-none"
  style={{
    backgroundColor: dragOverWheel === i ? 'rgba(182,138,78,.12)' : THEME.slotBg,
    borderColor:     dragOverWheel === i ? THEME.brass          : THEME.slotBorder,
  }}
  aria-label={`Wheel ${i+1} player slot`}
>
          {pc ? <StSCard card={pc} size="sm" /> : <div className="text-[11px] opacity-80 text-center">Your card</div>}
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
          style={{ backgroundColor: THEME.slotBg, borderColor: THEME.slotBorder }}
          aria-label={`Wheel ${i+1} enemy slot`}
        >
          {ec && (phase === "showEnemy" || phase === "anim" || phase === "roundEnd" || phase === "ended") ? (
            <StSCard card={ec} size="sm" disabled />
          ) : (
            <div className="text-[11px] opacity-60 text-center">Enemy</div>
          )}
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

    return (
      <div ref={dockRef} className="fixed left-0 right-0 bottom-0 z-50 pointer-events-none select-none" style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + -30px)' }}>
        <div className="mx-auto max-w-[1400px] flex justify-center gap-1.5 py-0.5">
          {player.hand.map((card, idx) => {
            const isSelected = selectedCardId === card.id;
            return (
              <div key={card.id} className="group relative pointer-events-auto" style={{ zIndex: 10 + idx }}>
                <motion.div data-hand-card initial={false} animate={{ y: isSelected ? -Math.max(8, liftPx - 10) : -liftPx, opacity: 1, scale: isSelected ? 1.06 : 1 }} whileHover={{ y: -Math.max(8, liftPx - 10), opacity: 1, scale: 1.04 }} transition={{ type: 'spring', stiffness: 320, damping: 22 }} className={`drop-shadow-xl ${isSelected ? 'ring-2 ring-amber-300' : ''}`}>
                  <button
  data-hand-card
  className="pointer-events-auto"
  onClick={(e) => {
    e.stopPropagation();
    setSelectedCardId((prev) => (prev === card.id ? null : card.id));
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

const HUDPanels = () => {
  const rsP = reserveSums ? reserveSums.player : null;
  const rsE = reserveSums ? reserveSums.enemy : null;

  const Panel = ({ side }: { side: Side }) => {
    const isPlayer = side === 'player';
    const color = HUD_COLORS[side];
    const name = isPlayer ? player.name : enemy.name;
    const win = isPlayer ? wins.player : wins.enemy;
    const rs = isPlayer ? rsP : rsE;
    const hasInit = initiative === side;
    const isReserveVisible = phase === 'roundEnd' && rs !== null;

    return (
      <div className="flex flex-col items-center w-full">
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
          <div className="flex items-center max-w-[36vw] sm:max-w-none min-w-0">
            <span className="truncate block font-semibold">{name}</span>
          </div>
          <div className="flex items-center gap-1 ml-1 flex-shrink-0">
            <span className="opacity-80">Wins</span>
            <span className="text-base font-extrabold tabular-nums">{win}</span>
          </div>
          <div
            className={`ml-2 rounded-full border px-2 py-0.5 text-[11px] overflow-hidden text-ellipsis whitespace-nowrap transition-opacity ${
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

        {/* (removed) old outside flag that was pushing layout down */}
        {/* {hasInit && <span className="mt-1" aria-label="Has initiative">⚑</span>} */}
      </div>
    );
  };

  return (
    <div className="w-full flex flex-col items-center">
      <div className="w-full grid grid-cols-2 gap-2 overflow-x-hidden">
        <div className="min-w-0 w-full max-w-[420px] mx-auto">
          <Panel side="player" />
        </div>
        <div className="min-w-0 w-full max-w-[420px] mx-auto">
          <Panel side="enemy" />
        </div>
      </div>
    </div>
  );
};


  return (
    <div className="h-screen w-screen overflow-x-hidden overflow-y-hidden text-slate-100 p-1 grid gap-2" style={{ gridTemplateRows: "auto auto 1fr auto" }}>
      {/* Controls */}
      <div className="flex items-center justify-between text-[12px] min-h-[24px]">
        <div className="flex items-center gap-3">
          <div><span className="opacity-70">Round</span> <span className="font-semibold">{round}</span></div>
          <div><span className="opacity-70">Phase</span> <span className="font-semibold">{phase}</span></div>
          <div><span className="opacity-70">Goal</span> <span className="font-semibold">First to {TARGET_WINS} wins</span></div>
        </div>
        <div className="flex items-center gap-2 relative">
          <button onClick={() => setShowRef((v) => !v)} className="px-2.5 py-0.5 rounded bg-slate-700 text-white border border-slate-600 hover:bg-slate-600">Reference</button>
          {showRef && (
            <div className="absolute top-[110%] right-0 w-80 rounded-lg border border-slate-700 bg-slate-800/95 shadow-xl p-3 z-50">
              <div className="flex items-center justify-between mb-1"><div className="font-semibold">Reference</div><button onClick={() => setShowRef(false)} className="text-xl leading-none text-slate-300 hover:text-white">×</button></div>
              <div className="text-[12px] space-y-2">
                <div>Place <span className="font-semibold">1 card next to each wheel</span>, then <span className="font-semibold">press the Resolve button</span>. Where the <span className="font-semibold">token stops</span> decides the winnning rule, and the player who matches it gets <span className="font-semibold">1 win</span>. First to <span className="font-semibold">7</span> wins takes the match.</div>
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
          {phase === "choose" && <button disabled={!canReveal} onClick={onReveal} className="px-2.5 py-0.5 rounded bg-amber-400 text-slate-900 font-semibold disabled:opacity-50">Resolve</button>}
          {(phase === "roundEnd" || phase === "ended") && <button onClick={nextRound} className="px-2.5 py-0.5 rounded bg-emerald-500 text-slate-900 font-semibold">Next</button>}
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

    </div>
  );

}

// ---------------- Dev Self-Tests (lightweight) ----------------
// These run once in dev consoles to catch regressions.
if (typeof window !== 'undefined') {
  try {
    // inSection should exclude 0 and handle wrap
    const s: Section = { id: "Strongest", color: "#fff", start: 14, end: 2 } as any;
    console.assert(!inSection(0, s), 'slice 0 excluded');
    console.assert(inSection(14, s) && inSection(15, s) && inSection(1, s) && inSection(2, s), 'wrap includes 14,15,1,2');
  } catch {}
  try {
    // sections cover 15 slices total (1..15)
    const secs = genWheelSections("bandit");
    const len = (sec: Section) => (sec.start <= sec.end ? (sec.end - sec.start + 1) : (SLICES - sec.start + (sec.end + 1)));
    const sum = secs.reduce((a, s) => a + len(s), 0);
    console.assert(sum === 15, 'sections cover 15 slices');
  } catch {}
}

