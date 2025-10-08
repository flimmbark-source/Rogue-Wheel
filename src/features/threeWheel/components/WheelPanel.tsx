import React, { useMemo } from "react";
import CanvasWheel, { WheelHandle } from "../../../components/CanvasWheel";
import StSCard from "../../../components/StSCard";
import type { Card, Fighter, Phase, Section } from "../../../game/types";
import type { AbilityKind } from "../../../game/skills";
import {
  type SpellDefinition,
  type SpellTargetInstance,
  type SpellTargetOwnership,
} from "../../../game/spellEngine";
import {
  getSpellTargetStage,
  spellTargetStageRequiresManualSelection,
  type SpellTargetLocation,
} from "../../../game/spells";
import {
  isChooseLikePhase,
  shouldShowSlotCard,
  type LegacySide,
} from "../utils/slotVisibility";

export type { LegacySide } from "../utils/slotVisibility";

type SlotView = { side: LegacySide; card: Card | null; name: string };

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
  startTouchDrag: (card: Card, e: React.TouchEvent<HTMLButtonElement>) => void;
  wheelHudColor: string | null;
  pendingSpell: {
    side: LegacySide;
    spell: SpellDefinition;
    targets: SpellTargetInstance[];
    currentStage: number;
  } | null;
  spellHighlightedCardIds: readonly string[];
  onSpellTargetSelect?: (selection: {
    side: LegacySide;
    lane: number | null;
    card: Card;
    location: SpellTargetLocation;
  }) => void;
  onWheelTargetSelect?: (wheelIndex: number) => void;
  isAwaitingSpellTarget: boolean;
  variant?: "standalone" | "grouped";
  skillPhaseActive?: boolean;
  skillLaneStates?: SideState<Array<{ ability: AbilityKind | null; exhausted: boolean }>>;
  onSkillAbilityStart?: (laneIndex: number, ability: AbilityKind) => void;
  onSkillAbilityCancel?: () => void;
  onSkillTargetSelect?: (selection: { laneIndex: number; side: LegacySide }) => void;
  skillTargeting?: {
    side: LegacySide;
    laneIndex: number;
    ability: AbilityKind;
    specKind: "reserve" | "friendlyLane";
  } | null;
  skillTargetableLaneIndexes?: Set<number> | null;
  numberColorMode?: "arcana" | "skill";
  skillEffectEmojis?: Record<LegacySide, Map<number, string>>;
}

const slotWidthPx = 80;
const gapXPx = 4;
const paddingXPx = 16;
const borderXPx = 4;
const extraHeightPx = 16;

