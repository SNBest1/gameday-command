/**
 * Run the crowd model on the validation maps and write validation/report.md.
 *
 * The reference tables are committed under validation/reference/. The raw data
 * they were derived from is fetched by validation/fetch-reference.ts and derived
 * by validation/derive-reference.ts; this script never types a reference value.
 *
 *   npm run validate
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DECISION_DEFAULTS } from '../brain/src/defaults.ts';
import { makePopulation } from '../brain/src/fan-types.ts';
import { CELL_SIZE_M, DOT_GROUP_SIZE, DOT_STATES, type Incident, type SimConfig } from '../contracts.ts';
import { FlowMovement } from '../engine/src/movement-flow.ts';
import { Simulation } from '../engine/src/sim.ts';
import { corridorMap, roomMap } from './maps.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REFERENCE = resolve(HERE, 'reference');
const REPORT = resolve(HERE, 'report.md');

interface CsvRow {
  [key: string]: string;
}

function readCsv(name: string): CsvRow[] {
  const lines = readFileSync(resolve(REFERENCE, name), 'utf8').trim().split('\n');
  const header = lines[0]!.split(',');
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const row: CsvRow = {};
    header.forEach((key, i) => {
      row[key] = cells[i] ?? '';
    });
    return row;
  });
}

function meanStd(values: number[]): { mean: number; std: number } {
  if (values.length === 0) return { mean: 0, std: 0 };
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  if (values.length < 2) return { mean, std: 0 };
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return { mean, std: Math.sqrt(variance) };
}

function baseConfig(mapId: string, incident: Incident, endAt: number): SimConfig {
  return {
    runId: 'validation',
    label: 'A',
    seed: 20251023,
    startAt: 0,
    endAt,
    speed: 1_000_000,
    dangerDensity: 4,
    mapId,
    incident,
    plan: { id: 'validation-none', name: 'No actions', forIncident: 'gate_surge', officersAvailable: 0, actions: [] },
    officers: [],
  };
}

const incident: Incident = {
  id: 'validation-incident',
  kind: 'gate_surge',
  at: 1_000_000,
  cells: [],
  safeCount: 0,
};

async function corridorModel(): Promise<Map<number, number[]>> {
  const map = corridorMap();
  const movement = new FlowMovement();
  const sim = new Simulation({
    config: baseConfig(map.id, incident, 600),
    map,
    population: makePopulation(1_500, 20251023),
    defaults: DECISION_DEFAULTS,
    serverUrl: '',
    movement,
    replay: { runId: 'validation', answers: [] },
  });
  const bins = new Map<number, number[]>();
  // A 10 m stretch in the middle of the 50 m corridor, across its full 6 m width.
  const X0 = 35;
  const X1 = 39;
  const AREA = (X1 - X0 + 1) * CELL_SIZE_M * 3 * CELL_SIZE_M;
  let previousX = sim.ctx.dots.x.slice();
  let previousY = sim.ctx.dots.y.slice();
  while (!sim.done) {
    await sim.step();
    const dots = sim.ctx.dots;
    let inside = 0;
    for (let i = 0; i < dots.count; i++) {
      const x = dots.x[i]!;
      const y = dots.y[i]!;
      if (x < 0 || y < 0) continue;
      const cx = (x / CELL_SIZE_M) | 0;
      if (cx < X0 || cx > X1) continue;
      inside++;
      if (DOT_STATES[dots.state[i]!] !== 'walking') continue;
      const dx = x - previousX[i]!;
      const dy = y - previousY[i]!;
      if (previousX[i]! < 0 || previousY[i]! < 0) continue;
      const speed = Math.hypot(dx, dy);
      if (!Number.isFinite(speed)) continue;
      const density = (inside * DOT_GROUP_SIZE) / AREA;
      const bin = Math.floor(density / 0.25);
      let values = bins.get(bin);
      if (!values) {
        values = [];
        bins.set(bin, values);
      }
      values.push(speed);
    }
    previousX = dots.x.slice();
    previousY = dots.y.slice();
  }
  return bins;
}

interface FlowResult {
  widthM: number;
  j: number;
  js: number;
  people: number;
  seconds: number;
}

async function roomModel(openingCells: number): Promise<FlowResult | null> {
  const map = roomMap(openingCells);
  const movement = new FlowMovement();
  const sim = new Simulation({
    config: baseConfig(map.id, incident, 900),
    map,
    population: makePopulation(1_200, 20251023),
    defaults: DECISION_DEFAULTS,
    serverUrl: '',
    movement,
    replay: { runId: 'validation', answers: [] },
  });
  const admitted = new Uint8Array(sim.ctx.dots.count);
  const events: { t: number; people: number }[] = [];
  while (!sim.done) {
    await sim.step();
    for (let i = 0; i < admitted.length; i++) {
      if (admitted[i] === 1) continue;
      if (movement.describe(i).admitted) {
        admitted[i] = 1;
        events.push({ t: sim.ctx.t, people: DOT_GROUP_SIZE });
      }
    }
  }
  if (events.length === 0) return null;
  const first = events[0]!.t;
  const last = events[events.length - 1]!.t;
  const span = last - first;
  if (span <= 0) return null;
  const from = first + 0.1 * span;
  const to = last - 0.1 * span;
  let people = 0;
  for (const event of events) if (event.t >= from && event.t <= to) people += event.people;
  const seconds = to - from;
  const widthM = openingCells * CELL_SIZE_M;
  const j = seconds > 0 ? people / seconds : 0;
  return { widthM, j, js: j / widthM, people, seconds };
}

const corridor = await corridorModel();
const rooms = [];
for (const cells of [1, 2, 3, 4]) rooms.push(await roomModel(cells));
const speedReference = readCsv('speed-density.csv');
const flowReference = readCsv('bottleneck-flow.csv');
const referenceByWidth = new Map<number, number[]>();
for (const row of flowReference) {
  const width = Number(row.width_m);
  const js = Number(row.Js);
  const values = referenceByWidth.get(width) ?? [];
  values.push(js);
  referenceByWidth.set(width, values);
}
const allReferenceJs = [...referenceByWidth.values()].flat();
const referenceMeanJs = allReferenceJs.reduce((sum, value) => sum + value, 0) / allReferenceJs.length;

const corridorRows = speedReference.map((row) => {
  const low = Number(row.density_min_p_m2);
  const high = Number(row.density_max_p_m2);
  const mid = (low + high) / 2;
  const model = corridor.get(Math.floor(mid / 0.25));
  const reference = Number(row.mean_speed_mps);
  const modelMean = model ? meanStd(model).mean : null;
  return {
    bin: `${low.toFixed(2)}-${high.toFixed(2)}`,
    model: modelMean,
    reference,
    difference: modelMean === null ? null : modelMean - reference,
    samples: row.samples,
  };
});

const bottleneckRows = rooms
  .filter((result): result is FlowResult => result !== null)
  .map((result) => ({
    width: result.widthM,
    model: result.js,
    reference: referenceMeanJs,
    difference: result.js - referenceMeanJs,
  }));

const md = [
  '# Validation report',
  '',
  'Generated by `npm run validate`. Every reference value comes from the committed',
  'CSVs under `validation/reference/`; the raw Jülich files and their hashes are',
  'described in `validation/reference/SOURCES.md`.',
  '',
  '## Reading this report',
  '',
  'The crowd model uses the Weidmann speed-density curve (`densityFactor()` in',
  '`engine/src/movement-flow.ts`). Comparing the model with the Weidmann row',
  'therefore checks that the implementation follows the curve; it does **not**',
  'validate the curve against reality. The Jülich corridor and bottleneck data are',
  'the empirical reference.',
  '',
  '## Corridor: walking speed against density',
  '',
  'Model: the 50 m validation corridor, 1,500 fans, default decisions, no officers or',
  'incident. Speed is the displacement of walking dots over one simulated second;',
  'density is the number of people in the middle 10 m x 6 m measurement area',
  '(30 m2). Reference: Jülich `corridor5`, run `UNI_CORR_500_05`, binned in 0.25',
  'p/m2 steps by `validation/derive-reference.ts`.',
  '',
  '| Density (p/m2) | Model mean speed (m/s) | Reference mean speed (m/s) | Difference (m/s) | Source |',
  '| --- | ---: | ---: | ---: | --- |',
  ...corridorRows.map(
    (row) =>
      `| ${row.bin} | ${row.model === null ? 'no samples' : row.model.toFixed(3)} | ${row.reference.toFixed(3)} | ${row.difference === null ? '-' : row.difference.toFixed(3)} | speed-density.csv |`,
  ),
  '',
  '## Bottleneck: specific flow against opening width',
  '',
  'Model: the validation room, 1,200 fans, one opening of 2, 4, 6 or 8 m, gate',
  'throughput set high so the geometry and crowd control the flow. The steady',
  'part is the middle 80% of the time between the first and last admission.',
  'Reference: `bottleneck1`, widths 0.8-1.2 m, using the derived `Js` column.',
  '',
  '**The reference openings are narrower than one 2 m cell (0.8-1.2 m). The model',
  'cannot represent an opening below 2 m, so this is a comparison of specific flow',
  'per metre only, and an extrapolation. It is not a like-for-like width test.**',
  '',
  '| Model opening (m) | Model Js (people/m/s) | Reference mean Js (people/m/s) | Difference | Source |',
  '| ---: | ---: | ---: | ---: | --- |',
  ...bottleneckRows.map(
    (row) =>
      `| ${row.width.toFixed(0)} | ${row.model.toFixed(3)} | ${row.reference.toFixed(3)} | ${row.difference.toFixed(3)} | bottleneck-flow.csv |`,
  ),
  '',
  'Reference rows behind that mean:',
  '',
  '| Width (m) | Participants | Crossings | J (people/s) | Js (people/m/s) | J first-last | Js first-last |',
  '| ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...flowReference.map(
    (row) =>
      `| ${Number(row.width_m).toFixed(1)} | ${row.participants} | ${row.crossings} | ${Number(row.J).toFixed(3)} | ${Number(row.Js).toFixed(3)} | ${Number(row.J_first_last).toFixed(3)} | ${Number(row.Js_first_last).toFixed(3)} |`,
  ),
  '',
  '## Weidmann (1993)',
  '',
  "The model curve is Weidmann's fitted relation, not a measurement from this",
  'suite: free flow up to 0.5 p/m2, `v = v_free · (1 − exp(−1.913 · (1/ρ − 1/ρ_jam)))`',
  'with `ρ_jam = 5.4 p/m2`, floored at 5% of free speed. It is recorded as a fitted',
  'curve in `SOURCES.md`; no number here is copied from memory.',
  '',
  '## Known limits of the grid',
  '',
  'The simulation grid is 2 m. An opening narrower than one cell cannot be',
  'represented, so the 0.8-1.2 m Jülich openings are not reproduced directly. The',
  'bottleneck comparison uses specific flow per metre as an extrapolation, and the',
  'corridor measurement area is a 2 m grid approximation of a continuous space.',
  '',
].join('\n');

writeFileSync(REPORT, md);
console.log(`wrote ${REPORT}`);
console.log(`corridor bins: ${corridor.size}; room widths: ${rooms.map((r) => r?.widthM ?? 'none').join(', ')}`);
