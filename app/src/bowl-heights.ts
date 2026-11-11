import type { MapBundle } from '../../contracts.ts';

/**
 * How high each seat in the bowl sits. OSM gives the stadium as one flat
 * polygon; here the seats rise in tiers from the field to the rim. Heights are
 * an impression of a real stadium, not a survey: about 16 m to the rim in
 * 1.5 m steps. Shared by the isometric close-up and the 3D operations map.
 */

export const RIM_H = 16;
export const TIER_STEP = 1.5;

export interface BowlHeights {
  /** Height of each cell's top, in meters; 0 outside the bowl and on the field. */
  height: Float32Array;
  /** The seat cells, in map order. */
  seats: number[];
}

export function bowlHeights(map: MapBundle): BowlHeights | null {
  const { width: W, height: H, cells } = map;
  const field = new Uint8Array(W * H);
  for (const c of map.field ?? []) field[c] = 1;
  const inBowl = (u: number, v: number) => u >= 0 && v >= 0 && u < W && v < H && cells[v * W + u] === 'stands';

  // Distance from the outer edge, in cells, over the whole bowl polygon.
  const dist = new Int32Array(W * H).fill(-1);
  const queue: number[] = [];
  for (let c = 0; c < cells.length; c++) {
    if (cells[c] !== 'stands') continue;
    const u = c % W;
    const v = (c / W) | 0;
    if (!inBowl(u + 1, v) || !inBowl(u - 1, v) || !inBowl(u, v + 1) || !inBowl(u, v - 1)) {
      dist[c] = 1;
      queue.push(c);
    }
  }
  if (queue.length === 0) return null;
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head]!;
    const u = c % W;
    const v = (c / W) | 0;
    for (const [du, dv] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      if (!inBowl(u + du, v + dv)) continue;
      const n = (v + dv) * W + u + du;
      if (dist[n]! >= 0) continue;
      dist[n] = dist[c]! + 1;
      queue.push(n);
    }
  }
  // How deep the seating runs: the deepest seat, short of the field.
  let deepest = 1;
  for (let c = 0; c < cells.length; c++) if (dist[c]! > 0 && !field[c]) deepest = Math.max(deepest, dist[c]!);

  const height = new Float32Array(W * H);
  const seats: number[] = [];
  for (let c = 0; c < cells.length; c++) {
    if (dist[c]! <= 0 || field[c]) continue;
    // Highest at the rim, falling to the front row; stepped, like real tiers.
    const t = 1 - (dist[c]! - 1) / deepest;
    height[c] = Math.max(TIER_STEP, Math.round((1 + t * (RIM_H - 1)) / TIER_STEP) * TIER_STEP);
    seats.push(c);
  }
  return { height, seats };
}
