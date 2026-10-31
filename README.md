# Gameday Command

A live police operations tool for game day at Ohio Stadium. It simulates the crowd and traffic, lets a commander trigger an incident, then runs the same moment under up to three response plans side by side and scores each one.

The commander always makes the call. The tool shows tradeoffs; it never tells police what to do. Fan behavior is an **assumption, not a forecast**, and the app says so on screen.

## Forecast layer (in progress)

`engine/src/forecast.ts` now holds the pure ensemble: normalised weights, Gaussian
reweighting, ESS, systematic resampling with jitter, weighted p10/p50/p90 and the
computed improving share. `app/src/sensors.ts` holds the synthetic observation model
(coverage, dropout, latency, seeded noise). Neither is wired to a checkpoint/worker
loop yet, so the app still does not claim forecast skill; see `docs/forecast.md` for
the boundary and the remaining work.

## Architecture

Five npm workspaces plus one frozen contract at the root. `contracts.ts` holds every type that crosses a lane; lanes also import each other's pure modules directly (the app imports the map, playbook and officer tables; the engine imports world hooks and brain defaults). The extra worker messages that are not in the contract — edits, inspection, live police orders, motion — live in `engine/src/edits.ts` and are spoken only by the app and the engine's own worker.

```
                     ┌──────────────────────────────────────────┐
                     │  contracts.ts  (frozen, gameday.v3)      │
                     │  types + decisionKey() + constants       │
                     └──────────────────────────────────────────┘
                              ▲         ▲         ▲
      ┌───────────────────────┘         │         └────────────────────┐
      │                                 │                             │
┌─────┴──────┐   WorldHooks /    ┌──────┴──────┐   POST /decide  ┌─────┴──────┐
│  /engine   │◄──WorldActions───►│   /world    │                 │  /server   │
│            │                   │             │                 │  Hono +    │
│ Web Worker │  one per plan     │ map, incid- │                 │  sqlite    │
│ flow field │                   │ ents, plans,│                 │            │
│ + density  │   DecisionAsk ──► │ officers,   │                 │ cache →    │
│ typed arr. │ ◄── DecisionAnswer│ scoring     │                 │ Kev 8009   │
└─────┬──────┘        │          └─────────────┘                 └─────┬──────┘
      │               │                                                │
      │          ┌────┴─────┐                                          │
      │          │  /brain  │  fan types, situations, decision client,  │
      │          │          │  odds sampling, DecisionTape              │
      │          └──────────┘                                          │
      │                                                                │
      │  TickFrame + DensityGrid (transferred typed arrays)             │
      ▼                                                                │
┌────────────────────────────────────────────────┐                      │
│  /app   Vite + React + PixiJS 8                │◄──── /api proxy ─────┘
│  3 runs side by side, heatmap, scorecards      │
└────────────────────────────────────────────────┘
```

Why it is shaped this way:

- **One worker per plan.** Three plans must run on the identical crowd. Isolated workers with the same seed is the cheapest way to guarantee that; nothing is shared, so nothing can leak between runs.
- **No AI in movement.** Crowd physics is plain code: flow fields on a 2 m grid, walking speed falling as cell density rises. AI answers *decisions only*, at decision points.
- **Decisions are grouped, not per-dot.** Dots that face the same choice in the same rounded context share a `decisionKey`, so one model call answers thousands of dots. Rounding is what makes that possible.
- **Sim time stops for decisions.** When a step raises a key with no answer yet, the clock waits. Anything over 2 s, any error, any odds that do not sum to 1 falls back to `DecisionDefaults` and is counted as a fallback on the scorecard — so the commander can see how much of a run was guessed.
- **Same seed + same tape = same run.** Every answer a run used is recorded on a `DecisionTape`, so a run replays with no model at all. A test asserts identical scorecards.

## Quick start

From a fresh clone. The project runs TypeScript directly with no build step
(`node server/src/index.ts`), so it needs a Node whose type stripping is on by
default — **Node 23.6 or newer**. Development uses Vite without a build;
`npm run build` produces a production bundle when you need one.

```bash
npm install
npm run typecheck
npm test
```

