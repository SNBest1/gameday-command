# Phase 0: Foundations

Branch: `phase-0/foundations`. It already exists, and its first commit holds this plan. Work only on this branch. **Never commit to, merge into or push `main`**; the user merges when they choose. Pushing `phase-0/foundations` to `origin` is allowed so CI can run.

## Goal

Make the repo safe to change, on macOS and Windows alike. A machine checks every change on Ubuntu, Windows and macOS, and the code has one style. The documentation says what the code does, `App.tsx` is small enough to work in, and the app reaches the engine through one public entry point.

**This phase changes no behaviour.** Every scorecard, every frame and every test result must be the same before and after.

## Definition of done

- `.github/workflows/ci.yml` runs install, typecheck, lint, format check, test and build on Ubuntu, Windows and macOS on every push and pull request, and all three pass.
- `npm run lint`, `npm run format`, `npm run format:check` and `npm run test:perf` exist and work the same on macOS and Windows.
- `README.md` and `CLAUDE.md` match the code on the points listed in Stream C.
- `app/src/App.tsx` is under 1,000 lines (measured after the Biome formatting in B3), and every piece moved out of it behaves exactly as before.
- No file under `app/` imports from `../../engine/src/<anything>` except `../../engine/src/index.ts`; the worker is still referenced by URL as `../../engine/src/worker.ts`. A lint rule enforces this.
- `npm run typecheck && npm run lint && npm run format:check && npm test && npm run build` pass.

## Constraints

- Follow `AGENTS.md`, including its "Mac and Windows" section. In particular:
  - do not touch `contracts.ts`;
  - do not change engine logic;
  - do not edit tests except where a step says so;
  - no shell-specific npm scripts.
- The only new dependency allowed is `@biomejs/biome` (dev dependency, exact version).
- The formatting commit (step B3) contains formatting only and nothing else.
- Moves out of `App.tsx` are cut-and-paste plus imports and props. Do not rename state, change effect dependencies or "tidy" logic while moving it.

## Non-goals

- The engine's own imports of `world/` and `brain/` stay as they are (that is Phase 1).
- No fixing of lint findings that need logic changes. Turn those rules off and list them (step B2).
- No new features, no UI changes, no dependency upgrades.
- No GitHub settings changes (the user does branch protection; see "Human steps").

## Skills used

Searched 2026-10-31 with `npx skills find` and the skills.sh leaderboard.

- `find-skills` (already available): used for the search; nothing installed.
- `addyosmani/agent-skills@ci-cd-and-automation` (61.6K installs, 112K repository stars, three security audits pass): reviewed for the matrix CI and quality-gate steps A2/B4. **Not installed** — the plan specifies the workflow and scripts exactly, so the skill would add no project files and no value. The user chose to skip installation.
- `wshobson/agents@github-actions-templates` (17.8K installs): reviewed; overlaps this plan and carries Docker/Kubernetes patterns the repo does not use.
- `antfu/skills@vitest` (45.2K installs): reviewed; it describes Vitest 5.1-beta APIs while this repo is on Vitest 3.2.4.
- `vercel-labs/agent-skills@vercel-react-best-practices` and `@vercel-composition-patterns`: reviewed; the plan requires cut-and-paste moves only, so their refactor and performance guidance is out of scope.
- `haydenbleasel/ultracite@ultracite`: rejected; it is an opinionated Biome preset and would conflict with the exact `biome.jsonc` in B1.
- `biomejs/biome@biome-developer`: rejected; it is for developing Biome itself, not configuring it.
- No dedicated cross-platform Node-script or Biome-configuration skill was found.
- `frontend-design`, `design-taste-frontend` and `opencode`: not relevant to Phase 0, which changes no UI.
- Installed: **none**.

## Streams and files

Run the streams in this order: **A and C together, then B, then D, then E.** B reformats every file, so nothing else may run alongside it. D and E both edit `app/` files, so they run one after the other.

