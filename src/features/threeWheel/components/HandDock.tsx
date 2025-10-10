import React, {
  forwardRef,
  type MutableRefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import StSCard from "../../../components/StSCard";
import type { Card, CorePhase, Fighter } from "../../../game/types";
import {
  describeSkillAbility,
  determineSkillAbility,
  SKILL_ABILITY_LABELS,
  type AbilityKind,
} from "../../../game/skills";
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
  phase: CorePhase;
  wheelPanelWidth?: number;
  wheelPanelBounds?: { left: number; width: number } | null;
  selectedCardId: string | null;
  setSelectedCardId: (value: string | null) => void;
  assign: { player: (Card | null)[]; enemy: (Card | null)[] };
  assignToWheelLocal: (laneIndex: number, card: Card) => void;
  setDragCardId: (value: string | null) => void;
  startPointerDrag: (card: Card, e: React.PointerEvent<HTMLButtonElement>) => void;
  startTouchDrag: (card: Card, e: React.TouchEvent<HTMLButtonElement>) => void;
  isPtrDragging: boolean;
  ptrDragCard: Card | null;
  ptrDragType: "pointer" | "touch" | null;
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
  spellHighlightedCardIds: readonly string[];
  skillTargeting?: {
    side: LegacySide;
    laneIndex: number;
    ability: AbilityKind;
    specKind: "reserve" | "friendlyLane";
  } | null;
  skillTargetableReserveIds?: Set<string> | null;
  onSkillTargetSelect?: (selection: { cardId: string }) => void;
  onSkillAbilityCancel?: () => void;
  numberColorMode?: "arcana" | "skill";
}

