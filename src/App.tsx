import React, { useEffect, useRef, useState } from "react";
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
  type Side as TwoSide,
  type Card,
  type Section,
  type Fighter,
  type Players,
} from "./game/types";
import { inSection } from "./game/math";
import { genWheelSections } from "./game/wheel";

// hooks
import { useThreeWheelGame, type LegacySide } from "./features/threeWheel/hooks/useThreeWheelGame";

// components
import CanvasWheel from "./components/CanvasWheel";
import StSCard from "./components/StSCard";

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
}: {
  localSide: TwoSide;
  localPlayerId: string;
  players: Players;
  seed: number;
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
    onExit,
  });

  const {
    player,
    enemy,
    initiative,
    wins,
    round,
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
    dragCardId,
    dragOverWheel,
    selectedCardId,
    reserveSums,
    isPtrDragging,
    ptrDragCard,
    lockedWheelSize,
  } = state;

  const {
    localLegacySide,
    remoteLegacySide,
    namesByLegacy,
    HUD_COLORS,
    winGoal,
    isMultiplayer,
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
    assignToWheelLocal,
    handleRevealClick,
    handleNextClick,
    handleRematchClick,
    handleExitClick,
  } = actions;

  const [showRef, setShowRef] = useState(false);

  type SlotView = { side: LegacySide; card: Card | null; name: string };

  const renderWheelPanel = (i: number) => {
    const pc = assign.player[i];
    const ec = assign.enemy[i];

    const leftSlot: SlotView = { side: "player", card: pc, name: namesByLegacy.player };
    const rightSlot: SlotView = { side: "enemy", card: ec, name: namesByLegacy.enemy };

    const ws = Math.round(lockedWheelSize ?? wheelSize);

    const isLeftSelected = !!leftSlot.card && selectedCardId === leftSlot.card.id;
    const isRightSelected = !!rightSlot.card && selectedCardId === rightSlot.card.id;

    const shouldShowLeftCard =
      !!leftSlot.card && (leftSlot.side === localLegacySide || phase !== "choose");
    const shouldShowRightCard =
      !!rightSlot.card && (rightSlot.side === localLegacySide || phase !== "choose");

    // --- layout numbers that must match the classes below ---
    const slotW = 80; // w-[80px] on both slots
    const gapX = 16; // gap-2 => 8px, two gaps between three items => 16
    const paddingX = 16; // p-2 => 8px left + 8px right
    const borderX = 4; // border-2 => 2px left + 2px right
    const EXTRA_H = 16; // extra breathing room inside the panel (change to tweak height)

    // panel width (border-box) so wheel is visually centered
    const panelW = ws + slotW * 2 + gapX + paddingX + borderX;

    const renderSlotCard = (slot: SlotView, isSlotSelected: boolean) => {
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
        try {
          e.dataTransfer.setData("text/plain", card.id);
        } catch {}
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

    const onZoneDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      if (dragCardId && active[i]) setDragOverWheel(i);
    };
    const onZoneLeave = () => {
      if (dragCardId) setDragOverWheel(null);
    };
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
      const fromSlots = (isLocalPlayer ? assign.player : assign.enemy).find((c) => c && c.id === id) as
        | Card
        | undefined;
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
        (isLocalPlayer ? player.hand : enemy.hand).find((c) => c.id === selectedCardId) ||
        (isLocalPlayer ? assign.player : assign.enemy).find((c) => c?.id === selectedCardId) ||
        null;
      if (card) assignToWheelLocal(i, card as Card);
    };

    const panelShadow = "0 2px 8px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.04)";

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
          contain: "paint",
          backfaceVisibility: "hidden",
          transform: "translateZ(0)",
          isolation: "isolate",
        }}
      >
        {(phase === "roundEnd" || phase === "ended") && (
          <>
            <span
              aria-label={`Wheel ${i + 1} player result`}
              className="absolute top-1 left-1 rounded-full border"
              style={{
                width: 10,
                height: 10,
                background: wheelHUD[i] === HUD_COLORS.player ? HUD_COLORS.player : "transparent",
                borderColor: wheelHUD[i] === HUD_COLORS.player ? HUD_COLORS.player : THEME.panelBorder,
                boxShadow: "0 0 0 1px rgba(0,0,0,0.4)",
              }}
            />
            <span
              aria-label={`Wheel ${i + 1} enemy result`}
              className="absolute top-1 right-1 rounded-full border"
              style={{
                width: 10,
                height: 10,
                background: wheelHUD[i] === HUD_COLORS.enemy ? HUD_COLORS.enemy : "transparent",
                borderColor: wheelHUD[i] === HUD_COLORS.enemy ? HUD_COLORS.enemy : THEME.panelBorder,
                boxShadow: "0 0 0 1px rgba(0,0,0,0.4)",
              }}
            />
          </>
        )}

        <div className="flex items-center justify-center gap-2" style={{ height: ws + EXTRA_H }}>
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
                tapAssignIfSelected();
              } else if (leftSlot.card) {
                setSelectedCardId(leftSlot.card.id);
              }
            }}
            className="w-[80px] h-[92px] rounded-md border px-1 py-0 flex items-center justify-center flex-none"
            style={{
              backgroundColor:
                dragOverWheel === i || isLeftSelected ? "rgba(182,138,78,.12)" : THEME.slotBg,
              borderColor: dragOverWheel === i || isLeftSelected ? THEME.brass : THEME.slotBorder,
              boxShadow: isLeftSelected ? "0 0 0 1px rgba(251,191,36,0.7)" : "none",
            }}
            aria-label={`Wheel ${i + 1} left slot`}
          >
            {shouldShowLeftCard ? (
              renderSlotCard(leftSlot, isLeftSelected)
            ) : (
              <div className="text-[11px] opacity-80 text-center">
                {leftSlot.side === localLegacySide ? "Your card" : leftSlot.name}
              </div>
            )}
          </div>

          <div
            data-drop="wheel"
            data-idx={i}
            className="relative flex-none flex items-center justify-center rounded-full overflow-hidden"
            style={{ width: ws, height: ws }}
            onDragOver={onZoneDragOver}
            onDragEnter={onZoneDragOver}
            onDragLeave={onZoneLeave}
            onDrop={onZoneDrop}
            onClick={(e) => {
              e.stopPropagation();
              tapAssignIfSelected();
            }}
            aria-label={`Wheel ${i + 1}`}
          >
            <CanvasWheel ref={wheelRefs[i]} sections={wheelSections[i]} size={ws} />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-full"
              style={{
                boxShadow:
                  dragOverWheel === i ? "0 0 0 2px rgba(251,191,36,0.7) inset" : "none",
              }}
            />
          </div>

          <div
            className="w-[80px] h-[92px] rounded-md border px-1 py-0 flex items-center justify-center flex-none"
            style={{
              backgroundColor:
                dragOverWheel === i || isRightSelected ? "rgba(182,138,78,.12)" : THEME.slotBg,
              borderColor: dragOverWheel === i || isRightSelected ? THEME.brass : THEME.slotBorder,
              boxShadow: isRightSelected ? "0 0 0 1px rgba(251,191,36,0.7)" : "none",
            }}
            aria-label={`Wheel ${i + 1} right slot`}
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
            {shouldShowRightCard ? (
              renderSlotCard(rightSlot, isRightSelected)
            ) : (
              <div className="text-[11px] opacity-60 text-center">
                {rightSlot.side === localLegacySide ? "Your card" : rightSlot.name}
              </div>
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

const HUDPanels = () => {
  const rsP = reserveSums ? reserveSums.player : null;
  const rsE = reserveSums ? reserveSums.enemy : null;

  const Panel = ({ side }: { side: LegacySide }) => {
    const isPlayer = side === 'player';
    const color = isPlayer ? (players.left.color ?? HUD_COLORS.player) : (players.right.color ?? HUD_COLORS.enemy);
    const name = isPlayer ? players.left.name : players.right.name;
    const win = isPlayer ? wins.player : wins.enemy;
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
          <div className="flex items-center gap-1 ml-1 flex-shrink-0">
            <span className="opacity-80">Wins</span>
            <span className="text-base font-extrabold tabular-nums">{win}</span>
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

  return (
    <div className="h-screen w-screen overflow-x-hidden overflow-y-hidden text-slate-100 p-1 grid gap-2" style={{ gridTemplateRows: "auto auto 1fr auto" }}>
      {/* Controls */}
      <div className="flex items-center justify-between text-[12px] min-h-[24px]">
        <div className="flex items-center gap-3">
          <div><span className="opacity-70">Round</span> <span className="font-semibold">{round}</span></div>
          <div><span className="opacity-70">Phase</span> <span className="font-semibold">{phase}</span></div>
          <div><span className="opacity-70">Goal</span> <span className="font-semibold">First to {winGoal} wins</span></div>
        </div>
        <div className="flex items-center gap-2 relative">
          <button onClick={() => setShowRef((v) => !v)} className="px-2.5 py-0.5 rounded bg-slate-700 text-white border border-slate-600 hover:bg-slate-600">Reference</button>
          {showRef && (
            <div className="absolute top-[110%] right-0 w-80 rounded-lg border border-slate-700 bg-slate-800/95 shadow-xl p-3 z-50">
              <div className="flex items-center justify-between mb-1"><div className="font-semibold">Reference</div><button onClick={() => setShowRef(false)} className="text-xl leading-none text-slate-300 hover:text-white">×</button></div>
              <div className="text-[12px] space-y-2">
                <div>Place <span className="font-semibold">1 card next to each wheel</span>, then <span className="font-semibold">press the Resolve button</span>. Where the <span className="font-semibold">token stops</span> decides the winnning rule, and the player who matches it gets <span className="font-semibold">1 win</span>. First to <span className="font-semibold">{winGoal}</span> wins takes the match.</div>
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
