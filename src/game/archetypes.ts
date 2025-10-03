import type { SpellId } from "./spells";

export type ArchetypeId = "bandit" | "sorcerer" | "beast";

export type ArchetypeDefinition = {
  id: ArchetypeId;
  name: string;
  description: string;
  spellIds: SpellId[];
};

const definitions: Record<ArchetypeId, ArchetypeDefinition> = {
  bandit: {
    id: "bandit",
    name: "Shade Bandit",
    description:
      "A cunning rogue who manipulates momentum with tricks and stolen reserves.",
    spellIds: ["hex", "mirrorImage", "iceShard", "suddenStrike", "crosscut", "leech"],
  },
  sorcerer: {
    id: "sorcerer",
    name: "Chronomancer",
    description:
      "A master of temporal magic who bends slices and values to their will.",
    spellIds: ["fireball", "arcaneShift", "timeTwist", "kindle", "offering", "phantom"],
  },
  beast: {
    id: "beast",
    name: "Wildshifter",
    description:
      "A primal force that overwhelms foes with ferocity and relentless pressure.",
    spellIds: ["fireball", "hex", "iceShard", "kindle", "leech", "phantom"],
  },
};

export const ARCHETYPE_DEFINITIONS = definitions;

export const ARCHETYPE_IDS: ArchetypeId[] = Object.keys(definitions) as ArchetypeId[];

export const DEFAULT_ARCHETYPE: ArchetypeId = "bandit";

export const ALL_SPELL_IDS: SpellId[] = Array.from(
  new Set(ARCHETYPE_IDS.flatMap((id) => definitions[id].spellIds))
);

export function getArchetypeDefinition(id: ArchetypeId): ArchetypeDefinition {
  return definitions[id];
}

