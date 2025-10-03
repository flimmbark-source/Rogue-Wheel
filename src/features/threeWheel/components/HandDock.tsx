import React, {
  forwardRef,
  type MutableRefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { motion } from "framer-motion";
import StSCard from "../../../components/StSCard";
import type { Card, Fighter } from "../../../game/types";
import type { LegacySide } from "./WheelPanel";
import { type SpellDefinition, type SpellTargetInstance } from "../../../game/spellEngine";
import {
  getSpellTargetStage,
  spellTargetStageRequiresManualSelection,
  type SpellTargetLocation,
} from "../../../game/spells";

interface HandDockProps {
  localLegacySide: LegacySide;
  player: Fighter;
  enemy: Fighter;
  wheelPanelWidth?: number;
  wheelPanelBounds?: { left: number; width: number } | null;
  selectedCardId: string | null;
  setSelectedCardId: (value: string | null) => void;
  assign: { player: (Card | null)[]; enemy: (Card | null)[] };
  assignToWheelLocal: (laneIndex: number, card: Card) => void;
  setDragCardId: (value: string | null) => void;
  startPointerDrag: (card: Card, e: React.PointerEvent<HTMLButtonElement>) => void;
  isPtrDragging: boolean;
  ptrDragCard: Card | null;
  ptrPos: React.MutableRefObject<{ x: number; y: number }>;
  onMeasure?: (px: number) => void;
  pendingSpell: {
    side: LegacySide;
    spell: SpellDefinition;
    targets: SpellTargetInstance[];
    currentStage: number;
  } | null;
  isAwaitingSpellTarget: boolean;
  onSpellTargetSelect?: (selection: {
    side: LegacySide;
    lane: number | null;
    card: Card;
    location: SpellTargetLocation;
  }) => void;
}

const HandDock = forwardRef<HTMLDivElement, HandDockProps>(
  ({
    localLegacySide,
    player,
    enemy,
    wheelPanelWidth,
    wheelPanelBounds,
    selectedCardId,
    setSelectedCardId,
    assign,
    assignToWheelLocal,
    setDragCardId,
    startPointerDrag,
    isPtrDragging,
    ptrDragCard,
    ptrPos,
    onMeasure,
    pendingSpell,
    isAwaitingSpellTarget,
    onSpellTargetSelect,
  }, forwardedRef) => {
    const dockRef = useRef<HTMLDivElement | null>(null);
    const handleDockRef = useCallback(
      (node: HTMLDivElement | null) => {
        dockRef.current = node;
        if (typeof forwardedRef === "function") {
          forwardedRef(node);
        } else if (forwardedRef) {
          (forwardedRef as MutableRefObject<HTMLDivElement | null>).current = node;
        }
      },
      [forwardedRef],
    );
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

  const activeStage = pendingSpell ? getSpellTargetStage(pendingSpell.spell.target, pendingSpell.currentStage) : null;

  const awaitingManualTarget = Boolean(
    isAwaitingSpellTarget && pendingSpell && activeStage && spellTargetStageRequiresManualSelection(activeStage),
  );

  const awaitingCardTarget = awaitingManualTarget && activeStage?.type === "card";

  const overlayStyle = useMemo<React.CSSProperties>(() => {
    const bottom = "calc(env(safe-area-inset-bottom, 0px) + -30px)";
    const measuredWidth = wheelPanelBounds?.width ?? wheelPanelWidth;

    const style: React.CSSProperties = {
      bottom,
      left: "50%",
      transform: "translateX(-50%)",
    };

    if (typeof measuredWidth === "number") {
      style.width = measuredWidth;
    }

    if (wheelPanelBounds) {
      const centerX = wheelPanelBounds.left + wheelPanelBounds.width / 2;
      style.left = `${centerX}px`;
    }

    return style;
  }, [wheelPanelBounds, wheelPanelWidth]);

  const stageLocation = activeStage?.type === "card" ? activeStage.location ?? "board" : null;

  return (
    <div
      ref={handleDockRef}
      className="fixed bottom-0 z-40 pointer-events-none select-none"
      style={overlayStyle}
      data-awaiting-spell-target={awaitingCardTarget ? "true" : "false"}
    >
      <div
        className="mx-auto max-w-[1400px] flex justify-center gap-1.5 py-0.5"
        style={{
          width: typeof wheelPanelWidth === "number" ? wheelPanelWidth : undefined,
          maxWidth: "min(100vw, 1400px)",
        }}
      >
        {localFighter.hand.map((card, idx) => {
          const isSelected = selectedCardId === card.id;
          const cardSelectable = awaitingCardTarget && (stageLocation === "any" || stageLocation === "hand");
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
                whileHover={{ y: -Math.max(8, liftPx - 10), opacity: 1, scale: 1.04 }}
                transition={{ type: "spring", stiffness: 320, damping: 22 }}
                className={`drop-shadow-xl ${isSelected ? "ring-2 ring-amber-300" : ""}`}
              >
                <StSCard
                  data-hand-card
                  className="pointer-events-auto"
                  card={card}
                  selected={isSelected}
                  disabled={awaitingManualTarget && !cardSelectable}
                  onPick={() => {
                    if (cardSelectable) {
                      const side = localLegacySide;
                      onSpellTargetSelect?.({ side, lane: null, card, location: "hand" });
                      return;
                    }
                    if (awaitingManualTarget) return;
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
                  draggable={!awaitingManualTarget}
                  onDragStart={(e) => {
                    if (awaitingManualTarget) return;
                    setDragCardId(card.id);
                    try {
                      e.dataTransfer.setData("text/plain", card.id);
                    } catch {}
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => setDragCardId(null)}
                  onPointerDown={(e) => {
                    if (awaitingManualTarget) return;
                    startPointerDrag(card, e);
                  }}
                  aria-pressed={isSelected}
                  aria-label={`Select ${card.name}`}
                />
              </motion.div>
            </div>
          );
        })}
      </div>
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
          aria-hidden
        >
          <div style={{ transform: "scale(0.9)", filter: "drop-shadow(0 6px 8px rgba(0,0,0,.35))" }}>
            <StSCard card={ptrDragCard} />
          </div>
        </div>
      )}
    </div>
  );
});

HandDock.displayName = "HandDock";

export default HandDock;
