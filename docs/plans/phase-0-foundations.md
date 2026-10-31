# Phase 0: Foundations

Branch: `phase-0/foundations` (from `main`).

## Goal

Make the repo safe to change. A machine checks every change, the code has one style, the documentation says what the code does, `App.tsx` is small enough to work in, and the app reaches the engine through one public entry point.

**This phase changes no behaviour.** Every scorecard, every frame and every test result must be the same before and after.

## Definition of done

- `.github/workflows/ci.yml` runs install, typecheck, lint, format check, test and build on every push and pull request, and passes.
- `npm run lint` and `npm run format:check` exist and pass.
- `README.md` and `CLAUDE.md` match the code on the points listed in Stream C.
- `app/src/App.tsx` is under 700 lines, and every piece moved out of it behaves exactly as before.
- No file under `app/` imports from `../../engine/src/<anything>` except `../../engine/src/index.ts` and the worker URL `../../engine/src/worker.ts`. A lint rule enforces this.
- `npm run typecheck && npm run lint && npm test && npm run build` pass.

## Constraints

- Follow `AGENTS.md`. In particular: do not touch `contracts.ts`, do not change engine logic, and do not edit tests except where a step says so.
- The only new dependency allowed is `@biomejs/biome` (dev dependency, exact version).
- The formatting commit (step B3) contains formatting only and nothing else.
- Moves out of `App.tsx` are cut-and-paste plus imports and props. Do not rename state, change effect dependencies or "tidy" logic while moving it.

## Non-goals

- The engine's own imports of `world/` and `brain/` stay as they are (that is Phase 1).
- No fixing of lint findings that need logic changes. Turn those rules off and list them (step B2).
- No new features, no UI changes, no dependency upgrades.
- No GitHub settings changes (the user does branch protection; see "Human steps").

## Streams and files

Run the streams in this order: **A and C together, then B, then D, then E.** B reformats every file, so nothing else may run alongside it. D and E both edit `app/` files, so they run one after the other.

| Stream | Owns these files |
| --- | --- |
| A: CI | `.github/workflows/ci.yml` (new), `engine/src/perf.test.ts` |
| B: Lint and format | `biome.jsonc` (new), `.gitattributes` (new), root `package.json`, `package-lock.json`; then every source file, for the formatting commit only |
| C: Doc drift | `README.md`, `CLAUDE.md` |
| D: Engine entry point | `engine/src/index.ts` (new), the app files that import engine internals (listed in D2), `biome.jsonc` (the one rule in D3) |
| E: Split App.tsx | `app/src/App.tsx` and the new files listed in E1 to E4 |

## Steps

### Stream A: CI

- [ ] **A1.** Gate the two throughput tests in `engine/src/perf.test.ts` behind an environment variable. Shared CI machines are slower and busier than a laptop, and `CLAUDE.md` says these assertions are load-sensitive. Change `describe('engine throughput', ...)` to `describe.skipIf(!process.env.PERF)('engine throughput', ...)`. Change nothing else in the file.
  Verify: `npm test` shows the two tests skipped. `PERF=1 npx vitest run engine/src/perf.test.ts` runs and passes them locally.
- [ ] **A2.** Create `.github/workflows/ci.yml`:
  - Triggers: `push` and `pull_request`.
  - Job: `ubuntu-latest`, `timeout-minutes: 30`.
  - Steps: `actions/checkout@v4`; `actions/setup-node@v4` with `node-version: 24` and `cache: npm`; `npm ci`; `npm run typecheck`; `npm test`; `npm run build`.
  - Lint and format steps are added in B4, once those scripts exist.

  Verify: push the branch and check that the workflow runs green on GitHub (`gh run list --branch phase-0/foundations`).

### Stream B: Lint and format

- [ ] **B1.** Install Biome with `npm install -D -E @biomejs/biome@2`. Create `biome.jsonc`, matching the style the code already mostly uses:
  - `formatter`: `indentStyle: "space"`, `indentWidth: 2`, `lineWidth: 120`, `lineEnding: "lf"`.
  - `javascript.formatter`: `quoteStyle: "single"`, `jsxQuoteStyle: "double"`, `semicolons: "always"`, `trailingCommas: "all"`.
  - `files.includes`: `contracts.ts`, `vitest.config.ts`, `engine/**`, `world/**`, `brain/**`, `server/**`, `app/**`, `scripts/**`. Exclude `**/node_modules/**`, `**/dist/**`, `**/*.json` data files under `world/data/` and `server/data/`.
  - `linter.rules.recommended: true`.

  Add root scripts: `"lint": "biome lint ."`, `"format": "biome format --write ."`, `"format:check": "biome format ."`.

  Create `.gitattributes` containing `* text=auto eol=lf`. The working tree on Windows is CRLF, and CI on Linux must see the same bytes.

  Verify: `npx biome --version` prints a 2.x version.
