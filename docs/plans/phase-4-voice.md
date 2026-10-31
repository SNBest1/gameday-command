# Phase 4: Voice assistant

Branch: `phase-4/voice`, created from the tip of `phase-3/map-ui`. The branches are stacked; the user merges 1, then 3, then 4. Work only on this branch. **Never commit to, merge into or push `main`.** Pushing `phase-4/voice` to `origin` is allowed so CI can run.

## Goal

Turn the command box from keyword matching into an assistant that understands what a commander says in a noisy command post. Spoken or typed words become the same typed orders, questions and controls the box already handles, with the same read-back and confirmation.

It must work in both deployments:

- **On premises:** a local speech model and a local LLM.
- **Hosted:** any provider with an OpenAI-compatible API.
- **Neither configured:** exactly today's behaviour.

## How it fits together

```
mic ─► speech.ts ──(browser Web Speech, or recorded audio)──► text
                         recorded audio ─► POST /api/speech/transcribe ─► STT server (OpenAI-compatible /v1/audio/transcriptions)
text ─► CommandBar ─► confirm/cancel/undo regex (local, instant)
                    └► POST /api/voice/interpret ─► LLM (OpenAI-compatible /v1/chat/completions with tools)
                         ◄─ one tool call (names as plain strings)
                    ─► voice-tools.ts fromToolCall(): resolve names with the existing matcher ─► Utterance
                    (any failure, timeout or unresolved name ─► parseUtterance(), today's parser)
Utterance ─► existing read-back + "say yes to confirm" ─► existing order / plan step / control
every interpreted command ─► POST /api/voice/log (audit)
```

The model only **proposes**. Names are confirmed against the map by the existing matcher (`findChoice` in `app/src/voice-commands.ts`), and nothing runs without the human's yes.

## Definition of done

- With `STT_URL` set, the mic and push-to-talk record audio and send it through the server to the configured speech-to-text service. Without it, the browser's Web Speech API is used as today.
- With `INTENT_LLM_URL` set, every utterance that is not a plain yes, no or undo goes to the LLM with a tool schema, and comes back as an `Utterance`. Without it, or on any failure, `parseUtterance()` handles it as today.
- Free phrasing works. Examples:
  - "can we get four units over to the north-east lot" → `send_officers`, 4, Stadium Lot Northeast;
  - "shut gate two for now" → `close` Gate 2;
  - "how's it looking at gate 2" → `gate` question;
  - "put the map up" → `view` ops.

  These are checked by unit tests with a fake LLM, and by a live test that skips itself when no LLM is configured.
- Keys and URLs live only in server environment variables; the browser never sees them.
- Every interpreted command is logged server-side with: transcript, source (browser or STT), the model's tool call (or "fallback"), the resolved summary, and whether the human confirmed, cancelled or neither. Logs older than `VOICE_LOG_DAYS` (default 30) are pruned at server start. **No audio is stored.**
- The Orders tab's after-action export includes the voice log for the session.
- `npm run typecheck && npm run lint && npm run format:check && npm test && npm run build` pass, and CI is green on Ubuntu, Windows and macOS.

## Constraints

- Follow `AGENTS.md`, including "Mac and Windows".
- **No new npm dependencies.** Node 24's built-in `fetch`, `FormData` and `Blob` on the server and `MediaRecorder` in the browser are enough.
- Both services are reached over **OpenAI-compatible HTTP APIs**, so any local server or hosted provider that speaks them works. Do not write provider-specific code.
- The LLM call uses `temperature: 0`, one tool call (`tool_choice: 'required'`), and a timeout of `INTENT_LLM_TIMEOUT_MS` (default 6000). A timeout, an HTTP error, invalid JSON, an unknown tool or arguments that fail the schema all mean **fallback to `parseUtterance()`**, never an error shown as an order.
- Keep unchanged:
  - the confirmation flow: read-back, "say yes to confirm", the auto re-listen after read-back;
  - typed orders keep their buttons;
  - live orders go only to the plan on the map;
  - undo is an inverse order (`app/src/after-action.ts`).
