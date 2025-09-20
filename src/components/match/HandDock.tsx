import { useEffect, useRef, useState } from "react";
import type { PointerEvent, DragEvent, MutableRefObject } from "react";
import { motion } from "framer-motion";
import StSCard, { getCardEffectSummary } from "../StSCard";
import type { Card, Fighter } from "../../game/types";
import { isSplit } from "../../game/values";
import type { LegacySide } from "./MatchBoard";

interface HandDockProps {
  localFighter: Fighter;
  selectedCardId: string | null;
  onSelectCard: (cardId: string | null) => void;
  localLegacySide: LegacySide;
  assign: { player: (Card | null)[]; enemy: (Card | null)[] };
  onAssignToWheel: (lane: number, card: Card) => void;
  onDragCardChange: (cardId: string | null) => void;
  startPointerDrag: (card: Card, event: PointerEvent) => void;
  isPointerDragging: boolean;
  pointerDragCard: Card | null;
  pointerPosition: MutableRefObject<{ x: number; y: number }>;
  onMeasure?: (px: number) => void;
}

export default function HandDock({
  localFighter,
  selectedCardId,
  onSelectCard,
  localLegacySide,
  assign,
  onAssignToWheel,
  onDragCardChange,
  startPointerDrag,
  isPointerDragging,
  pointerDragCard,
  pointerPosition,
  onMeasure,
}: HandDockProps) {
  const dockRef = useRef<HTMLDivElement | null>(null);
  const [liftPx, setLiftPx] = useState<number>(18);

  useEffect(() => {
    const compute = () => {
      const root = dockRef.current;
      if (!root) return;
      const sample = root.querySelector("[data-hand-card]") as HTMLElement | null;
      if (!sample) return;
      const height = sample.getBoundingClientRect().height || 96;
      const nextLift = Math.round(Math.min(44, Math.max(12, height * 0.34)));
      setLiftPx(nextLift);
      const clearance = Math.round(height + nextLift + 12);
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

  return (
    <div
      ref={dockRef}
      className="fixed left-0 right-0 bottom-0 z-50 pointer-events-none select-none"
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + -30px)" }}
    >
      <div className="mx-auto max-w-[1400px] flex justify-center gap-1.5 py-0.5">
        {localFighter.hand.map((card, idx) => {
          const isSelected = selectedCardId === card.id;
          const shouldDescribeAbility = Boolean(
            card.behavior ||
              (card.activation?.length ?? 0) > 0 ||
              card.reserve?.summary ||
              isSplit(card),
          );
          const abilitySummary = shouldDescribeAbility
            ? getCardEffectSummary(card) ?? undefined
            : undefined;

          const handlePick = () => {
            if (!selectedCardId) {
              onSelectCard(card.id);
              return;
            }

            if (selectedCardId === card.id) {
              onSelectCard(null);
              return;
            }

            const lane =
              localLegacySide === "player" ? assign.player : assign.enemy;

            const slotIdx = lane.findIndex((c) => c?.id === selectedCardId);
            if (slotIdx !== -1) {
              onAssignToWheel(slotIdx, card);
              return;
            }

            onSelectCard(card.id);
          };

          const ariaLabel = `Select ${card.name}${
            abilitySummary ? `, ${abilitySummary}` : ""
          }`;

          return (
            <div
              key={card.id}
              className="group relative pointer-events-auto"
              style={{ zIndex: 10 + idx }}
            >
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
                className={`drop-shadow-xl ${
                  isSelected ? "ring-2 ring-amber-300" : ""
                }`}
              >
                <StSCard
                  card={card}
                  showReserve={false}
                  variant="minimal"
                  showAbilityHint
                  frameAppearance="hand"

                  onPick={handlePick}
                  draggable
                  onDragStart={(event: DragEvent<HTMLButtonElement>) => {
                    onDragCardChange(card.id);
                    try {
                      event.dataTransfer.setData("text/plain", card.id);
                    } catch {}
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => onDragCardChange(null)}
                  onPointerDown={(
                    event: PointerEvent<HTMLButtonElement>,
                  ) => startPointerDrag(card, event)}
                  ariaLabel={ariaLabel}
                  title={abilitySummary}
                  ariaPressed={isSelected}
                  selected={isSelected}
                />
              </motion.div>
            </div>
          );
        })}
      </div>

      {isPointerDragging && pointerDragCard && (
        <div
          style={{
            position: "fixed",
            left: 0,
            top: 0,
            transform: `translate(${pointerPosition.current.x - 48}px, ${
              pointerPosition.current.y - 64
            }px)`,
            pointerEvents: "none",
            zIndex: 9999,
          }}
          aria-hidden
        >
          <div
            style={{
              transform: "scale(0.9)",
              filter: "drop-shadow(0 6px 8px rgba(0,0,0,.35))",
            }}
          >
            <StSCard
              card={pointerDragCard}
              showReserve={false}
              variant="minimal"
              showAbilityHint
              frameAppearance="hand"
            />
          </div>
        </div>
      )}
    </div>
  );
}
