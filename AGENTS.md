# AGENTS.md — rules for the implementer

Gameday Command is a crowd and traffic simulation for **live police operations** around a stadium (Ohio Stadium first). A commander sees the crowd, raises an incident, compares response plans side by side and gives live orders. The tool shows tradeoffs; it never tells police what to do.

This file is the short rulebook. `CLAUDE.md` is the deep record of *why* the code is the way it is: read the section about any file before you change it.

## Roles

- **Planner (Claude)** writes the plans in `docs/plans/` and reviews the result.
- **Implementer (you)** carries out one plan at a time, exactly as written. You do not redesign, widen the scope or "improve" things the plan does not mention. If the plan is wrong or unclear, stop and say so (see "Stop and ask").
- Plan status lives in `docs/roadmap.md`. Only the supervisor of a plan ticks its `## Steps` boxes.

## Commands

```bash
npm install          # Node 23.6 or newer (Node 24 recommended)
npm run typecheck    # tsc over every workspace, one pass
npm test             # vitest; live-model tests skip themselves when Kev/fm are not running
npm run build        # production bundle for the app
npm run serve        # API on :8787
npm run dev          # app on :5173, proxies /api to :8787
```

A change is **done** only when `npm run typecheck && npm test && npm run build` all pass. Once Phase 0 lands, `npm run lint` joins that list.

## Layout

| Path | Owns |
| --- | --- |
| `contracts.ts` | The shared types between lanes. **Frozen.** |
| `engine/` | Sim loop, seeded RNG, typed-array dots, flow fields, density, traffic, Web Worker entry. No AI. |
| `world/` | Maps, incidents, playbook plans, officers, scoring. |
| `brain/` | Fan types, situations, decision defaults and client. |
| `server/` | Hono + `node:sqlite`. Decision cache, plans, history, stadium import. |
| `app/` | Vite + React + PixiJS UI. |
| `scripts/` | Cache warming, seed export, manual diagnostics (not part of `npm test`). |
| `docs/` | Roadmap, plans, design records. |

## Hard rules (never break these)

1. **`contracts.ts` is frozen.** Never edit it. If a plan seems to need a change there, stop and ask.
2. **Do not change the order of the step loop** in `engine/src/sim.ts`: world hooks, then decisions, then officers, then dots, then density, then scoring. Changing it changes every result.
3. **Determinism.** The same seed plus the same decision tape must give the exact same run and scorecard. Never use `Math.random()`, `Date.now()` or wall-clock time inside `engine/`, `world/` or `brain/` simulation code. Traffic has its own RNG and only reads dots; keep it that way.
4. **Imports use explicit relative `.ts` paths** (`../../contracts.ts`). No path aliases.
5. **No TypeScript parameter properties** (`constructor(private x: T)`). Node's type stripping rejects them. Declare fields explicitly.
6. **Never `push(...bigArray)`**: large spreads overflow the call stack. Use a loop.
7. **No `<StrictMode>`** in `app/src/main.tsx` (it breaks PixiJS initialisation).
8. **Inside the bowl is not simulated.** Do not add seat-path or concourse walking code.
9. **Never store or show faces or identities.** Any future sensor input is people counts per zone only.
10. **Fan behaviour is an assumption, not a forecast**, and the UI must keep saying so.
11. **No new dependency** unless the plan names it.
12. **Do not edit tests to make them pass.** A test that fails after your change means your change is wrong, unless the plan explicitly says that test changes.

## Stop and ask (do not guess)

Stop, write down what you found and ask the user when:

- a step would touch `contracts.ts`;
- any scorecard number or measured result in `CLAUDE.md` changes when the plan says behaviour should not change;
- a test fails and the plan does not explain why;
- you need a dependency, file or tool the plan does not mention;
- a step needs a reference number (a measured speed, a flow rate) that is not in a committed source file. **Never write a reference number from memory.**
- the plan contradicts this file or `CLAUDE.md`.

## Git

- One branch per plan, named in the plan (for example `phase-0/foundations`). Never commit to `main`.
- Small commits, one idea each, with a clear message. A formatting-only commit stays separate from any logic change.
- Do not rewrite history on a shared branch and do not force-push.
- Never commit `.env`, API keys or anything under `server/data/*.db`.

## Docs

- When behaviour changes, update the matching section of `CLAUDE.md` in the same branch.
- When a plan finishes, mark it done in `docs/roadmap.md` and note anything left over.
