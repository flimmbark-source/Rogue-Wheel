import type { PointerEvent, DragEvent, RefObject } from "react";
import CanvasWheel, { WheelHandle } from "../CanvasWheel";
import StSCard from "../StSCard";
import type { Card, Fighter, Section } from "../../game/types";

export type LegacySide = "player" | "enemy";
export type Phase = "choose" | "showEnemy" | "anim" | "roundEnd" | "ended";

interface MatchBoardProps {
  theme: {
    panelBg: string;
    panelBorder: string;
    slotBg: string;
    slotBorder: string;
    brass: string;
    textWarm: string;
  };
  active: readonly boolean[];
  assign: { player: (Card | null)[]; enemy: (Card | null)[] };
  namesByLegacy: Record<LegacySide, string>;
  wheelSize: number;
  lockedWheelSize: number | null;
  selectedCardId: string | null;
  onSelectCard: (cardId: string | null) => void;
  localLegacySide: LegacySide;
  phase: Phase;
  startPointerDrag: (card: Card, event: PointerEvent) => void;
  fighters: { player: Fighter; enemy: Fighter };
  dragCardId: string | null;
  onDragCardChange: (cardId: string | null) => void;
  dragOverWheel: number | null;
  onDragOverWheelChange: (lane: number | null) => void;
  assignToWheel: (lane: number, card: Card) => void;
  wheelHUD: [string | null, string | null, string | null];
  hudColors: { player: string; enemy: string };
  wheelSections: Section[][];
  wheelRefs: Array<RefObject<WheelHandle | null>>;
}

const SLOT_WIDTH = 80;
const SLOT_GAP = 16;
const SLOT_PADDING = 16;
const SLOT_BORDER = 4;
const EXTRA_PANEL_HEIGHT = 16;

