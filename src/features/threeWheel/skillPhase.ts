import type { Card, LegacySide } from "../../game/types.js";
import {
  describeSkillAbility,
  determineSkillAbility,
  getReserveBoostValue,
  getSkillCardValue,
  isReserveBoostTarget,
  type AbilityKind,
} from "../../game/skills.js";

export type SkillPhaseSide = LegacySide;

export interface SkillPhaseLane {
  index: number;
  side: SkillPhaseSide;
  card: Card | null;
  boost: number;
  exhausted: boolean;
  ability?: AbilityKind;
  usesRemaining: number;
}

export type SkillPhaseReserves = Record<SkillPhaseSide, Card[]>;

export interface PhaseLimits {
  rerollsUsed: Record<SkillPhaseSide, number>;
}

export type TargetSpec = { kind: "reserve" | "friendlyLane"; count: number };

export type AbilityConfig = {
  kind: AbilityKind;
  usesPerPhase: number;
  targetsRequired: number;
};

export interface Snapshot {
  lanes: SkillPhaseLane[];
  reserves: SkillPhaseReserves;
  limits: PhaseLimits;
}

export interface SkillPhaseTargetingState {
  laneIndex: number;
  ability: AbilityKind;
  targetSpec: TargetSpec;
  selectedTargets: Array<string | number>;
  snapshotBefore: Snapshot;
}

export interface SkillPhaseState {
  lanes: SkillPhaseLane[];
  reserves: SkillPhaseReserves;
  activeSide: SkillPhaseSide;
  passed: Record<SkillPhaseSide, boolean>;
  limits: PhaseLimits;
  targeting?: SkillPhaseTargetingState;
  rngSeed: number;
}

export interface SkillPhaseUiEvents {
  banner?: (msg: string) => void;
  tooltipInfo?: (data: unknown) => void;
  log?: (msg: string, data?: unknown) => void;
  onStateChange?: (state: SkillPhaseState) => void;
}

interface InternalState extends SkillPhaseState {
  __ui?: SkillPhaseUiEvents;
}

export type OptionAvailability = {
  laneIndex: number;
  ability?: AbilityKind;
  available: boolean;
  reason?: string;
  targetSpec?: TargetSpec;
};

const abilityConfigs: Record<AbilityKind, AbilityConfig> = {
  swapReserve: { kind: "swapReserve", usesPerPhase: 1, targetsRequired: 1 },
  rerollReserve: { kind: "rerollReserve", usesPerPhase: 1, targetsRequired: 1 },
  boostCard: { kind: "boostCard", usesPerPhase: 1, targetsRequired: 1 },
  reserveBoost: { kind: "reserveBoost", usesPerPhase: 1, targetsRequired: 1 },
};

const abilityTargetSpecs: Record<AbilityKind, TargetSpec> = {
  swapReserve: { kind: "reserve", count: 1 },
  rerollReserve: { kind: "reserve", count: 1 },
  boostCard: { kind: "friendlyLane", count: 1 },
  reserveBoost: { kind: "reserve", count: 1 },
};

const RNG_INCREMENT = 0x6d2b79f5;

function cloneCard(card: Card | null): Card | null {
  return card ? { ...card } : null;
}

function cloneLane(lane: SkillPhaseLane): SkillPhaseLane {
  return {
    index: lane.index,
    side: lane.side,
    card: cloneCard(lane.card),
    boost: lane.boost,
    exhausted: lane.exhausted,
    ability: lane.ability,
    usesRemaining: lane.usesRemaining,
  };
}

function cloneLanes(lanes: SkillPhaseLane[]): SkillPhaseLane[] {
  return lanes.map(cloneLane);
}

function cloneReserves(reserves: SkillPhaseReserves): SkillPhaseReserves {
  return {
    player: reserves.player.map((card) => ({ ...card })),
    enemy: reserves.enemy.map((card) => ({ ...card })),
  } satisfies SkillPhaseReserves;
}

function cloneLimits(limits: PhaseLimits): PhaseLimits {
  return {
    rerollsUsed: { player: limits.rerollsUsed.player, enemy: limits.rerollsUsed.enemy },
  };
}