- Callbacks keep reading props through refs (CLAUDE.md, "Hands-free").
- `contracts.ts` is frozen: everything new lives in `app/`, `server/` and a new SQLite table.

## Non-goals

- No radio integration (open decision).
- No wake word, and no always-on listening.
- No storing audio.
- No change to what orders exist or how they execute.

## Skills used

Reviewed at step 0 with `find-skills`:

- No phase-specific skill applies cleanly. The available AI SDK skills (`vercel/ai@ai-sdk`) assume the Vercel AI SDK package, which the plan forbids; `openai/skills@openai-docs` documents the HTTP API the plan already specifies exactly. Nothing was installed.
- The plan's own OpenAI-compatible request shape, the browser `Web Speech` / `MediaRecorder` APIs and the existing repo tests are the working references. Where a general skill would suggest an SDK or provider-specific helper, the plan wins (no new npm dependencies).

## Streams and files

Run the waves in this order:

1. **A and B together.**
2. **Then C.**
3. **Then D.**

| Stream | Owns these files |
| --- | --- |
| A: Server routes | `server/src/voice.ts` (new), `server/src/voice.test.ts` (new), `server/src/db.ts` (new table only), `server/src/index.ts` (route registration only), `.env.example` |
| B: Tool schema and resolver | `app/src/voice-tools.ts` (new), `app/src/voice-tools.test.ts` (new) |
| C: Recording | `app/src/speech.ts`, `app/src/speech-recorded.ts` (new), `app/src/api.ts` (new calls) |
| D: Wiring, audit and docs | `app/src/CommandBar.tsx`, `app/src/useCommandBarProps.ts`, `app/src/after-action.ts`, `app/src/after-action.test.ts`, `docs/voice-setup.md` (new), `server/src/live.test.ts` |

## Steps

- [x] **0. Skills and baseline.** As in earlier phases.

### Stream A: Server routes

- [x] **A1.** `server/src/voice.ts` exports `voiceRoutes(app, db)`, registered from `server/src/index.ts`.
  - `GET /api/speech/config` → `{ stt: boolean, llm: boolean }`. True when the matching URL environment variable is set.
  - `POST /api/speech/transcribe`:
    - Takes the raw audio body (`audio/webm` or `audio/ogg`, capped at 2 MB, else 413).
    - Forwards it as `multipart/form-data` (`file`, `model` = `STT_MODEL`, default `whisper-1`, `language` = `en`) to `${STT_URL}/v1/audio/transcriptions`, with `Authorization: Bearer ${STT_KEY}` when that is set.
    - Returns `{ text }`, or `{ error }` with status 502 on failure.
    - Timeout `STT_TIMEOUT_MS`, default 15000.
  - `POST /api/voice/interpret`:
    - Body `{ text, tools, system }`, where the browser sends the tool list and the system prompt built by `voice-tools.ts`, so the vocabulary lives in one place.
    - The server checks `tools` is an array of at most 20 function definitions and `system` is at most 8,000 characters.
    - It calls `${INTENT_LLM_URL}/v1/chat/completions` with:
      - `model: INTENT_LLM_MODEL`;
      - `messages: [{ role: 'system', content: system }, { role: 'user', content: text }]`;
      - `tools`, `tool_choice: 'required'`, `temperature: 0`, `stream: false`;
      - `Authorization` when `INTENT_LLM_KEY` is set.
    - Returns `{ call: { name, arguments } }`, with `arguments` parsed from JSON, or `{ call: null, reason }` on any failure.
    - It never throws to the client.
  - `POST /api/voice/log` stores one entry; `GET /api/voice/log?since=<iso>` lists them.
- [x] **A2.** In `server/src/db.ts`, add the table `voice_log`:
  - columns: `id INTEGER PRIMARY KEY`, `at TEXT`, `session TEXT`, `source TEXT`, `transcript TEXT`, `tool_call TEXT` (JSON or `'fallback'`), `summary TEXT`, `outcome TEXT` (`'confirmed'|'cancelled'|'none'`);
  - prune rows older than `VOICE_LOG_DAYS` (default 30) when the server starts.

  Do **not** bump `DECISION_CACHE_VERSION` (that empties the decision cache). Create the table with `CREATE TABLE IF NOT EXISTS`.