| Stream | Owns these files |
| --- | --- |
| A: CI | `.github/workflows/ci.yml` (new), `vitest.perf.config.ts` (new), `engine/src/perf.test.ts` |
| B: Lint and format | `biome.jsonc` (new), `.gitattributes` (new), root `package.json`, `package-lock.json`; then every source file, for the formatting commit only |
| C: Doc drift | `README.md`, `CLAUDE.md` |
| D: Engine entry point | `engine/src/index.ts` (new), the app files that import engine internals (listed in D2), `biome.jsonc` (the one rule in D3) |
| E: Split App.tsx | `app/src/App.tsx` and the new files listed in E1 to E4 |

## Steps

- [x] **0. Skills and baseline.**
  1. Search for skills that could help with this plan: Biome, GitHub Actions, cross-platform Node scripts, React component extraction, Vitest.
  2. Record them under "Skills used" above.
  3. Run `npm run typecheck`, `npm test` and `npm run build`, and note any failure that already existed.

  Verify: the "Skills used" section is filled in, and the baseline results are written in the commit message of your first commit.

### Stream A: CI

- [x] **A1.** Gate the two throughput tests so they run only when asked. Shared CI machines are slower and busier than a laptop, and `CLAUDE.md` says these assertions are load-sensitive.
  - In `engine/src/perf.test.ts`, change `describe('engine throughput', ...)` to `describe.skipIf(!process.env.PERF)('engine throughput', ...)`. Change nothing else in the file.
  - Create `vitest.perf.config.ts`: the same as `vitest.config.ts`, but with `include: ['engine/src/perf.test.ts']` and `test.env: { PERF: '1' }`. Setting the variable inside the config, not on the command line, is what makes it work the same on Windows and macOS.

  Verify: `npm test` shows the two tests skipped. `npx vitest run --config vitest.perf.config.ts` runs and passes them.
- [x] **A2.** Create `.github/workflows/ci.yml`:
  - Triggers: `push` and `pull_request`.
  - One job with `strategy.fail-fast: false` and `matrix.os: [ubuntu-latest, windows-latest, macos-latest]`; `runs-on: ${{ matrix.os }}`, `timeout-minutes: 30`.
  - Steps: `actions/checkout@v4`; `actions/setup-node@v4` with `node-version: 24` and `cache: npm`; `npm ci`; `npm run typecheck`; `npm test`; `npm run build`.
  - Lint and format steps are added in B4, once those scripts exist.

  Verify: push `phase-0/foundations`, then check `gh run list --branch phase-0/foundations`. All three operating systems are green. If one OS fails and the others pass, stop and ask.

### Stream B: Lint and format

- [x] **B1.** Install Biome with `npm install -D -E @biomejs/biome@2`. Biome ships a separate native binary per platform as optional dependencies. Check that `package-lock.json` lists the `@biomejs/cli-*` packages for darwin, win32 and linux, so `npm ci` works on every OS. If any is missing, stop and ask.

  Create `biome.jsonc`, matching the style the code already mostly uses:
  - `formatter`: `indentStyle: "space"`, `indentWidth: 2`, `lineWidth: 120`, `lineEnding: "lf"`.
  - `javascript.formatter`: `quoteStyle: "single"`, `jsxQuoteStyle: "double"`, `semicolons: "always"`, `trailingCommas: "all"`.
  - `files.includes`: `contracts.ts`, `vitest.config.ts`, `vitest.perf.config.ts`, `engine/**`, `world/**`, `brain/**`, `server/**`, `app/**`, `scripts/**`. Exclude `**/node_modules/**`, `**/dist/**`, and the JSON data files under `world/data/` and `server/data/`.
  - `linter.rules.recommended: true`.

  Add root scripts:
  - `"lint": "biome lint ."`
  - `"format": "biome format --write ."`
  - `"format:check": "biome format ."`
  - `"test:perf": "vitest run --config vitest.perf.config.ts"`

  Create `.gitattributes` containing `* text=auto eol=lf`. Windows checkouts with `core.autocrlf=true` currently have CRLF files; this makes every OS see LF.

  Verify: `npx biome --version` prints a 2.x version.
