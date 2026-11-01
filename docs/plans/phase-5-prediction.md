# Phase 5: Prediction from live observations

This phase is built in **stages**. Each stage has its own branch, created from `main` after the previous stage is merged: `phase-5/1-validation-fixes`, `phase-5/2-walking-speed`, and so on. Implement **one stage per run**, then stop for review. **Never commit to, merge into or push `main`.** Pushing a stage branch to `origin` is allowed so CI can run.

## Goal

The product's purpose:

1. Camera and turnstile counts show what is happening now and what happened before.
2. The simulation starts from that real state.
3. It forecasts what happens next under each option the commander is weighing.
4. Suggestions are ranked by that forecast.
5. The commander confirms every action by hand.

This phase builds that loop end to end with **synthetic observations**, so it can be built and tested without cameras. It also measures how good the forecasts are, and it fixes the walking-speed error the validation suite found first, because a forecast cannot be better than the model behind it.

The camera pipeline itself is not in this phase (see `briefs/vision.md`). This phase defines the input it will post to.

## Definition of done (whole phase)

- `npm run validate` measures walking correctly. The model's open-space walking speed is within 0.15 m/s of the Jülich reference in the lowest density bin that has samples.
- A worker can fork a forecast from the current moment for several options without changing the live run. A run with forecasts requested gives byte-identical frames and scorecard to the same run without them.
- Zone counts (people per zone, never images or identities) can be posted to the server, stored, read back as history, and fed into a run. The run's state follows them.
- `npm run backtest` writes `validation/forecast-report.md`. It scores the forecasts against a "truth" run they never saw, and against a persistence baseline (the count simply stays the same).
- The app has a **What if** panel. It forecasts each option, shows the likely range (p10, p50 and p90), lets the commander send the option they choose through the existing order path, and shows observed against modelled counts for the past.
- Every stage's checks pass: `npm run typecheck && npm run lint && npm run format:check && npm test && npm run build`.

## Constraints

- Follow `AGENTS.md`. `contracts.ts` is frozen: everything new lives in engine-, world-, server- or app-owned files (`engine/src/edits.ts`, `engine/src/sim.ts` `Checkpoint`, new modules). If something truly needs the contract, stop and ask.
- **Everything works on macOS and Windows.** CI checks Ubuntu, Windows and macOS. Build paths with `node:path` and `fileURLToPath`.
- **Runs stay deterministic.** The same seed, decision tape, orders and observations reproduce a run exactly. Observations are replayed after a rewind exactly like orders.
- The step order in `sim.ts` does not change. Observations land in the same slot as orders: after the world hooks, before decisions.
- **Counts only, never faces or identities.** The observation schema has no field for an image, a track ID, a face, a licence plate or a person. The server rejects any request carrying fields outside the schema.
- **Say "forecast", never "will happen".** A zone without a sensor is "inferred", not "measured", and is drawn differently. Follow the claim rules in `docs/forecast.md`.
- **No new dependencies** unless a step names one.
- **No authentication exists yet.** The observation routes are off unless `OBSERVATIONS_ENABLED=1`, and the docs say not to expose them publicly.

## Non-goals

- No camera, video or detection code (vision brief).
- No real data feeds (Phase 2 needs people).
- No change to how fans decide (Kev, cache, defaults).
- No tuning of the model to fit the reference data beyond Stage 2's single, documented change.
- No authentication (its own plan).

## Skills used

Fill in at Stage 0 of each run.

## Streams and files