export function getWheelPanelLayout(wheelSize: number, lockedWheelSize: number | null) {
  const wheelDisplaySize = Math.round(lockedWheelSize ?? wheelSize);
  const panelWidth = wheelDisplaySize + slotWidthPx * 2 + gapXPx + paddingXPx + borderXPx;
  const panelHeight = wheelDisplaySize + extraHeightPx;

  return { wheelDisplaySize, panelWidth, panelHeight };
}

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
  startTouchDrag,
  wheelHudColor,
  pendingSpell,
  onSpellTargetSelect,
  onWheelTargetSelect,
  isAwaitingSpellTarget,
  variant = "standalone",
  spellHighlightedCardIds,
  skillPhaseActive = false,
  skillLaneStates,
  onSkillAbilityStart,
  onSkillAbilityCancel,
  onSkillTargetSelect,
  skillTargeting,
  skillTargetableLaneIndexes,
  numberColorMode = "arcana",
  skillEffectEmojis,
}) => {
  const playerCard = assign.player[index];
  const enemyCard = assign.enemy[index];

  const damageState = wheelDamage;
  const mirrorState = wheelMirror;
  const lockState = wheelLocked;
  const playerPenalty = reservePenalties.player;
  const enemyPenalty = reservePenalties.enemy;

  const activeStage = pendingSpell ? getSpellTargetStage(pendingSpell.spell.target, pendingSpell.currentStage) : null;

  const activeStageSelection = pendingSpell?.targets?.[pendingSpell.currentStage];

  const awaitingManualTarget = Boolean(
    isAwaitingSpellTarget &&
      pendingSpell &&
      activeStage &&
      spellTargetStageRequiresManualSelection(activeStage, activeStageSelection),
  );

  const awaitingCardTarget = awaitingManualTarget && activeStage?.type === "card";

  const awaitingWheelTarget = awaitingManualTarget && activeStage?.type === "wheel";

  const awaitingSpellTarget = awaitingManualTarget;

  const pendingOwnership: SpellTargetOwnership | null = awaitingCardTarget && activeStage?.type === "card"
    ? activeStage.ownership
    : null;

  const spellHighlightSet = useMemo(() => new Set(spellHighlightedCardIds), [spellHighlightedCardIds]);
  const leftSlot: SlotView = { side: "player", card: playerCard, name: namesByLegacy.player };
  const rightSlot: SlotView = { side: "enemy", card: enemyCard, name: namesByLegacy.enemy };

  const { wheelDisplaySize: ws, panelWidth, panelHeight } = getWheelPanelLayout(
    wheelSize,
    lockedWheelSize,
  );

  const isLeftSelected = !!leftSlot.card && selectedCardId === leftSlot.card.id;
  const isRightSelected = !!rightSlot.card && selectedCardId === rightSlot.card.id;
  const leftSkillEmoji = skillEffectEmojis?.player?.get(index) ?? null;
  const rightSkillEmoji = skillEffectEmojis?.enemy?.get(index) ?? null;

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

  const stageLocation = activeStage?.type === "card" ? activeStage.location ?? "board" : null;
  const previousTarget = pendingSpell?.targets[pendingSpell.targets.length - 1];

  const adjacencyAllows = (slotOwnership: SpellTargetOwnership | null, laneIndex: number): boolean => {
    if (!activeStage || activeStage.type !== "card") return true;
    if (!activeStage.adjacentToPrevious) return true;
    if (!previousTarget || previousTarget.type !== "card") return false;
    if (typeof previousTarget.lane !== "number") return false;
    if (!slotOwnership) return false;
    if (typeof laneIndex !== "number") return false;
    if (activeStage.ownership !== "any" && previousTarget.owner !== slotOwnership) return false;
    return Math.abs(previousTarget.lane - laneIndex) === 1;
  };

  const stageAllowsBoardSelection = stageLocation === "any" || stageLocation === "board";

  const slotIsTargetable = (
    slot: SlotView,
    slotOwnership: SpellTargetOwnership | null,
  ): boolean => {
    if (!awaitingCardTarget) return false;
    if (!slot.card) return false;
    if (!slotOwnership) return false;
    if (!stageAllowsBoardSelection) return false;
    if (pendingOwnership && pendingOwnership !== "any" && pendingOwnership !== slotOwnership) return false;
    return adjacencyAllows(slotOwnership, index);
  };

  const leftSlotTargetable = slotIsTargetable(leftSlot, leftSlotOwnership);

  const rightSlotTargetable = slotIsTargetable(rightSlot, rightSlotOwnership);

  const isPhaseChooseLike = isChooseLikePhase(phase);

  const revealOpposingCardDuringMirror =
    awaitingCardTarget &&
    pendingSpell?.spell.id === "mirrorImage" &&
    pendingSpell.side === localLegacySide;

  const revealBoardDuringSpell = awaitingSpellTarget && pendingSpell?.side === localLegacySide;

  const shouldShowLeftCard =
    shouldShowSlotCard({
      hasCard: !!leftSlot.card,
      slotSide: leftSlot.side,
      localLegacySide,
      isPhaseChooseLike,
      slotTargetable: leftSlotTargetable,
      revealBoardDuringSpell,
    }) || (revealOpposingCardDuringMirror && leftSlot.side !== localLegacySide);
  const shouldShowRightCard =
    shouldShowSlotCard({
      hasCard: !!rightSlot.card,
      slotSide: rightSlot.side,
      localLegacySide,
      isPhaseChooseLike,
      slotTargetable: rightSlotTargetable,
      revealBoardDuringSpell,
    }) || (revealOpposingCardDuringMirror && rightSlot.side !== localLegacySide);

  const wheelScope = activeStage?.type === "wheel" ? activeStage.scope : null;
  const wheelHasRequiredArcana = (): boolean => true;
  const wheelTargetable =
    awaitingWheelTarget &&
    pendingSpell?.side === localLegacySide &&
    (wheelScope === "any" || (wheelScope === "current" && isWheelActive)) &&
    wheelHasRequiredArcana();

  const targetedSkillLane =
    skillTargeting && skillTargeting.side === localLegacySide && skillTargeting.laneIndex === index;

  const renderSlotCard = (
    slot: SlotView,
    isSlotSelected: boolean,
    slotTargetable: boolean,
  ) => {
    if (!slot.card) return null;
    const card = slot.card;
    const isSpellAffected = spellHighlightSet.has(card.id);
    const canInteractNormally =
      !awaitingSpellTarget && !skillTargeting && slot.side === localLegacySide && phase === "choose" && isWheelActive;

    const skillState = skillLaneStates?.[slot.side]?.[index];
    const hasSkillAbility = Boolean(skillState?.ability && !skillState?.exhausted);
    const skillAbilityAvailable =
      skillPhaseActive &&
      slot.side === localLegacySide &&
      hasSkillAbility &&
      (!skillTargeting || targetedSkillLane);
    const skillTargetingFriendlyLane =
      skillTargeting &&
      skillTargeting.side === localLegacySide &&
      skillTargeting.specKind === "friendlyLane";
    const laneTargetableForSkill = Boolean(
      skillTargetingFriendlyLane &&
        slot.side === localLegacySide &&
        skillTargetableLaneIndexes?.has(index) &&
        slot.card,
    );

    const isSkillAbilityLane = Boolean(targetedSkillLane && slot.side === localLegacySide);

    const cardInteractable =
      canInteractNormally ||
      slotTargetable ||
      skillAbilityAvailable ||
      laneTargetableForSkill ||
      isSkillAbilityLane;

    const allowDrag = canInteractNormally;

    const handlePick = () => {
      if (slotTargetable && slot.card) {
        onSpellTargetSelect?.({ side: slot.side, lane: index, card: slot.card, location: "board" });
        return;
      }
      if (skillTargeting) {
        if (laneTargetableForSkill) {
          onSkillTargetSelect?.({ laneIndex: index, side: slot.side });
          return;
        }
        if (isSkillAbilityLane) {
          onSkillAbilityCancel?.();
          return;
        }
      }
      if (skillAbilityAvailable && skillState?.ability) {
        onSkillAbilityStart?.(index, skillState.ability);
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
      if (!allowDrag) return;
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
      if (!allowDrag) return;
      e.stopPropagation();
      startPointerDrag(card, e);
    };

    const handleTouchStart = (e: React.TouchEvent<HTMLButtonElement>) => {
      if (!allowDrag) return;
      e.stopPropagation();
      startTouchDrag(card, e);
    };

    const isExhausted = Boolean(skillState?.exhausted);
    const rotationClass = `inline-block transition-transform duration-200 ease-out translate-y-[5px] ${
      isExhausted ? "rotate-90 -translate-x-1 translate-y-[-1.1px]" : ""
    }`;

    return (
      <div className={rotationClass} data-exhausted={isExhausted ? "true" : undefined}>
        <StSCard
          card={card}
          size="sm"
          numberColorMode={numberColorMode}
          disabled={!cardInteractable}
          selected={isSlotSelected || isSkillAbilityLane}
          spellAffected={isSpellAffected}
          onPick={handlePick}
          draggable={allowDrag}
          onDragStart={allowDrag ? handleDragStart : undefined}
          onDragEnd={allowDrag ? handleDragEnd : undefined}
          onPointerDown={handlePointerDown}
          onTouchStart={handleTouchStart}
          className={
            slotTargetable
              ? "ring-2 ring-sky-400"
              : laneTargetableForSkill || isSkillAbilityLane
              ? "ring-2 ring-amber-300"
              : undefined
          }
          spellTargetable={slotTargetable || laneTargetableForSkill}
        />
      </div>
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

  const basePanelStyle: React.CSSProperties = {
    width: panelWidth,
    height: panelHeight,
    contain: "paint",
    backfaceVisibility: "hidden",
    transform: "translateZ(0)",
    isolation: "isolate",
  };

  const standaloneStyle: React.CSSProperties = {
    ...basePanelStyle,
    background: `linear-gradient(180deg, rgba(255,255,255,.04) 0%, rgba(0,0,0,.14) 100%), ${theme.panelBg}`,
    borderColor: theme.panelBorder,
    borderWidth: 2,
  };

  const groupedStyle: React.CSSProperties = basePanelStyle;

  const panelClassName =
    variant === "standalone"
      ? "relative rounded-xl border p-2 flex-none"
      : "relative flex-none mx-auto";


  const panelStyle = variant === "standalone" ? standaloneStyle : groupedStyle;

  const resultIndicators =
    (phase === "skill" || phase === "roundEnd" || phase === "ended") && (
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
    );

  const content = (
    <div className="flex items-center justify-center gap-[2px]" style={{ height: panelHeight }}>
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
              onSpellTargetSelect?.({ side: leftSlot.side, lane: index, card, location: "board" });
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
        className="relative w-[80px] h-[92px] rounded-md border px-1 py-0 flex items-center justify-center flex-none"
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
          renderSlotCard(leftSlot, isLeftSelected, leftSlotTargetable)
        ) : (
          <div className="text-[11px] opacity-80 text-center">
            {leftSlot.side === localLegacySide ? "Your card" : leftSlot.name}
          </div>
        )}
        {leftSkillEmoji ? (
          <span
            aria-hidden
            className="skill-pop pointer-events-none absolute inset-0 flex items-center justify-center text-[28px]"
            style={{ textShadow: "0 2px 6px rgba(0,0,0,0.7)" }}
          >
            {leftSkillEmoji}
          </span>
        ) : null}
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
      </div>

      <div
        className="relative w-[80px] h-[92px] rounded-md border px-1 py-0 flex items-center justify-center flex-none"
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
              onSpellTargetSelect?.({ side: rightSlot.side, lane: index, card, location: "board" });
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
          renderSlotCard(rightSlot, isRightSelected, rightSlotTargetable)
        ) : (
          <div className="text-[11px] opacity-60 text-center">
            {rightSlot.side === localLegacySide ? "Your card" : rightSlot.name}
          </div>
        )}
        {rightSkillEmoji ? (
          <span
            aria-hidden
            className="skill-pop pointer-events-none absolute inset-0 flex items-center justify-center text-[28px]"
            style={{ textShadow: "0 2px 6px rgba(0,0,0,0.7)" }}
          >
            {rightSkillEmoji}
          </span>
        ) : null}
      </div>
    </div>
  );

  return (
    <div
      className={panelClassName}
      style={panelStyle}
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
      {resultIndicators}
      {content}
    </div>
  );
};

export default WheelPanel;
