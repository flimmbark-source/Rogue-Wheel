import type { Card, Fighter, LegacySide } from "../../game/types";
import type {
  SpellDefinition,
  SpellTargetInstance,
} from "../spells";
import type { AssignmentState } from "../spellEngine";

export type CpuSpellCandidate = {
  spell: SpellDefinition;
  cost: number;
};

export type CpuSpellDecision = CpuSpellCandidate & {
  targets: SpellTargetInstance[];
};

type ReserveSums = { player: number; enemy: number } | null;

type CpuSpellContext = {
  casterSide: LegacySide;
  caster: Fighter;
  opponent: Fighter;
  board: AssignmentState<Card>;
  reserveSums: ReserveSums;
  initiative: LegacySide;
  availableSpells: CpuSpellCandidate[];
};

const opponentOf = (side: LegacySide): LegacySide =>
  side === "player" ? "enemy" : "player";

const getCardValue = (card: Card | null | undefined): number => {
  if (!card) return 0;
  if (typeof card.number === "number") return card.number;
  if (typeof card.leftValue === "number") return card.leftValue;
  if (typeof card.rightValue === "number") return card.rightValue;
  return 0;
};

const makeBoardTarget = (
  context: CpuSpellContext,
  side: LegacySide,
  lane: number,
  card: Card,
): SpellTargetInstance => ({
  type: "card",
  cardId: card.id,
  cardName: card.name,
  arcana: card.arcana,
  owner: side === context.casterSide ? "ally" : "enemy",
  lane,
  location: "board",
  cardValue: getCardValue(card),
});

const makeHandTarget = (
  context: CpuSpellContext,
  side: LegacySide,
  card: Card,
): SpellTargetInstance => ({
  type: "card",
  cardId: card.id,
  cardName: card.name,
  arcana: card.arcana,
  owner: side === context.casterSide ? "ally" : "enemy",
  lane: null,
  location: "hand",
  cardValue: getCardValue(card),
});

type BoardCardTargetOption = {
  card: Card;
  lane: number;
  value: number;
  target: SpellTargetInstance;
};

type HandCardTargetOption = {
  card: Card;
  value: number;
  target: SpellTargetInstance;
};

type ArcanaTargetOption = {
  cardId: string;
  target: SpellTargetInstance;
  value: number;
};

const cloneTarget = <T extends SpellTargetInstance>(target: T): T => ({ ...target });

const getBoardTargetsForSide = (
  context: CpuSpellContext,
  side: LegacySide,
): BoardCardTargetOption[] => {
  const results: BoardCardTargetOption[] = [];
  context.board[side].forEach((card, lane) => {
    if (!card) return;
    results.push({
      card,
      lane,
      value: getCardValue(card),
      target: makeBoardTarget(context, side, lane, card),
    });
  });
  return results;
};

const getHandTargetsForSide = (
  context: CpuSpellContext,
  side: LegacySide,
): HandCardTargetOption[] => {
  const cards = side === context.casterSide ? context.caster.hand : context.opponent.hand;
  return cards
    .filter((card): card is Card => Boolean(card))
    .map((card) => ({
      card,
      value: getCardValue(card),
      target: makeHandTarget(context, side, card),
    }));
};

const findBestAllyArcanaTarget = (
  context: CpuSpellContext,
  arcana: Card["arcana"],
  location: "board" | "hand" | "any" = "any",
  excludeIds?: Set<string>,
): ArcanaTargetOption | null => {
  const side = context.casterSide;
  let best: ArcanaTargetOption | null = null;
  const consider = (card: Card, target: SpellTargetInstance) => {
    if (excludeIds?.has(card.id)) return;
    if (card.arcana !== arcana) return;
    const value = getCardValue(card);
    if (!best || value > best.value) {
      best = { cardId: card.id, target: cloneTarget(target), value };
    }
  };

  if (location !== "hand") {
    getBoardTargetsForSide(context, side).forEach(({ card, target }) => consider(card, target));
  }

  if (location !== "board") {
    getHandTargetsForSide(context, side).forEach(({ card, target }) => consider(card, target));
  }

  return best;
};

