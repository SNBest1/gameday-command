# Phase 1: Headless engine and validation

Branch: `phase-1/headless-engine`, created from `main` **after the user has merged Phase 0**. Work only on this branch. **Never commit to, merge into or push `main`.** Pushing `phase-1/headless-engine` to `origin` is allowed so CI can run.

## Goal

Two things.

1. **The engine runs on the server**, behind a documented wire protocol. A run then has one authoritative state that any number of screens can watch, and live data can later be fed into it.
2. **A validation suite measures how close the crowd model is to published pedestrian data.** It reports, and does not tune.

The browser-worker path stays as it is and remains the default until the two paths are proven identical.

## Definition of done

- `engine/src/worker.ts` behaves exactly as before in the browser. The same simulation code also runs in a Node `worker_threads` worker.
- The server can create a run, stream its frames and scene messages over a WebSocket, and accept every message the browser worker accepts today (`WorkerIn` from `contracts.ts`, `EditIn` from `engine/src/edits.ts`).
- The app, opened with `?engine=server`, plays a run from the server with the same screens as today. Without the flag nothing changes.
- A test proves that the same seed and the same decision tape give an **identical scorecard and identical final frame** in-process and through the server.
- `npm run validate` produces `validation/report.md`. The report compares the model's speed-density relation and bottleneck flow with reference data committed under `validation/reference/`, each file with its source.
- `docs/wire-protocol.md` documents the protocol, and `docs/proposals/engine-boundary.md` proposes how the engine stops importing `world/` and `brain/` directly.
- `npm run typecheck && npm run lint && npm test && npm run build` pass.

## Constraints

- Follow `AGENTS.md`, including "Mac and Windows". In particular: `contracts.ts` is frozen, the step order in `sim.ts` is fixed, and runs stay deterministic.
- **Everything works on macOS and Windows.** Server workers, WebSockets, the validation scripts and every npm script must behave the same on both. CI checks Ubuntu, Windows and macOS. Build file paths with `node:path` / `fileURLToPath`, never by joining strings.
- **Do not change simulation behaviour.** No physics, decisions, scoring or constants change in this phase. The validation suite only measures.
- The only new dependency allowed is `@hono/node-ws` (server, exact version) for WebSockets. Nothing for validation: write plain TypeScript.
- **Reference numbers come only from files committed under `validation/reference/`, each with its URL and licence in `validation/reference/SOURCES.md`.** Never type a measured value from memory. If a source cannot be downloaded, stop and ask; the user can fetch it from a normal terminal.

## Non-goals

- No authentication, roles or multi-tenant hosting (a later plan; the deployment decision is "both on-prem and hosted").
- No removal of the browser-worker path.
- No live data input (vision is on hold; real data is Phase 2).
- No change to the engine's imports of `world/` and `brain/`. This phase only writes the proposal.
- No tuning of the model to match the reference data.

## Skills used

Searched 2026-10-31 with `npx skills find` for Node `worker_threads`, Hono
WebSockets, binary protocols, Vitest and pedestrian dynamics.

- `find-skills` (already available): used for the registry search; nothing installed.
- `secondsky/claude-skills@bun-workers` (411 installs): Bun-specific workers, not Node `worker_threads`; not used.
- Hono candidates (`vcode-sh/vibe-tools@hono-guide` 15 installs, `hankcraft/hankcraft-skills@hono-backend` 10 installs): too little adoption and no WebSocket-specific guidance; not used.
- Binary-protocol results were reverse-engineering/security skills, not a framing format for this protocol; not used.
- `pozapas/crowdskills@jupedsim` (2 installs): JuPedSim tooling, not the Jülich data archive; not used.
- No Vitest skill was needed; the repo's existing config and Phase 0 scripts cover it.
- The only dependency this plan names is `@hono/node-ws`, added in C1.
- Installed: **none**.

## Streams and files

Run the waves in this order:

1. **A, F and G together.**
2. **Then B.**
3. **Then C and E together.**
4. **Then D.**

| Stream | Owns these files |
| --- | --- |
| A: Worker core | `engine/src/worker.ts`, `engine/src/worker-core.ts` (new), `engine/src/worker-node.ts` (new), `engine/src/worker-core.test.ts` (new) |
| B: Wire protocol | `engine/src/wire.ts` (new), `engine/src/wire.test.ts` (new), `docs/wire-protocol.md` (new) |
| C: Server runs | `server/src/runs.ts` (new), `server/src/runs.test.ts` (new), `server/src/index.ts` (route registration only), `server/package.json`, `package-lock.json` |
| D: App client | `app/src/useRun.ts`, `app/src/run-source.ts` (new), `app/src/run-source.test.ts` (new) |
| E: Parity | `server/src/parity.test.ts` (new) |
| F: Validation | `validation/**` (new), root `package.json` (the `validate` script only) |
| G: Boundary proposal | `docs/proposals/engine-boundary.md` (new) |

## Steps

