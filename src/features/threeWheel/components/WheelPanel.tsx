import React from "react";
import CanvasWheel, { WheelHandle } from "../../../components/CanvasWheel";
import StSCard from "../../../components/StSCard";
import type { Card, Fighter, Phase, Section } from "../../../game/types";
import {
  spellTargetRequiresManualSelection,
  type SpellDefinition,
  type SpellTargetInstance,
  type SpellTargetOwnership,
} from "../../../game/spellEngine";
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
  onSpellTargetSelect?: (selection: { side: LegacySide; lane: number | null; cardId: string }) => void;
  onWheelTargetSelect?: (wheelIndex: number) => void;
  isAwaitingSpellTarget: boolean;
}

const slotWidthPx = 80;
const gapXPx = 16;
const paddingXPx = 16;
const borderXPx = 4;
const extraHeightPx = 96;

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

  const revealOpposingCardDuringMirror =
    awaitingCardTarget &&
    pendingSpell?.spell.id === "mirrorImage" &&
    pendingSpell.side === localLegacySide;

  const shouldShowLeftCard =
    shouldShowSlotCard({
      hasCard: !!leftSlot.card,
      slotSide: leftSlot.side,
      localLegacySide,
      isPhaseChooseLike,
      slotTargetable: leftSlotTargetable,
    }) || (revealOpposingCardDuringMirror && leftSlot.side !== localLegacySide);
  const shouldShowRightCard =
    shouldShowSlotCard({
      hasCard: !!rightSlot.card,
      slotSide: rightSlot.side,
      localLegacySide,
      isPhaseChooseLike,
      slotTargetable: rightSlotTargetable,
    }) || (revealOpposingCardDuringMirror && rightSlot.side !== localLegacySide);

  const wheelScope = pendingSpell?.spell.target.type === "wheel" ? pendingSpell.spell.target.scope : null;
  const wheelTargetable =
    awaitingWheelTarget &&
    pendingSpell?.side === localLegacySide &&
    (wheelScope === "any" || (wheelScope === "current" && isWheelActive));

  const panelWidth = ws + slotWidthPx * 2 + gapXPx + paddingXPx + borderXPx;

  const environmentOffset = extraHeightPx / 2;
  const clampLength = Math.max(120, ws * 0.7);
  const clampWidth = Math.max(26, ws * 0.18);
  const clampJawWidth = Math.max(48, ws * 0.28);
  const clampJawHeight = clampJawWidth * 0.55;
  const clampAnchorTop = Math.max(environmentOffset - clampLength * 0.58, -clampLength * 0.25);
  const clampTranslateY = lockState ? Math.min(ws * 0.22, 52) : -Math.min(ws * 0.2, 48);
  const clampRotationOpen = 28;
  const clampRotationClosed = 6;
  const clampTransform = (side: "left" | "right") => {
    const rotate = lockState
      ? side === "left"
        ? -clampRotationClosed
        : clampRotationClosed
      : side === "left"
      ? -clampRotationOpen
      : clampRotationOpen;
    const translateX =
      side === "left"
        ? lockState
          ? -clampWidth * 0.1
          : -clampWidth * 0.45
        : lockState
        ? clampWidth * 0.1
        : clampWidth * 0.45;
    return `translate(${translateX}px, ${clampTranslateY}px) rotate(${rotate}deg)`;
  };
  const clampJawTransform = (side: "left" | "right") => {
    const rotate = lockState
      ? side === "left"
        ? 4
        : -4
      : side === "left"
      ? -18
      : 18;
    const translateY = lockState ? -clampJawHeight * 0.15 : 0;
    return `translateY(${translateY}px) rotate(${rotate}deg)`;
  };
  const wheelYOffset = environmentOffset;
  const baseWidth = Math.max(ws * 0.8, 200);
  const baseHeight = Math.max(64, ws * 0.35);

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
        onSpellTargetSelect?.({ side: slot.side, lane: index, cardId: slot.card.id });
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
            const card = leftSlot.card;
            if (
              isAwaitingSpellTarget &&
              pendingSpell?.spell.target.type === "card" &&
              card
            ) {
              const ownership = pendingSpell.spell.target.ownership;
              const isAlly = leftSlot.side === localLegacySide;
              if (
                ownership === "any" ||
                (ownership === "ally" && isAlly) ||
                (ownership === "enemy" && !isAlly)
              ) {
                onSpellTargetSelect?.({ side: leftSlot.side, lane: index, cardId: card.id });
                return;
              }
            }
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
          className="relative flex-none"
          style={{ width: ws, height: ws + extraHeightPx }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2"
            style={{
              top: wheelYOffset - ws * 0.55,
              transform: "translateX(-50%)",
              width: ws * 1.45,
              height: ws * 1.45,
              background:
                "radial-gradient(circle at 50% 38%, rgba(148,163,184,0.14) 0%, rgba(15,23,42,0.22) 55%, transparent 78%)",
              filter: "drop-shadow(0 16px 24px rgba(8,15,35,0.55))",
              zIndex: 0,
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2"
            style={{
              top: wheelYOffset - ws * 0.08,
              transform: "translateX(-50%)",
              width: ws * 1.1,
              height: ws * 1.1,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(15,23,42,0.85) 0%, rgba(15,23,42,0.32) 64%, rgba(15,23,42,0) 78%)",
              boxShadow: "0 10px 18px rgba(8,11,24,0.55) inset, 0 12px 28px rgba(8,11,24,0.45)",
              zIndex: 1,
            }}
          />

          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2"
            style={{
              bottom: -baseHeight * 0.2,
              transform: "translateX(-50%)",
              width: baseWidth,
              height: baseHeight,
              zIndex: 1,
            }}
          >
            <div
              className="absolute top-3 left-1/2 -translate-x-1/2 rounded-full"
              style={{
                width: baseWidth * 0.78,
                height: Math.max(12, baseHeight * 0.14),
                background:
                  "linear-gradient(180deg, rgba(100,116,139,0.38) 0%, rgba(30,41,59,0.92) 100%)",
                boxShadow: "0 6px 14px rgba(8,11,24,0.55)",
              }}
            />
            <div
              className="absolute bottom-0 left-1/2 -translate-x-1/2 rounded-2xl border"
              style={{
                width: baseWidth,
                height: baseHeight * 0.82,
                borderColor: "rgba(71,85,105,0.55)",
                background:
                  "linear-gradient(180deg, rgba(51,65,85,0.92) 0%, rgba(15,23,42,0.9) 60%, rgba(15,23,42,0.8) 100%)",
                boxShadow: "0 16px 28px rgba(8,11,24,0.55)",
              }}
            />
            <div
              className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-2"
              style={{
                width: baseWidth * 0.64,
                justifyContent: "space-between",
              }}
            >
              {[0, 1, 2].map((idx) => (
                <span
                  key={idx}
                  className="h-2 w-[30%] rounded-sm"
                  style={{
                    background:
                      "linear-gradient(90deg, rgba(148,163,184,0.32) 0%, rgba(226,232,240,0.12) 40%, rgba(148,163,184,0.32) 100%)",
                    boxShadow: "0 0 6px rgba(148,163,184,0.35)",
                  }}
                />
              ))}
            </div>
            <div
              className="absolute -bottom-6 left-1/2 -translate-x-1/2 rounded-full"
              style={{
                width: baseWidth * 0.85,
                height: Math.max(14, baseHeight * 0.2),
                background: "radial-gradient(circle, rgba(0,0,0,0.55) 0%, transparent 70%)",
                filter: "blur(1px)",
              }}
            />
          </div>

          <div
            aria-hidden
            className="pointer-events-none absolute"
            style={{
              top: clampAnchorTop,
              left: -clampWidth * 0.65,
              width: clampWidth,
              height: clampLength,
              zIndex: 2,
            }}
          >
            <div
              className="absolute inset-0 rounded-tr-[28px] rounded-br-[12px] border"
              style={{
                borderColor: "rgba(71,85,105,0.6)",
                background:
                  "linear-gradient(180deg, rgba(191,219,254,0.28) 0%, rgba(51,65,85,0.92) 55%, rgba(30,41,59,0.95) 100%)",
                boxShadow: "0 12px 26px rgba(8,11,24,0.45)",
                transformOrigin: "top right",
                transform: clampTransform("left"),
                transition: "transform 320ms ease-in-out, filter 320ms ease-in-out",
                filter: lockState ? "brightness(1.05)" : "brightness(0.92)",
              }}
            >
              <div
                className="absolute -bottom-5 -right-6 rounded-full border"
                style={{
                  width: clampJawWidth,
                  height: clampJawHeight,
                  borderColor: "rgba(30,41,59,0.8)",
                  background:
                    "linear-gradient(180deg, rgba(226,232,240,0.2) 0%, rgba(51,65,85,0.95) 60%, rgba(15,23,42,0.95) 100%)",
                  boxShadow: "0 8px 16px rgba(8,11,24,0.45)",
                  transformOrigin: "top left",
                  transform: clampJawTransform("left"),
                  transition: "transform 320ms ease-in-out",
                }}
              />
            </div>
          </div>

          <div
            aria-hidden
            className="pointer-events-none absolute"
            style={{
              top: clampAnchorTop,
              right: -clampWidth * 0.65,
              width: clampWidth,
              height: clampLength,
              zIndex: 2,
            }}
          >
            <div
              className="absolute inset-0 rounded-tl-[28px] rounded-bl-[12px] border"
              style={{
                borderColor: "rgba(71,85,105,0.6)",
                background:
                  "linear-gradient(180deg, rgba(191,219,254,0.28) 0%, rgba(51,65,85,0.92) 55%, rgba(30,41,59,0.95) 100%)",
                boxShadow: "0 12px 26px rgba(8,11,24,0.45)",
                transformOrigin: "top left",
                transform: clampTransform("right"),
                transition: "transform 320ms ease-in-out, filter 320ms ease-in-out",
                filter: lockState ? "brightness(1.05)" : "brightness(0.92)",
              }}
            >
              <div
                className="absolute -bottom-5 -left-6 rounded-full border"
                style={{
                  width: clampJawWidth,
                  height: clampJawHeight,
                  borderColor: "rgba(30,41,59,0.8)",
                  background:
                    "linear-gradient(180deg, rgba(226,232,240,0.2) 0%, rgba(51,65,85,0.95) 60%, rgba(15,23,42,0.95) 100%)",
                  boxShadow: "0 8px 16px rgba(8,11,24,0.45)",
                  transformOrigin: "top right",
                  transform: clampJawTransform("right"),
                  transition: "transform 320ms ease-in-out",
                }}
              />
            </div>
          </div>

          <div
            data-drop="wheel"
            data-idx={index}
            className="absolute left-1/2 flex items-center justify-center rounded-full"
            style={{
              top: wheelYOffset,
              transform: "translateX(-50%)",
              width: ws,
              height: ws,
              cursor: wheelTargetable ? "pointer" : undefined,
              overflow: "hidden",
              zIndex: 3,
            }}
            onDragOver={onZoneDragOver}
            onDragEnter={onZoneDragOver}
            onDragLeave={onZoneLeave}
            onDrop={onZoneDrop}
            onClick={(e) => {
              e.stopPropagation();
              if (isAwaitingSpellTarget && pendingSpell?.spell.target.type === "wheel") {
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
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(15,23,42,0.28) 70%, rgba(15,23,42,0.45) 100%)",
                mixBlendMode: "screen",
                opacity: 0.45,
              }}
            />
          </div>
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
            const card = rightSlot.card;
            if (
              isAwaitingSpellTarget &&
              pendingSpell?.spell.target.type === "card" &&
              card
            ) {
              const ownership = pendingSpell.spell.target.ownership;
              const isAlly = rightSlot.side === localLegacySide;
              if (
                ownership === "any" ||
                (ownership === "ally" && isAlly) ||
                (ownership === "enemy" && !isAlly)
              ) {
                onSpellTargetSelect?.({ side: rightSlot.side, lane: index, cardId: card.id });
                return;
              }
            }
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