type SpellEvaluation = {
  score: number;
  targets: SpellTargetInstance[];
};

const evaluateFireball = (context: CpuSpellContext): SpellEvaluation | null => {
  const foeSide = opponentOf(context.casterSide);
  const enemyTargets = getBoardTargetsForSide(context, foeSide);
  if (enemyTargets.length === 0) return null;

  const bonusCandidate = findBestAllyArcanaTarget(context, "fire", "any");
  let best: SpellEvaluation | null = null;

  enemyTargets.forEach(({ target, value }) => {
    const baseDamage = 2;
    const bonus = bonusCandidate?.value ?? 0;
    const damage = baseDamage + bonus;
    const improvement = Math.min(damage, Math.max(0, value));
    const score = improvement + bonus * 0.5 + Math.max(0, value - improvement) * 0.1;
    const targets: SpellTargetInstance[] = [cloneTarget(target)];
    if (bonusCandidate && bonusCandidate.value > 0) {
      targets.push(cloneTarget(bonusCandidate.target));
    }
    if (!best || score > best.score) {
      best = { score, targets };
    }
  });

  return best;
};

const evaluateIceShard = (context: CpuSpellContext): SpellEvaluation | null => {
  const foeSide = opponentOf(context.casterSide);
  const enemyTargets = getBoardTargetsForSide(context, foeSide);
  if (enemyTargets.length === 0) return null;

  const bladeSupport = findBestAllyArcanaTarget(context, "blade", "any");
  let best: SpellEvaluation | null = null;

  enemyTargets.forEach(({ target, value }) => {
    const baseScore = Math.max(0.5, value);
    const bonus = bladeSupport && bladeSupport.value > 0 ? 1.5 : 0;
    const score = baseScore + bonus;
    const targets: SpellTargetInstance[] = [cloneTarget(target)];
    if (bladeSupport) {
      targets.push(cloneTarget(bladeSupport.target));
    }
    if (!best || score > best.score) {
      best = { score, targets };
    }
  });

  return best;
};

const evaluateHex = (context: CpuSpellContext): SpellEvaluation | null => {
  const foeSide = opponentOf(context.casterSide);
  const enemyTargets = getBoardTargetsForSide(context, foeSide);
  if (enemyTargets.length === 0) return null;

  const reserve = Math.max(0, context.reserveSums?.[foeSide] ?? 0);
  const serpentSupport = findBestAllyArcanaTarget(context, "serpent", "any");
  let best: SpellEvaluation | null = null;

  enemyTargets.forEach(({ target, value }) => {
    const bonus = serpentSupport?.value ?? 0;
    const drain = 2 + bonus;
    const cappedDrain = Math.min(drain, reserve);
    const score = cappedDrain + bonus * 0.75 + Math.max(0, value) * 0.15;
    const targets: SpellTargetInstance[] = [cloneTarget(target)];
    if (serpentSupport && serpentSupport.value > 0) {
      targets.push(cloneTarget(serpentSupport.target));
    }
    if (!best || score > best.score) {
      best = { score, targets };
    }
  });

  return best;
};