function otherSide(side: SkillPhaseSide): SkillPhaseSide {
  return side === "player" ? "enemy" : "player";
}

function makeDrawnCard(printed: number, id: string): Card {
  return {
    id,
    name: `Reserve ${printed}`,
    number: printed,
    baseNumber: printed,
    tags: [],
  } as Card;
}

export function nextRandom(seed: number): { value: number; nextSeed: number } {
  const nextSeed = (seed + RNG_INCREMENT) | 0;
  let t = nextSeed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, nextSeed };
}

export function makeRng(seed: number): () => number {
  let current = seed | 0;
  return () => {
    const step = nextRandom(current);
    current = step.nextSeed;
    return step.value;
  };
}

export function drawCard(rng: () => number): Card {
  const value = Math.floor(rng() * 11) - 3;
  const id = `draw-${Math.floor(rng() * 1_000_000)}`;
  return makeDrawnCard(value, id);
}

export function drawCardFromSeed(seed: number): { card: Card; nextSeed: number } {
  let step = nextRandom(seed);
  const printed = Math.floor(step.value * 11) - 3;
  step = nextRandom(step.nextSeed);
  const id = `draw-${Math.floor(step.value * 1_000_000)}`;
  return { card: makeDrawnCard(printed, id), nextSeed: step.nextSeed };
}

function assignLaneAbility(card: Card | null): AbilityKind | undefined {
  return card ? determineSkillAbility(card) : undefined;
}

function recalcLane(lane: SkillPhaseLane): SkillPhaseLane {
  const ability = assignLaneAbility(lane.card);
  const usesRemaining = ability ? Math.max(0, lane.usesRemaining) : 0;
  const exhausted = usesRemaining <= 0 || !lane.card || !ability;
  return { ...lane, ability, exhausted, usesRemaining };
}

function recalcAllLanes(lanes: SkillPhaseLane[]): SkillPhaseLane[] {
  return lanes.map(recalcLane);
}

function buildLaneState(
  boardLanes: Array<{ side: SkillPhaseSide; index: number; card: Card | null }>,
): SkillPhaseLane[] {
  return boardLanes.map((entry) => {
    const ability = assignLaneAbility(entry.card);
    const usesRemaining = ability ? abilityConfigs[ability].usesPerPhase : 0;
    return {
      index: entry.index,
      side: entry.side,
      card: entry.card ? { ...entry.card } : null,
      boost: 0,
      exhausted: !ability || !entry.card,
      ability,
      usesRemaining,
    } satisfies SkillPhaseLane;
  });
}

function computeLaneAvailability(
  state: SkillPhaseState,
  side: SkillPhaseSide,
): OptionAvailability[] {
  const reserves = state.reserves[side];
  const options: OptionAvailability[] = [];
  for (const lane of state.lanes) {
    if (lane.side !== side) continue;
    const base: OptionAvailability = {
      laneIndex: lane.index,
      ability: lane.ability,
      available: false,
    };
    if (!lane.card) {
      base.reason = "no card";
      options.push(base);
      continue;
    }
    if (!lane.ability) {
      base.reason = "no ability";
      options.push(base);
      continue;
    }
    if (lane.usesRemaining <= 0) {
      base.reason = "lane exhausted";
      options.push(base);
      continue;
    }
    const targetSpec = abilityTargetSpecs[lane.ability];
    base.targetSpec = targetSpec;
    switch (lane.ability) {
      case "swapReserve": {
        if (reserves.length === 0) {
          base.reason = "no reserve cards";
        } else {
          base.available = true;
        }
        break;
      }
      case "rerollReserve": {
        if (reserves.length === 0) {
          base.reason = "no reserve cards";
        } else if (state.limits.rerollsUsed[side] >= 2) {
          base.reason = "phase reroll limit reached";
        } else {
          base.available = true;
        }
        break;
      }
      case "boostCard": {
        const friendlyLanes = state.lanes.filter((l) => l.side === side && l.card);
        if (friendlyLanes.length === 0) {
          base.reason = "no friendly lanes";
        } else {
          base.available = true;
        }
        break;
      }
      case "reserveBoost": {
        const positiveReserve = reserves.some((card) => isReserveBoostTarget(card));
        if (!positiveReserve) {
          base.reason = "no positive reserve";
        } else {
          base.available = true;
        }
        break;
      }
      default: {
        base.reason = "unknown ability";
        break;
      }
    }
    options.push(base);
  }
  return options;
}

