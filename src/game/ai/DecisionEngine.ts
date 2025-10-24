import { inSection } from "../math";
import { isNormal } from "../values";
import {
  SLICES,
  type Card,
  type LegacySide,
  type Section,
} from "../types";

export interface WheelState {
  aiCard: Card | null;
  playerCard: Card | null;
}

export interface GameState {
  wheels: WheelState[];
  aiHand: Card[];
  playerHand: Card[];
  tokens: number[];
  wheelSections: Section[][];
  initiative: LegacySide;
  reservePenalties?: Partial<Record<LegacySide, number>>;
}

export interface AIMove {
  card: Card;
  wheelIndex: number;
  prob: number;
}

interface SimulationSnapshot extends GameState {
  wheels: WheelState[];
  aiHand: Card[];
  playerHand: Card[];
}

export function simulateGameRound(
  state: GameState,
  aiCard: Card,
  wheelIndex: number,
  trials = 200,
): number {
  if (!state.aiHand.some((c) => c.id === aiCard.id)) {
    return 0;
  }

  let wins = 0;

  for (let i = 0; i < trials; i++) {
    const wheels = state.wheels.map((wheel) => ({
      aiCard: wheel.aiCard ?? null,
      playerCard: wheel.playerCard ?? null,
    }));
    const aiHand = [...state.aiHand];
    const playerHand = [...state.playerHand];

    removeCardById(aiHand, aiCard.id);
    wheels[wheelIndex] = {
      ...wheels[wheelIndex],
      aiCard,
      playerCard:
        wheels[wheelIndex]?.playerCard ?? takeRandomCard(playerHand) ?? null,
    };

    if (wheels[wheelIndex].playerCard) {
      removeCardById(playerHand, wheels[wheelIndex].playerCard!.id);
    }

    for (let w = 0; w < wheels.length; w++) {
      if (w === wheelIndex) continue;
      const wheel = wheels[w];

      if (wheel.aiCard) {
        removeCardById(aiHand, wheel.aiCard.id);
      } else {
        wheel.aiCard = takeRandomCard(aiHand);
      }

      if (wheel.playerCard) {
        removeCardById(playerHand, wheel.playerCard.id);
      } else {
        wheel.playerCard = takeRandomCard(playerHand);
      }
    }

    const aiWon = evaluateRound({
      ...state,
      wheels,
      aiHand,
      playerHand,
    });

    if (aiWon) wins++;
  }

  return wins / trials;
}

export function chooseBestMove(
  state: GameState,
  candidateWheels?: number[],
  trials = 200,
): AIMove | null {
  const wheelsToCheck =
    candidateWheels ?? state.wheels.map((_, index) => index);
  let best: AIMove | null = null;

  for (const wheelIndex of wheelsToCheck) {
    const wheel = state.wheels[wheelIndex];
    if (wheel?.aiCard) continue;

    for (const card of state.aiHand) {
      const prob = simulateGameRound(state, card, wheelIndex, trials);
      if (!best || prob > best.prob) {
        best = { card, wheelIndex, prob };
      }
    }
  }

  return best;
}

function evaluateRound(state: SimulationSnapshot): boolean {
  let aiScore = 0;
  let playerScore = 0;

  const aiPlayed = state.wheels.map((w) => w.aiCard ?? null);
  const playerPlayed = state.wheels.map((w) => w.playerCard ?? null);

  const aiReserve = computeReserveSum(
    state.aiHand,
    aiPlayed,
    state.reservePenalties?.enemy ?? 0,
  );
  const playerReserve = computeReserveSum(
    state.playerHand,
    playerPlayed,
    state.reservePenalties?.player ?? 0,
  );

  for (let i = 0; i < state.wheels.length; i++) {
    const aiCard = state.wheels[i].aiCard;
    const playerCard = state.wheels[i].playerCard;
    const sectionList = state.wheelSections[i] ?? [];
    const baseP = cardWheelValue(playerCard);
    const baseE = cardWheelValue(aiCard);
    const steps = modSlice(modSlice(baseP) + modSlice(baseE));
    const startToken = state.tokens[i] ?? 0;
    const targetSlice = (startToken + steps) % SLICES;
    const section =
      sectionList.find(
        (s) => targetSlice !== 0 && inSection(targetSlice, s),
      ) ?? ({
        id: "Strongest",
        color: "transparent",
        start: 0,
        end: 0,
      } satisfies Section);

    let winner: LegacySide | null = null;
    let tie = false;

    if (targetSlice === 0) {
      tie = true;
    } else {
      switch (section.id) {
        case "Strongest":
          if (baseP === baseE) tie = true;
          else winner = baseP > baseE ? "player" : "enemy";
          break;
        case "Weakest":
          if (baseP === baseE) tie = true;
          else winner = baseP < baseE ? "player" : "enemy";
          break;
        case "ReserveSum":
          if (playerReserve === aiReserve) tie = true;
          else winner = playerReserve > aiReserve ? "player" : "enemy";
          break;
        case "ClosestToTarget": {
          const target = targetSlice === 0 ? section.target ?? 0 : targetSlice;
          const pd = Math.abs(baseP - target);
          const ed = Math.abs(baseE - target);
          if (pd === ed) tie = true;
          else winner = pd < ed ? "player" : "enemy";
          break;
        }
        case "Initiative":
          winner = state.initiative;
          break;
        default:
          tie = true;
          break;
      }
    }

    if (winner === "enemy") aiScore++;
    else if (winner === "player") playerScore++;
    else if (!tie && !winner) {
      playerScore++;
      aiScore++;
    }
  }

  return aiScore > playerScore;
}

function computeReserveSum(
  hand: Card[],
  used: (Card | null)[],
  penalty: number,
) {
  const usedIds = new Set(used.filter(Boolean).map((card) => card!.id));
  const remaining = hand.filter((card) => !usedIds.has(card.id));
  const values = remaining
    .filter(isNormal)
    .map((card) => card.number ?? 0)
    .sort((a, b) => b - a);
  const base = values.slice(0, 2).reduce((sum, value) => sum + value, 0);
  return Math.max(0, base - penalty);
}

function takeRandomCard(hand: Card[]): Card | null {
  if (hand.length === 0) return null;
  const index = Math.floor(Math.random() * hand.length);
  const [card] = hand.splice(index, 1);
  return card ?? null;
}

function removeCardById(hand: Card[], id: string) {
  const index = hand.findIndex((card) => card.id === id);
  if (index >= 0) hand.splice(index, 1);
}

function cardWheelValue(card: Card | null) {
  if (!card) return 0;
  if (typeof card.number === "number" && Number.isFinite(card.number)) {
    return card.number;
  }
  if (
    typeof card.leftValue === "number" &&
    typeof card.rightValue === "number"
  ) {
    return (card.leftValue + card.rightValue) / 2;
  }
  if (typeof card.leftValue === "number" && Number.isFinite(card.leftValue)) {
    return card.leftValue;
  }
  if (
    typeof card.rightValue === "number" &&
    Number.isFinite(card.rightValue)
  ) {
    return card.rightValue;
  }
  return 0;
}

function modSlice(value: number) {
  return ((value % SLICES) + SLICES) % SLICES;
}