- [x] **B2.** Run `npm run lint`. For each rule that reports errors, decide:
  - If fixing it is mechanical and cannot change behaviour (an unused import, `let` that should be `const`, a missing `type` keyword on an import), apply Biome's safe fixes with `npx biome lint --write .`.
  - Otherwise, set that rule to `"off"` in `biome.jsonc` with a comment saying how many findings it had. Add the rule to the "Lint rules turned off" list at the end of this file.
  - Never use `--unsafe`.

  Verify: `npm run lint` exits 0. Then `npm run typecheck && npm test` still pass.
- [x] **B3.** Run `git add --renormalize .`, then `npm run format`. Commit the result **alone**, with the message `Format the codebase with Biome and normalise line endings (no logic changes)`.
  Verify:
  - `npm run format:check` exits 0;
  - `npm run typecheck && npm test && npm run build` pass;
  - `git show --stat HEAD` lists only formatting and line-ending changes.
- [x] **B4.** Add `npm run lint` and `npm run format:check` steps to `.github/workflows/ci.yml`, after `npm ci`.
  Verify: CI green on all three operating systems.

### Stream C: Doc drift

- [x] **C1.** `CLAUDE.md`, "Non-obvious decisions": the bullet "**The speed curve is linear:** `v = v_free · max(0.05, 1 − ρ/5.4)`..." is wrong. `densityFactor()` in `engine/src/movement-flow.ts` uses the Weidmann curve.
  - Replace the bullet with one that describes the code as it is, quoting the formula from the comment in `densityFactor()`: free flow up to 0.5 people/m², jam density `RHO_JAM = 5.4`, and a 5% floor.
  - Also fix the sentence in "Where the key logic lives" that calls `densityFactor()` "the speed curve", but only if it states the curve's shape.

  Verify: `git grep -n "linear" -- CLAUDE.md` no longer describes the speed curve.
- [x] **C2.** `README.md` line 3 calls this "A practice tool for police commanders". It is a tool for live police operations.
  - Rewrite that opening sentence, and any other "practice" or "training" framing in `README.md` and `CLAUDE.md`, to say so.
  - Keep the sentences about the commander making the call and fan behaviour being an assumption.
  - Do **not** change `app/src/StartScreen.tsx`: "small practice map" refers to the 3-gate test map, which is correct.

  Verify: `git grep -n -i -e "practice tool" -e "training tool" -- README.md CLAUDE.md` returns nothing.
- [x] **C3.** In `CLAUDE.md` "Commands", replace the test-count line with `npm test` alone, without counts, so it cannot drift again. Add `lint`, `format`, `format:check` and `test:perf`. Remove the macOS-only Chrome command from "Verifying the app in a browser", or add the Windows path beside it (`"C:\Program Files\Google\Chrome\Application\chrome.exe"`).

### Stream D: Engine public entry point

- [x] **D1.** Create `engine/src/index.ts`. It re-exports exactly what the app uses today, and nothing more:
  - from `./edits.ts`, types only: `Barricade`, `DotInfo`, `EditIn`, `EditOut`, `GateStat`, `OfficerStatus`, `PoliceOrder`, `SceneInfo`;
  - from `./traffic.ts`: `trafficCapacity`, `roadNetFor`;
  - from `./motion.ts`: `MotionRecorder`, `poseOnPath`;
  - from `./junctions.ts`: `roadJunctions`;
  - from `./flowfield.ts`: `motorwayCells`.

  Use `export type { ... } from` for the types. `engine/package.json` already names `src/index.ts` as `main`.

  Verify: `npm run typecheck`.
- [x] **D2.** In every file under `app/src/` (tests included), replace imports from `../../engine/src/edits.ts`, `traffic.ts`, `motion.ts`, `junctions.ts` and `flowfield.ts` with imports from `../../engine/src/index.ts`.
  - Keep `import type` where it was.
  - Do not touch the three `new Worker(new URL('../../engine/src/worker.ts', ...))` lines in `app/src/useRun.ts` and `app/src/bench.ts`.
  - List the files with: `git grep -l -e "engine/src/edits" -e "engine/src/traffic" -e "engine/src/motion" -e "engine/src/junctions" -e "engine/src/flowfield" -- app/src`
  - If an app file imports an engine symbol not in D1's list, add it to `index.ts` and note it in the commit message.

  Verify: the `git grep` above returns nothing; `npm run typecheck && npm test && npm run build` pass.
