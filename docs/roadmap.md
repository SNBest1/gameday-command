# Roadmap

Gameday Command is moving from a hackathon demo to a tool for live police operations. The full reasoning is in the team's shared doc, "Gameday Command: what to rebuild". This file tracks status.

**How work happens.** Claude writes a plan in `docs/plans/`. DeepSeek v4.1 implements it in opencode:

```
/implement-plan docs/plans/<plan>.md
```

Claude then reviews the branch before it merges. Rules for the implementer are in `AGENTS.md`.

## Decisions so far (2026-10-31)

| Question | Decision |
| --- | --- |
| Hackathon rules (no paid APIs, one Mac) | No longer apply |
| Where it runs | Both: on police premises and hosted |
| Vision | On hold until the team discusses it |
| Purpose | Live police operations, not training |
| Who owns validation against real data | Not decided |
| Who talks to OSU and police about data | Not decided |

## Phases

| # | Phase | Status | Plan | Done when |
| --- | --- | --- | --- | --- |
| 0 | Foundations | Ready | [phase-0-foundations.md](plans/phase-0-foundations.md) | CI green on every PR; lint and format enforced; `App.tsx` split; app imports engine only through `engine/src/index.ts` |
| 1 | Headless engine and validation | Ready after Phase 0 merges | [phase-1-headless-engine.md](plans/phase-1-headless-engine.md) | Server-side and browser runs give identical scorecards; validation report compares the model with cited published data |
| 2 | Real data | Needs people, not code | [briefs/real-data.md](plans/briefs/real-data.md) | One past game day replayed against its real gate counts |
| 3 | Map UI | Brief only | [briefs/map-ui.md](plans/briefs/map-ui.md) | GIS map replaces the gamified view as the default |
| 4 | Voice | Brief only | [briefs/voice.md](plans/briefs/voice.md) | Spoken orders go through tool calling to typed `PoliceOrder`s, confirmed and audited |
| — | Vision | **On hold** | [briefs/vision.md](plans/briefs/vision.md) | Not started until the team decides |

A brief becomes a full plan when the phases before it are done, because each depends on what those phases find.
