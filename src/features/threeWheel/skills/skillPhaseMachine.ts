import type { Card, LegacySide } from "../../../game/types";
import {
  determineSkillAbility,
  getSkillMaxUses,
  type SkillAbility,
} from "../../../game/skills";

export type SkillSideState<T> = Record<LegacySide, T>;

export type SkillLaneState = {
  cardId: string | null;
  ability: SkillAbility | null;
  usesRemaining: number;
  exhausted: boolean;
};

export type SkillPhaseState = {
  activeSide: LegacySide;
  lanes: SkillSideState<[
    SkillLaneState,
    SkillLaneState,
    SkillLaneState,
  ]>;
  passed: SkillSideState<boolean>;
};

export type SkillPhaseSnapshot = {
  activeSide: LegacySide;
  exhausted: SkillSideState<[boolean, boolean, boolean]>;
  usesRemaining: SkillSideState<[number, number, number]>;
  passed: SkillSideState<boolean>;
};

function createLaneState(card: Card | null): SkillLaneState {
  const ability = determineSkillAbility(card);
  const usesRemaining = ability ? getSkillMaxUses(card) : 0;
  return {
    cardId: card?.id ?? null,
    ability,
    usesRemaining,
    exhausted: !ability || usesRemaining <= 0,
  };
}

function cloneLaneArray(lanes: [SkillLaneState, SkillLaneState, SkillLaneState]) {
  return [...lanes] as [SkillLaneState, SkillLaneState, SkillLaneState];
}

function updateLane(
  state: SkillPhaseState,
  side: LegacySide,
  laneIndex: number,
  lane: SkillLaneState,
): SkillPhaseState {
  const nextLanes = cloneLaneArray(state.lanes[side]);
  nextLanes[laneIndex] = lane;
  return {
    ...state,
    lanes: { ...state.lanes, [side]: nextLanes },
  };
}

export function createSkillPhaseState(
  assign: SkillSideState<(Card | null)[]>,
  initiative: LegacySide,
): SkillPhaseState | null {
  const playerLanes = assign.player.map((card) => createLaneState(card)) as [
    SkillLaneState,
    SkillLaneState,
    SkillLaneState,
  ];
  const enemyLanes = assign.enemy.map((card) => createLaneState(card)) as [
    SkillLaneState,
    SkillLaneState,
    SkillLaneState,
  ];

  const state: SkillPhaseState = {
    activeSide: initiative,
    lanes: { player: playerLanes, enemy: enemyLanes },
    passed: { player: false, enemy: false },
  };

  const currentHas = lanesHavePotentialActions(state.lanes[state.activeSide]);
  const otherSide: LegacySide = state.activeSide === "player" ? "enemy" : "player";
  const otherHas = lanesHavePotentialActions(state.lanes[otherSide]);

  if (!currentHas && !otherHas) {
    return null;
  }

  if (!currentHas && otherHas) {
    return { ...state, activeSide: otherSide };
  }

  return state;
}

function lanesHavePotentialActions(lanes: [SkillLaneState, SkillLaneState, SkillLaneState]): boolean {
  return lanes.some((lane) => lane.ability && !lane.exhausted && lane.usesRemaining > 0);
}

export function toSnapshot(state: SkillPhaseState): SkillPhaseSnapshot {
  const exhausted: SkillSideState<[boolean, boolean, boolean]> = {
    player: state.lanes.player.map((lane) => lane.exhausted) as [boolean, boolean, boolean],
    enemy: state.lanes.enemy.map((lane) => lane.exhausted) as [boolean, boolean, boolean],
  };
  const usesRemaining: SkillSideState<[number, number, number]> = {
    player: state.lanes.player.map((lane) => lane.usesRemaining) as [number, number, number],
    enemy: state.lanes.enemy.map((lane) => lane.usesRemaining) as [number, number, number],
  };

  return {
    activeSide: state.activeSide,
    exhausted,
    usesRemaining,
    passed: state.passed,
  };
}

export function decrementSkillUse(
  state: SkillPhaseState,
  side: LegacySide,
  laneIndex: number,
): SkillPhaseState {
  const lane = state.lanes[side][laneIndex];
  if (!lane) return state;
  if (lane.usesRemaining <= 0) {
    return state;
  }
  const nextLane: SkillLaneState = {
    ...lane,
    usesRemaining: lane.usesRemaining - 1,
  };
  return updateLane(state, side, laneIndex, nextLane);
}

export function applyExhaustion(
  state: SkillPhaseState,
  side: LegacySide,
  laneIndex: number,
): SkillPhaseState {
  const lane = state.lanes[side][laneIndex];
  if (!lane) return state;
  const shouldExhaust = !lane.ability || lane.usesRemaining <= 0;
  if (lane.exhausted === shouldExhaust) {
    return state;
  }
  const nextLane: SkillLaneState = {
    ...lane,
    exhausted: shouldExhaust,
  };
  return updateLane(state, side, laneIndex, nextLane);
}

export function markPassed(
  state: SkillPhaseState,
  side: LegacySide,
): SkillPhaseState {
  if (state.passed[side]) return state;
  return {
    ...state,
    passed: { ...state.passed, [side]: true },
  };
}

export function hasSkillActions(
  state: SkillPhaseState,
  side: LegacySide,
  canUseAbility: (lane: SkillLaneState, laneIndex: number) => boolean,
): boolean {
  if (state.passed[side]) return false;
  const lanes = state.lanes[side];
  return lanes.some((lane, index) => {
    if (!lane.ability || lane.exhausted || lane.usesRemaining <= 0) {
      return false;
    }
    return canUseAbility(lane, index);
  });
}

export function advanceSkillTurn(
  state: SkillPhaseState,
  opts: {
    canUseAbility: (side: LegacySide, laneIndex: number, ability: SkillAbility) => boolean;
  },
): { state: SkillPhaseState | null; finished: boolean } {
  const { canUseAbility } = opts;
  const current = state.activeSide;
  const other: LegacySide = current === "player" ? "enemy" : "player";

  const currentHas = hasSkillActions(state, current, (lane, index) =>
    canUseAbility(current, index, lane.ability!),
  );
  const otherHas = hasSkillActions(state, other, (lane, index) =>
    canUseAbility(other, index, lane.ability!),
  );

  if (!currentHas && !otherHas) {
    return { state: null, finished: true };
  }

  let nextSide: LegacySide = current;
  if (!currentHas && otherHas) {
    nextSide = other;
  } else if (currentHas && !otherHas) {
    nextSide = current;
  } else if (otherHas) {
    nextSide = other;
  }

  const nextHas = hasSkillActions(state, nextSide, (lane, index) =>
    canUseAbility(nextSide, index, lane.ability!),
  );
  if (!nextHas) {
    const fallback: LegacySide = nextSide === current ? other : current;
    const fallbackHas = hasSkillActions(state, fallback, (lane, index) =>
      canUseAbility(fallback, index, lane.ability!),
    );
    if (!fallbackHas) {
      return { state: null, finished: true };
    }
    nextSide = fallback;
  }

  if (nextSide !== state.activeSide) {
    return { state: { ...state, activeSide: nextSide }, finished: false };
  }

  return { state, finished: false };
}
