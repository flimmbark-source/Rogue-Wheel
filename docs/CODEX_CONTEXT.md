# Codex Editing Context

This guide summarizes how Rogue Wheel is organized so automated editors can modify the codebase safely.

## Project snapshot
- **Genre**: Tactical three-lane roguelike with card drafting and spinning victory wheels.【F:README.md†L1-L33】
- **Tech stack**: React 18 + Vite with TypeScript, Tailwind CSS, Framer Motion for animation, and Ably Realtime for multiplayer presence.【F:package.json†L1-L33】【F:src/App.tsx†L1-L86】
- **Developer workflows**: use `npm run dev` for the Vite dev server, `npm run build` for production bundles, and `npm run preview` to inspect builds locally.【F:README.md†L35-L50】

## Repository layout highlights
- `src/App.tsx` is the monolithic game shell. It wires the UI to `useThreeWheelGame`, imports the combat and spell engines, and feeds layout components such as the wheel panels, hand dock, and onboarding coach.【F:src/App.tsx†L1-L118】
- `src/features/threeWheel/` contains feature-specific hooks, utilities, and presentation components. The `hooks/useThreeWheelGame.ts` hook orchestrates turns, Ably synchronization, and skill/spell resolution, while `components/` and `utils/` host the reusable UI and game helpers referenced by tests.【F:src/features/threeWheel/hooks/useThreeWheelGame.ts†L1-L88】【F:src/features/threeWheel/utils/combat.ts†L1-L40】
- `src/game/` is the core simulation layer: card and wheel math, archetypes, spell and skill catalogs, AI decision engines, and reusable hooks consumed by both the app shell and the multiplayer lobby.【F:src/game/wheel.ts†L1-L20】【F:src/game/skills.ts†L1-L40】【F:src/features/threeWheel/hooks/useThreeWheelGame.ts†L41-L66】
- `src/player/profileStore.tsx` manages persistent profile state (XP, onboarding hints, and deck progression) by exporting helper functions that are invoked from the main app and hook layers.【F:src/App.tsx†L45-L66】【F:src/player/profileStore.tsx†L1-L40】
- `tests/` hosts TypeScript integration tests that validate spell effects, skill phases, CPU behavior, and round resolution once compiled to `dist-tests` via the test script.【F:package.json†L7-L24】【F:tests/spellEffects.test.ts†L1-L20】
- Static assets and marketing pages live in `public/`, `assets/`, and `ui/`, while documentation sits in `docs/` (including this file and the existing style guide).【F:README.md†L51-L60】【F:docs/STYLE_GUIDE.md†L1-L74】

## Gameplay flow reference
Use this when adjusting UI copy or onboarding logic:
1. Hub screen for run/lobby/profile selection.
2. Mode selection for Grimoire/Ante toggles and solo win targets.
3. Matches that compare three wheel outcomes per round.【F:README.md†L5-L23】

## Multiplayer considerations
- Presence and intent sharing run through Ably; components rely on a configured `VITE_ABLY_API_KEY` and the Realtime client exposed in `useThreeWheelGame`. Stub or guard Ably calls in tests to avoid network access.【F:README.md†L23-L29】【F:src/features/threeWheel/hooks/useThreeWheelGame.ts†L1-L33】

## Styling guidelines
- Tailwind utility classes drive layout, with shared `.panel`, `.card`, and button styles defined in `src/index.css` according to the style guide. When introducing new UI, prefer Tailwind utilities and the documented font and colour tokens.【F:docs/STYLE_GUIDE.md†L1-L74】【F:src/index.css†L1-L60】

## Testing and quality gates
- `npm run test` compiles the TypeScript tests with `tsconfig.tests.json` and then executes the generated Node modules in `dist-tests/tests`. Keep new tests colocated in `tests/` and ensure they are added to the command sequence if deterministic execution order matters.【F:package.json†L7-L24】
- Existing tests emphasize skill resolution, spell edge cases, CPU spell timing, and visibility rules. Mimic that pattern when adding new coverage.【F:tests/skillModePhase.test.ts†L1-L18】【F:tests/cpuSpellSaving.test.ts†L1-L19】

## Editing tips
- Favor pure helpers in `src/game/` for deterministic behavior; `useThreeWheelGame` stitches them together, so changes there should remain minimal and side-effect aware.【F:src/features/threeWheel/hooks/useThreeWheelGame.ts†L41-L88】
- Guard new multiplayer features behind host/room checks because both solo and lobby flows reuse the same hook and UI shell.【F:src/features/threeWheel/hooks/useThreeWheelGame.ts†L60-L88】
- Keep onboarding and profile updates routed through the `profileStore` helpers so localStorage usage stays centralized.【F:src/App.tsx†L45-L66】【F:src/player/profileStore.tsx†L1-L40】