Run it (two terminals):

```bash
npm run serve                      # Hono API on http://127.0.0.1:8787
npm run dev                        # app on http://localhost:5173
```

The app works with no model running: every decision shows as a fallback. To get live fan decisions, start Kev first:

```bash
uv run --extra serve python -m kev.serve --run jaredpalmer/kev-4b --port 8009
```

Everything above works with no configuration. `.env.example` documents all
eighteen environment variables the code reads, each with its default and why you
might change it. Copy it to `.env` only if you need to move a port, a model URL
or an OSM service; the server and the scripts that use these variables load that
file automatically through Node's `--env-file-if-exists`, and run unchanged when
it is absent.

Before a demo, warm the decision cache so fans are answered by the model rather
than the fallback table — `npm run warm`. The shipped seed already covers the
common decisions in clear weather, rain and lightning, so this is only needed
after changing the decision vocabulary, adding a weather case, or demoing an
imported stadium the seed has never seen.

## Where things stand

The real engine runs. Fans arrive on their type's schedule, walk a flow field to the nearest gate by walking distance, queue there against the gate's actual throughput, get admitted, and find a seat. Walking speed falls as the cell they are in fills up. Closing a gate or a street reroutes everyone, and a `redirect` only moves fans an alert actually reached who chose to follow it.

Measured on an 800x800 grid (the stadium plus half a mile at 2 m cells) with 20,000 dots standing for 100,000 fans, in one worker:

- **222x real time** in one browser Web Worker with a warm cache, zero fallbacks
  (254x after the worker pacing fix; the numbers are machine-dependent and the
  test asserts a 10x bar)
- **103x real time** through a lightning delay that asks every dot at once
- **57,974 dot decisions collapse to about 144 distinct model calls**

The real Ohio Stadium map is in, built from an OpenStreetMap extract (way 119153498) covering the stadium plus half a mile: an 800x800 grid of 2 m cells with 11 gates (Gate 8 omitted: no lot reaches it), the bowl and its concourse, 140 parking lots, and closable real streets — Woody Hayes Drive, Lane Avenue, Cannon Drive. Three plans run on it side by side with 100,000 fans at **56.8x real time each** — and that is the UI's speed setting, not the engine's ceiling.

Refetch the map with `npm run fetch-map` (it is committed, so you only need this to update it).

All four incidents work — a lightning delay, a gate surge at a north gate at kickoff, a suspicious package closing a street as the game lets out, and the final whistle with the whole crowd leaving — each with three editable plans. The commander briefing comes from Apple's on-device model through `fm serve`, and every number in it is checked against the scorecard before it is shown; one invented figure and you get the template instead.

The commander view has the live map with a density heatmap, the incident panel, a plan editor that edits each step's timing and size, the three runs side by side, a scorecard each, the briefing, a replay scrubber over the kept frames, a deciding indicator while sim time waits on Kev, and dot detail — click any dot to see which group it belonged to, what it was deciding, the odds it was given, and whether a model or the fallback table answered. The Orders tab adds live police work on the plan on the map: dispatch suggestions, responses, patrols, coverage, roadblocks, markers and an after-action report. On first visit, a skippable demo sign-in picks supervisor or a single officer unit; officer mode opens the unit console. See "Police operations" below.

### The demo, driven end to end

The gate surge is now a 5,000-fan late rush on Gate 2, with Gate 1 as the relief gate. Earlier demo tables (6 min / 9 min / never) described the old Gate 1 turnstile jam and should not be quoted. The current gate-surge plans are:

| | Plan A | Plan B | Plan C |
| --- | --- | --- | --- |
| what it does | six officers to Gate 2 | open Gate 1 + PA redirect | close Gate 2, phone alert, four officers |
| clears in (headless, defaults) | **17.3 min** | 26.9 min | 19.4 min |

The tradeoff is the point: officers alone clear Gate 2 fastest but reach nobody; opening Gate 1 spreads the load and the PA reaches people, at the cost of time; closing Gate 2 and redirecting is slower than officers alone and moves the pressure rather than removing it. Re-measure in Chrome with a warm cache before putting numbers on stage; `CLAUDE.md` keeps the latest figures and their caveats.