function applyUi(state: SkillPhaseState, key: keyof SkillPhaseUiEvents, payload?: unknown) {
  const withUi = state as InternalState;
  const handler = withUi.__ui?.[key];
  if (handler) {
    if (payload !== undefined) {
      (handler as (arg: unknown) => void)(payload);
    } else {
      (handler as () => void)();
    }
  }
}

function withUpdatedState<T extends Partial<SkillPhaseState>>(
  state: SkillPhaseState,
  updates: T,
): SkillPhaseState {
  const next: InternalState = {
    ...(state as InternalState),
    ...updates,
  };
  return next;
}

function findReserveIndex(reserves: Card[], cardId: string): number {
  return reserves.findIndex((card) => card.id === cardId);
}

function consumeLaneUse(lanes: SkillPhaseLane[], laneIndex: number): SkillPhaseLane[] {
  const updated = cloneLanes(lanes);
  const lane = updated.find((l) => l.index === laneIndex);
  if (lane) {
    lane.usesRemaining = Math.max(0, lane.usesRemaining - 1);
    lane.exhausted = lane.usesRemaining <= 0;
    lane.ability = assignLaneAbility(lane.card);
  }
  return updated;
}

function applySwapReserve(state: SkillPhaseState, laneIndex: number, cardId: string): SkillPhaseState {
  const lane = state.lanes.find((l) => l.index === laneIndex);
  if (!lane || !lane.card) throw new Error("Invalid swap lane");
  const side = lane.side;
  const reserves = cloneReserves(state.reserves);
  const reserve = reserves[side];
  const idx = findReserveIndex(reserve, cardId);
  if (idx === -1) throw new Error("Reserve card not found");
  const reserveCard = reserve[idx];
  reserve[idx] = { ...lane.card };
  const newLaneCard = { ...reserveCard };
  const lanes = cloneLanes(state.lanes);
  const laneMut = lanes.find((l) => l.index === laneIndex)!;
  laneMut.card = newLaneCard;
  laneMut.boost = lane.boost;
  laneMut.ability = assignLaneAbility(laneMut.card);
  return withUpdatedState(state, {
    lanes,
    reserves,
  });
}

function applyRerollReserve(state: SkillPhaseState, laneIndex: number, cardId: string): SkillPhaseState {
  const lane = state.lanes.find((l) => l.index === laneIndex);
  if (!lane) throw new Error("Invalid lane");
  const side = lane.side;
  const reserves = cloneReserves(state.reserves);
  const reserve = reserves[side];
  const idx = findReserveIndex(reserve, cardId);
  if (idx === -1) throw new Error("Reserve card not found");
  reserve.splice(idx, 1);
  const { card: drawn, nextSeed } = drawCardFromSeed(state.rngSeed);
  reserve.push(drawn);
  const updatedLimits = cloneLimits(state.limits);
  updatedLimits.rerollsUsed[side] += 1;
  return withUpdatedState(state, {
    reserves,
    limits: updatedLimits,
    rngSeed: nextSeed,
  });
}

function applyBoostCard(state: SkillPhaseState, laneIndex: number, targetLaneIndex: number): SkillPhaseState {
  const sourceLane = state.lanes.find((l) => l.index === laneIndex);
  if (!sourceLane || !sourceLane.card) throw new Error("Invalid source lane");
  const targetLane = state.lanes.find(
    (l) => l.index === targetLaneIndex && l.side === sourceLane.side,
  );
  if (!targetLane) throw new Error("Invalid target lane");
  const lanes = cloneLanes(state.lanes);
  const targetMut = lanes.find(
    (l) => l.index === targetLaneIndex && l.side === sourceLane.side,
  )!;
  targetMut.boost += getSkillCardValue(sourceLane.card);
  return withUpdatedState(state, { lanes });
}

