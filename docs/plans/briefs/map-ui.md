# Brief: professional map UI

Status: brief, not an implementation plan. It becomes a plan after Phase 1, because the new map should read from the server-side run.

## Goal

Replace the gamified look with a GIS-style operations map that a police commander would recognise. Today's isometric figures with shirt colours and names, plan "scores" and the "verdict" are what make the app feel like a game.

## Direction

- **Base map:** MapLibre GL JS with vector or satellite tiles. Tiles must work on premises without internet, because deployment is both on-prem and hosted. So: a self-hosted tile set (for example PMTiles) as well as a hosted provider.
- **Data layers:** deck.gl over MapLibre:
  - crowd density as a heat or hex layer;
  - vehicles and officers as icon layers;
  - closures and barricades as line and polygon layers;
  - gates with live in/out flow.

  deck.gl draws 100k points without the hand-rolled level-of-detail code in `app/src/crowd-scene.ts`.
- **Symbols:** standard incident-command symbology for units, incidents, staging, medical and PA points, instead of the current custom art (`app/src/vehicleArt.ts`, `barricadeArt.ts`).
- **Layout:** layer toggles, a timeline for replay and forecast, and the existing rail. Plans are compared as a table and a small multiple of maps, not as a scoreboard.
- **Wording:** neutral operational language. Drop "verdict" and "best"; keep "lowest crush-risk minutes" style statements that report numbers.
- The isometric 3D close-up (`crowd-scene.ts`, `stadium3d.ts`) becomes an optional view, not the default.

## Constraints to carry into the plan

- One WebGL context on the page at a time (see CLAUDE.md, "The close-up view").
- Every crowd colour and count uses standing density, not the raw grid.
- Text 12 px or larger and 4.5:1 contrast in light and dark modes, as the current app guarantees.
- New dependencies: `maplibre-gl` and `deck.gl` packages. They need team approval before the plan starts.

## Open decisions

- Which tile source for hosted, and how on-prem tiles are built and updated.
- Whether the 3D close-up survives at all.
- Which symbol standard the police department already uses.