- [x] **A3.** Document every new variable in `.env.example` with a comment:
  - `STT_URL`, `STT_MODEL`, `STT_KEY`, `STT_TIMEOUT_MS`;
  - `INTENT_LLM_URL`, `INTENT_LLM_MODEL`, `INTENT_LLM_KEY`, `INTENT_LLM_TIMEOUT_MS`;
  - `VOICE_LOG_DAYS`.
- [ ] **A4.** `server/src/voice.test.ts`: start fake STT and LLM servers (small Hono apps on random ports, the way other server tests start a server) and check:
  - `config` reflects the environment;
  - `transcribe` forwards a multipart body and returns its text;
  - an oversized body gets 413;
  - `interpret` returns a parsed tool call;
  - `interpret` returns `call: null` on HTTP 500, on a timeout (fake server delays past the timeout), on a non-JSON `arguments`, and on no tool call;
  - the log stores entries, lists them, and prunes old ones.

  Verify: `npx vitest run server/src/voice.test.ts`.

### Stream B: Tool schema and resolver

- [ ] **B1.** `app/src/voice-tools.ts`:
  - **`voiceTools(map)`** returns the OpenAI `tools` array. One function per kind the box already understands; arguments carry names as plain strings and numbers, never cell ids:
    - orders, one function per `Intent` kind in `voice-commands.ts`: `close`, `open`, `send_officers`, `redirect`, `alert`, `shelter_order`, each with optional `atMin` and optional `plan` (`"A"|"B"|"C"`);
    - one function per `Control` kind in `voice-intents.ts`;
    - one function per `Question` kind;
    - `show_plan`;
    - `none`, for words that are not a command.

    Give each function a one-line description and a JSON schema with `required` fields and `enum`s where the set is closed (plan letters, alert channel, speed, rail tab, view names including `ops`).
  - **`voiceSystemPrompt(map, labels)`** returns a short system prompt:
    - the role: "you turn a police commander's words into exactly one tool call";
    - the rules: never invent places, use `none` when unsure, and numbers spoken as words become digits;
    - the lists of gate names, other place names and street names from the map.

    Keep it under 8,000 characters. If the map has more names than fit, drop street names first.
  - **`fromToolCall(call, map): Utterance | null`** turns the call into the same `Utterance` shape `parseUtterance()` returns:
    - resolve every name with `findChoice` over the **same choice lists `parseCommand` uses**: `stepChoices(map)` from `app/src/plan-steps.ts`, plus however `parseCommand` resolves streets (read it, and reuse that code; if it is private, export it from `voice-commands.ts` as a pure move);
    - build `Parsed` with the same `summary` text `parseCommand` would produce (reuse `describe`).
    - Return `null` if any name does not resolve, a required field is missing, or the tool is `none`; the caller then falls back.

  Verify: `voice-tools.test.ts`, using the same map `voice-commands.test.ts` builds (the test map plus real-stadium names such as "Stadium Lot Northeast"; copy that setup):
  - every `Intent`, `Control` and `Question` kind has a tool, so a test fails if a kind is added without one;
  - the examples in "Definition of done" resolve;
  - an invented place returns `null`;
  - `none` returns `null`;
  - the system prompt stays under 8,000 characters.

### Stream C: Recording

- [ ] **C1.** `app/src/speech-recorded.ts`: `listenRecorded(onWords, onEnd): Listening | null`, with the same signature and `Listening` interface as `listen` in `speech.ts`.
  - Records with `MediaRecorder` (prefer `audio/webm;codecs=opus`, else `audio/ogg`, else whatever the browser supports).
  - `stop()` ends the recording, posts the blob to `/api/speech/transcribe`, then calls `onWords(text, true)` and `onEnd(null)`, or `onEnd(<sentence>)` on failure.
  - Stops by itself after 12 s.
  - Shows no interim words: the box says "Listening…" and then "Transcribing…".
