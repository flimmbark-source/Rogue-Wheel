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

type LaneSnapshot = {
  lane: number;
  allyCard: Card | null;
  enemyCard: Card | null;
  allyValue: number;
  enemyValue: number;
  threatScore: number;
  controlScore: number;
};

const computeLaneThreatScore = (allyValue: number, enemyValue: number): number => {
  if (enemyValue <= 0) return 0;
  const deficit = Math.max(0, enemyValue - allyValue);
  const contested = allyValue > 0 ? Math.min(allyValue, enemyValue) : 0;
  let score = Math.max(0, enemyValue);
  if (deficit > 0) score += deficit * 0.8;
  if (contested > 0) score += contested * 0.25;
  return score;
};

const computeLaneControlScore = (allyValue: number, enemyValue: number): number => {
  if (allyValue <= 0) return 0;
  const margin = allyValue - enemyValue;
  let score = Math.max(0, allyValue);
  if (margin > 0) {
    score += margin * 0.65;
  } else if (margin === 0) {
    score += allyValue * 0.2;
  } else {
    score += allyValue * 0.1;
  }
  return score;
};

const getLaneSnapshot = (context: CpuSpellContext, lane: number): LaneSnapshot => {
  const selfSide = context.casterSide;
  const foeSide = opponentOf(selfSide);
  const allyCard = (context.board[selfSide] ?? [])[lane] ?? null;
  const enemyCard = (context.board[foeSide] ?? [])[lane] ?? null;
  const allyValue = getCardValue(allyCard);
  const enemyValue = getCardValue(enemyCard);
  return {
    lane,
    allyCard,
    enemyCard,
    allyValue,
    enemyValue,
    threatScore: computeLaneThreatScore(allyValue, enemyValue),
    controlScore: computeLaneControlScore(allyValue, enemyValue),
  };
};

const computeThreatRelief = (
  allyValue: number,
  enemyValue: number,
  newEnemyValue: number,
): number => {
  const before = computeLaneThreatScore(allyValue, enemyValue);
  const after = computeLaneThreatScore(allyValue, newEnemyValue);
  return Math.max(0, before - after);
};

const computeControlDelta = (
  allyValue: number,
  enemyValue: number,
  newAllyValue: number,
): number => {
  const before = computeLaneControlScore(allyValue, enemyValue);
  const after = computeLaneControlScore(newAllyValue, enemyValue);
  return after - before;
};

const computeControlGain = (
  allyValue: number,
  enemyValue: number,
  newAllyValue: number,
): number => {
  return Math.max(0, computeControlDelta(allyValue, enemyValue, newAllyValue));
};

const getTotalThreatScore = (context: CpuSpellContext): number => {
  const laneCount = Math.max(
    context.board.player.length,
    context.board.enemy.length,
  );
  let total = 0;
  for (let lane = 0; lane < laneCount; lane += 1) {
    total += getLaneSnapshot(context, lane).threatScore;
  }
  return total;
};

const getReserveTotals = (
  context: CpuSpellContext,
): { self: number; foe: number } => {
  const selfSide = context.casterSide;
  const foeSide = opponentOf(selfSide);
  const self = Math.max(0, context.reserveSums?.[selfSide] ?? 0);
  const foe = Math.max(0, context.reserveSums?.[foeSide] ?? 0);
  return { self, foe };
};

const computeReservePressure = (self: number, foe: number): number => {
  if (foe <= 0) return 0;
  const deficit = Math.max(0, foe - self);
  return foe + deficit * 0.6;
};