function applyReserveBoost(state: SkillPhaseState, laneIndex: number, cardId: string): SkillPhaseState {
  const lane = state.lanes.find((l) => l.index === laneIndex);
  if (!lane || !lane.card) throw new Error("Invalid lane");
  const side = lane.side;
  const reserves = cloneReserves(state.reserves);
  const reserve = reserves[side];
  const idx = findReserveIndex(reserve, cardId);
  if (idx === -1) throw new Error("Reserve card not found");
  const [chosen] = reserve.splice(idx, 1);
  const boostValue = getReserveBoostValue(chosen);
  if (boostValue <= 0) {
    throw new Error("Reserve boost requires positive value");
  }
  const lanes = cloneLanes(state.lanes);
  const laneMut = lanes.find((l) => l.index === laneIndex)!;
  laneMut.boost += boostValue;
  return withUpdatedState(state, { lanes, reserves });
}

function phaseCanStart(state: SkillPhaseState): {
  start: boolean;
  reason?: string;
  handoverTo?: SkillPhaseSide;
} {
  const playerOptions = computeLaneAvailability(state, "player");
  const enemyOptions = computeLaneAvailability(state, "enemy");
  const playerHas = playerOptions.some((opt) => opt.available);
  const enemyHas = enemyOptions.some((opt) => opt.available);
  if (!playerHas && !enemyHas) {
    return { start: false, reason: "No skill actions available." };
  }
  if (!playerHas && enemyHas) {
    return { start: true, handoverTo: "enemy" };
  }
  if (playerHas && !enemyHas) {
    return { start: true, handoverTo: "player" };
  }
  return { start: true };
}

export function initSkillPhase(
  boardLanes: Array<{ side: SkillPhaseSide; index: number; card: Card | null }>,
  reserves: SkillPhaseReserves,
  startingSide: SkillPhaseSide,
  rngSeed: number,
  ui?: SkillPhaseUiEvents,
): SkillPhaseState {
  const lanes = buildLaneState(boardLanes);
  const state: InternalState = {
    lanes,
    reserves: cloneReserves(reserves),
    activeSide: startingSide,
    passed: { player: false, enemy: false },
    limits: { rerollsUsed: { player: 0, enemy: 0 } },
    rngSeed,
  };
  if (ui) {
    state.__ui = ui;
  }
  const startInfo = phaseCanStart(state);
  if (!startInfo.start) {
    applyUi(state, "banner", startInfo.reason ?? "Skill phase skipped.");
    state.passed = { player: true, enemy: true };
    applyUi(state, "onStateChange", state);
    return state;
  }
  if (startInfo.handoverTo && startInfo.handoverTo !== startingSide) {
    state.activeSide = startInfo.handoverTo;
    const msg = state.activeSide === "player"
      ? "Opponent has no skill actions—you start."
      : "You have no skill actions—opponent starts.";
    applyUi(state, "banner", msg);
  } else {
    state.activeSide = startInfo.handoverTo ?? startingSide;
    const msg = state.activeSide === "player"
      ? "Skill Phase begins. You act first."
      : "Skill Phase begins. Rival acts first.";
    applyUi(state, "banner", msg);
  }
  applyUi(state, "onStateChange", state);
  return state;
}

export function getOptions(state: SkillPhaseState, side: SkillPhaseSide): OptionAvailability[] {
  return computeLaneAvailability(state, side);
}

export function beginActivation(
  state: SkillPhaseState,
  side: SkillPhaseSide,
  laneIndex: number,
): SkillPhaseState {
  const lane = state.lanes.find((l) => l.index === laneIndex && l.side === side);
  if (!lane) {
    throw new Error(`Lane ${laneIndex} not found for ${side}`);
  }
  const options = computeLaneAvailability(state, side).find((opt) => opt.laneIndex === laneIndex);
  if (!options || !options.available || !options.ability || !options.targetSpec) {
    throw new Error("Lane not available for activation");
  }
  const snapshot: Snapshot = {
    lanes: cloneLanes(state.lanes),
    reserves: cloneReserves(state.reserves),
    limits: cloneLimits(state.limits),
  };
  const targeting: SkillPhaseTargetingState = {
    laneIndex,
    ability: options.ability,
    targetSpec: options.targetSpec,
    selectedTargets: [],
    snapshotBefore: snapshot,
  };
  const next = withUpdatedState(state, { targeting });
  applyUi(next, "log", `Begin activation from lane ${laneIndex}`);
  applyUi(next, "onStateChange", next);
  return next;
}

