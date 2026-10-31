# Police operations

Written 2026-10-31. This replaces the handoff report that used to live at
`CHECK THIS.MD`. The work was developed on `feat/police-ops`, merged into `main`
as PR #6 (`fe1987a`), and finished after the merge in `8a12cc0`. The branch
report claimed `main` was unchanged and that after-action and undo were still
open; neither is true any more.

## What shipped

- **Working responses.** An officer walks a reachable outdoor route, repeats
  crowd instructions on arrival, works the assignment for three simulated
  minutes, then returns to their original post. Instructions rank open gates by
  queue clearance plus walking cost. Arrival times and mission progress survive
  a rewind.
- **Traffic control.** Officers on a traffic-response assignment alternate
  junction entry directions with a clearance interval. Emergency vehicles are
  exempt. This changes vehicle movement, not just the officer marker. A unit can
  also be placed directly as a manual control point on a junction.
- **Dispatch suggestions.** Nearby hotspots merge into ranked suggestions. The
  rule prefers standby or patrolling units, protects the last unit at a critical
  hotspot, and uses worker-calculated walking ETAs. The panel supports send
  all, send one, modify the target, dismiss, and an optional dismissal reason;
  dismissals cool down for 300 sim seconds, or until severity rises 25%.
- **Patrols.** Deterministic outdoor beats are generated from the map, with a
  gate fallback on road-free maps. A response can interrupt a patrol, and the
  officer resumes it afterwards. Patrol state survives rewind.
- **Unit placement.** Synthetic officers have deterministic ids, can be added or
  removed, and are captured in checkpoints.
- **Coverage.** Both map views can draw current officer reach. The panel reports
  the share of outdoor walkable area covered, uncovered hotspot centres, the
  slowest suggested walk, and an optional "reachable within N minutes"
  straight-line estimate. This is geometry, not a safety claim.
- **Demo roles.** A skippable sign-in offers supervisor or a single officer
  unit. The choice is stored as role and unit only and can be switched within a
  run. Reduced-motion is respected.
- **Officer console.** Assignment details, acknowledgement, simulated status,
  camera follow, nearby walking ETAs, backup requests and map-based incident
  reports. Supervisor controls are hidden and guarded in this mode.
- **Roadblocks and markers.** Jersey barriers stop vehicles only, bike-rack
  fencing stops pedestrians only, and combined barriers stop both. Barriers can
  be moved or resized by clicking the road. The panel lists every roadblock and
  the stopped vehicles observed within 50 m. Staging, medical and PA markers can
  be placed; a PA marker defines an alert's radius.
- **Recorded motion.** Intermediate movement samples let both map views play
  paths around corners instead of drawing straight lines between replay frames.
  It is a rendering extension only, never simulation state or an RNG draw.
- **After-action and undo.** The run log downloads as an HTML after-action
  report. Undo sends the inverse order forward in time rather than rewinding;
  effects that cannot be taken back (an alert already heard, a release, a filed
  report) have no inverse.
- **Imported-stadium routing and parking.** Wider walking-route preferences near
  buildings, explicit parking connectors, capacity-based traffic counts, and
  alternate reachable entry selection. Ohio Stadium keeps its calibrated parking
  approaches.
- **Lightning performance.** Exhaustive shelter-cell searches were replaced with
  an exact spatial index that preserves eligibility and tie-breaking.

Most of this lives in `engine/src/sim.ts`, `engine/src/traffic.ts`,
`engine/src/motion.ts`, `world/src/officers.ts`, `app/src/PolicePanel.tsx`,
`app/src/suggestions.ts`, `app/src/coverage.ts`, `app/src/after-action.ts`,
`app/src/roles.ts` and `app/src/OfficerConsole.tsx`. When you change the police
behaviour, re-read "Live police orders" in `CLAUDE.md` first: orders must go to
the plan on the map only, and must be replayed after a rewind.

## Measurements

These were taken during the police-ops work on the development machine. They are
local measurements, not a controlled benchmark, and later changes have moved
some of them.

- The suite at handoff was 348 passed, 3 skipped; `tsc` was clean and the
  production build passed before the final Ohio compatibility adjustment.
