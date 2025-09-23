import { motion } from "framer-motion";
import { useThreeWheelGame } from "./features/threeWheel/hooks/useThreeWheelGame"
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
  type GameMode,
  LEGACY_FROM_SIDE,
} from "./game/types";
import { easeInOutCubic, inSection, createSeededRng } from "./game/math";
import { VC_META, genWheelSections } from "./game/wheel";
import {
  ARCHETYPE_DEFINITIONS,
  ARCHETYPE_IDS,
  DEFAULT_ARCHETYPE,
  type ArchetypeId,
} from "./game/archetypes";
import {
  makeFighter,
  drawOne,
  freshFive,
  recordMatchResult,
  type MatchResultSummary,
  type LevelProgress,
} from "./player/profileStore";
import { isSplit, isNormal, effectiveValue, fmtNum } from "./game/values";
import {
  autoPickEnemy,
  calcWheelSize,
  computeReserveSum,
  settleFighterAfterRound,
} from "./features/threeWheel/utils/combat";

// components
import CanvasWheel, { type WheelHandle } from "./components/CanvasWheel";
import WheelPanel from "./features/threeWheel/components/WheelPanel";
import HandDock from "./features/threeWheel/components/HandDock";
import HUDPanels from "./features/threeWheel/components/HUDPanels";
import VictoryOverlay from "./features/threeWheel/components/VictoryOverlay";
import { getSpellDefinitions, type SpellDefinition } from "./game/spells";
import ArchetypeModal from "./features/threeWheel/components/ArchetypeModal";
import StSCard from "./components/StSCard";

// ---- Local aliases/types/state helpers
type AblyRealtime = InstanceType<typeof Realtime>;
type AblyChannel = ReturnType<AblyRealtime["channels"]["get"]>;
type LegacySide = "player" | "enemy";

type SideState<T> = Record<LegacySide, T>;
type WheelSideState<T> = [SideState<T>, SideState<T>, SideState<T>];

const createWheelSideState = <T,>(value: T): WheelSideState<T> => [
  { player: value, enemy: value },
  { player: value, enemy: value },
  { player: value, enemy: value },
];

const createWheelLockState = (): [boolean, boolean, boolean] => [false, false, false];
const createPointerShiftState = (): [number, number, number] => [0, 0, 0];
const createReservePenaltyState = (): SideState<number> => ({ player: 0, enemy: 0 });