A full three-plan run is 90 simulated minutes. In the last browser demo three workers of 20,000 dots each finished in 95 seconds — **56.8x real time per plan** against a 10x bar — and that is the UI's speed setting rather than the engine's limit; unpaced in one worker it reaches 222x. The briefing underneath the scorecards is written by the on-device model from those numbers alone.

The three **lightning delay** plans separate too, which they did not until officers
were made to change what the crowd does rather than only to cost officer minutes:

| | danger minutes | fallback decisions |
| --- | --- | --- |
| A, shelter order + PA | 284,704 | 144 |
| B, gates open + officers on the gates | **278,758** | 1,021 |
| C, phone alert, shelter order at two minutes | 283,901 | 514 |

B buys the lowest danger minutes, and gets roughly 1,300 more fans out of the
open, by spending officers and far more model decisions. A is nearly as safe for
a fraction of both. Again: a tradeoff, not a recommendation.

### Verified, and not

| Requirement | State |
| --- | --- |
| Workspaces, typecheck, tests | **403 checks in 68 files (398 pass, 5 skip)**, `tsc` clean |
| Contract | **`gameday.v3`**; v3 added the `game_end` incident |
| Engine in a worker, no AI in movement | yes; flow fields, seeded RNG, frames every 15 s, snapshot **and** seek-to-rewind exercised through the worker |
| 20,000 dots at 10x or faster | **222x** in one browser worker, **56.8x** per plan with three running in the app (recorded on the development Mac) |
| Stadium map from OSM at kickoff minus 60 | yes, 800x800 cells from a committed extract |
| Four incidents, 3 editable plans each | gate surge, lightning, suspicious package and **game end**, all on the stadium map |
| Same moment, same seed, three plans | yes, side by side |
| Scorecard, checked against a hand count | yes, on the 3 gate test map |
| Decisions grouped, cached, sim pauses, fallbacks counted | yes; **57,974 dot decisions to about 144 model calls** |
| Live decisions from the real Kev-4B on :8009 | **yes**, MLX on the development Mac, `source: "kev"` end to end |
| Fans actually get into the stadium | **17,219 of 20,000** by kickoff plus 30 (default decisions) |
| DecisionTape replay gives identical scorecards | yes, proven by test |
| Cold-cache lightning under 60 s | **43.2 s** against the real Kev-4B |
| Briefing from `fm serve`, numbers checked | yes, verified live; 399-token prompt |
| Police responses, patrols, suggestions, coverage, roles, roadblocks | built and unit-tested; **browser QA outstanding** (see `docs/police-ops.md`) |
| App screens | all built and seen rendering in Chrome |
| Runs with Kev off, every decision a fallback | yes, tested |
| Full demo in a fresh browser | Chrome and the Mac's default browser completed an earlier build; **Safari is still unverified** — see below |

**Safari is the one unresolved browser.** A run had not finished, almost certainly because the worker's pacing loop slept once per simulated second and Safari clamps timers to about a second in a tab whose app is not frontmost. The loop now makes up every step the wall clock owes before sleeping, so a clamped timer costs fewer, bigger batches rather than a slower run; the same change took the Chrome bench from 222.5x to 254.4x. **Whether Safari now completes has not been confirmed:** the verifying run was cut short. Demo in Chrome.

Everything else above was watched happening. `CLAUDE.md` carries the remaining open items, the largest being that a cold cache is mostly fallbacks for its first eighty seconds while the background warmer catches up.

## Vehicles and weather (added in gameday.v2)

Traffic and weather were added when the contract went to `gameday.v2`; it is now `gameday.v3`, which added the `game_end` incident. Every traffic and weather addition is optional, so a run with no traffic and clear weather steps exactly as v1 did, and a test holds that down.