const evaluateKindle = (context: CpuSpellContext): SpellEvaluation | null => {
  const selfSide = context.casterSide;
  const foeSide = opponentOf(selfSide);
  const boardTargets = getBoardTargetsForSide(context, selfSide);
  const handTargets = getHandTargetsForSide(context, selfSide);
  if (boardTargets.length === 0 && handTargets.length === 0) return null;

  let best: SpellEvaluation | null = null;

  const evaluateTarget = (
    candidate: BoardCardTargetOption | HandCardTargetOption,
    location: "board" | "hand",
  ) => {
    const exclude = new Set<string>([candidate.card.id]);
    const fireSupport = findBestAllyArcanaTarget(context, "fire", "any", exclude);
    const bonus = fireSupport?.value ?? 0;
    const gain = 2 + bonus;
    let score = gain + (bonus > 0 ? bonus * 0.25 : 0);
    if (location === "board") {
      const foeCard = context.board[foeSide][(candidate as BoardCardTargetOption).lane] ?? null;
      const foeValue = getCardValue(foeCard);
      const beforeAdvantage = candidate.value - foeValue;
      const afterAdvantage = candidate.value + gain - foeValue;
      score += afterAdvantage - beforeAdvantage;
    } else {
      score += Math.max(0, candidate.value) * 0.1;
    }

    const targets: SpellTargetInstance[] = [cloneTarget(candidate.target)];
    if (fireSupport && fireSupport.value > 0) {
      targets.push(cloneTarget(fireSupport.target));
    }

    if (!best || score > best.score) {
      best = { score, targets };
    }
  };

  boardTargets.forEach((candidate) => evaluateTarget(candidate, "board"));
  handTargets.forEach((candidate) => evaluateTarget(candidate, "hand"));

  return best;
};

const evaluateMirrorImage = (
  context: CpuSpellContext,
): SpellEvaluation | null => {
  const selfSide = context.casterSide;
  const foeSide = opponentOf(selfSide);
  const boardTargets = getBoardTargetsForSide(context, selfSide);
  if (boardTargets.length === 0) return null;

  const eyeReserve = findBestAllyArcanaTarget(context, "eye", "hand");
  let best: SpellEvaluation | null = null;

  boardTargets.forEach(({ card, lane, target, value }) => {
    const foeCard = context.board[foeSide][lane] ?? null;
    const foeValue = getCardValue(foeCard);
    const bonus = eyeReserve?.value ?? 0;
    const newValue = foeValue + bonus;
    const improvement = newValue - value;
    if (improvement <= 0) return;
    const score = improvement + Math.max(0, foeValue) * 0.2 + (bonus > 0 ? bonus * 0.25 : 0);
    const targets: SpellTargetInstance[] = [cloneTarget(target)];
    if (eyeReserve && eyeReserve.value > 0) {
      targets.push(cloneTarget(eyeReserve.target));
    }
    if (!best || score > best.score) {
      best = { score, targets };
    }
  });

  return best;
};

const evaluateSuddenStrike = (
  context: CpuSpellContext,
): SpellEvaluation | null => {
  if (context.initiative === context.casterSide) return null;
  const selfSide = context.casterSide;
  const foeSide = opponentOf(selfSide);
  let best: SpellEvaluation | null = null;

  context.board[selfSide].forEach((card, lane) => {
    if (!card || card.arcana !== "blade") return;
    const foeCard = context.board[foeSide][lane];
    const diff = getCardValue(card) - getCardValue(foeCard);
    if (diff <= 0) return;
    const score = diff + 5;
    if (!best || score > best.score) {
      best = {
        score,
        targets: [makeBoardTarget(context, selfSide, lane, card)],
      };
    }
  });

  return best;
};

const evaluateTimeTwist = (
  context: CpuSpellContext,
): SpellEvaluation | null => {
  if (context.initiative === context.casterSide) return null;
  const selfSide = context.casterSide;
  let best: SpellEvaluation | null = null;

  context.caster.hand.forEach((card) => {
    if (!card) return;
    const arcana = card.arcana;
    if (arcana !== "eye" && arcana !== "moon") return;
    const value = getCardValue(card);
    const score = 8 - Math.max(0, value);
    if (!best || score > best.score) {
      best = {
        score,
        targets: [makeHandTarget(context, selfSide, card)],
      };
    }
  });

  return best;
};

