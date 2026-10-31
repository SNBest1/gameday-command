/**
 * Derive the two reference tables from the raw Jülich files.
 *
 * Sources, hashes and methods: validation/reference/SOURCES.md.
 * Raw inputs are downloaded by validation/fetch-reference.ts and are gitignored.
 *
 *   node validation/derive-reference.ts
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = resolve(HERE, 'reference/raw');
const OUT = resolve(HERE, 'reference');

interface Point {
  t: number;
  x: number;
  y: number;
}

interface Crossing {
  id: number;
  t: number;
}

/** Linear interpolation of a person's position at an arbitrary time. */
function positionAt(points: Point[], t: number): { x: number; y: number } | null {
  if (points.length === 0 || t < points[0]!.t || t > points[points.length - 1]!.t) return null;
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  const a = points[lo]!;
  const b = points[hi]!;
  const span = b.t - a.t;
  const f = span === 0 ? 0 : (t - a.t) / span;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

function meanStd(values: number[]): { mean: number; std: number } {
  if (values.length === 0) return { mean: 0, std: 0 };
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  if (values.length < 2) return { mean, std: 0 };
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return { mean, std: Math.sqrt(variance) };
}

function deriveCorridor(): void {
  const path = resolve(RAW, 'corridor/traj_UNI_CORR_500_05.txt');
  const lines = readFileSync(path, 'utf8').split('\n');
  const people = new Map<number, Point[]>();
  const frames = new Map<number, { id: number; x: number; y: number }[]>();

  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;
    const p = line.trim().split(/\s+/);
    if (p.length < 4) continue;
    const id = Number(p[0]);
    const frame = Number(p[1]);
    const x = Number(p[2]);
    const y = Number(p[3]);
    if (![id, frame, x, y].every(Number.isFinite)) continue;
    const t = frame / 25;
    let track = people.get(id);
    if (!track) {
      track = [];
      people.set(id, track);
    }
    track.push({ t, x, y });
    let atFrame = frames.get(frame);
    if (!atFrame) {
      atFrame = [];
      frames.set(frame, atFrame);
    }
    atFrame.push({ id, x, y });
  }
  for (const track of people.values()) track.sort((a, b) => a.t - b.t);

  // The corridor readme gives no measurement area. The accepted fallback is a
  // 2 m long stretch in the middle of the 5 m wide corridor, across its full width.
  const X0 = -1;
  const X1 = 1;
  const Y0 = 0;
  const Y1 = 5;
  const AREA = (X1 - X0) * (Y1 - Y0);
  const bins = new Map<number, number[]>();
  for (const frame of [...frames.keys()].sort((a, b) => a - b)) {
    const inside = frames.get(frame)!.filter((p) => p.x >= X0 && p.x <= X1 && p.y >= Y0 && p.y <= Y1);
    if (inside.length === 0) continue;
    const density = inside.length / AREA;
    const t = frame / 25;
    for (const p of inside) {
      const track = people.get(p.id);
      if (!track) continue;
      const before = positionAt(track, t - 0.2);
      const after = positionAt(track, t + 0.2);
      if (!before || !after) continue;
      const speed = Math.hypot(after.x - before.x, after.y - before.y) / 0.4;
      if (!Number.isFinite(speed)) continue;
      const bin = Math.floor(density / 0.25);
      let values = bins.get(bin);
      if (!values) {
        values = [];
        bins.set(bin, values);
      }
      values.push(speed);
    }
  }

  const rows = [...bins.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bin, values]) => {
      const { mean, std } = meanStd(values);
      return [
        (bin * 0.25).toFixed(2),
        ((bin + 1) * 0.25).toFixed(2),
        mean.toFixed(4),
        std.toFixed(4),
        String(values.length),
      ].join(',');
    });
  writeFileSync(
    resolve(OUT, 'speed-density.csv'),
    ['density_min_p_m2,density_max_p_m2,mean_speed_mps,std_speed_mps,samples', ...rows].join('\n') + '\n',
  );
  console.log(`speed-density.csv: ${rows.length} bins from ${people.size} people`);
}

function deriveBottleneck(): void {
  const files = readdirSync(resolve(RAW, 'bottleneck')).filter((name) => /^\d{3}_\d{2}\.txt$/.test(name));
  const rows: string[] = [];
  for (const file of files.sort()) {
    const [widthPart, participantsPart] = basename(file, '.txt').split('_');
    const width = Number(widthPart) / 100;
    const participants = Number(participantsPart);
    const tracks = new Map<number, Point[]>();
    for (const line of readFileSync(resolve(RAW, 'bottleneck', file), 'utf8').split('\n')) {
      const p = line.trim().split(/\s+/);
      if (p.length < 4) continue;
      const id = Number(p[0]);
      const [seconds, frame] = p[1]!.split(':');
      const t = Number(seconds) + Number(frame) / 25;
      const x = Number(p[2]);
      const y = Number(p[3]);
      if (![id, t, x, y].every(Number.isFinite)) continue;
      let track = tracks.get(id);
      if (!track) {
        track = [];
        tracks.set(id, track);
      }
      track.push({ t, x, y });
    }

    // The source paper measures at the center of the bottleneck at y = 0.4 m,
    // with movement toward negative y.
    const crossings: Crossing[] = [];
    for (const [id, track] of tracks) {
      track.sort((a, b) => a.t - b.t);
      for (let i = 1; i < track.length; i++) {
        const a = track[i - 1]!;
        const b = track[i]!;
        if (a.y > 0.4 && b.y <= 0.4) {
          const f = (0.4 - a.y) / (b.y - a.y);
          crossings.push({ id, t: a.t + (b.t - a.t) * f });
          break;
        }
      }
    }
    crossings.sort((a, b) => a.t - b.t);
    const n = crossings.length;
    if (n < 3) {
      console.warn(`skip ${file}: only ${n} crossings`);
      continue;
    }
    const k = Math.ceil(0.1 * n);
    const start = k;
    const end = n - k - 1;
    const intervals = end - start;
    const time = crossings[end]!.t - crossings[start]!.t;
    const j = intervals / time;
    const firstJ = n / (crossings[n - 1]!.t - crossings[0]!.t);
    rows.push(
      [
        width.toFixed(1),
        String(participants),
        String(n),
        j.toFixed(4),
        (j / width).toFixed(4),
        firstJ.toFixed(4),
        (firstJ / width).toFixed(4),
      ].join(','),
    );
  }
  writeFileSync(
    resolve(OUT, 'bottleneck-flow.csv'),
    [
      'width_m,participants,crossings,J,Js,J_first_last,Js_first_last',
      ...rows,
    ].join('\n') + '\n',
  );
  console.log(`bottleneck-flow.csv: ${rows.length} runs`);
}

deriveCorridor();
deriveBottleneck();
