import assert from "assert";
import type { Card } from "../src/game/types.js";
import {
  createSkillState,
  getSkillCardStatusKey,
  reconcileSkillStateWithAssignments,
} from "../src/features/threeWheel/hooks/skillState.js";

const makeAssignment = (
  player: Array<Card | null>,
  enemy: Array<Card | null>,
) => ({ player, enemy });

const createSkillCard = (id: string, value: number): Card => ({
  id,
  name: `Skill ${id}`,
  tags: [],
  baseNumber: value,
  number: value,
});

(function skillExhaustionFollowsCardAcrossLanes() {
  const skillCard = createSkillCard("skill", 0);
  let skillState = createSkillState(true);

  skillState = reconcileSkillStateWithAssignments(
    skillState,
    makeAssignment([skillCard, null, null], [null, null, null]),
    true,
  );

  const initialLane = skillState.lanes.player[0];
  assert.equal(initialLane?.ability, "swapReserve");
  assert.equal(initialLane?.exhausted, false);
  assert.equal(initialLane?.usesRemaining, 1);

  const exhaustedCardStatus = {
    ability: "swapReserve" as const,
    exhausted: true,
    usesRemaining: 0,
  };
  const exhaustedLane = {
    ...initialLane,
    exhausted: true,
    usesRemaining: 0,
  };

  const statusKey = getSkillCardStatusKey("player", skillCard.id);

  skillState = {
    ...skillState,
    cardStatus: { ...skillState.cardStatus, [statusKey]: exhaustedCardStatus },
    lanes: {
      ...skillState.lanes,
      player: [exhaustedLane, ...skillState.lanes.player.slice(1)],
    },
  };

  skillState = reconcileSkillStateWithAssignments(
    skillState,
    makeAssignment([null, skillCard, null], [null, null, null]),
    true,
  );

  const destinationLane = skillState.lanes.player[1];
  assert.equal(destinationLane?.cardId, skillCard.id);
  assert.equal(destinationLane?.exhausted, true);
  assert.equal(destinationLane?.usesRemaining, 0);

  console.log("skill card exhaustion follows card across lanes test passed");
})();
