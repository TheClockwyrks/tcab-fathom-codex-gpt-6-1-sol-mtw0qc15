# Fathom

A bioluminescent maze chase in the deep sea. Graze every plankton mote to descend. Your light grows as you eat, revealing passages and attracting hunters. Sonar reaches around corners; ink buys an escape. In the Kindle dive, remembered ground is visible only inside your growing circular window.

Three predators hunt differently: Lanternjaw follows light beneath an amber disguise, Gloamfin follows sound, and Flarefish illuminates the dark with a dangerous bloom.

## Run

Requires a current Node.js release supporting Vite 8.

```sh
npm ci
npm run dev
```

## Build

```sh
npm run build
npm run preview
```

Deploy `dist/` as a static site, at the server root or under a sub-path. All art is included and all asset URLs are relative. No backend or external services are used.

## Controls

| Control | Action |
| --- | --- |
| Arrow keys / WASD | Swim while held; buffer turns at junctions |
| Space | Sonar |
| Shift | Ink |
| P / Escape | Pause / resume |
| M | Toggle sound |
| Up / Down, Enter / Space | Select and confirm menus |
| Pointer / touch | Select and confirm menu items |
| Backtick | Engine diagnostics |

Touch devices also receive the engine's directional pad and two ability buttons. Collect every mote to clear a depth. The three life icons count spare attempts; losing a life keeps your score, eaten plankton, and explored terrain.

## Verification

```sh
npm run typecheck
npm run lint
npm run format
npm test
```

The tests cover maze geometry, continuous movement and wrapping, fog, sonar, ink, predator senses, progression, state immutability, and engine-driven menus. They use an in-process canvas and the engine's scripted clock.

The engine holds the entire game state by value. `src/game.ts` exports the game and state types; simulation, maze navigation, presentation, and validated debug poses live in neighboring modules. Automation uses `engine.debug` and `engine.apply`; nothing is attached to the page. See `specs/instrumentation.md` for the pose contract and `engine/` for runtime documentation.

Player-facing screenshots and a recorded dive are in `showcase/`.