- [x] **D3.** Add a Biome override in `biome.jsonc` for `app/**` that turns on `style/noRestrictedImports` and forbids engine internals. Allow only `../../engine/src/index.ts`. The worker is referenced by URL, not by import, so the rule does not see it. If the installed Biome version cannot express a path pattern for this rule, **stop and ask** rather than writing a custom script.
  Verify: temporarily add `import { FlowFields } from '../../engine/src/flowfield.ts';` to any app file, run `npm run lint` and see it fail, then remove the line.

### Stream E: Split `app/src/App.tsx`

Today `App.tsx` is 1,871 lines. `App()` runs from about line 420 to the end, and small components sit above it. Keep the existing flat layout of `app/src/` (no new folders). Move one piece per commit, and run `npm run typecheck && npm test` after each.

- [x] **E1.** Move the small components and helpers above `App()` into their own files, exported by name:
  - `Info` → `app/src/Info.tsx`
  - `PlanScoreboard`, `CopySummary`, `PlanCard` → `app/src/PlanCards.tsx`
  - `AlertBanner` → `app/src/AlertBanner.tsx`
  - `Legend`, `LegendBody`, `VehicleIcon` → `app/src/Legend.tsx`
  - `pitchFor` → `app/src/pitch.ts`
  - `signedInThisSession`, `markSignedIn` → `app/src/session.ts`

  Move the module-level constants (`SEED`, `LABELS`, `OFFICERS`, `SPEEDS`, `DANGER`, and the `params` / `AUTORUN` reads) to `app/src/app-config.ts`, unchanged.
- [x] **E2.** Move self-contained effects out of `App()` into custom hooks, each in its own file. Each hook takes the values it reads as arguments and returns what `App()` needs. Keep every effect's body and dependency list exactly as it is:
  - the history-recording effect (comment starts "Record this run's gate queues") → `app/src/useHistoryRecording.ts`
  - the autorun effect ("Start without a click when asked") and the "Published for an unattended run" effect → `app/src/useAutorun.ts`
  - the briefing effect ("The briefing is only worth asking for") → `app/src/useBriefing.ts`
  - the keyboard shortcuts effect (the `window.addEventListener('keydown', onKey)` block, around line 966) → `app/src/useShortcuts.ts`
- [x] **E3.** Move the top header (the `<header className="top">` block, around line 1002, with the situation tabs and clock) into `app/src/AppHeader.tsx`. Pass what it reads as props.
> **Revised after E3.** The original target of 700 lines was written before B3 reformatted `App.tsx` at 120 columns (1,872 lines became 2,399). After E1–E3 it is 1,851 lines, and the rail alone is about 440. Steps E3a–E3c were added to move the rest of the `<main>` block. The target is now **under 1,000 lines**. It stands in for "small enough to work in": do not invent splits just to hit the number. If plain moves of the pieces named here leave it a little over, report the number and stop.

- [x] **E3a.** Move the transport bar (the `<div className="controls transport">` block at the top of `<main>`, about lines 809–867) into `app/src/TransportBar.tsx`. Pass what it reads as props.
- [x] **E3b.** The `<CommandBar ... />` element (about lines 868–992) is mostly inline callbacks. Move those callbacks, with bodies unchanged, into a hook `app/src/useCommandBarProps.ts`. The hook takes what the callbacks read and returns the props object. `App.tsx` then renders `<CommandBar {...commandBarProps} />` under the same condition as now.
  - Keep any ref used by a callback as a ref (CLAUDE.md: "Callbacks read props through refs, because speech events fire long after the render that started them").
  - Do not wrap callbacks in `useCallback` or change when they are created.
