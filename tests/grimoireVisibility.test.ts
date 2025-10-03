import assert from "node:assert/strict";

import {
  GRIMOIRE_SPELL_REQUIREMENTS,
  createEmptySymbolMap,
  getVisibleSpellsForHand,
  handMeetsVisibilityRequirement,
} from "../src/game/grimoire.js";
import type { GrimoireSymbols } from "../src/game/grimoire.js";

const makeHand = (values: Partial<GrimoireSymbols>): GrimoireSymbols => {
  const base = createEmptySymbolMap();
  for (const [arcana, amount] of Object.entries(values)) {
    if (!arcana || typeof amount !== "number") continue;
    const key = arcana as keyof GrimoireSymbols;
    base[key] = amount;
  }
  return base;
};

// Single-symbol spells only require that symbol to appear in hand.
{
  const fireOnly = makeHand({ fire: 1 });
  assert.equal(
    handMeetsVisibilityRequirement(fireOnly, GRIMOIRE_SPELL_REQUIREMENTS.fireball),
    true,
    "fireball should appear when a fire symbol is present",
  );

  const noFire = makeHand({ fire: 0 });
  assert.equal(
    handMeetsVisibilityRequirement(noFire, GRIMOIRE_SPELL_REQUIREMENTS.fireball),
    false,
    "fireball should not appear without any fire symbols",
  );
}

// Multi-symbol spells require at least two of their required symbol types to appear.
{
  const fireAndMoon = makeHand({ fire: 1, moon: 1 });
  assert.equal(
    handMeetsVisibilityRequirement(fireAndMoon, GRIMOIRE_SPELL_REQUIREMENTS.kindle),
    true,
    "kindle should appear when both fire and moon symbols are present",
  );

  const fireOnly = makeHand({ fire: 1 });
  assert.equal(
    handMeetsVisibilityRequirement(fireOnly, GRIMOIRE_SPELL_REQUIREMENTS.kindle),
    false,
    "kindle should not appear when only one of its symbol types is present",
  );

  const moonOnly = makeHand({ moon: 1 });
  assert.equal(
    handMeetsVisibilityRequirement(moonOnly, GRIMOIRE_SPELL_REQUIREMENTS.kindle),
    false,
    "kindle should not appear when only moon symbols are present",
  );
}

// Spells that require three symbol types still only need any two of those types in hand.
{
  const moonAndEye = makeHand({ moon: 1, eye: 1 });
  assert.equal(
    handMeetsVisibilityRequirement(moonAndEye, GRIMOIRE_SPELL_REQUIREMENTS.timeTwist),
    true,
    "timeTwist should appear with any two of its required symbol types",
  );

  const moonOnly = makeHand({ moon: 1 });
  assert.equal(
    handMeetsVisibilityRequirement(moonOnly, GRIMOIRE_SPELL_REQUIREMENTS.timeTwist),
    false,
    "timeTwist should not appear with only one of its required symbol types",
  );
}

// getVisibleSpellsForHand should respect the visibility rules while keeping spell priority.
{
  const hand = makeHand({ fire: 1, moon: 1 });
  assert.deepEqual(
    getVisibleSpellsForHand(hand),
    ["fireball", "kindle", "iceShard"],
    "fire + moon hand should reveal matching single- and dual-symbol spells",
  );
}

{
  const eyeOnly = makeHand({ eye: 1 });
  assert.deepEqual(
    getVisibleSpellsForHand(eyeOnly),
    ["arcaneShift"],
    "single eye symbol should only reveal arcaneShift",
  );
}

// When a profile only knows certain spells, only those spells should populate the Grimoire.
{
  const unlocked = ["fireball", "hex"] as const;
  const fullHand = makeHand({ fire: 3, serpent: 3, moon: 2 });
  assert.deepEqual(
    getVisibleSpellsForHand(fullHand, [...unlocked]),
    ["fireball", "hex"],
    "grimoire should only show spells unlocked by the profile even if others meet visibility rules",
  );
}

console.log("grimoire visibility tests passed");
