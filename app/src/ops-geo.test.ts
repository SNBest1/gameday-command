import { describe, expect, it } from 'vitest';
import { georefOf } from '../../world/src/osm/georef.ts';
import { makeProjection } from '../../world/src/osm/raster.ts';
import { loadExtract } from '../../world/src/osm/stadium.ts';
import { CELL_SIZE_M } from '../../contracts.ts';
import { cellToLngLat, flatGeoref, lngLatToCell, mapBounds, metresToLngLat } from './ops-geo.ts';

const extract = loadExtract();
const ohio = georefOf(extract);
const ohioSize = makeProjection(extract.center, extract.radiusM, CELL_SIZE_M).width;

describe('ops map lon/lat helpers', () => {
  it('round-trips cells on the Ohio frame', () => {
    const width = ohioSize;
    const height = ohioSize;
    const cells = [0, width - 1, width * (height - 1), width * height - 1, Math.floor(width * height * 0.37)];
    for (const cell of cells) {
      const [lon, lat] = cellToLngLat(ohio, width, cell);
      expect(lngLatToCell(ohio, width, height, lon, lat)).toBe(cell);
    }
  });

  it('round-trips cells on the local flat frame', () => {
    const width = 17;
    const height = 13;
    const flat = flatGeoref(width);
    for (const cell of [0, width - 1, width * (height - 1), width * height - 1, 8 * width + 9]) {
      const [lon, lat] = cellToLngLat(flat, width, cell);
      expect(lngLatToCell(flat, width, height, lon, lat)).toBe(cell);
    }
  });

  it('places metres from the map origin on the right cell', () => {
    const width = 17;
    const height = 13;
    const flat = flatGeoref(width);
    const centre = metresToLngLat(flat, width, 17, 17);
    expect(centre[0]).toBeCloseTo(0, 9);
    expect(centre[1]).toBeCloseTo(0, 9);
    const cell = 10 * width + 10;
    const [lon, lat] = metresToLngLat(flat, width, 21, 21);
    expect(lngLatToCell(flat, width, height, lon, lat)).toBe(cell);
  });

  it('bounds cover the corner cells and reject clicks outside', () => {
    const width = 17;
    const height = 13;
    const flat = flatGeoref(width);
    const [[west, south], [east, north]] = mapBounds(flat, width, height);
    expect(west).toBeLessThan(east);
    expect(south).toBeLessThan(north);

    const [nwLon, nwLat] = cellToLngLat(flat, width, 0);
    const [seLon, seLat] = cellToLngLat(flat, width, width * height - 1);
    expect(nwLon).toBeGreaterThan(west);
    expect(nwLat).toBeLessThan(north);
    expect(seLon).toBeLessThan(east);
    expect(seLat).toBeGreaterThan(south);

    const metre = 1 / 111_320;
    expect(lngLatToCell(flat, width, height, west - metre, (south + north) / 2)).toBe(-1);
    expect(lngLatToCell(flat, width, height, east + metre, (south + north) / 2)).toBe(-1);
    expect(lngLatToCell(flat, width, height, (west + east) / 2, north + metre)).toBe(-1);
    expect(lngLatToCell(flat, width, height, (west + east) / 2, south - metre)).toBe(-1);
  });
});