- [ ] **C2.** In `speech.ts`, choose the recogniser once per page from `GET /api/speech/config`: recorded when `stt` is true, else the Web Speech API. `speechSupported()` is true if either works. `CommandBar` keeps calling one `listen` function.
  - Push-to-talk (hold Space) maps to start on press and `stop()` on release.
  - The mic button toggles.

  Check that `MediaRecorder` and `getUserMedia` exist in current Chrome, Edge, Safari and Firefox on both macOS and Windows; they do, but **no Safari-only or Chrome-only API** may be used.

### Stream D: Wiring, audit and docs

- [ ] **D1.** In the command-box flow (`CommandBar.tsx` / `useCommandBarProps.ts`), interpret final words like this:
  1. If the local regexes in `parseUtterance()` match confirm, cancel or undo, use that at once (no network).
  2. Else, if `llm` is true in the speech config, post `voiceTools`, `voiceSystemPrompt` and the text to `/api/voice/interpret`, and run `fromToolCall`. Show "Understanding…" while waiting.
  3. If that gives `null`, or `llm` is false, use `parseUtterance()`.

  Everything after this step (read-back, confirm, order, plan step, control, answer) is unchanged. Keep reading props through refs.
- [ ] **D2.** Log every interpreted utterance to `/api/voice/log`:
  - the transcript;
  - the source (`browser`, `stt` or `typed`);
  - the tool call or `'fallback'`;
  - the summary;
  - the outcome, updated when the human confirms or cancels. Post a second entry with the same session and transcript and the final outcome; do not add an update route.

  Session id: one random id per page load, generated in the app (not in simulation code).
- [ ] **D3.** In `app/src/after-action.ts`, add the session's voice log to `afterActionHtml` as a table (time, said, understood as, outcome). Update `after-action.test.ts` only to add a test for this section.
- [ ] **D4.** In `server/src/live.test.ts`, add a block that **skips itself unless `INTENT_LLM_URL` is set**, then:
  - sends the four example phrases through `/api/voice/interpret` with the real tool schema;
  - checks each resolves with `fromToolCall` to the expected kind.

  Add the same kind of self-skipping block for `STT_URL`, using a short WAV committed under `server/test-data/` (generate it with any TTS on your machine and commit it, under 200 KB). If you cannot produce one, skip the STT live test and say so.
- [ ] **D5.** Write `docs/voice-setup.md`:
  - the two deployments;
  - on premises: run any OpenAI-compatible speech-to-text server and any OpenAI-compatible LLM server with tool calling on the same network, and set the variables;
  - hosted: set the URLs and keys of a provider;
  - what is logged and for how long;
  - that no audio is kept;
  - how to check it works (`GET /api/speech/config`).

  Name example servers only as examples, without claiming versions or performance.
- [ ] **D6.** Browser check, without and with the services configured:
  1. With no variables set: the box behaves exactly as before. Typed "close gate 2" confirms; push-to-talk uses the browser recogniser.
  2. With a fake or real LLM: typed "can we get four units over to the north-east lot" reads back a send-officers order; "yes" confirms it on the plan on the map.
  3. Stop the LLM: the same sentence falls back to the old parser without an error.
  4. Download the after-action report: it lists the voice entries.

  Record the results and OS in the commit message.

## Stop and ask

- An `Intent`, `Control` or `Question` kind cannot be expressed as a tool without changing its type.
- `fromToolCall` cannot reuse `parseCommand`'s choice lists without changing `parseCommand`'s behaviour.
- `MediaRecorder` output is rejected by the speech-to-text server in a way a content type cannot fix.
- Anything would touch `contracts.ts`, simulation code or `DECISION_CACHE_VERSION`.

## Verification (before telling the planner it is done)

1. `npm ci && npm run typecheck && npm run lint && npm run format:check && npm test && npm run build`.
2. The browser check in D6.
3. CI green on Ubuntu, Windows and macOS for the branch.
4. Add a CLAUDE.md section, "Voice assistant", covering:
   - the flow diagram above;
   - the fallback rule;
   - where the tool schema lives;
   - the audit log;
   - the environment variables.
5. Mark Phase 4 "Ready for review" in `docs/roadmap.md`.
