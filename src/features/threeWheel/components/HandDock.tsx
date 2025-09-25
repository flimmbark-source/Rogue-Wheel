import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import StSCard from "../../../components/StSCard";
import type { Card, Fighter } from "../../../game/types";
import type { LegacySide } from "./WheelPanel";
import {
  spellTargetRequiresManualSelection,
  type SpellDefinition,
  type SpellTargetInstance,
} from "../../../game/spellEngine";

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
    target: SpellTargetInstance | null;
  } | null;
  isAwaitingSpellTarget: boolean;
  onSpellTargetSelect?: (selection: { side: LegacySide; lane: number | null; cardId: string }) => void;
}

const HandDock: React.FC<HandDockProps> = ({
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
}) => {
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

  const awaitingManualTarget =
    isAwaitingSpellTarget &&
    pendingSpell &&
    spellTargetRequiresManualSelection(pendingSpell.spell.target) &&
    !pendingSpell.target;

  const awaitingCardTarget =
    awaitingManualTarget && pendingSpell?.spell.target.type === "card";

  const overlayStyle = useMemo<React.CSSProperties>(() => {
    const bottom = "calc(env(safe-area-inset-bottom, 0px) + -30px)";
    const measuredWidth = wheelPanelBounds?.width ?? wheelPanelWidth;

    if (wheelPanelBounds) {
      return {
        bottom,
        left: wheelPanelBounds.left,
        width: measuredWidth,
      };
    }

    const style: React.CSSProperties = {
      bottom,
      left: "50%",
      transform: "translateX(-50%)",
    };

    if (typeof measuredWidth === "number") {
      style.width = measuredWidth;
    }

    style.maxWidth = "min(100vw, 1400px)";

    return style;
  }, [wheelPanelBounds, wheelPanelWidth]);

  return (
    <div
      ref={dockRef}
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
                <button
                  data-hand-card
                  className="pointer-events-auto"
                  disabled={awaitingManualTarget && !awaitingCardTarget}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (awaitingCardTarget && pendingSpell?.spell.target.type === "card") {
                      const side = localLegacySide;
                      onSpellTargetSelect?.({ side, lane: null, cardId: card.id });
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
                >
                  <StSCard card={card} />
                </button>
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
};

export default HandDock;
