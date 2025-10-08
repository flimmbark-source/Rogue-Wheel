import type { AbilityKind } from "../../../game/skills.js";
import { getCurrentSkillCardValue, getReserveBoostValue } from "../../../game/skills.js";
import type { Card, Fighter, LegacySide } from "../../../game/types.js";
import type { AssignmentState } from "../../../game/spellEngine.js";

type WheelRecalcResult = { value: number; changed: boolean };

export type SkillAbilityTarget =
  | { type: "reserve"; cardId: string }
  | { type: "lane"; laneIndex: number }
  | { type: "reserveToLane"; cardId: string; laneIndex: number }
  | { type: "reserveBoost"; cardId: string; laneIndex: number };

export type SkillAbilityEffectOptions = {
  ability: AbilityKind;
  actorName: string;
  side: LegacySide;
  laneIndex: number;
  target?: SkillAbilityTarget;
  skillCard: Card | null;
  storedSkillValue: number;
  sideAssignments: AssignmentState<Card>;
  concludeAssignUpdate: (nextAssign: AssignmentState<Card>) => void;
  recalcWheelForLane: (
    nextAssign: AssignmentState<Card>,
    laneIndex: number,
  ) => WheelRecalcResult;
  getFighterSnapshot: (side: LegacySide) => Fighter;
  updateFighter: (
    side: LegacySide,
    updater: (prev: Fighter) => Fighter,
  ) => void;
  drawOne: (fighter: Fighter) => Fighter;
  updateReservePreview: () => void;
  appendLog: (message: string) => void;
};

export type SkillAbilityEffectResult = {
  success: boolean;
  failureReason?: string;
  changedLanes?: number[];
};

const isValidLaneIndex = (
  index: number,
  laneArr: Array<Card | null>,
): index is number => Number.isInteger(index) && index >= 0 && index < laneArr.length;