- [ ] **B2.** Run `npm run lint`. For each rule that reports errors, decide:
  - If fixing it is mechanical and cannot change behaviour (an unused import, `let` that should be `const`, a missing `type` keyword on an import), apply Biome's safe fixes with `npx biome lint --write .`.
  - Otherwise, set that rule to `"off"` in `biome.jsonc` with a comment saying how many findings it had. Add the rule to the "Lint rules turned off" list at the end of this file, for a later plan.
  - Never use `--unsafe`.

  Verify: `npm run lint` exits 0. Then `npm run typecheck && npm test` still pass.
- [ ] **B3.** Run `npm run format`. Commit the result **alone**, with the message `Format the codebase with Biome (no logic changes)`.
  Verify: `npm run format:check` exits 0; `npm run typecheck && npm test && npm run build` pass; `git show --stat HEAD` lists only formatting changes.
- [ ] **B4.** Add `npm run lint` and `npm run format:check` steps to `.github/workflows/ci.yml`, after `npm ci`.
  Verify: CI green on GitHub.

### Stream C: Doc drift

- [ ] **C1.** `CLAUDE.md`, "Non-obvious decisions": the bullet "**The speed curve is linear:** `v = v_free · max(0.05, 1 − ρ/5.4)`..." is wrong. `densityFactor()` in `engine/src/movement-flow.ts` uses the Weidmann curve. Replace the bullet with one that describes the code as it is, quoting the formula from the comment in `densityFactor()`: free flow up to 0.5 people/m², jam density `RHO_JAM = 5.4`, and a 5% floor. Also fix the sentence in "Where the key logic lives" that calls `densityFactor()` "the speed curve" only if it states the curve's shape.
  Verify: `grep -n "linear" CLAUDE.md` no longer describes the speed curve.
- [ ] **C2.** `README.md` line 3 calls this "A practice tool for police commanders". It is a tool for live police operations. Rewrite that opening sentence and any other "practice" or "training" framing in `README.md` and `CLAUDE.md` to say so. Keep the sentences about the commander making the call and fan behaviour being an assumption. Do **not** change `app/src/StartScreen.tsx` ("small practice map" refers to the 3-gate test map, which is correct).
  Verify: `grep -ni "practice tool\|training tool" README.md CLAUDE.md` returns nothing.
- [ ] **C3.** In `CLAUDE.md` "Commands", replace the test-count line with `npm test` alone, without counts, so it cannot drift again. Add the `lint`, `format` and `format:check` scripts, and the note that throughput tests need `PERF=1`.

### Stream D: Engine public entry point

- [ ] **D1.** Create `engine/src/index.ts`. It re-exports exactly what the app uses today, and nothing more:
  - from `./edits.ts`, types only: `Barricade`, `DotInfo`, `EditIn`, `EditOut`, `GateStat`, `OfficerStatus`, `PoliceOrder`, `SceneInfo`;
  - from `./traffic.ts`: `trafficCapacity`, `roadNetFor`;
  - from `./motion.ts`: `MotionRecorder`, `poseOnPath`;
  - from `./junctions.ts`: `roadJunctions`;
  - from `./flowfield.ts`: `motorwayCells`.

  Use `export type { ... } from` for the types. `engine/package.json` already names `src/index.ts` as `main`.

  Verify: `npm run typecheck`.
- [ ] **D2.** In every file under `app/src/` (tests included), replace imports from `../../engine/src/edits.ts`, `traffic.ts`, `motion.ts`, `junctions.ts` and `flowfield.ts` with imports from `../../engine/src/index.ts`. Keep `import type` where it was. Do not touch the three `new Worker(new URL('../../engine/src/worker.ts', ...))` lines in `app/src/useRun.ts` and `app/src/bench.ts`. List the files with:
  `grep -rln "engine/src/\(edits\|traffic\|motion\|junctions\|flowfield\)" app/src`
  If an app file imports an engine symbol not in D1's list, add it to `index.ts` and note it in the commit message.
  Verify: the grep above returns nothing; `npm run typecheck && npm test && npm run build` pass.
