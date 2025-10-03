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

type SpellEvaluation = {
  score: number;
  targets: SpellTargetInstance[];
};

const evaluateFireball = (context: CpuSpellContext): SpellEvaluation | null => {
  const foeSide = opponentOf(context.casterSide);
  let best: SpellEvaluation | null = null;
  context.board[foeSide].forEach((card, lane) => {
    if (!card || card.arcana !== "fire") return;
    const value = getCardValue(card);
    const score = value > 0 ? value + 1.5 : 0.5;
    if (!best || score > best.score) {
      best = {
        score,
        targets: [makeBoardTarget(context, foeSide, lane, card)],
      };
    }
  });
  return best;
};

const evaluateIceShard = (context: CpuSpellContext): SpellEvaluation | null => {
  const foeSide = opponentOf(context.casterSide);
  let best: SpellEvaluation | null = null;
  context.board[foeSide].forEach((card, lane) => {
    if (!card || card.arcana !== "blade") return;
    const value = getCardValue(card);
    const score = value > 0 ? value + 1 : 0.75;
    if (!best || score > best.score) {
      best = {
        score,
        targets: [makeBoardTarget(context, foeSide, lane, card)],
      };
    }
  });
  return best;
};

const evaluateHex = (context: CpuSpellContext): SpellEvaluation | null => {
  const foeSide = opponentOf(context.casterSide);
  const reserve = context.reserveSums?.[foeSide] ?? 0;
  let best: SpellEvaluation | null = null;
  context.board[foeSide].forEach((card, lane) => {
    if (!card || card.arcana !== "serpent") return;
    const value = getCardValue(card);
    const score = 2 + reserve * 0.5 + Math.max(0, value * 0.4);
    if (!best || score > best.score) {
      best = {
        score,
        targets: [makeBoardTarget(context, foeSide, lane, card)],
      };
    }
  });
  return best;
};

const evaluateKindle = (context: CpuSpellContext): SpellEvaluation | null => {
  const selfSide = context.casterSide;
  let best: SpellEvaluation | null = null;

  context.board[selfSide].forEach((card, lane) => {
    if (!card || card.arcana !== "fire") return;
    const value = getCardValue(card);
    const score = value + 2.5;
    if (!best || score > best.score) {
      best = {
        score,
        targets: [makeBoardTarget(context, selfSide, lane, card)],
      };
    }
  });

  context.caster.hand.forEach((card) => {
    if (!card || card.arcana !== "fire") return;
    const value = getCardValue(card);
    const score = value + 4;
    if (!best || score > best.score) {
      best = {
        score,
        targets: [makeHandTarget(context, selfSide, card)],
      };
    }
  });

  return best;
};

const evaluateMirrorImage = (
  context: CpuSpellContext,
): SpellEvaluation | null => {
  const selfSide = context.casterSide;
  const foeSide = opponentOf(selfSide);
  let best: SpellEvaluation | null = null;

  context.board[selfSide].forEach((card, lane) => {
    if (!card || card.arcana !== "eye") return;
    const foeCard = context.board[foeSide][lane];
    const foeValue = getCardValue(foeCard);
    const selfValue = getCardValue(card);
    const improvement = foeValue - selfValue;
    if (improvement <= 0) return;
    const score = improvement + Math.max(0, foeValue * 0.5);
    if (!best || score > best.score) {
      best = {
        score,
        targets: [makeBoardTarget(context, selfSide, lane, card)],
      };
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

const EVALUATORS: Record<
  string,
  (context: CpuSpellContext) => SpellEvaluation | null
> = {
  fireball: evaluateFireball,
  iceShard: evaluateIceShard,
  hex: evaluateHex,
  kindle: evaluateKindle,
  mirrorImage: evaluateMirrorImage,
  suddenStrike: evaluateSuddenStrike,
  timeTwist: evaluateTimeTwist,
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