- [x] **0. Skills and baseline.**
  1. Search for skills that could help with this plan: Node `worker_threads`, WebSockets with Hono, binary protocols, Vitest, pedestrian-dynamics data.
  2. Record them under "Skills used" above.
  3. Run `npm run typecheck`, `npm run lint`, `npm test` and `npm run build`, and note any failure that already existed.

  Verify: "Skills used" is filled in, and the baseline results are in your first commit's message.

### Stream A: Worker core

- [x] **A1.** Split `engine/src/worker.ts` into a host-independent core and a thin browser entry.
  - Create `engine/src/worker-core.ts`. Move into it every line of `worker.ts` except the `host` global and the `host.onmessage = ...` assignment. Export `startWorker(host: WorkerHost): void`, with:
    ```ts
    export interface WorkerHost {
      post(message: WorkerOut | EditOut, transfer?: Transferable[]): void;
      onMessage(handler: (message: WorkerIn | EditIn) => void): void;
    }
    ```
  - `worker.ts` becomes: build a `WorkerHost` from `globalThis.postMessage` / `globalThis.onmessage` exactly as today, then call `startWorker(host)`.
  - Keep `setTimeout`-based pacing as it is.

  Verify: `npm run typecheck && npm test && npm run build`; then open `npm run dev` with `?autorun=1` and check that runs play as before.
- [x] **A2.** Create `engine/src/worker-node.ts`: a `WorkerHost` over `parentPort` from `node:worker_threads` (`parentPort.postMessage(msg, transfer)` and `parentPort.on('message', ...)`), then `startWorker(host)`.
- [x] **A3.** Create `engine/src/worker-core.test.ts`:
  - Start `worker-node.ts` with `new Worker(new URL('./worker-node.ts', import.meta.url))`.
  - Send `init` for the test map (`test-3gate`; copy how `app/src/bench.ts` builds its `init`).
  - Play to the end, and check that a scorecard arrives.

  If Node refuses to run a `.ts` file as a worker, stop and ask.
  Verify: `npx vitest run engine/src/worker-core.test.ts`.

### Stream B: Wire protocol

- [x] **B1.** Create `engine/src/wire.ts` with `encode(message): string | Uint8Array` and `decode(data: string | ArrayBuffer): message`, for every `WorkerIn`, `WorkerOut`, `EditIn` and `EditOut` message.
  - A message with no typed arrays is sent as a JSON text frame.
  - A message that carries typed arrays (frames, density, `types`) is sent as a binary frame:
    1. a `uint32` little-endian header length;
    2. a UTF-8 JSON header: the message with each typed array replaced by `{ "$ta": "<Float32Array|Uint8Array|...>", "offset": n, "length": n }`;
    3. the arrays' bytes, each aligned to 8 bytes.
  - Pure functions; no Node- or browser-only APIs.
- [x] **B2.** `engine/src/wire.test.ts`: a round trip of a real frame, scene, scorecard and snapshot taken from a short run on `test-3gate` must decode `toEqual` the original, with typed-array types preserved.
- [x] **B3.** Write `docs/wire-protocol.md`: the endpoint, the frame format above, which messages travel in which direction, and the version string `gameday-wire.1` sent as the first server message (`{ "type": "hello", "protocol": "gameday-wire.1" }`).
  Verify: `npx vitest run engine/src/wire.test.ts`.

### Stream C: Server runs

- [ ] **C1.** Add `@hono/node-ws` (exact version) to `server/package.json`. Create `server/src/runs.ts`, a run registry:
  - `POST /api/runs` takes the same `init` payload the app sends a worker today. It starts a `worker-node.ts` worker and returns `{ id }`.
  - `GET /api/runs/:id/ws` upgrades to a WebSocket and sends `hello`. It then forwards every worker message to every connected socket (encoded with `wire.ts`) and every socket message to the worker (decoded with `wire.ts`).
  - `DELETE /api/runs/:id` terminates the worker.
  - A run with no sockets for 10 minutes is terminated.

  Register the routes in `server/src/index.ts`, and change nothing else there.
- [ ] **C2.** Decisions: a server-side worker reaches `/api/decide` over HTTP, as the browser does. Pass `serverUrl` as `http://127.0.0.1:${PORT}` in the `init` the server forwards. Do not call the decision code in-process (that would change the timing the engine waits on).
- [ ] **C3.** `server/src/runs.test.ts`: start the Hono app on a random port, create a run on `test-3gate`, connect with Node's built-in `WebSocket`, send `play`, and receive `hello`, frames and a final scorecard.
  Verify: `npx vitest run server/src/runs.test.ts`.

### Stream D: App client

- [ ] **D1.** Create `app/src/run-source.ts` with one interface, `RunSource { post(msg, transfer?); onMessage(handler); close() }`, and two implementations:
  - `workerSource()` wraps today's `new Worker(new URL('../../engine/src/worker.ts', import.meta.url), { type: 'module' })`; keep that exact line.
  - `serverSource(init)` calls `POST /api/runs`, then opens the WebSocket, using `wire.ts`.