- **About 3,300 vehicles at real size on Ohio Stadium's 3,860 stalls.** The count follows each map's stalls instead of a fixed 4,500, so imported grounds scale down. Compacts, sedans, SUVs, pickups, minivans, rideshares, motorcycles, RVs, charter buses, a police cruiser and an ambulance, each with its real footprint (`world/src/vehicles.ts`) and drawn to scale, so a 13.7 m coach is visibly almost three sedans long.
- **They drive like the crowd walks.** Road flow fields, bumper-to-bumper queues on each vehicle's footprint, lane changes when blocked, and **they yield to people**: a car will not drive into a crowd, which is what stops Lane Avenue when the game lets out (`engine/src/traffic.ts`).
- **Parking is real.** Stalls are laid out in every road-connected OSM lot (3,860 at Ohio Stadium); buses and RVs take a run of stalls along a row. Lots fill, and drivers who find every reachable lot full turn back out.
- **Fans and cars are linked one way.** Fans who choose to go back to their car free up a parked car to leave; at the final whistle the lots empty over the next hour. Traffic runs on its own RNG and never writes to the crowd, so **the pedestrian scorecard is identical with traffic on** (tested).
- **An ambulance responds to every incident.** It drives from the best edge entry to the incident and the scorecard records how long it took: crowds and closures slow it, which is a tradeoff plans now show.
- **Weather timelines** (`world/src/weather.ts`): clear, rain at kickoff, a thunderstorm, snow, river fog, heat. Weather slows walkers and drivers and sets the decision context's `weather`, and a lightning delay always shows lightning. Non-clear skies create new decision keys, so the first run in new weather leans on fallbacks until Kev has answered them.

The map is now zoomable (scroll, drag, double-click, or Fit / Stadium / Incident) and glides between frames. The heatmap is drawn in five density bands; **click a colour** in the legend or on the map to isolate it on all three runs and list where those areas are, with a zoom-to button for each. Click any vehicle for its type, size, state, speed and time stopped.

### Congestion, police hotspots and the 3D stadium

- **Three views:** a 3D close-up of one plan, a large **2D plan** of one plan, and all three side by side.
- **Traffic flow:** roads under moving vehicles are coloured green (moving), amber (slow) or red (jammed), in 2D and 3D.
- **Most congested right now:** a ranked list per plan, merging packed standing crowds and stopped traffic, with numbered pins on the map and a button to fly to each. Seated fans are left out.
- **The Horseshoe in 3D:** tiered stands around a field with yard lines and end zones, the crowd sitting on the tiers, street centre lines and names from OpenStreetMap.

### Commander's brief, any stadium, and real conditions

- **Start empty, import any stadium.** With no `?map=`, a skippable demo sign-in offers supervisor or a single officer unit, then the app opens on a stadium chooser. Search OpenStreetMap by name and import: the server downloads the stadium and half a mile around it and builds the map, streets, lots and gates (gate count scales with capacity; gates are placed evenly, an assumption shown as such). Imported stadiums are saved under `data/stadiums/`.
- **Right now, low / medium / high.** Every gate's queue and every street's stopped vehicles, levelled against what is usual at that minute to kickoff from past runs of that stadium (each finished run adds to the history), or fixed thresholds until there is history.
- **Real conditions.** Upload or fetch a JSON/CSV feed of gate queues and stopped vehicles (format in `app/src/conditions.ts`); the brief then reads it instead of the simulation and says where the numbers came from. Only what the feed reports is shown.
- **Suggested plans.** One click builds three editable plans from the current conditions: redirect the busiest gate to a quiet one, close it and move its queue, or officers plus a street closure.
- **Best for your priority.** Pick what matters most (clear fastest, least crush risk, fewest officers, ambulance access) and the plans are ranked by it. The tool still does not decide; it says "your call".
- **What do you think?** After a comparison, the commander records the plan they would pick, whether they agree with the ranking, and a note.
- **Plan-step dropdowns.** Add any step from menus: close or open a gate or street, send officers, redirect, alert, shelter.

### Spoken orders, the plan scoreboard and shortcuts