export function pickTarget(state: SkillPhaseState, target: string | number): SkillPhaseState {
  if (!state.targeting) {
    throw new Error("No targeting in progress");
  }
  const targeting = state.targeting;
  if (targeting.selectedTargets.length >= targeting.targetSpec.count) {
    throw new Error("All targets already selected");
  }
  const nextTargets = [...targeting.selectedTargets, target];
  const targetingNext = { ...targeting, selectedTargets: nextTargets };
  const next = withUpdatedState(state, { targeting: targetingNext });
  applyUi(next, "onStateChange", next);
  return next;
}

export function cancelTargeting(state: SkillPhaseState): SkillPhaseState {
  if (!state.targeting) {
    return state;
  }
  const snapshot = state.targeting.snapshotBefore;
  const restored: InternalState = {
    ...(state as InternalState),
    lanes: cloneLanes(snapshot.lanes),
    reserves: cloneReserves(snapshot.reserves),
    limits: cloneLimits(snapshot.limits),
    targeting: undefined,
  };
  applyUi(restored, "log", "Activation cancelled");
  applyUi(restored, "onStateChange", restored);
  return restored;
}

export function confirmActivation(state: SkillPhaseState): SkillPhaseState {
  const targeting = state.targeting;
  if (!targeting) {
    throw new Error("No targeting to confirm");
  }
  if (targeting.selectedTargets.length !== targeting.targetSpec.count) {
    throw new Error("Targets incomplete");
  }
  const laneIndex = targeting.laneIndex;
  const side = state.lanes.find((l) => l.index === laneIndex)?.side;
  if (!side) throw new Error("Invalid lane");
  let nextState: SkillPhaseState = state;
  const [target] = targeting.selectedTargets;
  switch (targeting.ability) {
    case "swapReserve":
      nextState = applySwapReserve(nextState, laneIndex, String(target));
      break;
    case "rerollReserve":
      nextState = applyRerollReserve(nextState, laneIndex, String(target));
      break;
    case "boostCard":
      nextState = applyBoostCard(nextState, laneIndex, Number(target));
      break;
    case "reserveBoost":
      nextState = applyReserveBoost(nextState, laneIndex, String(target));
      break;
    default:
      throw new Error("Unknown ability");
  }
  const lanesAfter = consumeLaneUse(nextState.lanes, laneIndex);
  const passed = { ...nextState.passed, [side]: false };
  const cleaned: InternalState = {
    ...(nextState as InternalState),
    lanes: recalcAllLanes(lanesAfter),
    targeting: undefined,
    passed,
  };
  applyUi(cleaned, "log", `${side} resolves ${targeting.ability} on lane ${laneIndex}`);
  const advanced = advanceTurn(cleaned, true);
  applyUi(advanced, "onStateChange", advanced);
  return advanced;
}

export function pass(state: SkillPhaseState, side: SkillPhaseSide): SkillPhaseState {
  const nextPassed = { ...state.passed, [side]: true };
  const nextState = withUpdatedState(state, { passed: nextPassed });
  applyUi(nextState, "log", `${side} passes`);
  const advanced = advanceTurn(nextState, false);
  applyUi(advanced, "onStateChange", advanced);
  return advanced;
}

export function advanceTurn(state: SkillPhaseState, fromAction = false): SkillPhaseState {
  const current = state.activeSide;
  const opponent = otherSide(current);
  const currentOptions = computeLaneAvailability(state, current);
  const opponentOptions = computeLaneAvailability(state, opponent);
  const currentHas = currentOptions.some((o) => o.available);
  const opponentHas = opponentOptions.some((o) => o.available);

  let newPassed = { ...state.passed };
  if (fromAction) {
    newPassed[current] = false;
  }

  if (!currentHas && !opponentHas) {
    newPassed = { player: true, enemy: true };
    const ended = withUpdatedState(state, { passed: newPassed });
    applyUi(ended, "banner", "Skill Phase ends.");
    return ended;
  }
  if (state.passed[current] && state.passed[opponent]) {
    const ended = withUpdatedState(state, { passed: newPassed });
    applyUi(ended, "banner", "Skill Phase ends.");
    return ended;
  }
  if (state.passed[current] || !currentHas) {
    if (opponentHas) {
      return withUpdatedState(state, { activeSide: opponent, passed: newPassed });
    }
    return withUpdatedState(state, { passed: newPassed });
  }
  if (!opponentHas) {
    return withUpdatedState(state, { activeSide: current, passed: newPassed });
  }
  if (fromAction) {
    return withUpdatedState(state, { activeSide: opponent, passed: newPassed });
  }
  return withUpdatedState(state, { passed: newPassed });
}