// Spells-related state/types
type PendingSpellDescriptor = { side: LegacySide; spell: SpellDefinition };

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
  | { type: "spellState"; side: LegacySide; lane: number; state: LaneSpellState };

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
  gameMode = "classic",
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

  const isGrimoireMode = gameMode === "grimoire";
  const effectiveGameMode = gameMode;
  const pendingSpell: PendingSpellDescriptor | null = null;
  const manaPools = useMemo(() => ({ player: 3, enemy: 3 }), []);
  const localMana = manaPools[localLegacySide];

  const [localSelection, setLocalSelection] = useState<ArchetypeId>(
    () => DEFAULT_ARCHETYPE
  );
  const remoteSelection: ArchetypeId = DEFAULT_ARCHETYPE;
  const [localReady, setLocalReady] = useState(() => !isGrimoireMode);
  const remoteReady = true;
  const [showArchetypeModal, setShowArchetypeModal] = useState(isGrimoireMode);
  const [archetypeGateOpen, setArchetypeGateOpen] = useState(
    () => !isGrimoireMode
  );

  useEffect(() => {
    if (isGrimoireMode) {
      setLocalSelection(DEFAULT_ARCHETYPE);
      setLocalReady(false);
      setShowArchetypeModal(true);
      setArchetypeGateOpen(false);
    } else {
      setLocalReady(true);
      setShowArchetypeModal(false);
      setArchetypeGateOpen(true);
    }
  }, [isGrimoireMode]);

  const localSpells = useMemo<string[]>(() => {
    const def = ARCHETYPE_DEFINITIONS[localSelection];
    return def ? def.spellIds : [];
  }, [localSelection]);

  const remoteSpells = useMemo<string[]>(() => {
    const def = ARCHETYPE_DEFINITIONS[remoteSelection];
    return def ? def.spellIds : [];
  }, [remoteSelection]);

  const localSpellDefinitions = useMemo(
    () => getSpellDefinitions(localSpells),
    [localSpells]
  );

  const casterFighter = localLegacySide === "player" ? player : enemy;
  const opponentFighter = localLegacySide === "player" ? enemy : player;
  const readyButtonLabel = isMultiplayer ? "Ready" : "Next";
  const readyButtonDisabled = localReady;
  const handleLocalArchetypeSelect = useCallback((id: ArchetypeId) => {
    setLocalSelection(id);
    setLocalReady(false);
  }, []);

  const handleLocalArchetypeReady = useCallback(() => {
    setLocalReady(true);
    setShowArchetypeModal(false);
    setArchetypeGateOpen(true);
  }, []);
  const handleSpellActivate = useCallback((spell: SpellDefinition) => {
    console.warn("Spell activation is not yet implemented.", spell);
  }, []);
  const wheelDamage = useMemo(() => createWheelSideState(0), []);
  const wheelMirror = useMemo(() => createWheelSideState(false), []);
  const wheelLocks = useMemo(() => createWheelLockState(), []);
  const pointerShifts = useMemo(() => createPointerShiftState(), []);
  const reservePenalties = useMemo(() => createReservePenaltyState(), []);
  const initiativeOverride: LegacySide | null = null;

  const infoPopoverRootRef = useRef<HTMLDivElement | null>(null);
  const [showRef, setShowRef] = useState(false);
  const [showGrimoire, setShowGrimoire] = useState(false);


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
      const root = dockRef.current;
      if (!root) return;
      const sample = root.querySelector("[data-hand-card]") as HTMLElement | null;
      if (!sample) return;
      const h = sample.getBoundingClientRect().height || 96;
      const nextLift = Math.round(Math.min(44, Math.max(12, h * 0.34)));
      setLiftPx(nextLift);
      const clearance = Math.round(h + nextLift + 12);
      onMeasure?.(clearance);
    };
    compute();
    window.addEventListener("resize", compute);
    window.addEventListener("orientationchange", compute);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("orientationchange", compute);
    };
  }, [onMeasure]);

  const localFighter: Fighter = localLegacySide === "player" ? player : enemy;

  return (
    <div
      ref={dockRef}
      className="fixed left-0 right-0 bottom-0 z-50 pointer-events-none select-none"
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) - 30px)" }}
    >
      <div className="mx-auto max-w-[1400px] flex justify-center gap-1.5 py-0.5">
        {localFighter.hand.map((card, idx) => {
          const isSelected = selectedCardId === card.id;
          return (
            <div key={card.id} className="group relative pointer-events-auto" style={{ zIndex: 10 + idx }}>
              <motion.div
                data-hand-card
                initial={false}
                animate={{
                  y: isSelected ? -Math.max(8, liftPx - 10) : -liftPx,
                  opacity: 1,
                  scale: isSelected ? 1.06 : 1,
                }}
                whileHover={{
                  y: -Math.max(8, liftPx - 10),
                  opacity: 1,
                  scale: 1.04,
                }}
                transition={{ type: "spring", stiffness: 320, damping: 22 }}
                className={`drop-shadow-xl ${isSelected ? "ring-2 ring-amber-300" : ""}`}
              >
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
                    const lane =
                      localLegacySide === "player" ? assign.player : assign.enemy;
                    const slotIdx = lane.findIndex((c) => c?.id === selectedCardId);
                    if (slotIdx !== -1) {
                      assignToWheelLocal(slotIdx, card);
                      return;
                    }
                    setSelectedCardId(card.id);
                  }}
                  draggable
                  onDragStart={(e) => {
                    setDragCardId(card.id);
                    try {
                      e.dataTransfer.setData("text/plain", card.id);
                    } catch {}
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => setDragCardId(null)}
                  onPointerDown={(e) => startPointerDrag(card, e)}
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

      {/* Touch drag ghost */}
      {isPtrDragging && ptrDragCard && (
        <div
          style={{
            position: "fixed",
            left: 0,
            top: 0,
            transform: `translate(${ptrPos.current.x - 48}px, ${ptrPos.current.y - 64}px)`,
            pointerEvents: "none",
            zIndex: 9999,
          }}
        >
          <div style={{ transform: "scale(0.9)", filter: "drop-shadow(0 6px 8px rgba(0,0,0,.35))" }}>
            <StSCard card={ptrDragCard} />
          </div>
        </div>
      )}
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

    <div className={`h-screen w-screen overflow-x-hidden overflow-y-hidden text-slate-100 p-1 grid gap-2 ${rootModeClassName}`}
  style={{ gridTemplateRows: "auto auto 1fr auto" }}
  data-game-mode={effectiveGameMode}         // <- use your resolved mode var
  data-mana-enabled={grimoireAttrValue}
  data-spells-enabled={grimoireAttrValue}
  data-archetypes-enabled={grimoireAttrValue}
  data-pending-spell={pendingSpell ? pendingSpell.spell.id : ""}
  data-local-mana={localMana}
>
      {showArchetypeModal && (
        <ArchetypeModal
          isMultiplayer={isMultiplayer}
          hudColors={HUD_COLORS}
          localSide={localLegacySide}
          remoteSide={remoteLegacySide}
          namesBySide={namesByLegacy}
          localSelection={localSelection}
          remoteSelection={remoteSelection}
          localReady={localReady}
          remoteReady={remoteReady}
          localSpells={localSpells}
          remoteSpells={remoteSpells}
          onSelect={handleLocalArchetypeSelect}
          onReady={handleLocalArchetypeReady}
          readyButtonLabel={readyButtonLabel}
          readyButtonDisabled={readyButtonDisabled}
        />
      )}


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
                <>
                  <div
                    className="fixed inset-0 z-[70] bg-slate-950/40 backdrop-blur-sm"
                    onClick={() => setShowGrimoire(false)}
                  />
                  <div className="fixed inset-x-4 top-20 z-[80] flex justify-center sm:justify-end">
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
                      <div className="max-h-[65vh] overflow-y-auto px-4 py-4 text-[12px]">
                        <div className="flex items-center justify-between text-[11px] text-slate-300">
                          <span className="flex items-center gap-1">
                            <span aria-hidden className="text-sky-300">🔹</span>
                            <span>Mana</span>
                          </span>
                          <span className="font-semibold text-slate-100">{localMana}</span>
                        </div>
                        <div className="mt-3 space-y-2">
                          {localSpellDefinitions.length === 0 ? (
                            <div className="italic text-slate-400">No spells learned yet.</div>
                          ) : (
                            <ul className="space-y-2">
                              {localSpellDefinitions.map((spell) => {
                                const allowedPhases = spell.allowedPhases ?? ["choose"];
                                const phaseAllowed = allowedPhases.includes(phase);
                                const computedCostRaw = spell.variableCost
                                  ? spell.variableCost({
                                      caster: casterFighter,
                                      opponent: opponentFighter,
                                      phase,
                                      state: {},
                                    })
                                  : spell.cost;
                                const effectiveCost = Number.isFinite(computedCostRaw)
                                  ? Math.max(0, Math.round(computedCostRaw as number))
                                  : spell.cost;
                                const canAfford = localMana >= effectiveCost;
                                const disabled = !phaseAllowed || !canAfford;
                                return (
                                  <li key={spell.id}>
                                    <button
                                      type="button"
                                      onClick={() => handleSpellActivate(spell)}
                                      disabled={disabled}
                                      className={`w-full rounded-xl border border-slate-700/70 bg-slate-900/60 px-3 py-2 text-left transition ${
                                        disabled
                                          ? "cursor-not-allowed opacity-50"
                                          : "hover:bg-slate-800/80 focus:outline-none focus:ring-2 focus:ring-slate-500/50"
                                      }`}
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
                                      <div className="mt-1 text-[11px] leading-snug text-slate-300">
                                        {spell.description}
                                      </div>
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
                    </div>
                  </div>
                </>
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
      <div className="relative z-10">
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
        />
      </div>

      {/* Wheels center */}
      <div className="relative z-0" style={{ paddingBottom: handClearance }}>
        <div className="flex flex-col items-center justify-start gap-1">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex-shrink-0">
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
                archetypeGateOpen={archetypeGateOpen}
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
                wheelHudColor={wheelHUD[i]}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Docked hand overlay */}
      <HandDock
        localLegacySide={localLegacySide}
        player={player}
        enemy={enemy}
        selectedCardId={selectedCardId}
        setSelectedCardId={setSelectedCardId}
        assign={assign}
        assignToWheelLocal={assignToWheelLocal}
        setDragCardId={setDragCardId}
        startPointerDrag={startPointerDrag}
        isPtrDragging={isPtrDragging}
        ptrDragCard={ptrDragCard}
        ptrPos={ptrPos}
        onMeasure={setHandClearance}
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