| Stage | Branch | Owns these files |
| --- | --- | --- |
| 1: Validation fixes | `phase-5/1-validation-fixes` | `validation/run.ts`, `validation/maps.ts`, `validation/report.md` |
| 2: Walking speed | `phase-5/2-walking-speed` | `engine/src/movement-flow.ts`, `engine/src/flow.test.ts`, `engine/src/walking-speed.test.ts` (new), `scripts/scorecards.ts` (new), `docs/walking-speed.md` (new), `validation/report.md`, `CLAUDE.md` |
| 3: Forecast fork | `phase-5/3-forecast-fork` | `world/src/hooks.ts`, `engine/src/sim.ts`, `engine/src/edits.ts`, `engine/src/forecast-run.ts` (new), `engine/src/forecast-run.test.ts` (new), `engine/src/worker-core.ts`, `engine/src/wire.ts` (only if a new typed array needs it), `docs/wire-protocol.md`, `docs/forecast.md` |
| 4: Zones and observations | `phase-5/4-observations` | `world/src/zones.ts` (new), `world/src/zones.test.ts` (new), `engine/src/edits.ts`, `engine/src/sim.ts`, `server/src/observations.ts` (new), `server/src/observations.test.ts` (new), `server/src/db.ts`, `server/src/index.ts` (route registration only), `scripts/synthetic-feed.ts` (new), `.env.example`, `docs/observations.md` (new) |
| 5: State correction | `phase-5/5-assimilation` | `engine/src/assimilate.ts` (new), `engine/src/assimilate.test.ts` (new), `engine/src/movement-flow.ts` (arrival and gate-rate hooks only), `engine/src/sim.ts` |
| 6: Backtest | `phase-5/6-backtest` | `validation/backtest.ts` (new), `validation/forecast-report.md` (new), root `package.json` (`backtest` script only) |
| 7: App | `phase-5/7-what-if` | `app/src/WhatIfPanel.tsx` (new), `app/src/what-if.ts` (new), `app/src/what-if.test.ts` (new), `app/src/ops-layers.ts`, `app/src/ops-symbols.ts`, `app/src/suggestions.ts`, `app/src/useRun.ts`, `app/src/Rail.tsx` (tab registration only), `app/src/styles.css` |

## Steps

