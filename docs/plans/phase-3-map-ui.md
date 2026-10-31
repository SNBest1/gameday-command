# Phase 3: Operations map

Branch: `phase-3/map-ui`, created from the tip of `phase-1/headless-engine`. The branches are stacked: the user merges Phase 1 first, then this. Work only on this branch. **Never commit to, merge into or push `main`.** Pushing `phase-3/map-ui` to `origin` is allowed so CI can run.

## Goal

Give the commander a GIS-style operations map that reads like police software, not a game, and make it the default view.

- The real map is underneath (streets, buildings, satellite or plain style).
- The crowd, traffic, officers, closures and incident sit on top as data layers.
- Language is neutral and operational.

The isometric close-up and the side-by-side maps stay as optional views.

## Definition of done

- A new view, **Map** (`view === 'ops'`), is the default. It draws:
  - a MapLibre GL base map;
  - deck.gl layers for crowd density, fans (when zoomed in), vehicles coloured by traffic flow, officers with their routes, closures and barricades, gates with live flow, the incident zone and police hotspots.
- Every interaction the close-up supports also works on the Map view:
  - pick a fan, officer or vehicle;
  - click a street for barricades and dispatch;
  - the police pick modes;
  - focus on a hotspot or the incident;
  - `window.gamedayMap.lookAt`.
- It works **with no internet**. If the tile style cannot load, the map draws its own base layer from the `MapBundle` grid (roads, buildings, lots, the bowl), so an on-premises install needs nothing external. A hosted install can point at any MapLibre style URL, and at a self-hosted PMTiles file.
- Each map knows where it is on Earth: a new endpoint `GET /api/maps/:id/geo` returns its centre, radius and cell size. The test map, which has no location, still works in a local flat mode.
- The plan comparison no longer says "verdict" or "best". It reports which plan had the lowest crush-risk minutes and the fastest clearance, as numbers.
- Only one WebGL context exists on the page at a time, as now.
- `npm run typecheck && npm run lint && npm run format:check && npm test && npm run build` pass, and CI is green on Ubuntu, Windows and macOS.

## Constraints

- Follow `AGENTS.md`, including "Mac and Windows". `contracts.ts` is frozen: georeferencing goes in a **new endpoint**, not in `MapBundle`.
- New dependencies allowed, installed with exact versions (`npm install -E`) in the `app` workspace only: `maplibre-gl@5`, `@deck.gl/core@9`, `@deck.gl/layers@9`, `@deck.gl/mapbox@9`, `pmtiles@4`. Nothing else.
- deck.gl must share MapLibre's WebGL context through `MapboxOverlay` with `interleaved: true`, so the page holds one context. The Map view, the close-up and the side-by-side maps are never mounted together.
- Every crowd colour and count uses standing density (`standingDensity()` in `app/src/congestion.ts`), never the raw grid.
- Text stays 12 px or larger, and every colour passes 4.5:1 contrast in light and dark modes.
- No change to simulation, scoring or worker code. This phase is `app/` and one server route only.
- The default tile style URL must need no API key: `https://tiles.openfreemap.org/styles/positron` (OpenFreeMap, OSM data). It is set by `VITE_MAP_STYLE` and documented in `.env.example`.

## Non-goals

