# Brief: voice assistant

Status: brief, not an implementation plan.

## Goal

Turn the voice box from keyword matching into an assistant that understands spoken orders and questions in a noisy command post, and turns them into the same typed orders the Orders panel sends.

## Today

- `app/src/speech.ts` uses the browser's Web Speech API (Chrome sends audio to Google).
- `app/src/voice-commands.ts`, `voice-intents.ts` and `voice-answers.ts` match words against map names with plain code.
- A spoken order is read back and needs "yes" before it is sent.

## Direction

- **Speech recognition, two deployments:**
  - on premises: a local Whisper-family model (for example faster-whisper) in its own service;
  - hosted: the same service, or a hosted speech API.

  `speech.ts` is the only app file that changes for this. Later: radio audio as an input.
- **Understanding:** an LLM with tool calling. The tools are the existing typed orders (`PoliceOrder` and plan steps built by `buildStep`), plus read-only question tools over live state (gate stats, officers, congestion ranking). The model fills in a typed order; it never writes free-text instructions to anyone.
- **Map names:** resolve gate, street and lot names with the existing matcher in `voice-commands.ts`. The model proposes; the matcher confirms the name exists.
- **Keep, unchanged:**
  - read-back and "say yes to confirm" before anything executes;
  - live orders go only to the plan on the map;
  - undo is an inverse order (`app/src/after-action.ts`).
- **Audit:** every spoken order, its transcript, the model's tool call and the human confirmation are stored server-side.

## Constraints to carry into the plan

- Nothing executes without explicit human confirmation.
- The model must work both on premises (local model) and hosted. Choose models that can run locally.
- Answers use only live state, and say so when there is nothing yet (as `voice-answers.ts` does now).

## Open decisions

- Which local LLM, and on what hardware the police site has.
- Whether radio integration is in scope, and which radio system.
- Retention period for audio and transcripts.
