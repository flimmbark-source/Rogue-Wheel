// Skill Mode implementation and tests

type Side = "you" | "rival";

interface Card {
  id: string;
  printed: number;
}

interface Lane {
  index: number;
  side: Side;
  card: Card | null;
  boost: number;
  exhausted: boolean;
  ability?: AbilityKind;
  usesRemaining: number;
}

interface Reserves {
  you: Card[];
  rival: Card[];
}

type AbilityKind = "swapReserve" | "rerollReserve" | "boostCard" | "reserveBoost";

interface PhaseLimits {
  rerollsUsed: Record<Side, number>;
}

interface TargetSpec {
  kind: "reserve" | "friendlyLane" | "reserveThenLane";
  count: number;
}

interface AbilityConfig {
  kind: AbilityKind;
  usesPerPhase: number;
  targetsRequired: number;
}

interface Snapshot {
  lanes: Lane[];
  reserves: Reserves;
  limits: PhaseLimits;
}

interface SkillPhaseState {
  lanes: Lane[];
  reserves: Reserves;
  activeSide: Side;
  passed: Record<Side, boolean>;
  playLocked: Record<Side, boolean>;
  limits: PhaseLimits;
  targeting?: {
    laneIndex: number;
    ability: AbilityKind;
    targetSpec: TargetSpec;
    selectedTargets: Array<string | number>;
    snapshotBefore: Snapshot;
    side: Side;
    cardId: string;
  };
  rngSeed: number;
}

interface UiEvents {
  banner?: (msg: string) => void;
  tooltipInfo?: (data: any) => void;
  log?: (msg: string, data?: any) => void;
  onStateChange?: (s: SkillPhaseState) => void;
}

type InternalState = SkillPhaseState & { __ui?: UiEvents };

type OptionAvailability = {
  laneIndex: number;
  ability?: AbilityKind;
  available: boolean;
  reason?: string;
  targetSpec?: TargetSpec;
};

const abilityConfigs: Record<AbilityKind, AbilityConfig> = {
  swapReserve: { kind: "swapReserve", usesPerPhase: 1, targetsRequired: 2 },
  rerollReserve: { kind: "rerollReserve", usesPerPhase: 1, targetsRequired: 1 },
  boostCard: { kind: "boostCard", usesPerPhase: 1, targetsRequired: 1 },
  reserveBoost: { kind: "reserveBoost", usesPerPhase: 1, targetsRequired: 2 },
};

const abilityTargetSpecs: Record<AbilityKind, TargetSpec> = {
  swapReserve: { kind: "reserveThenLane", count: 2 },
  rerollReserve: { kind: "reserve", count: 1 },
  boostCard: { kind: "friendlyLane", count: 1 },
  reserveBoost: { kind: "reserveThenLane", count: 2 },
};

function targetKindForIndex(spec: TargetSpec, index: number): "reserve" | "friendlyLane" {
  if (spec.kind === "reserveThenLane") {
    return index === 0 ? "reserve" : "friendlyLane";
  }
  return spec.kind;
}

function cloneCard(card: Card | null): Card | null {
  return card ? { ...card } : null;
}

function cloneLane(lane: Lane): Lane {
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

function cloneLanes(lanes: Lane[]): Lane[] {
  return lanes.map(cloneLane);
}

function cloneReserves(reserves: Reserves): Reserves {
  return {
    you: reserves.you.map((c) => ({ ...c })),
    rival: reserves.rival.map((c) => ({ ...c })),
  };
}

function cloneLimits(limits: PhaseLimits): PhaseLimits {
  return {
    rerollsUsed: { you: limits.rerollsUsed.you, rival: limits.rerollsUsed.rival },
  };
}

function otherSide(side: Side): Side {
  return side === "you" ? "rival" : "you";
}

function deriveAbilityForCard(printed: number): AbilityKind | undefined {
  if (printed <= 0) return "swapReserve";
  if (printed <= 2) return "rerollReserve";
  if (printed <= 4) return "boostCard";
  if (printed >= 5) return "reserveBoost";
  return undefined;
}

const RNG_INCREMENT = 0x6d2b79f5;

function nextRandom(seed: number): { value: number; nextSeed: number } {
  const nextSeed = (seed + RNG_INCREMENT) | 0;
  let t = nextSeed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, nextSeed };
}

