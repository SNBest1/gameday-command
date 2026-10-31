# Brief: real data

Status: brief. **Most of this is people work, not implementer work.** Nobody on the team owns it yet.

## Goal

Get enough real game-day data to show whether the simulation matches reality. Without it nobody can claim the model is realistic, however good the code is.

## What to ask for

From Ohio State athletics and stadium operations:

- Turnstile scan logs for several past home games: gate, timestamp, count. Minute-level aggregates are enough. No ticket or personal data is needed or wanted.
- Gate opening times, staffing per gate, and any gate closures on those days.
- Attendance per game.
- Parking lot fill times, if they are recorded.

From the police department:

- Incident logs for those games (time, place, type), at whatever level they can share.
- Officer posts and their counts on those days.
- Which systems they use (dispatch, radio), for later integration.

## Gate for this phase

One past game day is replayed in the simulation with that day's attendance and gate set-up, and the simulated gate admissions per minute are compared against the real scan counts. The result goes into `validation/report.md` with the same "model, reference, difference, source" format as Phase 1.

## Implementer work once data arrives (a plan will follow)

- An importer from the provided format into a time series of counts per gate per minute.
- A replay scenario driven by real attendance and gate times.
- A comparison step added to `npm run validate`.

## Rules

- Counts only. No names, ticket numbers, faces or device identifiers are stored.
- Raw data the providers do not allow in git stays out of the repository. Only aggregates go in, with permission recorded in `validation/reference/SOURCES.md`.