- [x] **E3c.** Move the map workspace (the `{loaded && (<> <div className="canvas-wrap ..."> ... </>)}` block, about lines 993–1381) into `app/src/MapWorkspace.tsx`, rendered under the same `loaded &&` condition. If it needs more than about 25 props, split it inside the same file into named parts (for example the two `<aside className="inspector vehicle-inspector">` panels as `VehicleInspector`), rather than passing everything through one component. The rule from CLAUDE.md still holds: only one of `CrowdView` and `ComparisonMaps` is mounted at a time.
- [x] **E4.** Move the right rail (the `<aside className="side">` block with `rail-tabs` and `rail-body`, around line 1549) into `app/src/Rail.tsx`. Leave the `officerRole ? <OfficerConsole .../> : ...` choice in `App.tsx`. If the rail needs more than about 25 props, move each tab's body into its own component in the same file rather than passing everything through.
- [ ] **E5.** Check by hand in a browser (`npm run serve` and `npm run dev` in two terminals, then open http://localhost:5173/?autorun=1):
  - all three runs start;
  - the header tabs switch situations;
  - every rail tab opens (Brief, Orders, Plans, Gates, Map key, About);
  - `1` `2` `3` and `P` work;
  - the light/dark toggle works;
  - the transport bar's play, speed, weather and vehicles controls work;
  - typing an order in the command box (for example "close gate 2") shows the confirmation;
  - clicking a fan opens the inspector, and clicking a vehicle opens the vehicle panel;
  - **Side by side** and back switches the map view;
  - the browser console shows no errors.

  Write the result, and which OS you checked on, in the commit message. The user checks the other OS.
  Verify:
  - `node -e "console.log(require('fs').readFileSync('app/src/App.tsx','utf8').split('\n').length)"` prints under 1,000;
  - `npm run typecheck && npm run lint && npm test && npm run build` pass.

## Stop and ask

- Any test fails after a move or a formatting change.
- CI passes on one operating system and fails on another.
- A lint rule cannot be turned off cleanly, or a safe fix touches engine logic files in a way you cannot explain.
- An effect cannot be moved without changing its dependency list.
- The Biome restricted-imports rule cannot express the allow-list (D3).
- Anything would touch `contracts.ts` or `main`.

## Human steps (the user, not the implementer)

- Check the app in a browser on the OS the implementer did not use (E5).
- Review the branch, then merge it into `main` when satisfied.
- After the merge: in GitHub settings for `SNBest1/gameday-command`, protect `main`. Require a pull request and the CI check, and block direct pushes.

## Verification (before telling the user it is done)

1. On a clean checkout of the branch: `npm ci && npm run typecheck && npm run lint && npm run format:check && npm test && npm run build`.
2. `npm run test:perf` passes locally.
3. `git grep -n -e "engine/src/" --and --not -e "engine/src/index.ts" --and --not -e "engine/src/worker.ts" -- app/src` returns nothing.
4. The browser check in E5.
5. CI green on Ubuntu, Windows and macOS for the branch.
6. Mark Phase 0 "Ready for review" in `docs/roadmap.md`.

## Lint rules turned off

These reported errors that needed a logic or markup decision, so they are off rather than unsafe-fixed:

- `a11y/useButtonType` — 105
- `a11y/useSemanticElements` — 5
- `a11y/noStaticElementInteractions` — 5
- `a11y/useKeyWithClickEvents` — 4
- `a11y/noAriaHiddenOnFocusable` — 1
- `a11y/noNoninteractiveTabindex` — 1
- `correctness/useExhaustiveDependencies` — 71
- `suspicious/noArrayIndexKey` — 8
- `suspicious/useIterableCallbackReturn` — 6
- `suspicious/noAssignInExpressions` — 4
- `suspicious/noShadowRestrictedNames` — 1
- `suspicious/noImplicitAnyLet` — 1

Warnings left on (they do not fail the gate): `style/noNonNullAssertion` 1,342,
`style/noDescendingSpecificity` 82, `complexity/useOptionalChain` 3,
`complexity/useMathMinMax` 1 and `complexity/noCommaOperator` 1. The remaining
diagnostics are infos.
