import type { Card, Fighter, LegacySide } from "../types";
import type { AssignmentState } from "../spellEngine";
import { getCardValue } from "../spellEffectHandlers";
import {
  getReserveBoostValue,
  getSkillCardValue,
  type AbilityKind,
} from "../skills";

export type SkillAbilityTarget =
  | { type: "reserve"; cardId: string }
  | { type: "lane"; laneIndex: number }
  | { type: "reserveToLane"; cardId: string; laneIndex: number }
  | { type: "reserveBoost"; cardId: string; laneIndex: number };

export type SkillLaneSnapshot = {
  ability: AbilityKind | null;
  exhausted: boolean;
  usesRemaining: number;
};

export type CpuSkillDecision = {
  laneIndex: number;
  ability: AbilityKind;
  target?: SkillAbilityTarget;
};

type CpuSkillContext = {
  side: LegacySide;
  board: AssignmentState<Card>;
  skillLanes: SkillLaneSnapshot[];
  fighter: Fighter;
  opponent: Fighter;
};

const opponentOf = (side: LegacySide): LegacySide =>
  side === "player" ? "enemy" : "player";

const getLaneValue = (board: AssignmentState<Card>, side: LegacySide, lane: number): number =>
  getCardValue(board[side][lane] ?? null);

const scoreLaneDelta = (current: number, enemy: number, delta: number): number => {
  if (delta <= 0 && enemy <= current) {
    return delta;
  }
  const improvement = delta;
  const deficitBefore = Math.max(0, enemy - current);
  const deficitAfter = Math.max(0, enemy - (current + delta));
  const swingBonus = deficitBefore > 0 && deficitAfter === 0 ? Math.min(improvement, deficitBefore + 0.5) : 0;
  const secureBonus = current + delta > enemy ? Math.min(current + delta - enemy, Math.max(0, improvement)) * 0.25 : 0;
  return improvement + (deficitBefore - deficitAfter) + swingBonus + secureBonus;
};

type Candidate = { score: number; decision: CpuSkillDecision } | null;

const betterOf = (current: Candidate, next: Candidate): Candidate => {
  if (!next) return current;
  if (!current) return next;
  return next.score > current.score ? next : current;
};

const evaluateBoostCard = (context: CpuSkillContext, laneIndex: number): Candidate => {
  const skillCard = context.board[context.side][laneIndex];
  if (!skillCard) return null;
  const boostAmount = getSkillCardValue(skillCard);
  if (boostAmount <= 0) return null;

  let best: Candidate = null;
  context.board[context.side].forEach((card, targetLane) => {
    if (!card) return;
    const current = getLaneValue(context.board, context.side, targetLane);
    const enemy = getLaneValue(context.board, opponentOf(context.side), targetLane);
    const score = scoreLaneDelta(current, enemy, boostAmount);
    if (score <= 0) return;
    const decision: CpuSkillDecision = {
      laneIndex,
      ability: "boostCard",
      target: { type: "lane", laneIndex: targetLane },
    };
    best = betterOf(best, { score, decision });
  });
  return best;
};

const evaluateReserveBoost = (context: CpuSkillContext, laneIndex: number): Candidate => {
  const reserves = context.fighter.hand.filter((card) => !card.reserveExhausted);
  if (reserves.length === 0) return null;

  let best: Candidate = null;
  reserves.forEach((card) => {
    const amount = getReserveBoostValue(card);
    if (amount <= 0) return;
    context.board[context.side].forEach((laneCard, targetLane) => {
      if (!laneCard) return;
      const current = getLaneValue(context.board, context.side, targetLane);
      const enemy = getLaneValue(context.board, opponentOf(context.side), targetLane);
      const score = scoreLaneDelta(current, enemy, amount) + amount * 0.1;
      if (score <= 0) return;
      const decision: CpuSkillDecision = {
        laneIndex,
        ability: "reserveBoost",
        target: { type: "reserveBoost", cardId: card.id, laneIndex: targetLane },
      };
      best = betterOf(best, { score, decision });
    });
  });
  return best;
};

const evaluateSwapReserve = (context: CpuSkillContext, laneIndex: number): Candidate => {
  const reserves = context.fighter.hand.filter((card) => !card.reserveExhausted);
  if (reserves.length === 0) return null;

  let best: Candidate = null;
  reserves.forEach((reserveCard) => {
    const reserveValue = getCardValue(reserveCard);
    context.board[context.side].forEach((laneCard, targetLane) => {
      const currentValue = laneCard ? getLaneValue(context.board, context.side, targetLane) : 0;
      const enemyValue = getLaneValue(context.board, opponentOf(context.side), targetLane);
      const displacedValue = laneCard ? getLaneValue(context.board, context.side, targetLane) : 0;
      const delta = reserveValue - currentValue;
      const laneScore = scoreLaneDelta(currentValue, enemyValue, delta);
      const displacedBonus = Math.max(0, displacedValue) * 0.2;
      const score = laneScore + Math.max(0, delta) + displacedBonus;
      if (score <= 0) return;
      const decision: CpuSkillDecision = {
        laneIndex,
        ability: "swapReserve",
        target: { type: "reserveToLane", cardId: reserveCard.id, laneIndex: targetLane },
      };
      best = betterOf(best, { score, decision });
    });
  });
  return best;
};

const evaluateRerollReserve = (context: CpuSkillContext, laneIndex: number): Candidate => {
  let best: Candidate = null;
  context.fighter.hand.forEach((card) => {
    if (card.reserveExhausted) return;
    const value = getCardValue(card);
    const score = Math.max(0, -value + (value <= 0 ? 1.5 : 0));
    if (score <= 0) return;
    const decision: CpuSkillDecision = {
      laneIndex,
      ability: "rerollReserve",
      target: { type: "reserve", cardId: card.id },
    };
    best = betterOf(best, { score, decision });
  });
  return best;
};

export function chooseCpuSkillResponse(context: CpuSkillContext): CpuSkillDecision | null {
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestDecision: CpuSkillDecision | null = null;

  const adopt = (candidate: Candidate) => {
    if (!candidate) return;
    if (candidate.score <= bestScore) return;
    bestScore = candidate.score;
    bestDecision = candidate.decision;
  };

  context.skillLanes.forEach((lane, laneIndex) => {
    if (!lane || lane.exhausted || !lane.ability || lane.usesRemaining <= 0) {
      return;
    }
    switch (lane.ability) {
      case "boostCard":
        adopt(evaluateBoostCard(context, laneIndex));
        break;
      case "reserveBoost":
        adopt(evaluateReserveBoost(context, laneIndex));
        break;
      case "swapReserve":
        adopt(evaluateSwapReserve(context, laneIndex));
        break;
      case "rerollReserve":
        adopt(evaluateRerollReserve(context, laneIndex));
        break;
      default:
        break;
    }
  });

  if (!bestDecision || bestScore <= 0) {
    return null;
  }

  return bestDecision;
}