const HandDock = forwardRef<HTMLDivElement, HandDockProps>(
  ({
    localLegacySide,
    player,
    enemy,
    phase,
    wheelPanelWidth,
    wheelPanelBounds,
    selectedCardId,
    setSelectedCardId,
    assign,
    assignToWheelLocal,
    setDragCardId,
    startPointerDrag,
    startTouchDrag,
    isPtrDragging,
    ptrDragCard,
    ptrDragType,
    ptrPos,
    onMeasure,
    pendingSpell,
    isAwaitingSpellTarget,
    onSpellTargetSelect,
    spellHighlightedCardIds,
    skillTargeting,
    skillTargetableReserveIds,
    onSkillTargetSelect,
    onSkillAbilityCancel,
    numberColorMode = "arcana",
  }, forwardedRef) => {
    const dockRef = useRef<HTMLDivElement | null>(null);
    const ghostRef = useRef<HTMLDivElement | null>(null);
    const cardDimensionsRef = useRef<{ width: number; height: number }>({ width: 72, height: 96 });
    const ghostOffsetRef = useRef<{ x: number; y: number }>({ x: 48, y: 64 });
    const [ghostPortalTarget, setGhostPortalTarget] = useState<HTMLElement | null>(null);
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
    const [hoveredSkillCardId, setHoveredSkillCardId] = useState<string | null>(null);

    useEffect(() => {
      const compute = () => {
        const root = dockRef.current;
        if (!root) return;
        const sample = root.querySelector("[data-hand-card]") as HTMLElement | null;
        if (!sample) return;
        const rect = sample.getBoundingClientRect();
        const h = rect.height || 96;
        const w = rect.width || 72;
        cardDimensionsRef.current = { width: w, height: h };
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

    useEffect(() => {
      if (typeof document !== "undefined") {
        setGhostPortalTarget(document.body);
      }
    }, []);

    useEffect(() => {
      if (!isPtrDragging) return;
      const el = ghostRef.current;
      if (!el) return;

      let rafId: number | null = null;
      let prevX = NaN;
      let prevY = NaN;

      const syncPosition = () => {
        const { x, y } = ptrPos.current;
        if (x !== prevX || y !== prevY) {
          prevX = x;
          prevY = y;
          const { x: offsetX, y: offsetY } = ghostOffsetRef.current;
          el.style.transform = `translate(${x - offsetX}px, ${y - offsetY}px)`;
        }
        rafId = window.requestAnimationFrame(syncPosition);
      };

      syncPosition();

      return () => {
        if (rafId !== null) {
          window.cancelAnimationFrame(rafId);
        }
      };
    }, [isPtrDragging, ptrDragType, ptrPos]);

    useEffect(() => {
      if (ptrDragType === "touch") {
        const { width, height } = cardDimensionsRef.current;
        ghostOffsetRef.current = { x: width / 2, y: height / 2 };
      } else if (ptrDragType === "pointer") {
        ghostOffsetRef.current = { x: 48, y: 64 };
      }

      if (!isPtrDragging) return;
      const el = ghostRef.current;
      if (!el) return;
      const { x, y } = ptrPos.current;
      const { x: offsetX, y: offsetY } = ghostOffsetRef.current;
      el.style.transform = `translate(${x - offsetX}px, ${y - offsetY}px)`;
    }, [cardDimensionsRef, isPtrDragging, ptrDragType, ptrPos]);

    const skillDescriptionsEnabled = numberColorMode === "skill";
    const skillHoverEnabled = skillDescriptionsEnabled && phase === "choose";

    useEffect(() => {
      if (!skillHoverEnabled) {
        setHoveredSkillCardId(null);
      }
    }, [skillHoverEnabled]);

    useEffect(() => {
      if (!isPtrDragging) return;
      setHoveredSkillCardId(null);
    }, [isPtrDragging]);

    const handleSkillHoverStart = useCallback(
      (cardId: string) => {
        if (!skillHoverEnabled) return;
        setHoveredSkillCardId(cardId);
      },
      [skillHoverEnabled],
    );

    const handleSkillHoverEnd = useCallback((cardId: string) => {
      setHoveredSkillCardId((prev) => (prev === cardId ? null : prev));
    }, []);

    const localFighter: Fighter = localLegacySide === "player" ? player : enemy;

    const activeStage = pendingSpell ? getSpellTargetStage(pendingSpell.spell.target, pendingSpell.currentStage) : null;

    const activeStageSelection = pendingSpell?.targets?.[pendingSpell.currentStage];

    const awaitingManualTarget = Boolean(
      isAwaitingSpellTarget &&
        pendingSpell &&
        activeStage &&
        spellTargetStageRequiresManualSelection(activeStage, activeStageSelection),
    );

    const awaitingCardTarget = awaitingManualTarget && activeStage?.type === "card";

    const skillTargetingReserve =
      skillTargeting &&
      skillTargeting.side === localLegacySide &&
      skillTargeting.specKind === "reserve";
    const skillTargetableReserveSet = skillTargetableReserveIds ?? null;

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

    const spellHighlightSet = useMemo(() => new Set(spellHighlightedCardIds), [spellHighlightedCardIds]);

    const ghost =
      isPtrDragging && ptrDragCard ? (
        <div
          ref={ghostRef}
          style={{
            position: "fixed",
            left: 0,
            top: 0,
            transform: (() => {
              const baseX = ptrPos.current.x;
              const baseY = ptrPos.current.y;
              const { x: offsetX, y: offsetY } = ghostOffsetRef.current;
              return `translate(${baseX - offsetX}px, ${baseY - offsetY}px)`;
            })(),
            pointerEvents: "none",
            zIndex: 9999,
          }}
          aria-hidden
        >
          <div style={{ transform: "scale(0.9)", filter: "drop-shadow(0 6px 8px rgba(0,0,0,.35))" }}>
            <StSCard card={ptrDragCard} numberColorMode={numberColorMode} />
          </div>
        </div>
      ) : null;

    return (
      <>
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
              const isSpellAffected = spellHighlightSet.has(card.id);
              const cardSelectableForSpell = awaitingCardTarget && (stageLocation === "any" || stageLocation === "hand");
              const cardSelectableForSkill =
                skillTargetingReserve && skillTargetableReserveSet?.has(card.id);
              const cardSelectable = cardSelectableForSpell || cardSelectableForSkill;
              const cardDisabled =
                (awaitingManualTarget && !cardSelectableForSpell) ||
                (skillTargetingReserve && !cardSelectableForSkill);
              const ability = determineSkillAbility(card);
              const abilityLabel = SKILL_ABILITY_LABELS[ability];
              const abilityDescription = describeSkillAbility(ability, card).trim();
              const showSkillDescription =
                skillHoverEnabled &&
                hoveredSkillCardId === card.id &&
                abilityDescription.length > 0;
              const baseZIndex = 10 + idx;
              const elevatedZIndex = 200 + idx;
              const containerZIndex = showSkillDescription || isSelected ? elevatedZIndex : baseZIndex;
              return (
                <div
                  key={card.id}
                  className="group relative pointer-events-auto"
                  style={{ zIndex: containerZIndex }}
                >
                  {showSkillDescription ? (
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-30 w-56 -translate-x-1/2 pb-3">
                      <div className="rounded-md bg-slate-900/95 px-3 py-2 text-xs font-medium leading-snug text-slate-100 shadow-lg ring-1 ring-white/10">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-200/90">
                          {abilityLabel}
                        </div>
                        <div className="mt-1 font-normal text-slate-200/90">{abilityDescription}</div>
                      </div>
                    </div>
                  ) : null}
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
                    onPointerEnter={() => handleSkillHoverStart(card.id)}
                    onPointerLeave={() => handleSkillHoverEnd(card.id)}
                    onFocusCapture={() => handleSkillHoverStart(card.id)}
                    onBlurCapture={() => handleSkillHoverEnd(card.id)}
                    onPointerDown={(event) => {
                      if (event.pointerType !== "mouse") {
                        handleSkillHoverStart(card.id);
                      }
                    }}
                    onPointerUp={() => handleSkillHoverEnd(card.id)}
                    onPointerCancel={() => handleSkillHoverEnd(card.id)}
                  >
                    <StSCard
                      data-hand-card
                      className="pointer-events-auto"
                      card={card}
                      numberColorMode={numberColorMode}
                      selected={isSelected}
                      disabled={cardDisabled}
                      spellTargetable={cardSelectable}
                      spellAffected={isSpellAffected}
                      onPick={() => {
                        if (cardSelectableForSpell) {
                          const side = localLegacySide;
                          onSpellTargetSelect?.({ side, lane: null, card, location: "hand" });
                          return;
                        }
                        if (skillTargetingReserve) {
                          if (cardSelectableForSkill) {
                            onSkillTargetSelect?.({ cardId: card.id });
                          }
                          return;
                        }
                        if (awaitingManualTarget || skillTargetingReserve) return;
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
                      draggable={!awaitingManualTarget && !skillTargetingReserve}
                      onDragStart={(e) => {
                        if (awaitingManualTarget || skillTargetingReserve) return;
                        setDragCardId(card.id);
                        try {
                          e.dataTransfer.setData("text/plain", card.id);
                        } catch {}
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => setDragCardId(null)}
                      onPointerDown={(e) => {
                        if (awaitingManualTarget || skillTargetingReserve) return;
                        startPointerDrag(card, e);
                      }}
                      onTouchStart={(e) => {
                        if (awaitingManualTarget || skillTargetingReserve) return;
                        startTouchDrag(card, e);
                      }}
                      aria-pressed={isSelected}
                      aria-label={`Select ${card.name}`}
                    />
                  </motion.div>
                </div>
              );
            })}
          </div>
        </div>
        {ghostPortalTarget && ghost ? createPortal(ghost, ghostPortalTarget) : ghost}
      </>
    );
  });

HandDock.displayName = "HandDock";

export default HandDock;
