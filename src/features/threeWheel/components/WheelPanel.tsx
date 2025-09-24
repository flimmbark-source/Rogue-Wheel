import React from "react";
import CanvasWheel, { WheelHandle } from "../../../components/CanvasWheel";
import StSCard from "../../../components/StSCard";
import type { Card, Fighter, Phase, Section } from "../../../game/types";
import {
  spellTargetRequiresManualSelection,
  type SpellDefinition,
  type SpellTargetInstance,
  type SpellTargetOwnership,
} from "../../../game/spells";
import {
  isChooseLikePhase,
  shouldShowSlotCard,
  type LegacySide,
} from "../utils/slotVisibility";

type SideState<T> = Record<LegacySide, T>;

interface Theme {
  panelBg: string;
  panelBorder: string;
  slotBg: string;
  slotBorder: string;
  brass: string;
  textWarm: string;
}

export interface WheelPanelProps {
  index: number;
  assign: { player: (Card | null)[]; enemy: (Card | null)[] };
  namesByLegacy: Record<LegacySide, string>;
  wheelSize: number;
  lockedWheelSize: number | null;
  wheelDamage: SideState<number>;
  wheelMirror: SideState<boolean>;
  wheelLocked: boolean;
  pointerShift: number;
  reservePenalties: SideState<number>;
  selectedCardId: string | null;
  setSelectedCardId: (value: string | null) => void;
  localLegacySide: LegacySide;
  phase: Phase;
  archetypeGateOpen: boolean;
  setDragCardId: (value: string | null) => void;
  dragCardId: string | null;
  setDragOverWheel: (value: number | null) => void;
  dragOverWheel: number | null;
  player: Fighter;
  enemy: Fighter;
  assignToWheelLocal: (laneIndex: number, card: Card) => void;
  isWheelActive: boolean;
  wheelRef: React.RefObject<WheelHandle | null>;
  wheelSection: Section[];
  hudColors: Record<LegacySide, string>;
  theme: Theme;
  initiativeOverride: LegacySide | null;
  startPointerDrag: (card: Card, e: React.PointerEvent<HTMLButtonElement>) => void;
  wheelHudColor: string | null;
  pendingSpell: {
    side: LegacySide;
    spell: SpellDefinition;
    target: SpellTargetInstance | null;
  } | null;
  onSpellTargetSelect?: (cardId: string, ownerSide: LegacySide, cardName: string) => void;
  onWheelTargetSelect?: (wheelIndex: number) => void;
  isAwaitingSpellTarget: boolean;
}

const slotWidthPx = 80;
const gapXPx = 16;
const paddingXPx = 16;
const borderXPx = 4;
const extraHeightPx = 16;