function evaluateLaneScore(lane: SkillPhaseLane, opponentLane: SkillPhaseLane | undefined): number {
  if (!lane.card) return 0;
  const laneValue = getSkillCardValue(lane.card) + lane.boost;
  const opponentValue = opponentLane && opponentLane.card
    ? getSkillCardValue(opponentLane.card) + opponentLane.boost
    : 0;
  return laneValue - opponentValue;
}

export function aiChooseAction(
  state: SkillPhaseState,
  side: SkillPhaseSide,
): { type: "activate" | "pass"; laneIndex?: number; chosenTarget?: string | number } {
  const options = computeLaneAvailability(state, side).filter((o) => o.available && o.ability);
  let bestScore = -Infinity;
  let bestAction: { type: "activate" | "pass"; laneIndex?: number; chosenTarget?: string | number } = {
    type: "pass",
  };
  for (const option of options) {
    const lane = state.lanes.find((l) => l.index === option.laneIndex && l.side === side);
    if (!lane || !lane.card || !option.ability) continue;
    let score = 0;
    switch (option.ability) {
      case "reserveBoost": {
        const reserves = state.reserves[side].filter((c) => isReserveBoostTarget(c));
        if (reserves.length === 0) break;
        const bestReserve = reserves.reduce((a, b) => (getReserveBoostValue(a) > getReserveBoostValue(b) ? a : b));
        score = getReserveBoostValue(bestReserve) * 2;
        break;
      }
      case "boostCard": {
        const opponentLane = state.lanes.find((l) => l.side === otherSide(side) && l.index === lane.index);
        const currentScore = evaluateLaneScore(lane, opponentLane);
        score = getSkillCardValue(lane.card);
        if (currentScore > 5) score -= 5;
        break;
      }
      case "swapReserve": {
        const reserves = state.reserves[side];
        if (reserves.length === 0) break;
        const best = reserves.reduce((a, b) => (getSkillCardValue(a) > getSkillCardValue(b) ? a : b));
        const delta = getSkillCardValue(best) - getSkillCardValue(lane.card);
        score = delta <= 0 ? -1 : delta;
        break;
      }
      case "rerollReserve": {
        score = 0.5;
        break;
      }
      default:
        break;
    }
    if (score > bestScore && score > 0) {
      bestScore = score;
      let chosenTarget: string | number | undefined;
      if (option.ability === "boostCard") {
        chosenTarget = lane.index;
      } else if (option.ability === "reserveBoost") {
        const reserves = state.reserves[side].filter((c) => isReserveBoostTarget(c));
        if (reserves.length > 0) {
          const bestReserve = reserves.reduce((a, b) => (getReserveBoostValue(a) > getReserveBoostValue(b) ? a : b));
          chosenTarget = bestReserve.id;
        }
      } else if (option.ability === "swapReserve") {
        const reserves = state.reserves[side];
        const best = reserves.reduce((a, b) => (getSkillCardValue(a) > getSkillCardValue(b) ? a : b));
        chosenTarget = best.id;
      } else if (option.ability === "rerollReserve") {
        const reserves = state.reserves[side];
        chosenTarget = reserves[0]?.id;
      }
      if (chosenTarget !== undefined) {
        bestAction = { type: "activate", laneIndex: option.laneIndex, chosenTarget };
      }
    }
  }
  return bestAction;
}

export function describeAbility(ability: AbilityKind, card?: Card): string {
  return describeSkillAbility(ability, card);
}
