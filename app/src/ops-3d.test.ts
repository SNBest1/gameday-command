import { describe, expect, it } from 'vitest';
import { DOT_STATES, type TickFrame } from '../../contracts.ts';
import { makeTestMap } from '../../world/src/test-map.ts';
import { bowlHeights, RIM_H, TIER_STEP } from './bowl-heights.ts';
import { bowlBox, crowdColour, seatColumns, seatedByCell } from './ops-3d.ts';
import { flatGeoref } from './ops-geo.ts';
import type { Rgba } from './ops-layers.ts';

const map = makeTestMap();
const geo = flatGeoref(map.width);

describe('the 3D operations map', () => {
  it('raises every seat cell in whole tiers, never the field or the ground', () => {
    const bowl = bowlHeights(map)!;
    const field = new Set(map.field ?? []);
    expect(bowl.seats.length).toBeGreaterThan(0);
    for (const cell of bowl.seats) {
      expect(map.cells[cell]).toBe('stands');
      expect(field.has(cell)).toBe(false);
      const h = bowl.height[cell]!;
      expect(h).toBeGreaterThanOrEqual(TIER_STEP);
      expect(h).toBeLessThanOrEqual(RIM_H + TIER_STEP);
      expect((h / TIER_STEP) % 1).toBe(0);
    }
    expect(bowl.height.filter((h, c) => h > 0 && map.cells[c] !== 'stands').length).toBe(0);
  });

  it('gives one column per seat, inside the bowl box', () => {
    const columns = seatColumns(map, geo);
    const box = bowlBox(map)!;
    expect(columns.length).toBe(bowlHeights(map)!.seats.length);
    for (const c of columns) {
      const u = c.cell % map.width;
      const v = Math.floor(c.cell / map.width);
      expect(u >= box.x0 && u <= box.x1 && v >= box.y0 && v <= box.y1).toBe(true);
      expect(c.color[3]).toBe(255);
    }
  });

  it('counts only the people sitting, and colours a filled seat differently', () => {
    const seat = seatColumns(map, geo)[0]!;
    const x = ((seat.cell % map.width) + 0.5) * 2;
    const y = (Math.floor(seat.cell / map.width) + 0.5) * 2;
    const frame = {
      x: Float32Array.from([x, x, x, -1]),
      y: Float32Array.from([y, y, y, -1]),
      state: Uint8Array.from([
        DOT_STATES.indexOf('seated'),
        DOT_STATES.indexOf('seated'),
        DOT_STATES.indexOf('walking'),
        DOT_STATES.indexOf('seated'),
      ]),
    } as unknown as TickFrame;
    const seated = seatedByCell(map, frame);
    expect(seated[seat.cell]).toBe(2);
    const empty: Rgba = [156, 28, 36, 255];
    expect(crowdColour(empty, 0, seat.cell)).toEqual(empty);
    expect(crowdColour(empty, 6, seat.cell)).not.toEqual(empty);
  });
});