- [ ] **0. Skills and baseline (every stage).**
  1. Search for skills that could help with this stage, and record them under "Skills used".
  2. Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` and `npm run validate`.
  3. Note any failure that already existed, in the first commit message.

### Stage 1: Fix the validation measurements (no model change)

These are bugs in the measuring code, found on 2026-10-31. The model is not touched in this stage, so `npm test` must not change at all.

- [ ] **1.1 Density is counted part-way through.** In `corridorModel()` (`validation/run.ts`), `inside` increments in the same loop that reads it. Each dot's density therefore counts only the dots before it in the array, so most samples land in too-low bins.
  - Count every dot in the window first, in its own loop.
  - Then compute density once for the step, and bin every walking dot's speed by it.
- [ ] **1.2 The area label is wrong.** The code's area is 5 cells × 2 m × 3 cells × 2 m = 60 m², but the report text says 30 m². Make the text read the `AREA` constant, so the two cannot drift again.
- [ ] **1.3 The window sits where fans are admitted.** Fans are admitted within reach of the gate, about 20 m before it, and vanish from the corridor there; the window (cells x = 35..39) overlaps that zone.
  1. Lengthen the corridor in `corridorMap()` to 100 m (50 cells).
  2. Put the measurement window 30 to 40 m from the corridor's start.
  3. Assert in `run.ts` that no dot is admitted inside the window; throw with a clear message if one is.
- [ ] **1.4 Let the crowd in at a steady rate.** Today all 1,500 fans start in the lot at once, so the corridor measures a release from a packed lot, not steady flow. Feed the corridor at several fixed rates, one run per rate, so each run sits near one density, as the Jülich runs do.
  - Rates: 0.5, 1, 1.5, 2 and 3 people/s.
  - Use the existing arrival mechanism (`arrivalWindowMin` on the fan types, or the `arriving` state). Do not add a new movement path. If no existing mechanism can give a fixed rate, stop and ask.
- [ ] **1.5 Free walking check.** Add a table to the report: for walking dots alone in their cell with no dot in the eight cells around them, show mean speed, mean free speed (`walkSpeedMps` × weather factor) and their ratio. On 2026-10-31 a quick diagnostic measured a ratio of 0.69 (0.806 against 1.166 m/s). Report what the fixed harness measures; do not copy that figure.
- [ ] **1.6 Measure the bottleneck at the opening.** `roomModel()` counts admissions, which measures the gate, not the opening.
  - Count each dot when its cell crosses the opening's line, outward.
  - Keep the throughput of the gate beyond the opening high, so the opening decides the flow.
  - Report both counts (crossings and admissions) side by side.

  Verify: `npm test` gives exactly the baseline result; `npm run validate` writes the report; `git diff --stat` touches only `validation/`.

### Stage 2: Walking speed

This changes every scorecard. Build it behind an option, measure it, and **stop for the team's decision before making it the default** (2.5).

- [ ] **2.1 Add a constructor option**, `new FlowMovement({ speedDensity: 'cell' | 'neighbourhood' })`. The default is `'cell'`, which is today's behaviour, byte for byte.
- [ ] **2.2 Implement `'neighbourhood'`** in the walking step (`movement-flow.ts`, where `stride` is computed from `SPEED_BY_COUNT`).
  - The density a walker feels is: `DOT_GROUP_SIZE × (standing dots in the 3 × 3 block around its cell − 1)`, divided by `4 m² × the number of non-blocked cells in that block`.
  - The `− 1` removes the walker itself. Block edges are clipped to the map.
  - Read the counts from `density.standingPerM2` as the current code does (the grid from the end of the last step), not from `occupancy`.
  - Keep the result an integer count before any division, so the speed is reproducible on every platform. Use `densityFactor()`, or a second lookup table indexed by integers, not a fresh `Math.exp` per dot.
  - The cell entry cap (`MAX_DOTS_PER_CELL`) is unchanged.
- [ ] **2.3 Test it** in `engine/src/walking-speed.test.ts`:
  - A lone dot on an empty map walks at its free speed.
  - A dot in a full 3 × 3 block walks at the 5% floor.
  - With `'cell'`, every existing test result is unchanged.
- [ ] **2.4 Measure.**
  1. Make `validation/run.ts` run both modes and report them side by side.
  2. Write `scripts/scorecards.ts`. It runs the four incidents × three plans on the stadium map with default decisions, in both modes, and prints one table: time to clear, danger minutes and officer minutes for each.
  3. Write `docs/walking-speed.md` with:
     - both validation tables;
     - the scorecard table;
     - the change in step time measured by `npm run test:perf`;
     - one paragraph on what changed, and why.
- [ ] **2.5 STOP: team decision.** Report the tables to the user and wait. Only on a yes:
  1. Make `'neighbourhood'` the default.
  2. Update every test whose numbers move. List each one in the commit message with its old and new value. Never loosen an assertion to make it pass.
  3. Update the measured numbers in `CLAUDE.md` (the gate-surge clear times, "Current state" and open item 0).
  4. Tell the user the decision cache needs re-warming with Kev, because waits and crowd sizes feed decision keys.

  Verify: `npm test`, `npm run validate`, `npm run test:perf`.

### Stage 3: Fork a forecast from now

- [ ] **3.1 World hooks are restored on rewind.** Today a checkpoint does not restore the world hooks' own state (which plan steps fired, standing orders, assigned officers; see `createWorldHooks` in `world/src/hooks.ts`).
  - Add `capture(): unknown` and `restore(state: unknown): void` to `WorldRuntime`. That interface belongs to `world/`, not the contract.
  - Add `hooks?: unknown` to `Checkpoint` in `sim.ts`.
  - Extend the rewind test in `engine/src/replay.test.ts`: checkpoint before a plan step's time, run past it, rewind, run again, and require a scorecard identical to a straight run.
- [ ] **3.2 A speed scale for variants.** `ctx.walkFactor` is reset from the weather every step (`sim.ts` line ~292), so it cannot carry a variant's speed. Add `ctx.speedScale` (default exactly 1), multiplied in wherever `walkFactor` is used for walkers and officers. With 1, results must be byte-identical.
- [ ] **3.3 `engine/src/forecast-run.ts`.** Export `runForecast(sim, request, client)`:
  1. `const now = sim.checkpoint()`.
  2. For each option and each variant:
     - `sim.rewind(now)`;
     - apply the variant (an RNG seed offset and a `speedScale`);
     - apply the option's `PoliceOrder`s at `now.t`;
     - step `horizonS` with frames and records suppressed, sampling the standing people in each zone every 30 s.
  3. `sim.rewind(now)` and return.

  Variants, per `docs/forecast.md`:

  | Variant | Seed offset | `speedScale` |
  | --- | ---: | ---: |
  | centre | 0 | 1 |
  | seed | +1 | 1 |
  | seed | +2 | 1 |
  | slow | 0 | 0.9 |
  | fast | 0 | 1.1 |

  Combine the variants with `combine()` from `engine/src/forecast.ts` into p10/p50/p90 per zone per sample, plus the same three for time to clear and danger minutes.
- [ ] **3.4 Forecast decisions never touch the network.** Variants use a client that answers from the answers this run has already received (keep a memo in the worker), and from defaults otherwise. A forecast must not wait on Kev.
- [ ] **3.5 Messages** in `engine/src/edits.ts`, with the worker handling them in `worker-core.ts`:
  - `{ type: 'forecast', id, horizonS, zones: { id, cells }[], options: { id, label, orders: PoliceOrder[] }[] }` in. An option with no orders means "do nothing" and is always included.
  - `{ type: 'forecast_result', id, t, horizonS, sampleEveryS, options: { id, zones: ZoneBand[][], clear: { p10, p50, p90 }, danger: { p10, p50, p90 } }[], wallMs }` out.
  - Document both in `docs/wire-protocol.md`.
- [ ] **3.6 The live run must not notice.** In `engine/src/forecast-run.test.ts`, run the test map twice with the same seed: once plainly, and once with three forecasts requested at different times. Require byte-identical final frames and equal scorecards.
- [ ] **3.7 Measure the cost.** Time five variants × three options × 600 s on the stadium map, and put the number in `docs/forecast.md`. **If one forecast takes more than 5 s of wall time, stop and ask** before going on: it pauses the live run, and the answer may be fewer variants, a shorter horizon or a separate worker.

  Verify: `npx vitest run engine/src/forecast-run.test.ts engine/src/replay.test.ts`, then `npm test`.

### Stage 4: Zones and observations

- [ ] **4.1 Zones** (`world/src/zones.ts`). `zonesFor(map)` returns `{ id, name, cells, kind: 'gate_approach' | 'parking' | 'street' | 'custom' }[]`.
  - If `world/data/zones/<mapId>.json` exists, use it. Each zone is a polygon in map metres, rasterised to cells.
  - Otherwise generate one zone per gate approach (the cells `outsideGate()` in `world/src/incidents.ts` gives; export it rather than copying it) and one per parking place.
  - Test both paths on the test map.
- [ ] **4.2 The observation shape** (`engine/src/edits.ts`):
  ```ts
  interface ZoneCount {
    zoneId: string;
    at: SimSeconds;
    people: number;
    source: 'camera' | 'turnstile' | 'synthetic';
  }
  interface GateCount {
    gateId: Id;
    at: SimSeconds;
    admittedPerMin: number;
    source: 'turnstile' | 'synthetic';
  }
  ```
  Counts only. Add the message `{ type: 'observe', counts: ZoneCount[], gates: GateCount[] }`.
- [ ] **4.3 Observations are replayed like orders.**
  - `Simulation` keeps them for the life of the run and applies each at its `at` second, in the orders slot.
  - `seek` drops the ones after the target, as `dropOrdersAfter` does.
  - In this stage, applying an observation only records it, and `SceneInfo` gains the latest observed count per zone. State correction is Stage 5.
- [ ] **4.4 Server** (`server/src/observations.ts`):
  - `POST /api/observations` stores a batch, and `GET /api/observations?map=&from=&to=` reads history.
  - Add a table `observations (map_id, zone_id, gate_id, at, people, admitted_per_min, source, received_at)` to `server/src/db.ts`, created the way the existing tables are.
  - Validate strictly:
    - reject unknown fields;
    - reject non-finite or negative numbers;
    - cap the body at 256 KB and a batch at 5,000 rows.
  - Both routes answer 404 unless `OBSERVATIONS_ENABLED=1`. Document the variable in `.env.example`, with the no-authentication warning.
  - Tests in `server/src/observations.test.ts`: round trip; an extra field (for example `image`) is rejected; disabled by default.
- [ ] **4.5 Synthetic feed** (`scripts/synthetic-feed.ts`).
  1. Run a "truth" simulation with a different seed and `speedScale` 0.9.
  2. Every 30 sim seconds, turn its zone counts into observations through `observeZones()` from `app/src/sensors.ts`, which gives coverage, dropout, latency and noise.
  3. Either write them to a JSON file, or POST them to the server.

  This is how Stages 5 and 6 are tested without cameras. Document it in `docs/observations.md`, together with the schema the future camera edge must post.

  Verify: `npx vitest run world/src/zones.test.ts server/src/observations.test.ts`, then `npm test`.

### Stage 5: Keep the run matched to observations

The first version is deliberately simple and deterministic. A particle filter over whole simulations is out of scope.

- [ ] **5.1 Gate rate from turnstiles.** A `GateCount` sets that gate's effective admission rate for the next 60 s to the observed rate, capped at its door's capacity. This needs a small public hook on `FlowMovement`.
- [ ] **5.2 Arrival nudging** (`engine/src/assimilate.ts`, pure). For each gate-approach or parking zone with a fresh count:
  - if the model holds fewer people than observed, bring forward the arrival time of the dots still `arriving` whose home gate or lot is that zone's, until the shortfall is covered or none are left;
  - if it holds more, delay the latest arrivals there by up to 5 minutes.

  Choose dots in index order, never with an RNG draw, so the result is reproducible. Never move a dot that is already on the map.
- [ ] **5.3 Report the mismatch.** `SceneInfo` gains, per zone, the observed count, the modelled count and the age of the observation.
- [ ] **5.4 Test** in `engine/src/assimilate.test.ts`, with a twin experiment on the test map: a truth run and a model run with different seeds, the model fed synthetic counts from the truth. Over a run, the model's zone-count error must be lower with assimilation than without. Report both numbers in the test name or a comment; do not hard-code a threshold you have not measured.

  Verify: `npx vitest run engine/src/assimilate.test.ts`, then `npm test`.

### Stage 6: Score the forecasts

- [ ] **6.1 `validation/backtest.ts`**, a twin experiment on the stadium map, gate surge and lightning:
  1. The truth run as in 4.5.
  2. A model run that assimilates the truth's synthetic counts.
  3. At kickoff −30, −15, 0, +10 and +20 minutes, a forecast of 10 and 20 minutes ahead for "do nothing".
- [ ] **6.2 Scores** per zone and horizon:
  - mean absolute error of p50 against the truth;
  - the share of truth values inside p10 to p90 (it should be near 80%);
  - the same error for persistence (the last observed count carried forward).

  Write `validation/forecast-report.md`. Its first line states plainly whether the forecast beats persistence at each horizon. Add the root script `"backtest": "node validation/backtest.ts"`.
- [ ] **6.3 Read real history when it exists.** The script takes `--observations <file>` to read recorded counts instead of a truth run. It is untested until real data exists; say so in the report.

  Verify: `npm run backtest` writes the report; `npm run typecheck`.

### Stage 7: The What if panel

- [ ] **7.1 Pure core** (`app/src/what-if.ts`, tested in `what-if.test.ts`).
  - Build forecast options from:
    - "do nothing";
    - each current dispatch suggestion (`dispatchSuggestions()` in `app/src/suggestions.ts`), as the orders it would send;
    - the order being drafted in the Orders tab, if any.
  - Rank results by p50 danger minutes, then p50 time to clear. A tie in p50 is a tie.
  - The words: "forecast", "likely range", and "inferred" for zones with no observation.
- [ ] **7.2 Panel** (`WhatIfPanel.tsx`), a new rail tab registered in `Rail.tsx`:
  - a **Forecast** button, which sends `forecast` for the plan on the map only, like live orders;
  - for each option: the likely range of time to clear and danger minutes, and the worst zone;
  - a **Send this** button, which goes through the existing `sendOrder` confirmation. Nothing is sent without that click.
  - Show `wallMs` and the time the forecast was made. Grey the result out once the run is more than 60 sim seconds past it.
- [ ] **7.3 Suggestions use forecasts.** `dispatchSuggestions()` takes an optional score per suggestion from the latest forecast and sorts by it when present. Without it, the order is unchanged and every existing test still passes.
- [ ] **7.4 Map** (`ops-layers.ts`, `ops-symbols.ts`):
  - a zone layer coloured by p50 standing density at the horizon's end, for the selected option;
  - an outline on measured zones, and a hatch or dashed outline on inferred ones;
  - colours from the symbol table, readable in light, dark and satellite modes.
- [ ] **7.5 The past.** The Gates tab gains, per zone, a sparkline of observed against modelled counts from `GET /api/observations` and `SceneInfo`. Observed is drawn solid, modelled dashed, and the legend says which is which.
- [ ] **7.6 Browser check.**
  1. Run `npm run serve` with `OBSERVATIONS_ENABLED=1`, `npm run dev`, and `scripts/synthetic-feed.ts` posting into the server.
  2. Forecast at least three options.
  3. Send one, and see it appear in the after-action log.
  4. Check the console is clean.
  5. Say which OS you checked on.

  Verify: `npm test`, `npm run build`, then the browser check.

## Stop and ask

- Anything needs `contracts.ts`.
- Any existing test or scorecard number moves in Stages 1, 3 or 4, or in Stage 2 before 2.5.
- Stage 2.5: always, before making the new walking speed the default.
- A forecast takes more than 5 s (3.7).
- The live run changes when forecasts are requested (3.6). Report the first differing field; never loosen the comparison.
- No existing arrival mechanism can give a fixed rate (1.4).
- Anyone asks to accept images, video, tracks or identities on any route.

## Verification (each stage, before telling the user it is done)

1. `npm ci && npm run typecheck && npm run lint && npm run format:check && npm test && npm run build`.
2. The stage's own verify line above.
3. CI green on Ubuntu, Windows and macOS for the stage branch.
4. Tick the stage's steps here. Update `docs/roadmap.md` (the Phase 5 row) and `CLAUDE.md` where behaviour changed.