export default function MatchBoard({
  theme,
  active,
  assign,
  namesByLegacy,
  wheelSize,
  lockedWheelSize,
  selectedCardId,
  onSelectCard,
  localLegacySide,
  phase,
  startPointerDrag,
  fighters,
  dragCardId,
  onDragCardChange,
  dragOverWheel,
  onDragOverWheelChange,
  assignToWheel,
  wheelHUD,
  hudColors,
  wheelSections,
  wheelRefs,
}: MatchBoardProps) {
  const lanes = Math.min(
    assign.player.length,
    assign.enemy.length,
    wheelSections.length,
    wheelRefs.length,
    active.length,
  );

  const panelShadow = "0 2px 8px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.04)";
  const wheelDimension = Math.round(lockedWheelSize ?? wheelSize);

  return (
    <div className="flex flex-col items-center justify-start gap-1">
      {Array.from({ length: lanes }, (_, laneIndex) => {
        const playerCard = assign.player[laneIndex];
        const enemyCard = assign.enemy[laneIndex];

        const leftSlot = {
          side: "player" as const,
          card: playerCard,
          name: namesByLegacy.player,
        };
        const rightSlot = {
          side: "enemy" as const,
          card: enemyCard,
          name: namesByLegacy.enemy,
        };

        const isLeftSelected = !!leftSlot.card && selectedCardId === leftSlot.card.id;
        const isRightSelected = !!rightSlot.card && selectedCardId === rightSlot.card.id;

        const shouldShowLeftCard =
          !!leftSlot.card && (leftSlot.side === localLegacySide || phase !== "choose");
        const shouldShowRightCard =
          !!rightSlot.card && (rightSlot.side === localLegacySide || phase !== "choose");

        const renderSlotCard = (
          slot: typeof leftSlot,
          isSlotSelected: boolean,
        ) => {
          if (!slot.card) return null;
          const card = slot.card;
          const interactable = slot.side === localLegacySide && phase === "choose";

          const handlePick = () => {
            if (!interactable) return;
            if (selectedCardId) {
              tapAssignIfSelected();
            } else {
              onSelectCard(card.id);
            }
          };

          const handleDragStart = (event: DragEvent<HTMLButtonElement>) => {
            if (!interactable) return;
            onSelectCard(card.id);
            onDragCardChange(card.id);
            try {
              event.dataTransfer.setData("text/plain", card.id);
            } catch {}
            event.dataTransfer.effectAllowed = "move";
          };

          const handleDragEnd = () => {
            onDragCardChange(null);
            onDragOverWheelChange(null);
          };

          const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
            if (!interactable) return;
            event.stopPropagation();
            startPointerDrag(card, event);
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
              variant="minimal"
            />
          );
        };

        const tapAssignIfSelected = () => {
          if (!selectedCardId) return;
          const isLocalPlayer = localLegacySide === "player";
          const { player, enemy } = fighters;
          const card =
            (isLocalPlayer ? player.hand : enemy.hand).find((c) => c.id === selectedCardId) ||
            (isLocalPlayer ? assign.player : assign.enemy).find((c) => c?.id === selectedCardId) ||
            null;
          if (card) assignToWheel(laneIndex, card);
        };

        const handleDropCommon = (cardId: string | null, targetSide?: LegacySide) => {
          if (!cardId || !active[laneIndex]) return;
          const intendedSide = targetSide ?? localLegacySide;
          if (intendedSide !== localLegacySide) {
            onDragOverWheelChange(null);
            onDragCardChange(null);
            return;
          }

          const isLocalPlayer = localLegacySide === "player";
          const { player, enemy } = fighters;
          const fromHand = (isLocalPlayer ? player.hand : enemy.hand).find((c) => c.id === cardId);
          const fromSlots = (isLocalPlayer ? assign.player : assign.enemy).find(
            (c) => c && c.id === cardId,
          ) as Card | undefined;
          const card = fromHand || fromSlots || null;
          if (card) assignToWheel(laneIndex, card);
          onDragOverWheelChange(null);
          onDragCardChange(null);
        };

        const onZoneDragOver = (event: DragEvent) => {
          event.preventDefault();
          if (dragCardId && active[laneIndex]) onDragOverWheelChange(laneIndex);
        };
        const onZoneLeave = () => {
          if (dragCardId) onDragOverWheelChange(null);
        };
        const onZoneDrop = (event: DragEvent, targetSide?: LegacySide) => {
          event.preventDefault();
          handleDropCommon(event.dataTransfer.getData("text/plain") || dragCardId, targetSide);
        };

        const panelWidth = wheelDimension + SLOT_WIDTH * 2 + SLOT_GAP + SLOT_PADDING + SLOT_BORDER;

        return (
          <div key={laneIndex} className="flex-shrink-0">
            <div
              className="relative rounded-xl border p-2 shadow flex-none"
              style={{
                width: panelWidth,
                height: wheelDimension + EXTRA_PANEL_HEIGHT,
                background: `linear-gradient(180deg, rgba(255,255,255,.04) 0%, rgba(0,0,0,.14) 100%), ${theme.panelBg}`,
                borderColor: theme.panelBorder,
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
                    aria-label={`Wheel ${laneIndex + 1} player result`}
                    className="absolute top-1 left-1 rounded-full border"
                    style={{
                      width: 10,
                      height: 10,
                      background:
                        wheelHUD[laneIndex] === hudColors.player ? hudColors.player : "transparent",
                      borderColor:
                        wheelHUD[laneIndex] === hudColors.player
                          ? hudColors.player
                          : theme.panelBorder,
                      boxShadow: "0 0 0 1px rgba(0,0,0,0.4)",
                    }}
                  />

                  <span
                    aria-label={`Wheel ${laneIndex + 1} enemy result`}
                    className="absolute top-1 right-1 rounded-full border"
                    style={{
                      width: 10,
                      height: 10,
                      background:
                        wheelHUD[laneIndex] === hudColors.enemy ? hudColors.enemy : "transparent",
                      borderColor:
                        wheelHUD[laneIndex] === hudColors.enemy
                          ? hudColors.enemy
                          : theme.panelBorder,
                      boxShadow: "0 0 0 1px rgba(0,0,0,0.4)",
                    }}
                  />
                </>
              )}

              <div
                className="flex items-center justify-center gap-2"
                style={{ height: wheelDimension + EXTRA_PANEL_HEIGHT }}
              >
                <div
                  data-drop="slot"
                  data-idx={laneIndex}
                  onDragOver={onZoneDragOver}
                  onDragEnter={onZoneDragOver}
                  onDragLeave={onZoneLeave}
                  onDrop={(event) => onZoneDrop(event, "player")}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (leftSlot.side !== localLegacySide) return;
                    if (selectedCardId) {
                      tapAssignIfSelected();
                    } else if (leftSlot.card) {
                      onSelectCard(leftSlot.card.id);
                    }
                  }}
                  className="w-[80px] h-[92px] rounded-md border px-1 py-0 flex items-center justify-center flex-none"
                  style={{
                    backgroundColor:
                      dragOverWheel === laneIndex || isLeftSelected
                        ? "rgba(182,138,78,.12)"
                        : theme.slotBg,
                    borderColor:
                      dragOverWheel === laneIndex || isLeftSelected ? theme.brass : theme.slotBorder,
                    boxShadow: isLeftSelected ? "0 0 0 1px rgba(251,191,36,0.7)" : "none",
                  }}
                  aria-label={`Wheel ${laneIndex + 1} left slot`}
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
                  data-idx={laneIndex}
                  className="relative flex-none flex items-center justify-center rounded-full overflow-hidden"
                  style={{ width: wheelDimension, height: wheelDimension }}
                  onDragOver={onZoneDragOver}
                  onDragEnter={onZoneDragOver}
                  onDragLeave={onZoneLeave}
                  onDrop={onZoneDrop}
                  onClick={(event) => {
                    event.stopPropagation();
                    tapAssignIfSelected();
                  }}
                  aria-label={`Wheel ${laneIndex + 1}`}
                >
                  <CanvasWheel ref={wheelRefs[laneIndex]} sections={wheelSections[laneIndex]} size={wheelDimension} />
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 rounded-full"
                    style={{
                      boxShadow:
                        dragOverWheel === laneIndex
                          ? "0 0 0 2px rgba(251,191,36,0.7) inset"
                          : "none",
                    }}
                  />
                </div>

                <div
                  className="w-[80px] h-[92px] rounded-md border px-1 py-0 flex items-center justify-center flex-none"
                  style={{
                    backgroundColor:
                      dragOverWheel === laneIndex || isRightSelected
                        ? "rgba(182,138,78,.12)"
                        : theme.slotBg,
                    borderColor:
                      dragOverWheel === laneIndex || isRightSelected ? theme.brass : theme.slotBorder,
                    boxShadow: isRightSelected ? "0 0 0 1px rgba(251,191,36,0.7)" : "none",
                  }}
                  aria-label={`Wheel ${laneIndex + 1} right slot`}
                  data-drop="slot"
                  data-idx={laneIndex}
                  onDragOver={onZoneDragOver}
                  onDragEnter={onZoneDragOver}
                  onDragLeave={onZoneLeave}
                  onDrop={(event) => onZoneDrop(event, "enemy")}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (rightSlot.side !== localLegacySide) return;
                    if (selectedCardId) {
                      tapAssignIfSelected();
                    } else if (rightSlot.card) {
                      onSelectCard(rightSlot.card.id);
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
          </div>
        );
      })}
    </div>
  );
}
