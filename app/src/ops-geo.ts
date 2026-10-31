import { CELL_SIZE_M } from '../../contracts.ts';
import { cellCentreLngLat, lngLatToXY, type MapGeoref } from '../../world/src/osm/georef.ts';

/**
 * Lon/lat helpers for the Map view. The grid and the OSM projection are the
 * same local equirectangular frame; a map with no location uses a flat frame
 * centred on (0, 0), so every caller can stay in lon/lat.
 */

export type Bounds = [[west: number, south: number], [east: number, north: number]];

/** The frame used when a map has no georeference (the test map). */
export function flatGeoref(width: number, cellSizeM = CELL_SIZE_M): MapGeoref {
  return {
    center: { lat: 0, lon: 0 },
    radiusM: (width * cellSizeM) / 2,
    cellSizeM,
  };
}

/** Exact grid extent as MapLibre's [[west, south], [east, north]]. */
export function mapBounds(geo: MapGeoref, width: number, height: number): Bounds {
  const [west, north] = cellCentreLngLat(geo, width, -0.5, -0.5);
  const [east, south] = cellCentreLngLat(geo, width, width - 0.5, height - 0.5);
  return [
    [west, south],
    [east, north],
  ];
}

/** Centre of a cell index as [lon, lat]. */
export function cellToLngLat(geo: MapGeoref, width: number, cell: number): [number, number] {
  const x = cell % width;
  const y = Math.floor(cell / width);
  return cellCentreLngLat(geo, width, x, y);
}

/** A click's [lon, lat] to a cell index, or -1 when it is off the grid. */
export function lngLatToCell(geo: MapGeoref, width: number, height: number, lon: number, lat: number): number {
  const radius = geo.radiusM > 0 ? geo.radiusM : (width * geo.cellSizeM) / 2;
  const { x, y } = lngLatToXY(geo, lon, lat);
  const gx = Math.floor((x + radius) / geo.cellSizeM);
  const gy = Math.floor((y + radius) / geo.cellSizeM);
  if (gx < 0 || gy < 0 || gx >= width || gy >= height) return -1;
  return gy * width + gx;
}