export const applySkillAbilityEffect = (
  options: SkillAbilityEffectOptions,
): SkillAbilityEffectResult => {
  const {
    ability,
    actorName,
    side,
    target,
    skillCard,
    storedSkillValue,
    sideAssignments,
    concludeAssignUpdate,
    recalcWheelForLane,
    getFighterSnapshot,
    updateFighter,
    drawOne,
    updateReservePreview,
    appendLog,
  } = options;

  const laneSourceArr = side === "player" ? sideAssignments.player : sideAssignments.enemy;

  switch (ability) {
    case "swapReserve": {
      if (!skillCard) {
        return { success: false, failureReason: "The skill card is no longer in play." };
      }
      if (!target || target.type !== "reserveToLane") {
        return { success: false, failureReason: "Select a reserve card and a target lane." };
      }
      const targetLaneIndex = target.laneIndex;
      if (!isValidLaneIndex(targetLaneIndex, laneSourceArr)) {
        return { success: false, failureReason: "Choose a valid lane to receive the reserve card." };
      }
      const fighter = getFighterSnapshot(side);
      const reserveIndex = fighter.hand.findIndex((card) => card.id === target.cardId);
      if (reserveIndex === -1) {
        return { success: false, failureReason: "That reserve card is no longer available." };
      }
      const reserveCard = fighter.hand[reserveIndex];
      const displacedCard = laneSourceArr[targetLaneIndex] ?? null;

      updateFighter(side, (prev) => {
        const nextHand = prev.hand.filter((card) => card.id !== target.cardId);
        if (displacedCard && !nextHand.some((card) => card.id === displacedCard.id)) {
          nextHand.push({ ...displacedCard });
        }
        return { ...prev, hand: nextHand };
      });

      const nextAssign: AssignmentState<Card> = {
        player: [...sideAssignments.player],
        enemy: [...sideAssignments.enemy],
      };
      const laneArr = side === "player" ? nextAssign.player : nextAssign.enemy;
      laneArr[targetLaneIndex] = { ...reserveCard };

      concludeAssignUpdate(nextAssign);
      const { changed } = recalcWheelForLane(nextAssign, targetLaneIndex);
      updateReservePreview();
      appendLog(`${actorName} swapped a reserve card onto lane ${targetLaneIndex + 1}.`);
      return { success: true, changedLanes: changed ? [targetLaneIndex] : undefined };
    }
    case "rerollReserve": {
      if (!target || target.type !== "reserve") {
        return { success: false, failureReason: "Select a reserve card to reroll." };
      }
      const fighter = getFighterSnapshot(side);
      const reserveIndex = fighter.hand.findIndex((card) => card.id === target.cardId);
      if (reserveIndex === -1) {
        return { success: false, failureReason: "That reserve card is no longer available." };
      }
      const discarded = fighter.hand[reserveIndex];
      let drawnCard: Card | null = null;

      updateFighter(side, (prev) => {
        const nextHand = [...prev.hand];
        const idx = nextHand.findIndex((card) => card.id === target.cardId);
        if (idx === -1) return prev;
        const [removed] = nextHand.splice(idx, 1);
        const nextDiscard = removed ? [...prev.discard, removed] : [...prev.discard];
        const base: Fighter = {
          ...prev,
          hand: nextHand,
          discard: nextDiscard,
          exhaust: [...prev.exhaust],
        };
        const afterDraw = drawOne(base);
        if (afterDraw.hand.length > base.hand.length) {
          drawnCard = afterDraw.hand[afterDraw.hand.length - 1] ?? null;
        }
        return afterDraw;
      });

      updateReservePreview();
      const drawnCardNumber = (drawnCard as Card | null)?.number;
      const drawnValue = typeof drawnCardNumber === "number" ? drawnCardNumber : 0;
      const drawnLabel = drawnCard ? ` and drew ${drawnValue}` : "";
      appendLog(
        `${actorName} discarded ${discarded.number ?? 0} from reserve${drawnLabel}.`,
      );
      return { success: true };
    }
    case "boostCard": {
      if (!target || target.type !== "lane") {
        return { success: false, failureReason: "Select a lane to boost." };
      }
      const targetLane = target.laneIndex;
      if (!isValidLaneIndex(targetLane, laneSourceArr)) {
        return { success: false, failureReason: "Choose a valid lane to boost." };
      }
      const existing = laneSourceArr[targetLane];
      if (!existing) {
        return { success: false, failureReason: "There is no card on that lane." };
      }
      const dynamicSkillValue = skillCard ? getCurrentSkillCardValue(skillCard) : undefined;
      const boostAmount = dynamicSkillValue !== undefined ? dynamicSkillValue : storedSkillValue;
      if (boostAmount === 0) {
        return { success: false, failureReason: "The skill card has no boost value." };
      }

      const updatedCard = { ...existing } as Card;
      const currentValue = typeof updatedCard.number === "number" ? updatedCard.number : 0;
      updatedCard.number = currentValue + boostAmount;

      const nextAssign: AssignmentState<Card> = {
        player: [...sideAssignments.player],
        enemy: [...sideAssignments.enemy],
      };
      const laneArr = side === "player" ? nextAssign.player : nextAssign.enemy;
      laneArr[targetLane] = updatedCard;

      concludeAssignUpdate(nextAssign);
      const { changed } = recalcWheelForLane(nextAssign, targetLane);
      appendLog(`${actorName} boosted lane ${targetLane + 1} by ${boostAmount}.`);
      return { success: true, changedLanes: changed ? [targetLane] : undefined };
    }
    case "reserveBoost": {
      if (!target || target.type !== "reserveBoost") {
        return { success: false, failureReason: "Select a reserve card and target lane." };
      }
      const targetLaneIndex = target.laneIndex;
      if (!isValidLaneIndex(targetLaneIndex, laneSourceArr)) {
        return { success: false, failureReason: "Choose a valid lane to infuse." };
      }
      const laneCard = laneSourceArr[targetLaneIndex];
      if (!laneCard) {
        return { success: false, failureReason: "There is no card on that lane to infuse." };
      }
      const fighter = getFighterSnapshot(side);
      const reserveIndex = fighter.hand.findIndex((card) => card.id === target.cardId);
      if (reserveIndex === -1) {
        return { success: false, failureReason: "That reserve card is no longer available." };
      }
      const reserveCard = fighter.hand[reserveIndex];
      if (reserveCard.reserveExhausted) {
        return { success: false, failureReason: "That reserve card has already been exhausted." };
      }
      const storedReserveValue = Math.max(0, getReserveBoostValue(reserveCard));

      updateFighter(side, (prev) => {
        const idx = prev.hand.findIndex((card) => card.id === target.cardId);
        if (idx === -1) return prev;
        const existing = prev.hand[idx];
        if (existing.reserveExhausted) return prev;
        const nextHand = [...prev.hand];
        nextHand[idx] = { ...existing, reserveExhausted: true };
        return { ...prev, hand: nextHand };
      });

      updateReservePreview();

      if (storedReserveValue > 0) {
        const nextAssign: AssignmentState<Card> = {
          player: [...sideAssignments.player],
          enemy: [...sideAssignments.enemy],
        };
        const laneArr = side === "player" ? nextAssign.player : nextAssign.enemy;
        const updatedCard = { ...laneCard } as Card;
        const baseValue = typeof updatedCard.number === "number" ? updatedCard.number : 0;
        updatedCard.number = baseValue + storedReserveValue;
        laneArr[targetLaneIndex] = updatedCard;
        concludeAssignUpdate(nextAssign);
        const { changed } = recalcWheelForLane(nextAssign, targetLaneIndex);
        appendLog(
          `${actorName} infused lane ${targetLaneIndex + 1} with +${storedReserveValue} from reserve.`,
        );
        return { success: true, changedLanes: changed ? [targetLaneIndex] : undefined };
      }
      appendLog(`${actorName} exhausted a reserve card with no value to boost.`);
      return { success: true };
    }
    default:
      return { success: false, failureReason: "Unknown skill ability." };
  }
};

