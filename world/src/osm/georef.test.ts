import { describe, expect, it } from 'vitest';
import { CELL_SIZE_M } from '../../../contracts.ts';
import { cellCentreLngLat, georefOf, lngLatToXY } from './georef.ts';
import { makeProjection, METERS_PER_DEGREE_LAT } from './raster.ts';
import { loadExtract } from './stadium.ts';

const extract = loadExtract();
const geo = georefOf(extract);
const projection = makeProjection(extract.center, extract.radiusM, CELL_SIZE_M);

describe('OSM georeference', () => {
  it('projects five OSM points back into the same cell', () => {
    const points = extract.elements
      .flatMap((element) => [element.geometry ?? [], ...(element.members ?? []).map((m) => m.geometry ?? [])])
      .flat()
      .slice(0, 5);
    expect(points).toHaveLength(5);

    for (const point of points) {
      const cell = projection.xyOf(point);
      const [lon, lat] = cellCentreLngLat(geo, projection.width, cell.x, cell.y);
      const metres = lngLatToXY(geo, lon, lat);
      expect(Math.floor((metres.x + extract.radiusM) / CELL_SIZE_M)).toBe(cell.x);
      expect(Math.floor((metres.y + extract.radiusM) / CELL_SIZE_M)).toBe(cell.y);

      // The source point is inside that cell, so no further than one cell away.
      const source = lngLatToXY(geo, point.lon, point.lat);
      expect(Math.abs(source.x - metres.x)).toBeLessThan(CELL_SIZE_M);
      expect(Math.abs(source.y - metres.y)).toBeLessThan(CELL_SIZE_M);
    }
  });

  it('puts the four bounding-box corners on the corner cells', () => {
    const { center, radiusM } = extract;
    const metersPerDegreeLon = METERS_PER_DEGREE_LAT * Math.cos((center.lat * Math.PI) / 180);
    const inset = 0.5;
    const west = center.lon - (radiusM - inset) / metersPerDegreeLon;
    const east = center.lon + (radiusM - inset) / metersPerDegreeLon;
    const south = center.lat - (radiusM - inset) / METERS_PER_DEGREE_LAT;
    const north = center.lat + (radiusM - inset) / METERS_PER_DEGREE_LAT;
    const last = projection.width - 1;

    expect(projection.xyOf({ lat: north, lon: west })).toEqual({ x: 0, y: 0 });
    expect(projection.xyOf({ lat: north, lon: east })).toEqual({ x: last, y: 0 });
    expect(projection.xyOf({ lat: south, lon: west })).toEqual({ x: 0, y: last });
    expect(projection.xyOf({ lat: south, lon: east })).toEqual({ x: last, y: last });

    for (const [x, y] of [
      [0, 0],
      [last, 0],
      [0, last],
      [last, last],
    ] as const) {
      const [lon, lat] = cellCentreLngLat(geo, projection.width, x, y);
      const metres = lngLatToXY(geo, lon, lat);
      expect(Math.abs(metres.x)).toBeLessThanOrEqual(radiusM);
      expect(Math.abs(metres.y)).toBeLessThanOrEqual(radiusM);
    }
  });
});
