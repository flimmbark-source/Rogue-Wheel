import type { AbilityKind } from "../../../game/skills.js";
import { determineSkillAbility } from "../../../game/skills.js";
import type { Card, LegacySide } from "../../../game/types.js";

export type SkillLane = {
  ability: AbilityKind | null;
  cardId: string | null;
  exhausted: boolean;
  usesRemaining: number;
};

export type SkillCardStatus = {
  ability: AbilityKind | null;
  exhausted: boolean;
  usesRemaining: number;
};

export type SkillState = {
  enabled: boolean;
  completed: boolean;
  lanes: Record<LegacySide, SkillLane[]>;
  cardStatus: Record<string, SkillCardStatus>;
};

export const createEmptySkillLane = (): SkillLane => ({
  ability: null,
  cardId: null,
  exhausted: true,
  usesRemaining: 0,
});

const INITIAL_SKILL_USES: Record<AbilityKind, number> = {
  swapReserve: 1,
  rerollReserve: 2,
  boostCard: 1,
  reserveBoost: 1,
};

const getInitialSkillUses = (ability: AbilityKind | null): number => {
  if (!ability) return 0;
  return INITIAL_SKILL_USES[ability] ?? 1;
};

export const createSkillLanes = (): Record<LegacySide, SkillLane[]> => ({
  player: [createEmptySkillLane(), createEmptySkillLane(), createEmptySkillLane()],
  enemy: [createEmptySkillLane(), createEmptySkillLane(), createEmptySkillLane()],
});

const EMPTY_LANE_TEMPLATE = createEmptySkillLane();

const lanesEqual = (a: SkillLane, b: SkillLane): boolean =>
  a.ability === b.ability &&
  a.cardId === b.cardId &&
  a.exhausted === b.exhausted &&
  a.usesRemaining === b.usesRemaining;

export const createSkillState = (isSkillMode: boolean): SkillState => ({
  enabled: isSkillMode,
  completed: !isSkillMode,
  lanes: createSkillLanes(),
  cardStatus: {},
});

export const reconcileSkillStateWithAssignments = (
  prev: SkillState,
  assign: { player: (Card | null)[]; enemy: (Card | null)[] },
  isSkillMode: boolean,
): SkillState => {
  if (!isSkillMode) {
    if (!prev.enabled && prev.completed && Object.keys(prev.cardStatus).length === 0) {
      const lanes = prev.lanes;
      const playerPristine = lanes.player.every((lane) => lanesEqual(lane, EMPTY_LANE_TEMPLATE));
      const enemyPristine = lanes.enemy.every((lane) => lanesEqual(lane, EMPTY_LANE_TEMPLATE));
      if (playerPristine && enemyPristine) {
        return prev;
      }
    }
    return createSkillState(false);
  }

  let changed = prev.enabled !== isSkillMode;
  let cardStatusChanged = false;
  let nextCardStatus = prev.cardStatus;

  const nextLanes: Record<LegacySide, SkillLane[]> = {
    player: [...prev.lanes.player],
    enemy: [...prev.lanes.enemy],
  };

  const ensureCardStatusClone = () => {
    if (!cardStatusChanged) {
      nextCardStatus = { ...nextCardStatus };
      cardStatusChanged = true;
    }
  };

  const updateLane = (side: LegacySide, laneIndex: number, lane: SkillLane) => {
    const previous = prev.lanes[side][laneIndex];
    if (!previous || !lanesEqual(previous, lane)) {
      nextLanes[side][laneIndex] = lane;
      changed = true;
    }
  };

  const applyCard = (side: LegacySide, laneIndex: number, card: Card | null) => {
    if (!card) {
      updateLane(side, laneIndex, createEmptySkillLane());
      return;
    }

    const ability: AbilityKind | null = determineSkillAbility(card);
    const cardId = card.id;

    let status = nextCardStatus[cardId];
    if (!status || status.ability !== ability) {
      ensureCardStatusClone();
      status = {
        ability,
        exhausted: ability ? false : true,
        usesRemaining: getInitialSkillUses(ability),
      };
      nextCardStatus[cardId] = status;
    }

    const desiredLane: SkillLane = {
      ability,
      cardId,
      exhausted: status.exhausted,
      usesRemaining: status.usesRemaining,
    };

    updateLane(side, laneIndex, desiredLane);
  };

  const sides: LegacySide[] = ["player", "enemy"];
  for (const side of sides) {
    const source = side === "player" ? assign.player : assign.enemy;
    for (let i = 0; i < nextLanes[side].length; i++) {
      applyCard(side, i, source[i] ?? null);
    }
  }

  if (!changed && !cardStatusChanged) {
    return prev;
  }

  return {
    enabled: true,
    completed: prev.completed,
    lanes: nextLanes,
    cardStatus: nextCardStatus,
  };
};
