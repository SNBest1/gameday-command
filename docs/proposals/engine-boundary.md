# Engine boundary proposal

Status: proposal only. No code changes in this phase.

The engine still imports `world/` and `brain/` directly. This document lists every
such import in `engine/src/`, grouped by the symbol imported, and proposes how
each one stops crossing that boundary. None of the proposals needs
`contracts.ts` to change.

Line numbers were taken from the Phase 1 branch.

## Runtime imports

| Symbol | Imported from | Used by | Proposal |
| --- | --- | --- | --- |
| `DecisionClient` | `brain/src/client.ts` | `engine/src/sim.ts:23` | **(a) Pass it in.** `SimulationOptions.client` already exists; make it required-ish by supplying it from the host (browser worker, Node worker, parity test) and remove the `new DecisionClient(...)` fallback from `sim.ts`. Define the small interface the engine needs in `engine/`; `brain/` keeps the implementation. |
| `sampleOdds` | `brain/src/sample.ts` | `engine/src/sim.ts:24` | **(b) Move it.** A pure sampling function over `Odds`; it belongs beside the engine's RNG. `brain/` re-exports it if its own code still needs it. |
| `Scorer`, `ScorerState` | `world/src/scoring.ts` | `engine/src/sim.ts:25` | **(a) Pass it in.** Define a `Scorer` interface in `engine/` (constructor, `observe`, `scorecard`, `capture`, `restore`) and accept an instance in `SimulationOptions`. `world/scoring.ts` remains the implementation. |
| `createWorldHooks`, `WorldRuntime` | `world/src/hooks.ts` | `engine/src/sim.ts:26` | **(a) Pass it in.** Accept a `WorldHooks` value in `SimulationOptions`; the host or the world package builds it. This is the largest single change: the engine no longer knows which plan steps exist. |
| `GAME_END_S` | `world/src/incidents.ts` | `engine/src/sim.ts:27` | **(a) Pass it in.** Add `gameEndAt` to the engine-owned `SimulationOptions`; the host computes it from the incident. Do not add it to `SimConfig` (that would need a contract change). |
| `lateRushFor` | `world/src/incidents.ts` | `engine/src/sim.ts:27` | **(a) Pass it in.** Precompute `{ fans, fromS, toS, gateId }` in the host and pass it in `SimulationOptions`; the engine only applies it. |
| `CLEAR_SKY` | `world/src/weather.ts` | `engine/src/sim.ts:28` | **(b) Move it.** `WeatherState` is already a contract type; the clear-sky constant belongs in the engine's weather module. |
| `decisionWeather` | `world/src/weather.ts` | `engine/src/sim.ts:28` | **(b) Move it.** It maps a `WeatherState` to the decision context's `weather` string. That is simulation input, not map data. |
| `walkFactor` | `world/src/weather.ts` | `engine/src/sim.ts:28` | **(b) Move it.** The walker speed multiplier is part of the movement model. |
| `weatherAt` | `world/src/weather.ts` | `engine/src/sim.ts:28` | **(b) Move it.** Selecting the weather segment at sim time is deterministic simulation logic. The world package keeps the timeline data and labels. |
| `OFFICER_REACH_CELLS` | `world/src/officers.ts` | `engine/src/sim.ts:29` | **(b) Move it.** Used only for the engine's officer instruction radius. |
| `OFFICER_SPEED_MPS` | `world/src/officers.ts` | `engine/src/sim.ts:29` | **(b) Move it.** The officer walk speed is movement physics. |
| `expandCells` | `world/src/incidents.ts` | `engine/src/traffic.ts:13` | **(b) Move it.** It is a pure grid utility (expand a cell set by a radius). Put it beside the engine's grid helpers. |
| `isLongVehicle` | `world/src/vehicles.ts` | `engine/src/traffic.ts:14` | **(a) Pass it in.** Vehicle footprint data is a traffic input. Add an engine-owned vehicle catalog to the `TrafficModel` constructor options and let the host pass `world`'s catalog. |
| `VEHICLE_TYPES` | `world/src/vehicles.ts` | `engine/src/traffic.ts:14` | **(a) Pass it in.** Same catalog as above; the engine needs dimensions, not the map package's presentation labels. |
| `driveFactor` | `world/src/weather.ts` | `engine/src/traffic.ts:15` | **(b) Move it.** The driver speed multiplier is traffic physics, like `walkFactor`. |

## Test-only imports

These are fixtures and assertions in `engine/src/*.test.ts`; they do not cross the
runtime boundary. They may stay as they are, or move into a shared test-support
module if the team prefers one:

| Symbol | Imported from | Used by |
| --- | --- | --- |
| `DECISION_DEFAULTS` | `brain/src/defaults.ts` | `density-contribution.test.ts`, `edits.test.ts`, `engine.test.ts`, `exit.test.ts`, `flow.test.ts`, `ingress.test.ts`, `orders.test.ts`, `perf.test.ts`, `police-response.test.ts`, `replay.test.ts`, `traffic.test.ts`, `worker-core.test.ts` |
| `makePopulation` | `brain/src/fan-types.ts` | same test files, plus `traffic-control.test.ts` |
| `DecisionClient` | `brain/src/client.ts` | `replay.test.ts` |
| `GAME_END_S`, `gameEnd`, `gateSurge`, `lightningDelay`, `testGateSurge`, `windowFor` | `world/src/incidents.ts` | several test files; `worker-core.test.ts` |
| `makeOfficers` | `world/src/officers.ts` | several test files |
| `buildStadiumMap`, `extractExists`, `loadExtract` | `world/src/osm/stadium.ts` | `density-contribution.test.ts`, `game-end-traffic.test.ts`, `ingress.test.ts`, `traffic.test.ts` |
| `playbookFor` | `world/src/playbook.ts` | several test files |
| `makeTestMap`, `TEST_GATE_THROUGHPUT_PER_MIN` | `world/src/test-map.ts` | several test files |
| `VEHICLE_TYPES` | `world/src/vehicles.ts` | `traffic.test.ts` |
| `CLEAR_SKY` | `world/src/weather.ts` | `game-end-traffic.test.ts`, `traffic-control.test.ts`, `traffic.test.ts` |

## Order of work

1. Inject `DecisionClient`, `Scorer`, `WorldHooks`, `gameEndAt` and `lateRush` through `SimulationOptions`; these remove most of `sim.ts`'s imports without changing results.
2. Move the pure weather math and constants, `sampleOdds`, `expandCells`, and the officer constants into `engine/`.
3. Move the vehicle catalog into traffic options; leave map data and labels in `world/`.
4. Re-run the parity tests after each step; any scorecard or frame difference is a bug in the boundary change, not a reason to loosen the comparison.

No proposal requires a `contracts.ts` change. If a future step does, mark it
**"needs contract change, ask the team"** and stop.