const WheelPanel: React.FC<WheelPanelProps> = ({
  index,
  assign,
  namesByLegacy,
  wheelSize,
  lockedWheelSize,
  wheelDamage,
  wheelMirror,
  wheelLocked,
  pointerShift,
  reservePenalties,
  selectedCardId,
  setSelectedCardId,
  localLegacySide,
  phase,
  archetypeGateOpen,
  setDragCardId,
  dragCardId,
  setDragOverWheel,
  dragOverWheel,
  player,
  enemy,
  assignToWheelLocal,
  isWheelActive,
  wheelRef,
  wheelSection,
  hudColors,
  theme,
  initiativeOverride,
  startPointerDrag,
  wheelHudColor,
  pendingSpell,
  onSpellTargetSelect,
  onWheelTargetSelect,
  isAwaitingSpellTarget,
}) => {
  const playerCard = assign.player[index];
  const enemyCard = assign.enemy[index];

  const damageState = wheelDamage;
  const mirrorState = wheelMirror;
  const lockState = wheelLocked;
  const playerPenalty = reservePenalties.player;
  const enemyPenalty = reservePenalties.enemy;

  const awaitingManualTarget =
    isAwaitingSpellTarget &&
    pendingSpell &&
    spellTargetRequiresManualSelection(pendingSpell.spell.target) &&
    !pendingSpell.target;

  const awaitingCardTarget =
    awaitingManualTarget && pendingSpell?.spell.target.type === "card";

  const awaitingWheelTarget =
    awaitingManualTarget && pendingSpell?.spell.target.type === "wheel";

  const awaitingSpellTarget = awaitingManualTarget;

  const pendingOwnership: SpellTargetOwnership | null = awaitingCardTarget
    ? pendingSpell!.spell.target.ownership
    : null;

  const leftSlot = { side: "player" as const, card: playerCard, name: namesByLegacy.player };
  const rightSlot = { side: "enemy" as const, card: enemyCard, name: namesByLegacy.enemy };

  const ws = Math.round(lockedWheelSize ?? wheelSize);

  const isLeftSelected = !!leftSlot.card && selectedCardId === leftSlot.card.id;
  const isRightSelected = !!rightSlot.card && selectedCardId === rightSlot.card.id;

  const leftSlotOwnership: SpellTargetOwnership | null = pendingSpell
    ? leftSlot.side === pendingSpell.side
      ? "ally"
      : "enemy"
    : null;
  const rightSlotOwnership: SpellTargetOwnership | null = pendingSpell
    ? rightSlot.side === pendingSpell.side
      ? "ally"
      : "enemy"
    : null;

  const leftSlotTargetable =
    awaitingCardTarget &&
    !!leftSlot.card &&
    (pendingOwnership === "any" || pendingOwnership === leftSlotOwnership);

  const rightSlotTargetable =
    awaitingCardTarget &&
    !!rightSlot.card &&
    (pendingOwnership === "any" || pendingOwnership === rightSlotOwnership);

  const isPhaseChooseLike = isChooseLikePhase(phase);

  const shouldShowLeftCard = shouldShowSlotCard({
    hasCard: !!leftSlot.card,
    slotSide: leftSlot.side,
    localLegacySide,
    isPhaseChooseLike,
    slotTargetable: leftSlotTargetable,
  });
  const shouldShowRightCard = shouldShowSlotCard({
    hasCard: !!rightSlot.card,
    slotSide: rightSlot.side,
    localLegacySide,
    isPhaseChooseLike,
    slotTargetable: rightSlotTargetable,
  });

  const wheelScope = pendingSpell?.spell.target.type === "wheel" ? pendingSpell.spell.target.scope : null;
  const wheelTargetable =
    awaitingWheelTarget &&
    pendingSpell?.side === localLegacySide &&
    (wheelScope === "any" || (wheelScope === "current" && isWheelActive));

  const panelWidth = ws + slotWidthPx * 2 + gapXPx + paddingXPx + borderXPx;

  const renderSlotCard = (slot: typeof leftSlot, isSlotSelected: boolean) => {
    if (!slot.card) return null;
    const card = slot.card;
    const slotOwnership: SpellTargetOwnership = pendingSpell
      ? slot.side === pendingSpell.side
        ? "ally"
        : "enemy"
      : "ally";

    const isSlotTargetable =
      awaitingSpellTarget &&
      !!slot.card &&
      (pendingOwnership === "any" || pendingOwnership === slotOwnership);

    const canInteractNormally =
      !awaitingSpellTarget &&
      slot.side === localLegacySide &&
      phase === "choose" &&
      archetypeGateOpen &&
      isWheelActive;

    const cardInteractable = canInteractNormally || isSlotTargetable;

    const handlePick = () => {
      if (isSlotTargetable && slot.card) {
        onSpellTargetSelect?.(slot.card.id, slot.side, slot.card.name);
        return;
      }
      if (!canInteractNormally) return;
      if (selectedCardId) {
        tapAssignIfSelected();
      } else {
        setSelectedCardId(card.id);
      }
    };

    const handleDragStart = (e: React.DragEvent<HTMLButtonElement>) => {
      if (!canInteractNormally) return;
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
      if (!canInteractNormally) return;
      e.stopPropagation();
      startPointerDrag(card, e);
    };

    return (
      <StSCard
        card={card}
        size="sm"
        disabled={!cardInteractable}
        selected={isSlotSelected}
        onPick={handlePick}
        draggable={canInteractNormally}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onPointerDown={handlePointerDown}
        className={isSlotTargetable ? "ring-2 ring-sky-400" : undefined}
        spellTargetable={isSlotTargetable}
      />
    );
  };

  const onZoneDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (awaitingSpellTarget) return;
    if (dragCardId && isWheelActive) setDragOverWheel(index);
  };
  const onZoneLeave = () => {
    if (dragCardId) setDragOverWheel(null);
  };

  const handleDropCommon = (id: string | null, targetSide?: LegacySide) => {
    if (!id || !isWheelActive || awaitingSpellTarget) return;
    const intendedSide = targetSide ?? localLegacySide;
    if (intendedSide !== localLegacySide) {
      setDragOverWheel(null);
      setDragCardId(null);
      return;
    }

    const isLocalPlayer = localLegacySide === "player";
    const fromHand = (isLocalPlayer ? player.hand : enemy.hand).find((c) => c.id === id);
    const fromSlots = (isLocalPlayer ? assign.player : assign.enemy).find((c) => c && c.id === id);
    const card = fromHand || fromSlots || null;
    if (card) assignToWheelLocal(index, card);
    setDragOverWheel(null);
    setDragCardId(null);
  };

  const onZoneDrop = (e: React.DragEvent, targetSide?: LegacySide) => {
    e.preventDefault();
    handleDropCommon(e.dataTransfer.getData("text/plain") || dragCardId, targetSide);
  };

  const tapAssignIfSelected = () => {
    if (!selectedCardId || awaitingSpellTarget) return;
    const isLocalPlayer = localLegacySide === "player";
    const card =
      (isLocalPlayer ? player.hand : enemy.hand).find((c) => c.id === selectedCardId) ||
      (isLocalPlayer ? assign.player : assign.enemy).find((c) => c?.id === selectedCardId) ||
      null;
    if (card) assignToWheelLocal(index, card);
  };

  const panelShadow = "0 2px 8px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.04)";

  return (
    <div
      className="relative rounded-xl border p-2 shadow flex-none"
      style={{
        width: panelWidth,
        height: ws + extraHeightPx,
        background: `linear-gradient(180deg, rgba(255,255,255,.04) 0%, rgba(0,0,0,.14) 100%), ${theme.panelBg}`,
        borderColor: theme.panelBorder,
        borderWidth: 2,
        boxShadow: panelShadow,
        contain: "paint",
        backfaceVisibility: "hidden",
        transform: "translateZ(0)",
        isolation: "isolate",
      }}
      data-wheel-locked={lockState ? "true" : "false"}
      data-pointer-shift={pointerShift}
      data-player-damage={damageState.player}
      data-enemy-damage={damageState.enemy}
      data-player-mirror={mirrorState.player ? "true" : "false"}
      data-enemy-mirror={mirrorState.enemy ? "true" : "false"}
      data-player-reserve-penalty={playerPenalty}
      data-enemy-reserve-penalty={enemyPenalty}
      data-initiative-override={initiativeOverride ?? ""}
    >
      {(phase === "roundEnd" || phase === "ended") && (
        <>
          <span
            aria-label={`Wheel ${index + 1} player result`}
            className="absolute top-1 left-1 rounded-full border"
            style={{
              width: 10,
              height: 10,
              background: wheelHudColor === hudColors.player ? hudColors.player : "transparent",
              borderColor: wheelHudColor === hudColors.player ? hudColors.player : theme.panelBorder,
              boxShadow: "0 0 0 1px rgba(0,0,0,0.4)",
            }}
          />
          <span
            aria-label={`Wheel ${index + 1} enemy result`}
            className="absolute top-1 right-1 rounded-full border"
            style={{
              width: 10,
              height: 10,
              background: wheelHudColor === hudColors.enemy ? hudColors.enemy : "transparent",
              borderColor: wheelHudColor === hudColors.enemy ? hudColors.enemy : theme.panelBorder,
              boxShadow: "0 0 0 1px rgba(0,0,0,0.4)",
            }}
          />
        </>
      )}

      <div
        className="flex items-center justify-center gap-2"
        style={{ height: ws + extraHeightPx }}
      >
        <div
          data-drop="slot"
          data-idx={index}
          onDragOver={onZoneDragOver}
          onDragEnter={onZoneDragOver}
          onDragLeave={onZoneLeave}
          onDrop={(e) => onZoneDrop(e, "player")}
          onClick={(e) => {
            e.stopPropagation();
            if (awaitingSpellTarget) return;
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
              dragOverWheel === index || isLeftSelected ? "rgba(182,138,78,.12)" : theme.slotBg,
            borderColor:
              dragOverWheel === index || isLeftSelected || leftSlotTargetable
                ? theme.brass
                : theme.slotBorder,
            boxShadow: isLeftSelected
              ? "0 0 0 1px rgba(251,191,36,0.7)"
              : leftSlotTargetable
              ? "0 0 0 2px rgba(56,189,248,0.55)"
              : "none",
          }}
          aria-label={`Wheel ${index + 1} left slot`}
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
          data-idx={index}
          className="relative flex-none flex items-center justify-center rounded-full overflow-hidden"
          style={{ width: ws, height: ws, cursor: wheelTargetable ? "pointer" : undefined }}
          onDragOver={onZoneDragOver}
          onDragEnter={onZoneDragOver}
          onDragLeave={onZoneLeave}
          onDrop={onZoneDrop}
          onClick={(e) => {
            e.stopPropagation();
            if (awaitingWheelTarget) {
              if (wheelTargetable) {
                onWheelTargetSelect?.(index);
              }
              return;
            }
            if (awaitingSpellTarget) return;
            tapAssignIfSelected();
          }}
          aria-label={`Wheel ${index + 1}`}
        >
          <CanvasWheel ref={wheelRef as React.RefObject<WheelHandle>} sections={wheelSection} size={ws} />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-full"
            style={{
              boxShadow:
                dragOverWheel === index
                  ? "0 0 0 2px rgba(251,191,36,0.7) inset"
                  : wheelTargetable
                  ? "0 0 0 2px rgba(56,189,248,0.55) inset"
                  : "none",
            }}
          />
        </div>

        <div
          className="w-[80px] h-[92px] rounded-md border px-1 py-0 flex items-center justify-center flex-none"
          style={{
            backgroundColor:
              dragOverWheel === index || isRightSelected ? "rgba(182,138,78,.12)" : theme.slotBg,
            borderColor:
              dragOverWheel === index || isRightSelected || rightSlotTargetable
                ? theme.brass
                : theme.slotBorder,
            boxShadow: isRightSelected
              ? "0 0 0 1px rgba(251,191,36,0.7)"
              : rightSlotTargetable
              ? "0 0 0 2px rgba(56,189,248,0.55)"
              : "none",
          }}
          aria-label={`Wheel ${index + 1} right slot`}
          data-drop="slot"
          data-idx={index}
          onDragOver={onZoneDragOver}
          onDragEnter={onZoneDragOver}
          onDragLeave={onZoneLeave}
          onDrop={(e) => onZoneDrop(e, "enemy")}
          onClick={(e) => {
            e.stopPropagation();
            if (awaitingSpellTarget) return;
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

export default WheelPanel;
