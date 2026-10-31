import { CELL_SIZE_M } from '../../../contracts.ts';
import { METERS_PER_DEGREE_LAT, type LatLon } from './raster.ts';
import type { OsmExtract } from './stadium.ts';

/**
 * Where a map sits on Earth, in the same local frame as `makeProjection`.
 * `center` and `radiusM` come from the OSM extract; `cellSizeM` is the
 * simulation grid, so a cell can be placed back in lon/lat exactly.
 */
export interface MapGeoref {
  center: { lat: number; lon: number };
  radiusM: number;
  cellSizeM: number;
}

const DEG = Math.PI / 180;

/** Metres per degree of longitude at the map's centre latitude. */
const metersPerDegreeLon = (center: LatLon) => METERS_PER_DEGREE_LAT * Math.cos(center.lat * DEG);

export function georefOf(extract: OsmExtract): MapGeoref {
  return {
    center: { lat: extract.center.lat, lon: extract.center.lon },
    radiusM: extract.radiusM,
    cellSizeM: CELL_SIZE_M,
  };
}

/**
 * Centre of cell (x, y) as [lon, lat]. `width` is only used when the georef
 * has no radius: the local flat frame used by maps with no location.
 */
export function cellCentreLngLat(geo: MapGeoref, width: number, x: number, y: number): [number, number] {
  const radius = geo.radiusM > 0 ? geo.radiusM : (width * geo.cellSizeM) / 2;
  const east = (x + 0.5) * geo.cellSizeM - radius;
  const south = (y + 0.5) * geo.cellSizeM - radius;
  const lon = geo.center.lon + east / metersPerDegreeLon(geo.center);
  const lat = geo.center.lat - south / METERS_PER_DEGREE_LAT;
  return [lon, lat];
}

/**
 * Lon/lat to local metres (x east, y south) from the centre, the same frame
 * `makeProjection` uses before it floors into a cell.
 */
export function lngLatToXY(geo: MapGeoref, lon: number, lat: number): { x: number; y: number } {
  return {
    x: (lon - geo.center.lon) * metersPerDegreeLon(geo.center),
    y: (geo.center.lat - lat) * METERS_PER_DEGREE_LAT,
  };
}