const computeReserveRelief = (
  self: number,
  foe: number,
  foeAfter: number,
): number => {
  const before = computeReservePressure(self, foe);
  const after = computeReservePressure(self, foeAfter);
  return Math.max(0, before - after);
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

  enemyTargets.forEach(({ target, value, lane }) => {
    if (value <= 0) return;
    const baseDamage = 2;
    const bonus = bonusCandidate?.value ?? 0;
    const damage = baseDamage + bonus;
    const snapshot = getLaneSnapshot(context, lane);
    const inflicted = Math.min(damage, Math.max(0, snapshot.enemyValue));
    if (inflicted <= 0) return;
    const remainingEnemy = Math.max(0, snapshot.enemyValue - damage);
    const threatRelief = computeThreatRelief(
      snapshot.allyValue,
      snapshot.enemyValue,
      remainingEnemy,
    );
    let score = inflicted * 0.6 + threatRelief;
    if (bonusCandidate && bonusCandidate.value > 0) {
      score += bonusCandidate.value * 0.4;
    }
    if (snapshot.allyValue < snapshot.enemyValue) {
      score += Math.abs(snapshot.allyValue - snapshot.enemyValue) * 0.3;
    }
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

  enemyTargets.forEach(({ target, value, lane }) => {
    if (value <= 0) return;
    const snapshot = getLaneSnapshot(context, lane);
    const threatRelief = computeThreatRelief(
      snapshot.allyValue,
      snapshot.enemyValue,
      0,
    );
    if (threatRelief <= 0.1) return;
    let score = threatRelief;
    if (!snapshot.allyCard) {
      score += Math.max(0, snapshot.enemyValue) * 0.25;
    }
    if (snapshot.allyValue < snapshot.enemyValue) {
      score += Math.abs(snapshot.allyValue - snapshot.enemyValue) * 0.4;
    }
    const bladeValue = bladeSupport?.value ?? 0;
    if (bladeSupport && bladeValue > 0) {
      const initiativePressure = snapshot.allyValue > 0
        ? snapshot.allyValue * 0.3
        : Math.max(1, snapshot.enemyValue * 0.2);
      score += initiativePressure + bladeValue * 0.35;
    }
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
    if (cappedDrain <= 0) return;
    const { self, foe } = getReserveTotals(context);
    const reserveRelief = computeReserveRelief(
      self,
      foe,
      Math.max(0, foe - cappedDrain),
    );
    let score = cappedDrain * 0.5 + reserveRelief + Math.max(0, value) * 0.1;
    if (serpentSupport && serpentSupport.value > 0) {
      score += serpentSupport.value * 0.6;
    }
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
    let score = gain * 0.5 + (bonus > 0 ? bonus * 0.3 : 0);
    if (location === "board") {
      const laneSnapshot = getLaneSnapshot(
        context,
        (candidate as BoardCardTargetOption).lane,
      );
      const newAllyValue = laneSnapshot.allyValue + gain;
      const controlGain = computeControlGain(
        laneSnapshot.allyValue,
        laneSnapshot.enemyValue,
        newAllyValue,
      );
      score += controlGain;
      if (laneSnapshot.enemyValue > laneSnapshot.allyValue) {
        score += Math.abs(laneSnapshot.enemyValue - laneSnapshot.allyValue) * 0.25;
      }
    } else {
      score += Math.max(0, candidate.value) * 0.2;
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
    const controlGain = computeControlGain(value, foeValue, newValue);
    const threatRelief = computeThreatRelief(value, foeValue, foeValue);
    const improvement = controlGain + threatRelief;
    if (improvement <= 0) return;
    const score = improvement + Math.max(0, foeValue) * 0.2 + (bonus > 0 ? bonus * 0.3 : 0);
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
  const totalThreat = getTotalThreatScore(context);
  let best: SpellEvaluation | null = null;

  context.board[selfSide].forEach((card, lane) => {
    if (!card || card.arcana !== "blade") return;
    const foeCard = context.board[foeSide][lane];
    const diff = getCardValue(card) - getCardValue(foeCard);
    if (diff <= 0) return;
    const laneSnapshot = getLaneSnapshot(context, lane);
    const threatRelief = computeThreatRelief(
      laneSnapshot.allyValue,
      laneSnapshot.enemyValue,
      0,
    );
    const initiativeValue = 3 + totalThreat * 0.1;
    const score = diff * 0.5 + threatRelief + initiativeValue;
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
  const totalThreat = getTotalThreatScore(context);
  let best: SpellEvaluation | null = null;

  context.caster.hand.forEach((card) => {
    if (!card) return;
    const arcana = card.arcana;
    if (arcana !== "eye" && arcana !== "moon") return;
    const value = getCardValue(card);
    const initiativeNeed = 6 + totalThreat * 0.12;
    const score = initiativeNeed - Math.max(0, value) * 0.3;
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
    let score = difference * 0.8 + difference * 0.2;
    const targets: SpellTargetInstance[] = [cloneTarget(target)];
    if (bladeSupport) {
      score += difference * 0.5 + getTotalThreatScore(context) * 0.05;
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

      const primarySnapshot = getLaneSnapshot(context, primary.lane);
      const adjacentSnapshot = getLaneSnapshot(context, lane);
      const transferredAmount = adjacentSnapshot.allyValue;
      const afterPrimaryValue = primarySnapshot.allyValue + transferredAmount;
      const afterAdjacentValue = Math.max(0, adjacentSnapshot.allyValue - transferredAmount);
      const primaryDelta = computeControlDelta(
        primarySnapshot.allyValue,
        primarySnapshot.enemyValue,
        afterPrimaryValue,
      );
      const adjacentDelta = computeControlDelta(
        adjacentSnapshot.allyValue,
        adjacentSnapshot.enemyValue,
        afterAdjacentValue,
      );
      const improvement = primaryDelta + adjacentDelta;

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

    reserveTargets.forEach((reserveOption) => {
      const value = reserveOption.value;
      if (value <= 0) return;
      const gain = reserveOption.card.arcana === "fire" ? value * 2 : value;
      if (gain <= 0) return;
      const snapshot = getLaneSnapshot(context, boardOption.lane);
      const newAllyValue = snapshot.allyValue + gain;
      const improvement = computeControlGain(
        snapshot.allyValue,
        snapshot.enemyValue,
        newAllyValue,
      );
      if (improvement <= 0) return;
      const fireBonus = reserveOption.card.arcana === "fire" ? value : 0;
      const score = improvement + fireBonus * 0.6;
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
      const firstSnapshot = getLaneSnapshot(context, first.lane);
      const secondSnapshot = getLaneSnapshot(context, second.lane);
      const swapFirstDelta = computeControlDelta(
        firstSnapshot.allyValue,
        getCardValue(foeFirst),
        secondSnapshot.allyValue,
      );
      const swapSecondDelta = computeControlDelta(
        secondSnapshot.allyValue,
        getCardValue(foeSecond),
        firstSnapshot.allyValue,
      );
      const improvement = swapFirstDelta + swapSecondDelta;
      if (improvement <= 0.1) continue;
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
      const snapshot = getLaneSnapshot(context, option.lane);
      const improvement = computeControlGain(
        snapshot.allyValue,
        snapshot.enemyValue,
        moonReserve.value,
      );
      if (improvement <= 0) return;
      const filler = boardTargets.find((candidate) => candidate.card.id !== option.card.id);
      if (!filler) return;
      const targets: SpellTargetInstance[] = [
        cloneTarget(option.target),
        cloneTarget(filler.target),
        cloneTarget(moonReserve.target),
      ];
      const score = improvement + moonReserve.value * 0.25;
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
