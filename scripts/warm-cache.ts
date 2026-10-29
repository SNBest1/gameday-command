/**
 * Fill the decision cache before a demo.
 *
 * Kev answers in roughly 250 ms, so a scenario met for the very first time
 * cannot have more than a handful of its keys answered inside the engine's 2 s
 * pause; the rest fall back, exactly as the contract says they must. The server
 * then fetches those keys in the background, so the cache is complete a minute
 * or two later and every run after that is answered by the model.
 *
 * This runs each incident once against a live server to raise its keys, then
 * waits for the background warmer to go quiet.
 *
 *   npm run serve     # in another terminal, with Kev on :8009
 *   npm run warm
 *   WARM_WEATHER=thunderstorm npm run warm   # weather is part of every decision's key
 *   WARM_SETTLE_S=120 npm run warm           # wait longer when Kev is slow (low memory)
 */
import type { SimConfig } from '../contracts.ts';
import { DEFAULT_DANGER_DENSITY } from '../contracts.ts';
import { DECISION_DEFAULTS } from '../brain/src/defaults.ts';
import { makePopulation } from '../brain/src/fan-types.ts';
import { buildStadiumMap, extractExists, loadExtract } from '../world/src/osm/stadium.ts';
import { makeTestMap } from '../world/src/test-map.ts';
import { incidentsFor, windowFor, INCIDENT_LABELS } from '../world/src/incidents.ts';
import { playbookFor } from '../world/src/playbook.ts';
import { WEATHER_TIMELINES } from '../world/src/weather.ts';
import { makeOfficers } from '../world/src/officers.ts';
import { FlowMovement } from '../engine/src/movement-flow.ts';
import { Simulation } from '../engine/src/sim.ts';

const SERVER = process.env.SERVER_URL ?? 'http://127.0.0.1:8787';
const FANS = Number(process.env.WARM_FANS ?? 100_000);
const SEED = 20251023;
// Rain and lightning change the decision key, so a demo in that weather needs its own answers.
const WEATHER = WEATHER_TIMELINES.find((w) => w.id === (process.env.WARM_WEATHER ?? 'clear'));
if (!WEATHER) throw new Error(`WARM_WEATHER must be one of ${WEATHER_TIMELINES.map((w) => w.id).join(', ')}`);

async function cachedKeys(): Promise<number> {
  const res = await fetch(`${SERVER}/api/health`);
  const body = (await res.json()) as { cachedDecisions?: number };
  return body.cachedDecisions ?? 0;
}

const map = extractExists() ? buildStadiumMap(loadExtract()) : makeTestMap();
const population = makePopulation(FANS, SEED);

console.log(`warming ${map.name} with ${FANS.toLocaleString()} fans in ${WEATHER.label} against ${SERVER}`);
console.log(`cache starts at ${await cachedKeys()} keys`);

for (const incident of incidentsFor(map)) {
  const plans = playbookFor(incident.kind, map).slice(0, 3);
  const window = windowFor(incident);
  for (const [i, plan] of plans.entries()) {
    const config: SimConfig = {
      runId: `warm-${incident.id}-${i}`,
      label: (['A', 'B', 'C'] as const)[i]!,
      seed: SEED,
      startAt: window.startAt,
      endAt: window.endAt,
      speed: 1_000_000,
      dangerDensity: DEFAULT_DANGER_DENSITY,
      mapId: map.id,
      incident,
      plan,
      officers: makeOfficers(map, 24),
      ...(WEATHER.id === 'clear' ? {} : { weather: WEATHER }),
    };
    const sim = new Simulation({
      config,
      map,
      population,
      defaults: DECISION_DEFAULTS,
      serverUrl: SERVER,
      movement: new FlowMovement(),
    });
    while (!sim.done) await sim.step();
    console.log(`  ${INCIDENT_LABELS[incident.kind]} / ${plan.name}: raised its keys`);
  }
}

// The warmer works in the background; wait for it to stop finding new ones. A Kev
// short of memory can take 20 s or more per answer, so the quiet spell that counts
// as done is configurable (WARM_SETTLE_S, default 15 s).
const SETTLE_MS = (Number(process.env.WARM_SETTLE_S ?? 15) * 1000) / 3;
let last = -1;
let settled = 0;
while (settled < 3) {
  await new Promise((r) => setTimeout(r, SETTLE_MS));
  const now = await cachedKeys();
  settled = now === last ? settled + 1 : 0;
  if (now !== last) console.log(`  cache at ${now} keys`);
  last = now;
}
console.log(`done: ${last} keys cached. Decisions will come from the model, not the fallback table.`);