- No satellite imagery provider (needs a key and a decision). The style URL setting lets a deployment add one later.
- No new symbol standard beyond the neutral set in step C5 (the department's own standard is an open decision).
- No removal of `CrowdView` or `ComparisonMaps`.
- No change to the rail, orders panel or command bar, apart from the wording in Stream E.

## Skills used

Reviewed at step 0:

- **`maplibre-tile-sources`** and **`maplibre-pmtiles-patterns`** (`maplibre/maplibre-agent-skills`, installed for this session with `npx skills add ... --agent opencode -g`). Used for the style/source split, the MapLibre 4+ `addProtocol` `{ data }` contract, and using `url:` (not `tiles:`) for PMTiles. Where they differ from this plan, the plan wins (`maplibre-gl@5`, the exact dependency list).
- **`frontend-design`** (available). Used for the operational palette, legend and type treatment of the Map view.
- **`web-design-guidelines`** (`vercel-labs/agent-skills`, read from its installed `SKILL.md`; its rules are fetched at review time). Used as the accessibility and interaction checklist for the Map view.
- No repo or harness skill covers MapLibre, deck.gl, React or the app's existing Pixi shell beyond the plan itself; the plan's steps are the fallback.

## Streams and files

Run the waves in this order:

1. **A and E together.**
2. **Then B.**
3. **Then C.**
4. **Then D.**

| Stream | Owns these files |
| --- | --- |
| A: Georeference | `world/src/osm/raster.ts` (export one constant), `world/src/osm/georef.ts` (new), `world/src/osm/georef.test.ts` (new), `server/src/index.ts` and `server/src/command.ts` (the geo route only), `app/src/api.ts` (one new call) |
| B: Map shell | `app/src/OpsMap.tsx` (new), `app/src/ops-basemap.ts` (new), `app/src/ops-basemap.test.ts` (new), `app/src/ops-geo.ts` (new), `app/src/ops-geo.test.ts` (new), `app/package.json`, `package-lock.json`, `.env.example` |
| C: Data layers | `app/src/ops-layers.ts` (new), `app/src/ops-layers.test.ts` (new), `app/src/ops-symbols.ts` (new), `app/src/OpsMap.tsx` |
| D: Wiring and interactions | `app/src/MapWorkspace.tsx`, `app/src/App.tsx` (view state only), `app/src/TransportBar.tsx` or wherever the view switch lives, `app/src/styles.css` (Map view rules only), `app/src/OpsMap.tsx` |
| E: Neutral wording | `app/src/story.ts`, `app/src/story.test.ts`, `app/src/scoreboard.ts`, `app/src/scoreboard.test.ts`, `app/src/CommandPanel.tsx`, `app/src/PlanCards.tsx`, `app/src/Rail.tsx` (wording only; Rail is free because Stream D does not touch it) |

## Steps

- [x] **0. Skills and baseline.**
  1. Search for and review skills.
  2. Record them under "Skills used".
  3. Run `npm run typecheck`, `npm run lint`, `npm test` and `npm run build`, and note anything already failing.

### Stream A: Georeference

- [x] **A1.** Create `world/src/osm/georef.ts`:
  - `export interface MapGeoref { center: { lat: number; lon: number }; radiusM: number; cellSizeM: number }`.
  - `georefOf(extract: OsmExtract): MapGeoref`, taking `center` and `radiusM` from the extract and `CELL_SIZE_M` from `contracts.ts`.
  - `cellCentreLngLat(geo, width, x, y): [lon, lat]` and `lngLatToXY(geo, lon, lat): { x, y }` in metres. These must be the exact inverse of `makeProjection` in `world/src/osm/raster.ts`, using the same `METERS_PER_DEGREE_LAT` (a private `const` there today; export it, which is the only change to `raster.ts`) and the cosine of the centre latitude.

  Verify: `world/src/osm/georef.test.ts` round-trips:
  - five OSM points from `world/data/ohio-stadium.osm.json`: `xyOf` then the inverse must land within one cell;
  - the bounding box corners.
- [x] **A2.** Add `GET /api/maps/:id/geo`:
  - for the Ohio map (`STADIUM_MAP_ID`), from `loadExtract()`;
  - for an imported stadium, from its saved extract (see how `server/src/command.ts` rebuilds a map from `saved.extract`);
  - for the test map, return `404` with `{ error: 'no location' }`.

  Do not change `/api/maps/:id`. Add `getMapGeo(id)` to `app/src/api.ts`, returning `MapGeoref | null` (null on 404 or any failure).
  Verify: `npx vitest run world/src/osm/georef.test.ts`, plus a server test that the Ohio map answers with `center.lat` between 39.9 and 40.1 and the test map answers 404.

### Stream B: Map shell

- [x] **B1.** Install the dependencies from Constraints into `app/` with exact versions. Import `maplibre-gl/dist/maplibre-gl.css` in `OpsMap.tsx`.
- [x] **B2.** `app/src/ops-geo.ts`: pure helpers on top of `MapGeoref`:
  - map bounds as `[[west, south], [east, north]]`;
  - a cell index to `[lon, lat]`;
  - a click's `[lon, lat]` to a cell index, or -1 off the map.

  When the georef is `null` (test map), use a **local flat frame**: the same functions with `center = { lat: 0, lon: 0 }`, `radiusM = width * cellSizeM / 2`. Everything downstream then works without special cases.
  Verify: `ops-geo.test.ts` round-trips cells on both the Ohio georef and the flat frame.
- [x] **B3.** `app/src/ops-basemap.ts`: `basemapImage(map: MapBundle, theme: 'light' | 'dark'): ImageData`, one pixel per cell, using muted operational colours:
  - roads mid-grey;
  - walkable ground near-background;
  - buildings and walls darker;
  - parking a light tint;
  - the seating bowl and field in neutral greys (not team colours);
  - gates marked.

  Reuse the cell kinds and the place lookups `ComparisonMaps.tsx` uses for its base texture. Do not import Pixi.
  Verify: `ops-basemap.test.ts`: the image is `width x height`, and a known road cell and a known building cell on the test map get different colours.
- [x] **B4.** `app/src/OpsMap.tsx`, first version:
  - Props: exactly `CrowdViewProps` from `app/src/CrowdView.tsx` (import the type), so `MapWorkspace` can swap views without new wiring.
  - On mount: fetch the georef. Create a `maplibregl.Map` with the style from `import.meta.env.VITE_MAP_STYLE` (default `https://tiles.openfreemap.org/styles/positron`). Fit to the map bounds, and set `maxBounds` to the bounds padded by 20%.
  - If the georef is null, or the style fails to load within 5 s, or the page is offline, switch to a blank style (`{ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': <token> } }] }`).
  - **Always** add the basemap image from B3 as a deck.gl `BitmapLayer` at the map bounds: under the tiles' labels when tiles load, and as the whole base map offline. It is what guarantees the map works on premises.
  - Register the `pmtiles` protocol (`maplibregl.addProtocol('pmtiles', new Protocol().tile)`), so a style that points at `pmtiles://...` works.
  - Add one `MapboxOverlay({ interleaved: true, layers: [] })`.
  - On unmount, call `map.remove()` and remove the protocol.
  - Read dark or light from `document.documentElement.dataset.theme` (falling back to `prefers-color-scheme`), the same way the rest of the app does.

  Add to `.env.example`: `VITE_MAP_STYLE=` with a comment. Explain how an on-premises deployment points this at a self-hosted style with a `pmtiles://` source, or leaves it empty to use the built-in grid basemap.
  Verify: `npm run typecheck && npm run build`.

### Stream C: Data layers

- [ ] **C1.** `app/src/ops-layers.ts`: pure functions that turn the current frame and scene into deck.gl layer **props** (plain objects), so they can be unit-tested without WebGL.
  - **Density:** an `ImageData` of standing density banded with `heatBands(dangerDensity)` from `app/src/heat.ts`, transparent below `HEAT_FLOOR`. Drawn as a `BitmapLayer` over the map bounds. Respect `selectedBand`.
  - **Fans:** a `ScatterplotLayer`, shown only at zoom 17 or more. Positions come from the frame's dot `x`/`y` (metres → lng/lat through `ops-geo`); off-map dots (x < 0) are skipped. Colour by state from `STATE_RGB` in `app/src/people.ts`; never by shirt or fan type, and never named.
  - **Vehicles:** a `ScatterplotLayer` at vehicle centres, coloured by `flowLevel` and `FLOW_RGB` (`app/src/congestion.ts`) when `showFlow`, else neutral. Shown when `showVehicles`. Respect `vehicleFocus`.
  - **Officers:** an `IconLayer` (or `ScatterplotLayer` with a text label) per officer from `run.scene.current.officers`, plus a dashed `PathLayer` from each officer to its route target. Colour by status: standby, en route, on scene.
  - **Closures and barricades:** `PolygonLayer` or `PathLayer` over closed closable cells and live barricades (`SceneInfo.barricades`), striped or hatched red, dark-safe.
  - **Gates:** a `TextLayer` with `Gate 2 · 105/min` or `Gate 1 closed`, from `run`'s gate stats, as the close-up labels do. Only closed gates are labelled below zoom 15.
  - **Incident zone:** a `PolygonLayer` outline over `incidentCells`, with the `incidentLabel`.
  - **Hotspots:** circles sized by area and coloured by `HOTSPOT_COLOUR`.
  - **Coverage:** when `showCoverage`, officer reach from `coverage()` in `app/src/coverage.ts`, labelled as geometry, not safety.

  Each function takes what it needs and returns `{ id, data, ...accessors }`. Do not build layers inside React render.
  Verify: `ops-layers.test.ts` on the test map with a short `Simulation` run (copy the setup from an existing engine test):
  - fans are filtered by zoom;
  - off-map dots are skipped;
  - density pixels above the danger line get the danger colour;
  - a closed gate yields a label.
- [ ] **C2.** In `OpsMap.tsx`, build deck.gl layer instances from C1 and call `overlay.setProps({ layers })` when a new frame arrives (follow how `CrowdView` learns about new frames from `run`) and when the inputs change. When `scrubIndex` is set, draw the kept frame at that index, exactly as `CrowdView` does. No tweening in this phase.
- [ ] **C3.** Picking: `pickable: true` on fans, vehicles and officers. Order of precedence, as in the close-up: officers, then vehicles, then fans. A click on nothing that lands on a road cell, or a walk cell next to one, calls `onPick(null)` then `onPickStreet(cell)`; use the exact rule `crowd-scene.ts` uses for `onPickStreet`. If that logic is private there, move it into a small exported pure function in a new file `app/src/street-pick.ts`, and have both `crowd-scene.ts` and `OpsMap.tsx` call it. This is a pure move, so `crowd-scene.ts` behaves exactly as before; add `app/src/street-pick.ts` and `crowd-scene.ts` to Stream C's files. Highlight `selected`, `selectedOfficer` and `selectedVehicle`.
- [ ] **C4.** Camera:
  - `focusBox` (new nonce) fits the map to those cells;
  - `focusToken` changes centre on the selected fan;
  - **Incident** and **Whole map** buttons, with the same meaning as the close-up's.
  - Publish `window.gamedayMap = { lookAt(xM, yM, zoom) }` while the Map view is mounted, converting metres to lng/lat. Keep the same signature as today.
- [ ] **C5.** `app/src/ops-symbols.ts`: one place that defines the Map view's symbols and colours (unit, incident, staging, medical, PA marker, barricade, hotspot levels) as plain data. Neutral, legible shapes: a circle or chevron with a short text code. No team colours. A later plan can swap in the department's standard here.

### Stream D: Wiring and interactions

- [ ] **D1.** Add `'ops'` to the view union in `App.tsx` and `MapWorkspace.tsx`, and make it the default. Keep `?view=close`, `?view=plan` and `?view=compare` working, and add `?view=ops`. In `MapWorkspace`, mount exactly one of `OpsMap`, `CrowdView` or `ComparisonMaps`.
- [ ] **D2.** Update the view switch (find where `setView` is offered to the commander; it is passed to `TransportBar` and `MapWorkspace`). The names become **Map** (ops, default), **Close-up** (the old close view) and **Side by side**. `app/src/useShortcuts.ts` has `setView` typed as `'close' | 'plan' | 'compare'` and sends `compare` back to `close`. Widen the type to include `'ops'`, and send `compare` back to `ops`, the new default (add `useShortcuts.ts` to Stream D's files).
- [ ] **D3.** Police pick modes and street picks (`onPickStreet`, the armed pick in `App.tsx`) work the same on the Map view. Check by hand: arm a barricade on the Orders tab, click a street on the Map view, and see the barricade drawn.
- [ ] **D4.** Browser check (`npm run serve`, `npm run dev`, http://localhost:5173/?autorun=1):
  1. The Map view loads with tiles; the crowd, vehicles, officers, gates and incident are drawn; zoom in and fans appear.
  2. Click a fan, an officer and a vehicle: each opens its panel.
  3. Dispatch an officer to a street from the Orders tab; the route line appears.
  4. Barricade a street; it is drawn.
  5. Light and dark themes both read well.
  6. Close-up and Side by side still work.
  7. Turn the network off in DevTools (Network: Offline) and reload: the Map view falls back to the grid basemap with every layer still drawn.
  8. `?autorun=1&engine=server` also works on the Map view.
  9. The console is clean apart from the known `favicon.ico`.

  Record the results and OS in the commit message; the user checks the other OS.

### Stream E: Neutral wording

- [x] **E1.** In `app/src/story.ts`, `scoreboard.ts`, `CommandPanel.tsx`, `PlanCards.tsx` and `Rail.tsx`, replace judging words the user sees with reporting words. Known places: the `<h2>Verdict</h2>` heading in `Rail.tsx`, and the "Best plan" badge in `PlanCards.tsx`, which becomes "Lowest crush risk". Keep CSS class names and identifiers such as `verdictText` and `r.best` as they are.
  - "Verdict" → "Comparison";
  - "best" or "winner" → "lowest crush-risk minutes" or "fastest to clear", each with its number.
  - When the plan with the lowest crush-risk minutes is not the fastest, say both, as today.
  - Keep the ranking rule itself (`rankPlans`: danger minutes, then time to clear) exactly as it is.
  - Keep "The commander always makes the call" and "assumption, not a forecast" wording wherever it already appears.
- [x] **E2.** Update `story.test.ts` and `scoreboard.test.ts` **only** where an expected string changes because of E1; ranking assertions stay as they are.
  Verify: `npx vitest run app/src/story.test.ts app/src/scoreboard.test.ts`, then `git grep -n -i -e "verdict" -e "winner" -- app/src` shows only identifiers, not words the user sees.

## Stop and ask

- A dependency in the allowed list fails to install on one OS, or needs a version other than the major stated.
- deck.gl cannot share MapLibre's context with `interleaved: true`.
- `CrowdViewProps` is missing something the Map view needs. Add an optional prop only after asking.
- Any simulation, worker or scoring file would change.
- Any ranking result changes (E1 is wording only).

## Verification (before telling the planner it is done)

1. `npm ci && npm run typecheck && npm run lint && npm run format:check && npm test && npm run build`.
2. The browser check in D4, all nine points.
3. CI green on Ubuntu, Windows and macOS for the branch.
4. Add a CLAUDE.md section, "The operations map", covering:
   - georeferencing via `/api/maps/:id/geo`;
   - the offline grid basemap;
   - `VITE_MAP_STYLE` and PMTiles;
   - the shared WebGL context;
   - which file holds symbols.
5. Mark Phase 3 "Ready for review" in `docs/roadmap.md`.