- [ ] **D3.** Add a Biome override in `biome.jsonc` for `app/**` that turns on `style/noRestrictedImports` and forbids engine internals. Allow only `../../engine/src/index.ts`; the worker is referenced by URL, not by import, so the rule does not see it. If the installed Biome version cannot express a path pattern for this rule, **stop and ask** rather than writing a custom script.
  Verify: temporarily add `import { FlowFields } from '../../engine/src/flowfield.ts';` to any app file, run `npm run lint` and see it fail, then remove the line.

### Stream E: Split `app/src/App.tsx`

Today `App.tsx` is 1,871 lines. `App()` runs from about line 420 to the end, and small components sit above it. Keep the existing flat layout of `app/src/` (no new folders). Move one piece per commit, and run `npm run typecheck && npm test` after each.

- [ ] **E1.** Move the small components and helpers above `App()` into their own files, exported by name:
  - `Info` → `app/src/Info.tsx`
  - `PlanScoreboard`, `CopySummary`, `PlanCard` → `app/src/PlanCards.tsx`
  - `AlertBanner` → `app/src/AlertBanner.tsx`
  - `Legend`, `LegendBody`, `VehicleIcon` → `app/src/Legend.tsx`
  - `pitchFor` → `app/src/pitch.ts`
  - `signedInThisSession`, `markSignedIn` → `app/src/session.ts`

  Move the module-level constants (`SEED`, `LABELS`, `OFFICERS`, `SPEEDS`, `DANGER`, and the `params` / `AUTORUN` reads) to `app/src/app-config.ts`, unchanged.
- [ ] **E2.** Move self-contained effects out of `App()` into custom hooks, each in its own file. Each hook takes the values it reads as arguments and returns what `App()` needs. Keep every effect's body and dependency list exactly as it is:
  - the history-recording effect (comment starts "Record this run's gate queues") → `app/src/useHistoryRecording.ts`
  - the autorun effect ("Start without a click when asked") and the "Published for an unattended run" effect → `app/src/useAutorun.ts`
  - the briefing effect ("The briefing is only worth asking for") → `app/src/useBriefing.ts`
  - the keyboard shortcuts effect (the `window.addEventListener('keydown', onKey)` block, around line 966) → `app/src/useShortcuts.ts`
- [ ] **E3.** Move the top header (the `<header className="top">` block, around line 1002, with the situation tabs and clock) into `app/src/AppHeader.tsx`. Pass what it reads as props.
- [ ] **E4.** Move the right rail (the `<aside className="side">` block with `rail-tabs` and `rail-body`, around line 1549) into `app/src/Rail.tsx`. Leave the `officerRole ? <OfficerConsole .../> : ...` choice in `App.tsx`. If the rail needs more than about 25 props, move each tab's body into its own component in the same file rather than passing everything through.
- [ ] **E5.** Check by hand in a browser (`npm run serve` and `npm run dev`, then open http://localhost:5173/?autorun=1):
  - all three runs start;
  - the header tabs switch situations;
  - every rail tab opens (Brief, Orders, Plans, Gates, Map key, About);
  - `1` `2` `3` and `P` work;
  - the light/dark toggle works;
  - the browser console shows no errors.

  Write down the result in the PR description.
  Verify: `wc -l app/src/App.tsx` is under 700; `npm run typecheck && npm run lint && npm test && npm run build` pass.

## Stop and ask

- Any test fails after a move or a formatting change.
- A lint rule cannot be turned off cleanly, or a safe fix touches engine logic files in a way you cannot explain.
- An effect cannot be moved without changing its dependency list.
- The Biome restricted-imports rule cannot express the allow-list (D3).
- Anything would touch `contracts.ts`.

## Human steps (the user, not the implementer)

- After the PR merges: in GitHub settings for `SNBest1/gameday-command`, protect `main`. Require a pull request and the CI check, and block direct pushes.

## Verification (supervisor, before opening the PR)

1. `npm ci && npm run typecheck && npm run lint && npm run format:check && npm test && npm run build` on a clean checkout.
2. `PERF=1 npx vitest run engine/src/perf.test.ts` passes locally.
3. `grep -rn "engine/src/" app/src | grep -v "engine/src/index.ts" | grep -v "engine/src/worker.ts"` returns nothing.
4. The browser check in E5.
5. CI green on the PR.

## Lint rules turned off

Filled in during B2: rule name and finding count.