function makeRng(seed: number): () => number {
  let current = seed | 0;
  return () => {
    const step = nextRandom(current);
    current = step.nextSeed;
    return step.value;
  };
}

function drawCard(rng: () => number): Card {
  const value = Math.floor(rng() * 11) - 3; // range -3..7
  const id = `draw-${Math.floor(rng() * 1_000_000)}`;
  return { id, printed: value };
}

function drawCardFromSeed(seed: number): { card: Card; nextSeed: number } {
  let step = nextRandom(seed);
  const printed = Math.floor(step.value * 11) - 3;
  step = nextRandom(step.nextSeed);
  const id = `draw-${Math.floor(step.value * 1_000_000)}`;
  return { card: { id, printed }, nextSeed: step.nextSeed };
}

function computeLaneAvailability(state: SkillPhaseState, side: Side): OptionAvailability[] {
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
        const positiveReserve = reserves.some((card) => card.printed > 0);
        const friendlyLanes = state.lanes.filter((l) => l.side === side && l.card);
        if (!positiveReserve) {
          base.reason = "no positive reserve";
        } else if (friendlyLanes.length === 0) {
          base.reason = "no friendly lanes";
        } else {
          base.available = true;
        }
        break;
      }
      default:
        base.reason = "unknown ability";
        break;
    }
    options.push(base);
  }
  return options;
}

function applyUi(state: SkillPhaseState, key: keyof UiEvents, payload?: any) {
  const withUi = state as InternalState;
  const handler = withUi.__ui?.[key];
  if (handler) {
    if (payload !== undefined) {
      (handler as any)(payload);
    } else {
      (handler as any)();
    }
  }
}

function assignLaneAbility(card: Card | null): AbilityKind | undefined {
  return card ? deriveAbilityForCard(card.printed) : undefined;
}

function recalcLane(lane: Lane): Lane {
  const updated = { ...lane, ability: assignLaneAbility(lane.card) };
  updated.exhausted = updated.usesRemaining <= 0 || !updated.card || !updated.ability;
  return updated;
}

function recalcAllLanes(lanes: Lane[]): Lane[] {
  return lanes.map(recalcLane);
}

function buildLaneState(boardLanes: Array<{ side: Side; index: number; card: Card | null }>): Lane[] {
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
    } satisfies Lane;
  });
}

function phaseCanStart(state: SkillPhaseState): { start: boolean; reason?: string; handoverTo?: Side } {
  const youOptions = computeLaneAvailability(state, "you");
  const rivalOptions = computeLaneAvailability(state, "rival");
  const youHas = youOptions.some((opt) => opt.available);
  const rivalHas = rivalOptions.some((opt) => opt.available);
  if (!youHas && !rivalHas) {
    return { start: false, reason: "No skill actions available." };
  }
  if (!youHas && rivalHas) {
    return { start: true, handoverTo: "rival" };
  }
  if (youHas && !rivalHas) {
    return { start: true, handoverTo: "you" };
  }
  return { start: true };
}

function initSkillPhase(
  boardLanes: Array<{ side: Side; index: number; card: Card | null }>,
  reserves: Reserves,
  startingSide: Side,
  rngSeed: number,
  ui?: UiEvents
): SkillPhaseState {
  const lanes = buildLaneState(boardLanes);
  const state: InternalState = {
    lanes,
    reserves: cloneReserves(reserves),
    activeSide: startingSide,
    passed: { you: false, rival: false },
    playLocked: { you: false, rival: false },
    limits: { rerollsUsed: { you: 0, rival: 0 } },
    rngSeed,
  };
  if (ui) {
    state.__ui = ui;
  }
  const startInfo = phaseCanStart(state);
  if (!startInfo.start) {
    applyUi(state, "banner", startInfo.reason ?? "Skill phase skipped.");
    state.passed = { you: true, rival: true };
    state.playLocked = { you: true, rival: true };
    applyUi(state, "onStateChange", state);
    return state;
  }
  if (startInfo.handoverTo && startInfo.handoverTo !== startingSide) {
    state.activeSide = startInfo.handoverTo;
    const msg = state.activeSide === "you"
      ? "Opponent has no skill actions—you start."
      : "You have no skill actions—opponent starts.";
    applyUi(state, "banner", msg);
  } else {
    state.activeSide = startInfo.handoverTo ?? startingSide;
    const msg = state.activeSide === "you"
      ? "Skill Phase begins. You act first."
      : "Skill Phase begins. Rival acts first.";
    applyUi(state, "banner", msg);
  }
  applyUi(state, "onStateChange", state);
  return state;
}

