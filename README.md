# Rogue Wheel

## Overview
Rogue Wheel is a three-lane card battler where every round is decided by a trio of spinning victory wheels. The project is built with React and Vite and ships with a test harness and tooling configured through npm scripts, making it easy to iterate on UI and combat logic together.【F:package.json†L1-L19】

## Current build at a glance
- **Hub screen** – The main menu pulls your local profile data and routes to solo runs, the multiplayer lobby, or the profile screen using the shared hub layout component.【F:src/HubRoute.tsx†L11-L33】
- **Solo runs** – Launching a solo game creates a seeded match against the Nemesis AI with adjustable win targets before you enter the arena.【F:src/AppShell.tsx†L68-L137】
- **Multiplayer lobby** – Hosts and guests meet in an Ably-backed lobby where they can choose target wins, enable optional modes, and see everyone connected before starting a synchronized match.【F:src/MultiplayerRoute.tsx†L215-L334】
- **Mode selection** – A dedicated screen lets you toggle optional rule sets and (in solo play) change how many rounds it takes to win, with sensible validation for the allowed range.【F:src/ModeSelect.tsx†L13-L166】
- **Profile page** – Players can rename their profile, manage tutorial pop-ups, and redistribute Grimoire symbols to unlock spells, all stored locally for repeat runs.【F:src/ProfilePage.tsx†L26-L185】

## How matches play out
- **Hands and lanes** – Both sides draw up to five cards each round, then assign three of them to the lanes beside the wheels while the remaining two feed Reserve-based mechanics.【F:src/features/threeWheel/utils/combat.ts†L47-L78】
- **Three victory wheels** – Internally the game tracks three wheel panels, one per lane, each with mirrored state for the player and opponent.【F:src/App.tsx†L100-L117】 Every wheel spins across 16 slices to land on a victory condition, and different archetypes shuffle distinct slice lengths for variety.【F:src/game/types.ts†L2-L58】【F:src/game/wheel.ts†L17-L48】
- **Victory conditions** – Wheels can call for Strongest, Weakest, Reserve Sum, Closest to Target, or Initiative comparisons, each with its own icon and resolution rules.【F:src/game/wheel.ts†L4-L12】 Reserve challenges total the values of the two cards you kept in hand to add tension to your initial assignments.【F:src/features/threeWheel/utils/combat.ts†L36-L45】
- **Coaching and HUD** – A first-run coach highlights the hand, wheels, and resolve button during the opening stages so new players learn where to look before the overlays step aside.【F:src/features/threeWheel/components/FirstRunCoach.tsx†L30-L113】

## Game modes
The game always runs with Classic rules, and you can layer on optional modes from the selection screen:
- **Grimoire** – Grants access to a mana system tied to your reserves and enables archetype-specific spell casting that can reshape card values or wheel outcomes.【F:src/gameModes.ts†L1-L26】【F:src/game/archetypes.ts†L12-L34】
- **Ante** – Lets you wager your current wins at the start of each round for a chance at multiplied payouts when the wheel odds swing in your favor.【F:src/gameModes.ts†L1-L26】

Game mode combinations are normalized so the UI displays a clean label (for example, “Grimoire + Ante”) regardless of toggle order.【F:src/gameModes.ts†L1-L47】

## Progression and customization
Local profile data tracks level, experience, win streaks, decks, and Grimoire symbols, seeded with a starter deck and tutorial state for new players.【F:src/player/profileStore.tsx†L18-L91】 The profile screen surfaces that data, lets you rename your adventurer, toggle the in-match tutorial, review unlocked spells, and allocate up to ten Grimoire symbols across five arcana tracks to chase new spell requirements.【F:src/ProfilePage.tsx†L41-L185】【F:src/game/grimoire.ts†L1-L85】 Archetypes—Shade Bandit, Chronomancer, and Wildshifter—each come with themed spell loadouts when Grimoire mode is active.【F:src/game/archetypes.ts†L12-L34】

## Multiplayer details
Set a `VITE_ABLY_API_KEY` environment variable before starting the dev server to enable realtime lobbies. The lobby flow uses Ably presence to keep member lists, target win counts, and selected modes in sync, and only the host can launch the match once everyone is ready.【F:src/MultiplayerRoute.tsx†L215-L334】

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
- `src/` – Application source for the hub, match flow, multiplayer lobby, and supporting systems such as spells and wheels.【F:src/App.tsx†L30-L180】【F:src/AppShell.tsx†L1-L155】
- `tests/` – Headless regression tests compiled to `dist-tests` before execution.【F:package.json†L7-L18】
- `public/` and `assets/` – Static art and audio used by the hub and combat scenes.

## Contributing
Before opening a pull request, make sure documentation and tests still reflect any gameplay or balance changes. Multiplayer features require valid Ably credentials; omit secrets from commits.【F:src/MultiplayerRoute.tsx†L228-L334】