- [ ] **D2.** In `app/src/useRun.ts`, replace direct use of the `Worker` with a `RunSource`. Pick `serverSource` only when the page URL has `engine=server`; otherwise use `workerSource`. Change nothing else about how `useRun` stores frames and records.
- [ ] **D3.** `app/src/run-source.test.ts`: `serverSource` against a fake fetch and a fake WebSocket decodes a binary frame into the same shape a worker posts.
  Verify: `npm test`, then a browser check. Start `npm run serve` and `npm run dev`, and open http://localhost:5173/?autorun=1&engine=server. All three runs play, the rail tabs work, the console is clean, and `GET /api/health` still answers. Then open the same URL without `engine=server` and check that it behaves as before.

### Stream E: Parity

- [ ] **E1.** `server/src/parity.test.ts`:
  1. Run the gate-surge incident on `test-3gate` with a fixed seed and **default decisions only**, so there is no Kev and no cache: (a) in-process through `worker-core.ts` with an in-memory `WorkerHost`, and (b) through the server and WebSocket path from Stream C.
  2. Assert that the final scorecards are `toEqual`, and that the final frame's typed arrays are byte-identical.
  3. Then run the stadium map (`ohio-stadium`) for 10 sim minutes past the incident and assert the same. If this case takes over 60 s, mark it with `describe.skipIf(!process.env.PERF)` and add its file to `include` in `vitest.perf.config.ts` (from Phase 0), so it runs under `npm run test:perf`.

  Verify: `npx vitest run server/src/parity.test.ts`.

### Stream F: Validation suite

- [x] **F1.** Create `validation/reference/` and `validation/reference/SOURCES.md`. Download, from the Jülich pedestrian dynamics data archive (https://ped.fz-juelich.de/da/), the processed data for (a) a unidirectional corridor experiment (speed against density) and (b) a bottleneck experiment across several widths (flow against width). Commit the files you use, with URL, experiment name, licence and download date in `SOURCES.md`. Also record the Weidmann (1993, ETH IVT report 132) parameters already quoted in `densityFactor()` as a source entry.

  **If the archive cannot be reached from your environment, stop and ask.** Do not substitute values from memory or from a summary.
- [x] **F2.** `validation/maps.ts`: build synthetic `MapBundle`s in code:
  - a straight corridor, 50 m long, with an entry and a destination at the two ends;
  - a room that empties through a single opening, for opening widths of 2, 4, 6 and 8 m (multiples of the 2 m cell).

  Use the same `MapBundle` shape as the test map in `world/`.
- [x] **F3.** `validation/run.ts`:
  - Run each map through `Simulation` with `FlowMovement`, no officers, no incidents and default decisions.
  - Measure:
    - mean walking speed against standing density, binned by density from the density grid, on the corridor;
    - specific flow (people per metre per second) through each opening, over the steady part of the run.
  - Write `validation/report.md`:
    - one table per measurement: model value, reference value, difference, and a source column pointing at `SOURCES.md`;
    - a section "Known limits of the grid" stating plainly that openings narrower than one 2 m cell cannot be represented.

  Add the root script `"validate": "node validation/run.ts"`.
- [x] **F4.** Make sure `validation/` is **not** included in `vitest.config.ts` and **is** included in `tsconfig.json` (so it typechecks). Check that adding it to `tsconfig.json` `include` is the only change there.
  Verify: `npm run validate` writes the report; `npm run typecheck` passes.

### Stream G: Engine boundary proposal (document only)

- [x] **G1.** Write `docs/proposals/engine-boundary.md`:
  - List every import in `engine/src/` from `../../world/` and `../../brain/` (use `git grep -n -e "from '../../world/" -e "from '../../brain/" -- engine/src`), grouped by imported symbol, with the engine files that use it.
  - For each symbol, propose one of:
    - (a) pass it in through `SimulationOptions` or `SimContext`;
    - (b) it belongs in `engine/`, so move it there;
    - (c) it is already behind `WorldHooks`/`WorldActions`.
  - Flag any proposal that needs `contracts.ts` to change as **"needs contract change, ask the team"**.

  No code changes in this stream.

## Stop and ask

- Node cannot run a `.ts` worker file (A3).
- A parity assertion fails (E1). Do not "fix" it by loosening the comparison; report the first differing field.
- A Jülich file cannot be downloaded, or its licence forbids committing it (F1).
- Anything needs `contracts.ts`, or any existing test or scorecard number changes.
- The app needs more than `useRun.ts` changed to use `RunSource` (D2).

## Verification (before telling the user it is done)

1. `npm ci && npm run typecheck && npm run lint && npm run format:check && npm test && npm run build`.
2. `npx vitest run server/src/parity.test.ts` passes, and `npm run test:perf` passes for the stadium case.
3. A browser check with and without `?engine=server` (D3). Say which OS you checked on; the user checks the other.
4. CI green on Ubuntu, Windows and macOS for the branch.
5. `npm run validate`. Tell the user where `validation/report.md` is.
6. `docs/wire-protocol.md` and `docs/proposals/engine-boundary.md` exist.
7. Mark Phase 1 "Ready for review" in `docs/roadmap.md`, and add a short CLAUDE.md section, "Running the engine on the server".