- **Orders in plain words.** The box above the map takes typed or spoken orders: "close gate 3 in 2 minutes", "send 4 officers to gate 2", "redirect gate 1 to gate 5", "PA: use the west gates", "close Woody Hayes Drive". Names are matched against the map's own gates, streets and places in plain code, never a model, and an order that names nothing is refused with a "did you mean". Nothing happens until the commander confirms, either as a live order on the plan on the map or as a step added to a plan.
- **Hands-free.** Hold Space (or click the mic) and speak. A spoken order is read back with "say yes to confirm", and the mic opens again for the answer. The same box runs the app ("run the plans", "pause", "show 2D", "shift to plan B"), answers questions from the plan's own numbers ("what's the worst gate?", "how many officers are free?", "status") and undoes ("undo that").
- **Where the audio goes.** The mic uses the browser's own speech recognition: Chrome sends the audio to Google's speech service, Safari uses Apple's, and Brave blocks it (the app says so). Any dictation tool that types into the box (macOS dictation, Handy) also works and keeps audio on the laptop. Only `app/src/speech.ts` would change for a local recogniser.
- **Plan scoreboard.** The Plans tab opens with A, B and C side by side: who is in the zone and dangerously packed while they run, then time to clear, crush-risk minutes and officer time, the best of each marked.
- **Keyboard.** Space (hold) to talk, `/` to type, `1` `2` `3` to put a plan on the map, `P` to run or pause, `?` for the list.
- **Decision cache in every weather.** Weather is part of each fan decision's key, so `WARM_WEATHER=rain-at-kickoff npm run warm` (or `thunderstorm`) fills the answers a rainy or stormy demo needs; `WARM_SETTLE_S` waits longer for a Kev short of memory.

### Police operations

The **Orders** tab drives the plan on the map while it runs. Orders go to that plan only; the other two keep to their written plan, which is the comparison the tool exists to show.

- **Dispatch suggestions.** Nearby hotspots merge into a ranked list. Prefer standby or patrolling units, keep the last unit at a critical hotspot, and use the worker's own walking ETA; each suggestion says what it is for, why, its cost and how long the assignment lasts. Send all, modify or dismiss with an optional reason; dismissals cool down for five simulated minutes.
- **Responses, not just markers.** An officer walks a reachable outdoor route, repeats instructions to the crowd around them, works the assignment for three simulated minutes, then returns to their post. Instructions rank open gates by queue clearance and walking cost. Arrival and mission progress survive a rewind.
- **Patrols and units.** Deterministic outdoor beats come from the map, with a gate fallback on road-free maps. A response can interrupt a patrol and the officer resumes afterwards. Synthetic units can be added or removed, and all of it survives replay.
- **Coverage.** Current reach can be drawn in both map views, with the share of outdoor walkable area covered, uncovered hotspot centres, the slowest suggested walk, and an optional "reachable within N minutes" straight-line estimate. It is geometry, not a safety claim.
- **Roadblocks and markers.** Jersey barriers stop vehicles only, bike-rack fencing stops pedestrians only, and combined barriers stop both. Barriers can be moved or resized by clicking the road; the panel lists each one and the stopped vehicles observed within 50 m. Staging, medical and PA markers can be placed, and a PA marker sets an alert's radius.
- **Traffic control.** Officers on a traffic assignment alternate junction entry directions with clearance intervals, and emergency vehicles are exempt. A unit can also be placed directly as a manual control point on a junction.
- **Demo roles and the officer console.** The sign-in can hand the same run to one unit. That view shows the assignment, acknowledgement, simulated status, walking ETAs, camera follow, backup requests and map incident reports; supervisor controls are hidden and guarded.
- **After-action and undo.** The run log downloads as an HTML after-action report. Undo sends the inverse order forward in time rather than rewinding; an alert already heard, a release or a filed report has no inverse.
- **Recorded motion.** Intermediate samples let both map views play paths around corners instead of drawing straight lines between 15-second frames. It is rendering only, never simulation state or an RNG draw.

`docs/police-ops.md` has the shipped list, the measurements and the remaining gaps (vehicle physics, incident resolution and browser QA are the big ones).

## Rules this project holds to

- No Claude API and no paid API. Models run locally: Kev via MLX, the briefing via Apple's on-device `fm serve`.
- No faces, no identities, ever. Future sensor input is people counts per zone only.
- Fan behavior is labeled on screen as an assumption, not a forecast.
