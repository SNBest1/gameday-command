# Roadmap

Gameday Command is moving from a hackathon demo to a tool for live police operations. The full reasoning is in the team's shared doc, "Gameday Command: what to rebuild". This file tracks status.

**How work happens.**

1. Claude writes a plan in `docs/plans/`.
2. DeepSeek v4.1 implements it in opencode, on the plan's own branch. It first searches for skills that could help, then works through the plan's steps (see "How to work a plan" in `AGENTS.md`). A prompt to start it:

   ```
   Read AGENTS.md and docs/plans/<plan>.md. Search for skills that could help with this plan and record them under "Skills used", then implement the plan step by step.
   ```

3. Claude reviews the branch.
4. The user merges it into `main`. Nobody else commits to or pushes `main`.

Everything must work on both macOS and Windows; CI checks Ubuntu, Windows and macOS.

## Decisions so far (2026-10-31)

| Question | Decision |
| --- | --- |
| Hackathon rules (no paid APIs, one Mac) | No longer apply |
| Where it runs | Both: on police premises and hosted |
| Vision | Camera counts are the goal (2026-10-31): live and past counts feed the forecast. Counts only, never faces or identities. The camera pipeline waits on camera access and legal review |
| Purpose | Live police operations, not training |
| Who owns validation against real data | Not decided |
| Who talks to OSU and police about data | Not decided |

## Phases

| # | Phase | Status | Plan | Done when |
| --- | --- | --- | --- | --- |
| 0 | Foundations | Done, merged into `main` (0cdbb5e) | [phase-0-foundations.md](plans/phase-0-foundations.md) | CI green on every PR; lint and format enforced; `App.tsx` split; app imports engine only through `engine/src/index.ts` |
| 1 | Headless engine and validation | Done, merged into `main` (dd52adb) | [phase-1-headless-engine.md](plans/phase-1-headless-engine.md) | Server-side and browser runs give identical scorecards; validation report compares the model with cited published data |
| 2 | Real data | Needs people, not code | [briefs/real-data.md](plans/briefs/real-data.md) | One past game day replayed against its real gate counts |
| 3 | Map UI | Done, merged into `main` (7fcba7d) | [phase-3-map-ui.md](plans/phase-3-map-ui.md) | GIS map replaces the gamified view as the default |
| 4 | Voice | Done, merged into `main` (2a3d9cb) | [phase-4-voice.md](plans/phase-4-voice.md) | Spoken orders go through tool calling to typed `PoliceOrder`s, confirmed and audited |
| 5 | Prediction from live observations | Planned, Stage 1 next | [phase-5-prediction.md](plans/phase-5-prediction.md) | Forecasts fork from the live state, follow posted zone counts, and beat persistence in a backtest; the What if panel sends the chosen option through the usual confirmation |
| — | Camera pipeline (vision) | Wanted; waits on camera access and legal review | [briefs/vision.md](plans/briefs/vision.md) | Edge devices post zone counts to the Phase 5 observation route; video never leaves the edge |

A brief becomes a full plan when the phases before it are done, because each depends on what those phases find.

## Merging (2026-10-31)

Phases 1, 3 and 4 were stacked branches and are merged into `main` in that order, one merge commit each, followed by `feat/satellite-basemap` (e8f84b0), which adds a **Satellite** imagery button to the operations map. Each branch was green in CI on Ubuntu, Windows and macOS and was reviewed by the planner. Each was checked in Chrome on Windows only, so check the merged `main` on a Mac.

| Branch | Adds | Review fixes made |
| --- | --- | --- |
| `phase-1/headless-engine` | Engine in Node workers behind `POST /api/runs` and a WebSocket (`gameday-wire.1`); `?engine=server` in the app; parity test; `npm run validate` against Jülich data; engine boundary proposal | Idle timer, bounded pre-viewer buffer, errors back to the right socket, `RUNS_MAX` cap, frame-by-frame parity |
| `phase-3/map-ui` | MapLibre + deck.gl operations map as the default view; `/api/maps/:id/geo`; offline grid basemap; PMTiles support; neutral comparison wording | Parked cars no longer drawn as jams; grid basemap only when tiles fail; dark tile style; root `.env` reaches Vite; readable labels in both themes |
| `phase-4/voice` | Recorded speech through any OpenAI-compatible speech-to-text server; LLM tool calling over the existing orders with fallback to the old parser; voice audit log in the after-action report | Body limits, a 500-character cap and a per-IP rate limit on the voice routes; bounded log entries; malformed tool calls fall back |
| `feat/satellite-basemap` | Satellite imagery option on the operations map (`VITE_SATELLITE_TILES`, default Esri World Imagery; check its terms before operational use) | None |

## Findings and next steps

1. **The crowd model walks too slowly in open space, and the measuring code has bugs too.** Phase 5 Stage 1 fixes the measuring (density counted part-way through the loop, a 60 m² area labelled 30 m², a window that overlaps where fans are admitted, and a bottleneck that counts admissions rather than crossings); Stage 2 fixes the walking. `validation/report.md` shows the model at about 0.5 m/s at low density, where the Jülich corridor measured about 1.1 m/s. The likely cause: each dot is 5 people in a 2 × 2 m cell, so a group walking alone already counts itself as 1.25 people/m². The Weidmann curve then slows it to about 69% of its free speed before any other crowd is near. Fixing this is a deliberate model change that alters every scorecard, so Stage 2 stops for a team decision before making it the default. The validation suite is the tool to judge it. The bottleneck comparison is also erratic across opening widths (1.1 to 6.3 people/m/s), which suggests gate admission, not walking, is setting flow there.
2. **Authentication and roles come before any hosted deployment.** The API (runs, voice, voice log with police transcripts) has no authentication. `docs/voice-setup.md` says so. This should be the next plan.
3. **Real data (Phase 2) needs a person.** Nobody owns contacting OSU athletics and the police yet; see `briefs/real-data.md`.
4. **Engine boundary.** `docs/proposals/engine-boundary.md` lists how the engine stops importing `world/` and `brain/`; none of it needs a contract change. It is ready to become a plan once the team agrees.
5. **Tell Nipun:** Phase 0's formatting pass reformatted `contracts.ts`. Its contents are unchanged, but the frozen file's bytes changed.
6. **Smaller items:** `Rail.tsx` is one large component with many props. The speech-to-text live test was skipped because no test recording was available.