const evaluateCrosscut = (context: CpuSpellContext): SpellEvaluation | null => {
  const reserveTargets = getHandTargetsForSide(context, context.casterSide);
  if (reserveTargets.length === 0) return null;

  const opponentReserve = context.opponent.hand[0] ?? null;
  if (!opponentReserve) return null;
  const opponentValue = getCardValue(opponentReserve);

  const bladeSupport = findBestAllyArcanaTarget(context, "blade", "board");
  let best: SpellEvaluation | null = null;

  reserveTargets.forEach(({ target, value }) => {
    const difference = Math.abs(value - opponentValue);
    if (difference <= 0) return;
    let score = difference + difference * 0.1;
    const targets: SpellTargetInstance[] = [cloneTarget(target)];
    if (bladeSupport) {
      score += difference * 0.5;
      targets.push(cloneTarget(bladeSupport.target));
    }
    if (!best || score > best.score) {
      best = { score, targets };
    }
  });

  return best;
};

const evaluateLeech = (context: CpuSpellContext): SpellEvaluation | null => {
  const selfSide = context.casterSide;
  const foeSide = opponentOf(selfSide);
  const boardTargets = getBoardTargetsForSide(context, selfSide);
  if (boardTargets.length < 2) return null;

  const targetsByLane = new Map<number, BoardCardTargetOption>();
  boardTargets.forEach((option) => targetsByLane.set(option.lane, option));
  const serpentSupport = findBestAllyArcanaTarget(context, "serpent", "any");
  let best: SpellEvaluation | null = null;

  boardTargets.forEach((primary) => {
    const adjacentLanes = [primary.lane - 1, primary.lane + 1];
    adjacentLanes.forEach((lane) => {
      const adjacent = targetsByLane.get(lane);
      if (!adjacent) return;
      if (adjacent.value <= 0) return;

      const foePrimary = context.board[foeSide][primary.lane] ?? null;
      const foeAdjacent = context.board[foeSide][lane] ?? null;
      const foePrimaryValue = getCardValue(foePrimary);
      const foeAdjacentValue = getCardValue(foeAdjacent);

      const beforeAdvantage =
        (primary.value - foePrimaryValue) + (adjacent.value - foeAdjacentValue);
      const transferredAmount = adjacent.value;
      const afterPrimaryValue = primary.value + transferredAmount;
      const afterAdjacentValue = Math.max(0, adjacent.value - transferredAmount);
      const afterAdvantage =
        (afterPrimaryValue - foePrimaryValue) + (afterAdjacentValue - foeAdjacentValue);
      const improvement = afterAdvantage - beforeAdvantage;

      const bonus = serpentSupport?.value ?? 0;
      if (improvement <= 0 && bonus <= 0) return;

      let score = improvement + Math.max(0, bonus) * 0.75;
      const targets: SpellTargetInstance[] = [
        cloneTarget(primary.target),
        cloneTarget(adjacent.target),
      ];
      if (serpentSupport && serpentSupport.value > 0) {
        targets.push(cloneTarget(serpentSupport.target));
      }
      if (!best || score > best.score) {
        best = { score, targets };
      }
    });
  });

  return best;
};

const evaluateOffering = (context: CpuSpellContext): SpellEvaluation | null => {
  const selfSide = context.casterSide;
  const foeSide = opponentOf(selfSide);
  const boardTargets = getBoardTargetsForSide(context, selfSide);
  const reserveTargets = getHandTargetsForSide(context, selfSide);
  if (boardTargets.length === 0 || reserveTargets.length === 0) return null;

  let best: SpellEvaluation | null = null;

  boardTargets.forEach((boardOption) => {
    const foeCard = context.board[foeSide][boardOption.lane] ?? null;
    const foeValue = getCardValue(foeCard);
    const beforeAdvantage = boardOption.value - foeValue;

    reserveTargets.forEach((reserveOption) => {
      const value = reserveOption.value;
      if (value <= 0) return;
      const gain = reserveOption.card.arcana === "fire" ? value * 2 : value;
      if (gain <= 0) return;
      const afterAdvantage = boardOption.value + gain - foeValue;
      const improvement = afterAdvantage - beforeAdvantage;
      if (improvement <= 0) return;
      const fireBonus = reserveOption.card.arcana === "fire" ? value : 0;
      const score = improvement + fireBonus;
      const targets: SpellTargetInstance[] = [
        cloneTarget(boardOption.target),
        cloneTarget(reserveOption.target),
      ];
      if (!best || score > best.score) {
        best = { score, targets };
      }
    });
  });

  return best;
};