function getOptions(state: SkillPhaseState, side: Side): OptionAvailability[] {
  return computeLaneAvailability(state, side);
}

function withUpdatedState<T extends Partial<SkillPhaseState>>(
  state: SkillPhaseState,
  updates: T
): SkillPhaseState {
  const next: InternalState = {
    ...(state as InternalState),
    ...updates,
  };
  return next;
}

function beginActivation(state: SkillPhaseState, side: Side, laneIndex: number): SkillPhaseState {
  const lane = state.lanes.find((l) => l.index === laneIndex && l.side === side);
  if (!lane) {
    throw new Error(`Lane ${laneIndex} not found for ${side}`);
  }
  if (state.activeSide !== side || state.playLocked[side]) {
    throw new Error("Cannot activate without play");
  }
  if (!lane.card) {
    throw new Error("Lane has no card to activate");
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
  const targeting = {
    laneIndex,
    ability: options.ability,
    targetSpec: options.targetSpec,
    selectedTargets: [],
    snapshotBefore: snapshot,
    side,
    cardId: lane.card.id,
  };
  const next = withUpdatedState(state, { targeting });
  applyUi(next, "log", `Begin activation from lane ${laneIndex}`);
  applyUi(next, "onStateChange", next);
  return next;
}

function pickTarget(state: SkillPhaseState, target: string | number): SkillPhaseState {
  if (!state.targeting) {
    throw new Error("No targeting in progress");
  }
  const targeting = state.targeting;
  if (targeting.selectedTargets.length >= targeting.targetSpec.count) {
    throw new Error("All targets already selected");
  }
  const stageIndex = targeting.selectedTargets.length;
  const stageKind = targetKindForIndex(targeting.targetSpec, stageIndex);
  if (stageKind === "reserve" && typeof target !== "string") {
    throw new Error("Expected reserve card target");
  }
  if (stageKind === "friendlyLane" && typeof target !== "number") {
    throw new Error("Expected lane index target");
  }
  const nextTargets = [...targeting.selectedTargets, target];
  const targetingNext = { ...targeting, selectedTargets: nextTargets };
  const next = withUpdatedState(state, { targeting: targetingNext });
  applyUi(next, "onStateChange", next);
  return next;
}

function cancelTargeting(state: SkillPhaseState): SkillPhaseState {
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

function findReserveIndex(reserves: Card[], cardId: string): number {
  return reserves.findIndex((card) => card.id === cardId);
}

function consumeLaneUse(
  lanes: Lane[],
  laneIndex: number,
  side: Side,
  cardId: string,
): Lane[] {
  const updated = cloneLanes(lanes);
  const lane =
    updated.find((l) => l.card?.id === cardId && l.side === side) ??
    updated.find((l) => l.index === laneIndex && l.side === side);
  if (lane) {
    lane.usesRemaining = Math.max(0, lane.usesRemaining - 1);
    lane.exhausted = lane.usesRemaining <= 0;
    lane.ability = assignLaneAbility(lane.card);
  }
  return updated;
}

function applySwapReserve(
  state: SkillPhaseState,
  laneIndex: number,
  targetLaneIndex: number,
  cardId: string
): SkillPhaseState {
  const lane = state.lanes.find((l) => l.index === laneIndex);
  if (!lane || !lane.card) throw new Error("Invalid swap lane");
  const side = lane.side;
  const targetLane = state.lanes.find((l) => l.index === targetLaneIndex && l.side === side);
  if (!targetLane) throw new Error("Invalid target lane");
  const reserves = cloneReserves(state.reserves);
  const reserve = reserves[side];
  const idx = findReserveIndex(reserve, cardId);
  if (idx === -1) throw new Error("Reserve card not found");
  const [reserveCard] = reserve.splice(idx, 1);
  const displaced = targetLane.card ? { ...targetLane.card } : null;
  if (displaced) {
    reserve.push(displaced);
  }
  const lanes = cloneLanes(state.lanes);
  const laneMut = lanes.find((l) => l.index === targetLaneIndex && l.side === side);
  if (!laneMut) throw new Error("Target lane missing");
  laneMut.card = { ...reserveCard };
  laneMut.boost = targetLane.boost;
  laneMut.ability = assignLaneAbility(laneMut.card);
  const updatedLimits = cloneLimits(state.limits);
  return withUpdatedState(state, {
    lanes,
    reserves,
    limits: updatedLimits,
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
  const targetLane = state.lanes.find((l) => l.index === targetLaneIndex && l.side === sourceLane.side);
  if (!targetLane) throw new Error("Invalid target lane");
  const lanes = cloneLanes(state.lanes);
  const targetMut = lanes.find((l) => l.index === targetLaneIndex && l.side === sourceLane.side)!;
  targetMut.boost += sourceLane.card.printed;
  return withUpdatedState(state, { lanes });
}

function applyReserveBoost(
  state: SkillPhaseState,
  laneIndex: number,
  targetLaneIndex: number,
  cardId: string
): SkillPhaseState {
  const lane = state.lanes.find((l) => l.index === laneIndex);
  if (!lane || !lane.card) throw new Error("Invalid lane");
  const side = lane.side;
  const reserves = cloneReserves(state.reserves);
  const reserve = reserves[side];
  const idx = findReserveIndex(reserve, cardId);
  if (idx === -1) throw new Error("Reserve card not found");
  const [chosen] = reserve.splice(idx, 1);
  if (chosen.printed <= 0) {
    throw new Error("Reserve boost requires positive value");
  }
  const lanes = cloneLanes(state.lanes);
  const laneMut = lanes.find((l) => l.index === targetLaneIndex && l.side === side);
  if (!laneMut || !laneMut.card) {
    throw new Error("Invalid boost lane");
  }
  laneMut.boost += chosen.printed;
  return withUpdatedState(state, { lanes, reserves });
}

function confirmActivation(state: SkillPhaseState): SkillPhaseState {
  const targeting = state.targeting;
  if (!targeting) {
    throw new Error("No targeting to confirm");
  }
  if (targeting.selectedTargets.length !== targeting.targetSpec.count) {
    throw new Error("Targets incomplete");
  }
  const { laneIndex, side, cardId } = targeting;
  let nextState: SkillPhaseState = state;
  switch (targeting.ability) {
    case "swapReserve": {
      const [reserveTarget, laneTarget] = targeting.selectedTargets;
      nextState = applySwapReserve(
        nextState,
        laneIndex,
        Number(laneTarget),
        String(reserveTarget)
      );
      break;
    }
    case "rerollReserve":
      nextState = applyRerollReserve(nextState, laneIndex, String(targeting.selectedTargets[0]));
      break;
    case "boostCard":
      nextState = applyBoostCard(nextState, laneIndex, Number(targeting.selectedTargets[0]));
      break;
    case "reserveBoost": {
      const [reserveTarget, laneTarget] = targeting.selectedTargets;
      nextState = applyReserveBoost(
        nextState,
        laneIndex,
        Number(laneTarget),
        String(reserveTarget)
      );
      break;
    }
    default:
      throw new Error("Unknown ability");
  }
  const lanesAfter = consumeLaneUse(nextState.lanes, laneIndex, side, cardId);
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

function pass(state: SkillPhaseState, side: Side): SkillPhaseState {
  const nextPassed = { ...state.passed, [side]: true };
  const nextLocked = { ...state.playLocked, [side]: true };
  const nextState = withUpdatedState(state, { passed: nextPassed, playLocked: nextLocked });
  applyUi(nextState, "log", `${side} passes`);
  const advanced = advanceTurn(nextState, false);
  applyUi(advanced, "onStateChange", advanced);
  return advanced;
}

function advanceTurn(state: SkillPhaseState, fromAction: boolean = false): SkillPhaseState {
  const current = state.activeSide;
  const opponent = otherSide(current);
  const currentOptions = computeLaneAvailability(state, current);
  const opponentOptions = computeLaneAvailability(state, opponent);
  const currentHas = currentOptions.some((o) => o.available);
  const opponentHas = opponentOptions.some((o) => o.available);

  let newPassed = { ...state.passed };
  let newLocked = { ...state.playLocked };
  if (fromAction) {
    newPassed[current] = false;
  }

  const currentLocked = newLocked[current];
  const opponentLocked = newLocked[opponent];

  const currentEligible = !currentLocked && currentHas;
  const opponentEligible = !opponentLocked && opponentHas;

  if (!currentEligible && !opponentEligible) {
    newPassed = { you: true, rival: true };
    const ended = withUpdatedState(state, { passed: newPassed, playLocked: newLocked });
    applyUi(ended, "banner", "Skill Phase ends.");
    return ended;
  }
  if ((state.passed[current] && state.passed[opponent]) || (currentLocked && opponentLocked)) {
    const ended = withUpdatedState(state, { passed: newPassed, playLocked: newLocked });
    applyUi(ended, "banner", "Skill Phase ends.");
    return ended;
  }

  let nextActive: Side = state.activeSide;

  if (fromAction) {
    if (opponentEligible) {
      nextActive = opponent;
    } else if (currentEligible) {
      nextActive = current;
    }
  } else {
    if (state.passed[current] || currentLocked || !currentHas) {
      if (opponentEligible) {
        nextActive = opponent;
      } else if (currentEligible) {
        nextActive = current;
      }
    }
  }

  return withUpdatedState(state, {
    activeSide: nextActive,
    passed: newPassed,
    playLocked: newLocked,
  });
}

function evaluateLaneScore(lane: Lane, opponentLane: Lane | undefined): number {
  if (!lane.card) return 0;
  const laneValue = lane.card.printed + lane.boost;
  const opponentValue = opponentLane && opponentLane.card ? opponentLane.card.printed + opponentLane.boost : 0;
  return laneValue - opponentValue;
}

function aiChooseAction(
  state: SkillPhaseState,
  side: Side
): { type: "activate" | "pass"; laneIndex?: number; chosenTargets?: Array<string | number> } {
  const options = computeLaneAvailability(state, side).filter((o) => o.available && o.ability);
  let bestScore = -Infinity;
  let bestAction: { type: "activate" | "pass"; laneIndex?: number; chosenTargets?: Array<string | number> } = {
    type: "pass",
  };
  for (const option of options) {
    const lane = state.lanes.find((l) => l.index === option.laneIndex && l.side === side);
    if (!lane || !lane.card || !option.ability) continue;
    let score = 0;
    switch (option.ability) {
      case "reserveBoost": {
        const reserves = state.reserves[side].filter((c) => c.printed > 0);
        if (reserves.length === 0) break;
        const bestReserve = reserves.reduce((a, b) => (a.printed > b.printed ? a : b));
        score = bestReserve.printed * 2;
        break;
      }
      case "boostCard": {
        const opponentLane = state.lanes.find((l) => l.side === otherSide(side) && l.index === lane.index);
        const currentScore = evaluateLaneScore(lane, opponentLane);
        score = lane.card.printed;
        if (currentScore > 5) score -= 5;
        break;
      }
      case "swapReserve": {
        const reserves = state.reserves[side];
        if (reserves.length === 0) break;
        const best = reserves.reduce((a, b) => (a.printed > b.printed ? a : b));
        const delta = best.printed - lane.card.printed;
        if (delta <= 0) {
          score = -1;
        } else {
          score = delta;
        }
        break;
      }
      case "rerollReserve": {
        score = 0.5;
        break;
    }
    }
    if (score > bestScore && score > 0) {
      bestScore = score;
      let chosenTargets: Array<string | number> | undefined;
      if (option.ability === "boostCard") {
        chosenTargets = [lane.index];
      } else if (option.ability === "reserveBoost") {
        const reserves = state.reserves[side].filter((c) => c.printed > 0);
        if (reserves.length > 0) {
          const bestReserve = reserves.reduce((a, b) => (a.printed > b.printed ? a : b));
          chosenTargets = [bestReserve.id, lane.index];
        }
      } else if (option.ability === "swapReserve") {
        const reserves = state.reserves[side];
        if (reserves.length > 0) {
          const bestReserve = reserves.reduce((a, b) => (a.printed > b.printed ? a : b));
          chosenTargets = [bestReserve.id, lane.index];
        }
      } else if (option.ability === "rerollReserve") {
        const reserves = state.reserves[side];
        if (reserves[0]) {
          chosenTargets = [reserves[0].id];
        }
      }
      if (
        chosenTargets &&
        chosenTargets.length === abilityTargetSpecs[option.ability].count
      ) {
        bestAction = { type: "activate", laneIndex: option.laneIndex, chosenTargets };
      }
    }
  }
  return bestAction;
}

// --- Test Runner ---

type TestCase = { name: string; run: () => void | Promise<void> };
const tests: TestCase[] = [];

function test(name: string, run: () => void | Promise<void>) {
  tests.push({ name, run });
}

function expect(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function deepEqual(a: any, b: any): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// --- Tests ---

test("Phase entry banners for active starter", () => {
  const messages: string[] = [];
  const state = initSkillPhase(
    [
      { side: "you", index: 0, card: { id: "a", printed: 3 } },
      { side: "rival", index: 0, card: { id: "b", printed: 3 } },
    ],
    { you: [{ id: "ry1", printed: 2 }], rival: [{ id: "rr1", printed: 2 }] },
    "you",
    1,
    {
      banner: (msg) => messages.push(msg),
    }
  );
  expect(messages[0] === "Skill Phase begins. You act first.", "Starter banner incorrect");
  expect(state.activeSide === "you", "Starter should keep initiative");
});

test("Phase entry hands initiative when starter lacks actions", () => {
  const messages: string[] = [];
  const state = initSkillPhase(
    [
      { side: "you", index: 0, card: { id: "a", printed: 0 } },
      { side: "rival", index: 0, card: { id: "b", printed: 3 } },
    ],
    { you: [], rival: [{ id: "rr1", printed: 2 }] },
    "you",
    5,
    {
      banner: (msg) => messages.push(msg),
    }
  );
  expect(messages[0] === "You have no skill actions—opponent starts.", "Hand-over banner incorrect");
  expect(state.activeSide === "rival", "Opponent should act first");
});

test("Phase skips entirely when no actions", () => {
  const messages: string[] = [];
  const state = initSkillPhase(
    [
      { side: "you", index: 0, card: { id: "a", printed: 0 } },
      { side: "rival", index: 0, card: { id: "b", printed: 0 } },
    ],
    { you: [], rival: [] },
    "you",
    1,
    {
      banner: (msg) => messages.push(msg),
    }
  );
  expect(messages[0] === "No skill actions available.", "Skip banner incorrect");
  expect(state.passed.you && state.passed.rival, "Both should be marked passed");
});

test("Reserve boost only available with positive reserve", () => {
  const state = initSkillPhase(
    [
      { side: "you", index: 0, card: { id: "a", printed: 5 } },
    ],
    { you: [{ id: "neg", printed: -1 }], rival: [] },
    "you",
    2
  );
  const options1 = getOptions(state, "you");
  expect(!options1[0].available && options1[0].reason === "no positive reserve", "Should be unavailable without positive reserve");
  const withPositive = withUpdatedState(state, {
    reserves: { you: [{ id: "pos", printed: 3 }], rival: [] },
  });
  const options2 = getOptions(withPositive, "you");
  expect(options2[0].available, "Should be available with positive reserve");
});

test("Reroll greys out after two uses", () => {
  const baseState = initSkillPhase(
    [
      { side: "you", index: 0, card: { id: "a", printed: 1 } },
    ],
    { you: [{ id: "r1", printed: 2 }], rival: [] },
    "you",
    10
  );
  const afterTwo = withUpdatedState(baseState, {
    limits: { rerollsUsed: { you: 2, rival: 0 } },
  });
  const options = getOptions(afterTwo, "you");
  expect(!options[0].available && options[0].reason === "phase reroll limit reached", "Reroll should be unavailable after two uses");
});

test("Targeting cancel restores snapshot", () => {
  let state = initSkillPhase(
    [
      { side: "you", index: 0, card: { id: "a", printed: 5 } },
    ],
    { you: [{ id: "boost", printed: 2 }], rival: [] },
    "you",
    9
  );
  state = beginActivation(state, "you", 0);
  state = pickTarget(state, "boost");
  const cancelled = cancelTargeting(state);
  expect(!cancelled.targeting, "Targeting should be cleared");
  expect(cancelled.reserves.you.some((c) => c.id === "boost"), "Reserve should be restored after cancel");
});

test("Confirm activation consumes use and updates state", () => {
  let state = initSkillPhase(
    [
      { side: "you", index: 0, card: { id: "a", printed: 5 } },
    ],
    { you: [{ id: "boost", printed: 3 }], rival: [] },
    "you",
    9
  );
  state = beginActivation(state, "you", 0);
  state = pickTarget(state, "boost");
  state = pickTarget(state, 0);
  state = confirmActivation(state);
  const lane = state.lanes.find((l) => l.index === 0)!;
  expect(lane.boost === 3, "Boost should be applied");
  expect(lane.usesRemaining === 0, "Use should be consumed");
});

test("Turn advances only when opponent can act", () => {
  let state = initSkillPhase(
    [
      { side: "you", index: 0, card: { id: "a", printed: 5 } },
      { side: "rival", index: 0, card: { id: "b", printed: 0 } },
    ],
    { you: [{ id: "boost", printed: 2 }], rival: [] },
    "you",
    9
  );
  state = beginActivation(state, "you", 0);
  state = pickTarget(state, "boost");
  state = pickTarget(state, 0);
  state = confirmActivation(state);
  expect(state.activeSide === "you", "Active side should remain when opponent lacks actions");
});

test("Activation requires play", () => {
  const base = initSkillPhase(
    [
      { side: "you", index: 0, card: { id: "a", printed: 5 } },
    ],
    { you: [{ id: "boost", printed: 3 }], rival: [] },
    "you",
    13,
  );
  const rivalTurn = withUpdatedState(base, { activeSide: "rival" });
  let threw = false;
  try {
    void beginActivation(rivalTurn, "you", 0);
  } catch (err) {
    threw = String(err).includes("play");
  }
  expect(threw, "Should block activation when lacking play");
});

test("Play passes to opponent after activation", () => {
  let state = initSkillPhase(
    [
      { side: "you", index: 0, card: { id: "you", printed: 5 } },
      { side: "rival", index: 0, card: { id: "them", printed: 3 } },
    ],
    {
      you: [{ id: "boost", printed: 3 }],
      rival: [{ id: "reserve", printed: 2 }],
    },
    "you",
    21,
  );
  state = beginActivation(state, "you", 0);
  state = pickTarget(state, "boost");
  state = pickTarget(state, 0);
  state = confirmActivation(state);
  expect(state.activeSide === "rival", "Play should hand off after activation");
});

test("Passing yields play for the rest of the round", () => {
  let state = initSkillPhase(
    [
      { side: "you", index: 0, card: { id: "you", printed: 5 } },
      { side: "rival", index: 0, card: { id: "them", printed: 5 } },
    ],
    {
      you: [{ id: "boost", printed: 3 }],
      rival: [{ id: "other", printed: 2 }],
    },
    "you",
    33,
  );
  state = pass(state, "you");
  expect(state.activeSide === "rival", "Passing should hand play to opponent");
  state = beginActivation(state, "rival", 0);
  state = pickTarget(state, "other");
  state = pickTarget(state, 0);
  state = confirmActivation(state);
  expect(state.activeSide === "rival", "Opponent should retain play after acting");
  let blocked = false;
  try {
    void beginActivation(state, "you", 0);
  } catch (err) {
    blocked = String(err).includes("play");
  }
  expect(blocked, "Passing should prevent further activations");
});

test("Swap reserve exchanges cards", () => {
  let state = initSkillPhase(
    [
      { side: "you", index: 0, card: { id: "lane", printed: 0 } },
    ],
    { you: [{ id: "res", printed: 4 }], rival: [] },
    "you",
    4
  );
  state = beginActivation(state, "you", 0);
  state = pickTarget(state, "res");
  state = pickTarget(state, 0);
  state = confirmActivation(state);
  const lane = state.lanes.find((l) => l.index === 0)!;
  expect(lane.card?.id === "res", "Lane card should now be reserve card");
  expect(state.reserves.you.some((c) => c.id === "lane"), "Reserve should contain swapped card");
});

test("Reroll increments limit and draws deterministically", () => {
  let state = initSkillPhase(
    [
      { side: "you", index: 0, card: { id: "lane", printed: 1 } },
    ],
    { you: [{ id: "res", printed: 1 }], rival: [] },
    "you",
    1234
  );
  state = beginActivation(state, "you", 0);
  const targetId = state.reserves.you[0].id;
  state = pickTarget(state, targetId);
  state = confirmActivation(state);
  expect(state.limits.rerollsUsed.you === 1, "Reroll count should increase");
  expect(state.reserves.you.length === 1, "Reserve size should stay the same");
});

test("Boost card adds printed value", () => {
  let state = initSkillPhase(
    [
      { side: "you", index: 0, card: { id: "lane", printed: 3 } },
      { side: "you", index: 1, card: { id: "ally", printed: 2 } },
    ],
    { you: [], rival: [] },
    "you",
    11
  );
  state = beginActivation(state, "you", 0);
  state = pickTarget(state, 1);
  state = confirmActivation(state);
  const lane = state.lanes.find((l) => l.index === 1)!;
  expect(lane.boost === 3, "Target lane should gain boost");
});

test("Reserve boost removes reserve card", () => {
  let state = initSkillPhase(
    [
      { side: "you", index: 0, card: { id: "lane", printed: 5 } },
    ],
    { you: [{ id: "boost", printed: 3 }], rival: [] },
    "you",
    9
  );
  state = beginActivation(state, "you", 0);
  state = pickTarget(state, "boost");
  state = pickTarget(state, 0);
  state = confirmActivation(state);
  expect(state.reserves.you.length === 0, "Reserve card should be consumed");
  const boostedLane = state.lanes.find((l) => l.index === 0)!;
  expect(boostedLane.boost === 3, "Selected lane should gain the reserve boost");
});

test("Reserve boost can target a different friendly lane", () => {
  let state = initSkillPhase(
    [
      { side: "you", index: 0, card: { id: "lane", printed: 5 } },
      { side: "you", index: 1, card: { id: "ally", printed: 2 } },
    ],
    { you: [{ id: "boost", printed: 3 }], rival: [] },
    "you",
    12
  );
  state = beginActivation(state, "you", 0);
  state = pickTarget(state, "boost");
  state = pickTarget(state, 1);
  state = confirmActivation(state);
  const boostedAlly = state.lanes.find((l) => l.index === 1)!;
  expect(boostedAlly.boost === 3, "Reserve boost should apply to the chosen lane");
  expect(state.lanes.find((l) => l.index === 0)?.boost === 0, "Source lane boost should remain unchanged");
});

test("AI prefers deterministic boost", () => {
  const state = initSkillPhase(
    [
      { side: "rival", index: 0, card: { id: "lane", printed: 5 } },
      { side: "you", index: 0, card: { id: "opp", printed: 6 } },
    ],
    { you: [], rival: [{ id: "boost", printed: 3 }] },
    "you",
    20
  );
  const action = aiChooseAction(state, "rival");
  const [firstTarget, laneTarget] = action.chosenTargets ?? [];
  expect(
    action.type === "activate" &&
      action.laneIndex === 0 &&
      firstTarget === "boost" &&
      laneTarget === 0,
    "AI should choose reserve boost and target its lane"
  );
});

test("Deterministic outcomes with same seed", () => {
  const stateA1 = initSkillPhase(
    [
      { side: "you", index: 0, card: { id: "lane", printed: 1 } },
    ],
    { you: [{ id: "res", printed: 1 }], rival: [] },
    "you",
    77
  );
  let a = beginActivation(stateA1, "you", 0);
  a = pickTarget(a, "res");
  a = confirmActivation(a);

  const stateB1 = initSkillPhase(
    [
      { side: "you", index: 0, card: { id: "lane", printed: 1 } },
    ],
    { you: [{ id: "res", printed: 1 }], rival: [] },
    "you",
    77
  );
  let b = beginActivation(stateB1, "you", 0);
  b = pickTarget(b, "res");
  b = confirmActivation(b);

  expect(deepEqual(a, b), "States should match for identical seeds and actions");
});

async function run() {
  let passed = 0;
  for (const t of tests) {
    try {
      await t.run();
      console.log(`✔ ${t.name}`);
      passed += 1;
    } catch (err) {
      console.error(`✘ ${t.name}`);
      console.error(err);
      process.exitCode = 1;
    }
  }
  console.log(`${passed}/${tests.length} tests passed`);
}

run();

export type {
  AbilityKind,
  AbilityConfig,
  SkillPhaseState,
  UiEvents,
};

export {
  deriveAbilityForCard,
  computeLaneAvailability,
  initSkillPhase,
  getOptions,
  beginActivation,
  pickTarget,
  cancelTargeting,
  confirmActivation,
  pass,
  advanceTurn,
  aiChooseAction,
  makeRng,
  drawCard,
};