- Lightning in the full test run: 16.3x real time.
- Crowd fingerprints with 24 and 60 officers, traffic on and off, were identical
  before and after.
- With motion recording on, traffic benchmarks were 5.20 ms/s with 24 officers
  and 5.13 ms/s with 60, against earlier references of 4.57 and 4.82.

The current suite is recorded in `README.md`; re-measure before quoting a number
on stage.

## Imported stadiums (Wembley check)

- Wembley's saved map has 117 mapped surface stalls, so the app schedules 99
  synthetic vehicles rather than blindly scheduling 4,500.
- Reachable entry selection raised parked vehicles from 73 to 90 of 99 in the
  comparable capacity-based test.
- Wider routes reduced the measured stationary outdoor crowd from 10,730 to
  4,950 people.
- Accepting suggested responses once produced 2,470 people instructed, 1,300
  following and 58,910 seated, against 58,405 seated in the original run. Danger
  minutes rose about 2.6%, so this is evidence of changed behaviour and fewer
  stationary people, not of a safer outcome.

The stricter connectors caused an Ohio traffic regression during testing. The
shipped code preserves Ohio's calibrated parking behaviour; its final benchmark
returned to the original 65 stopped / 1,360 out figures.

## Still open

1. **Vehicle physics is the largest gap.** Full rectangular collision
   enforcement, parking drive aisles, collision-safe stall entry and departure,
   reversing, departure staggering, turning-radius limits, and squeeze counters
   or visual indicators are unfinished. Do not claim cars never overlap or clip
   buildings.
2. **Incident resolution is limited.** Officers influence crowds and traffic,
   but medical incidents, fights and suspicious items have no separate
   resolution lifecycle that completes when officers arrive.
3. **Routing needs broader validation.** Wembley improved but still shows some
   stationary congestion. Test several imported stadiums through arrivals,
   parking, closures and departures. Ohio still uses its older driveway
   behaviour until the stricter connector model can be generalised.
4. **Coverage is partial.** Current reach, hotspot walking ETAs and an optional
   straight-line "reachable within N minutes" share exist. The reachable-area
   grid, uncovered-area hatching, complete beat geometry and further response
   readouts are unfinished.
5. **Suggestion auditing is partial.** The live log records dismissals and their
   reasons, and a suggestion shows how long its hotspot has been seen, but there
   is no durable audit/expiration log and no richer description of which posts
   become uncovered.
6. **Officer mode uses a same-tab fallback.** Two-window synchronisation through
   `BroadcastChannel` is not implemented. Camera following, phone-width layout,
   focus handling and request workflows still need browser verification.
7. **Roadblock placement is click-based.** True click-drag endpoints are
   unfinished, the reach control can include connected junction branches, and
   distinct barrier artwork in 2D, longer pedestrian fences, changing a barrier's
   kind, and more rewind combinations need work. Stopped-nearby counts do not
   prove vehicles were held by that particular barrier.
8. **Browser QA is outstanding.** Check desktop and 390 px layouts, both themes,
   vehicles at 20x and 60x, patrols, automatic returns, placement, role
   switching, reports and rewind.
9. **Release checks.** Re-run the full suite and production build after the last
   compatibility change, measure three simultaneous browser workers and
   rendering performance with 24 and 60 officers, and run the live-model tests
   with Kev and `fm serve` up.
10. **Optional M7 features not implemented:** hotspot watch, fatigue indicators
    and audio cues. After-action exports, undo and keyboard shortcuts have since
    shipped.

## Reproducing the measurements

These scripts are manual and deliberately not part of `npm test`:

```bash
node scripts/police-baseline.ts            # crowd fingerprints, 24/60 officers, traffic on/off
node scripts/police-baseline.ts --motion   # the same with recorded motion and packet sizes
node scripts/diagnose-stadium.ts [saved-map.json] [--capacity]
node scripts/diagnose-imported-crowd.ts saved-map.json [comparison-module.ts] [--responses]
```

Pass saved stadium JSON from the import path under `data/stadiums/`.