const evaluatePhantom = (context: CpuSpellContext): SpellEvaluation | null => {
  const selfSide = context.casterSide;
  const foeSide = opponentOf(selfSide);
  const boardTargets = getBoardTargetsForSide(context, selfSide);
  if (boardTargets.length < 2) return null;

  let best: SpellEvaluation | null = null;

  for (let i = 0; i < boardTargets.length; i += 1) {
    for (let j = i + 1; j < boardTargets.length; j += 1) {
      const first = boardTargets[i];
      const second = boardTargets[j];
      const foeFirst = context.board[foeSide][first.lane] ?? null;
      const foeSecond = context.board[foeSide][second.lane] ?? null;
      const beforeAdvantage =
        (first.value - getCardValue(foeFirst)) + (second.value - getCardValue(foeSecond));
      const afterAdvantage =
        (second.value - getCardValue(foeFirst)) + (first.value - getCardValue(foeSecond));
      const improvement = afterAdvantage - beforeAdvantage;
      if (improvement <= 0) continue;
      const targets: SpellTargetInstance[] = [
        cloneTarget(first.target),
        cloneTarget(second.target),
      ];
      if (!best || improvement > best.score) {
        best = { score: improvement, targets };
      }
    }
  }

  const moonReserve = findBestAllyArcanaTarget(context, "moon", "hand");
  if (moonReserve) {
    boardTargets.forEach((option) => {
      if (option.card.arcana !== "moon") return;
      const foeCard = context.board[foeSide][option.lane] ?? null;
      const foeValue = getCardValue(foeCard);
      const beforeAdvantage = option.value - foeValue;
      const afterAdvantage = moonReserve.value - foeValue;
      const improvement = afterAdvantage - beforeAdvantage;
      if (improvement <= 0) return;
      const filler = boardTargets.find((candidate) => candidate.card.id !== option.card.id);
      if (!filler) return;
      const targets: SpellTargetInstance[] = [
        cloneTarget(option.target),
        cloneTarget(filler.target),
        cloneTarget(moonReserve.target),
      ];
      const score = improvement + moonReserve.value * 0.3;
      if (!best || score > best.score) {
        best = { score, targets };
      }
    });
  }

  return best;
};

const EVALUATORS: Record<
  string,
  (context: CpuSpellContext) => SpellEvaluation | null
> = {
  fireball: evaluateFireball,
  iceShard: evaluateIceShard,
  hex: evaluateHex,
  kindle: evaluateKindle,
  mirrorImage: evaluateMirrorImage,
  crosscut: evaluateCrosscut,
  leech: evaluateLeech,
  suddenStrike: evaluateSuddenStrike,
  timeTwist: evaluateTimeTwist,
  offering: evaluateOffering,
  phantom: evaluatePhantom,
};

export function chooseCpuSpellResponse(
  context: CpuSpellContext,
): CpuSpellDecision | null {
  let bestDecision: { score: number; decision: CpuSpellDecision } | null = null;

  for (const candidate of context.availableSpells) {
    const evaluator = EVALUATORS[candidate.spell.id];
    if (!evaluator) continue;
    const result = evaluator(context);
    if (!result) continue;
    const score = result.score - candidate.cost * 0.25;
    if (!bestDecision || score > bestDecision.score) {
      bestDecision = {
        score,
        decision: {
          spell: candidate.spell,
          cost: candidate.cost,
          targets: result.targets,
        },
      };
    }
  }

  return bestDecision?.decision ?? null;
}
