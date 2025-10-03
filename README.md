# Rogue Wheel

## Overview
Rogue Wheel is a tactical, three-lane roguelike that combines card drafting with a spinning victory wheel. Built with React and Vite, the current build focuses on fast "wins-only" runs with minimal bookkeeping while still supporting online multiplayer lobbies.

## Game flow
1. **Hub screen** – choose between starting a solo run, opening the multiplayer lobby, or checking your profile.
2. **Mode selection** – toggle optional rules (Grimoire or Ante) and, for solo games, adjust the target number of round wins needed to clear the run.
3. **Match** – play best-of rounds against an AI Nemesis or a remote opponent while the three wheels determine unique victory conditions each spin.

## Core systems
- **Victory wheels** – each of the three wheels contains 16 slices and rolls a victory condition such as Strongest, Weakest, Reserve Sum, Closest to Target, or Initiative.
- **Cards and decks** – fighters play cards with single values or split values, and reserve unplayed cards for late-round comparisons.
- **Archetypes and spells** – runs start by selecting an archetype (Shade Bandit, Chronomancer, or Wildshifter), each granting a themed spell loadout used when the Grimoire mode is active. Signature spells include Fireball, Ice Shard, Mirror Image, Arcane Shift, Hex, and Time Twist.

## Game modes
- **Classic** – default rules with no additional modifiers.
- **Grimoire** – unlocks the mana system so players can bank reserve points and cast archetype-specific spells that alter card values, wheel tokens, and reserves.
- **Ante** – wagers existing round wins at the start of each round and multiplies payouts based on the wheel odds.

Multiple modes can be enabled at once; the UI shows the combined label (for example, "Grimoire + Ante").

## Multiplayer lobbies
The multiplayer lobby lets hosts create a room, pick a target win count, and choose active modes. Presence is synchronized via Ably Realtime, and all clients inherit the host's settings. Set a `VITE_ABLY_API_KEY` in your environment before running the lobby.

## Progression and onboarding
- **Local profile** – runs seed a local profile with XP, level, and win streak tracking plus a starter deck stored in `localStorage`.
- **Hub stats** – the hub displays your name, level, XP progress, and version while offering new run and multiplayer actions.
- **First-run coach** – contextual overlays highlight the hand, wheel, and resolve button during early matches, nudging the player through the first three turns.

## Development
Install dependencies with `npm install` and use the following scripts:

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server. |
| `npm run build` | Produce a production build. |
| `npm run preview` | Preview the production build. |
| `npm run test` | Type-check the project and run the compiled integration tests. |

These scripts are defined in `package.json`.

## Repository layout
- `src/` – application source, including the core game engine (`src/game`), multiplayer lobby, and UI components.
- `tests/` – headless regression tests compiled to `dist-tests` before execution.
- `public/` and `assets/` – static art and audio shared across the hub and combat scenes.

## Contributing
Before opening a pull request, make sure documentation and tests still reflect any gameplay or balance changes. Multiplayer features require valid Ably credentials; omit secrets from commits.
