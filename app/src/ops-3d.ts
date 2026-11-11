import type { MapBundle, TickFrame, VehicleKind } from '../../contracts.ts';
import { CELL_SIZE_M, DOT_STATES, VEHICLE_KINDS } from '../../contracts.ts';
import { VEHICLE_TYPES } from '../../world/src/vehicles.ts';
import { flowLevel, FLOW_RGB, isDriving } from './congestion.ts';
import type { MapGeoref } from '../../world/src/osm/georef.ts';
import { bowlHeights, TIER_STEP } from './bowl-heights.ts';
import { cellToLngLat, metresToLngLat } from './ops-geo.ts';
import type { Rgba } from './ops-layers.ts';
import { bowlPalette } from './stadium3d.ts';

/**
 * The 3D operations map's own pieces, as plain data: the stadium bowl as one
 * column per seat cell, rising in tiers and painted in the home team's
 * sections, and the turf inside it. Buildings come from the map tiles; the
 * stadium is drawn here instead, because a tile building is one solid block
 * that would bury the bowl and everyone in it. No deck.gl or MapLibre here.
 */

export interface SeatColumn {
  cell: number;
  position: [number, number];
  /** Meters to the top of this tier. */
  elevation: number;
  /** The empty seat's colour. */
  color: Rgba;
}

const rgb = (n: number): [number, number, number] => [(n >> 16) & 255, (n >> 8) & 255, n & 255];

/** One column per seat cell. Built once per map; the crowd is a colour on top. */
export function seatColumns(map: MapBundle, geo: MapGeoref): SeatColumn[] {
  const bowl = bowlHeights(map);
  if (!bowl) return [];
  const W = map.width;
  let cx = 0;
  let cy = 0;
  for (const c of bowl.seats) {
    cx += c % W;
    cy += (c / W) | 0;
  }
  cx /= bowl.seats.length;
  cy /= bowl.seats.length;
  const palette = bowlPalette(map);
  return bowl.seats.map((cell) => {
    const u = cell % W;
    const v = (cell / W) | 0;
    const h = bowl.height[cell]!;
    // Sections of the home team's two colours with a lighter aisle between, as in the close-up.
    const turn = ((Math.atan2(v - cy, u - cx) + Math.PI) / (Math.PI * 2)) * 28;
    const section = Math.floor(turn);
    const aisle = Math.abs(turn - section - 0.5) > 0.46;
    const row = Math.round(h / TIER_STEP) % 2;
    const seat = aisle ? palette.aisle : section % 2 ? (row ? palette.a1 : palette.a2) : row ? palette.b1 : palette.b2;
    return { cell, position: cellToLngLat(geo, W, cell), elevation: h, color: [...rgb(seat), 255] as Rgba };
  });
}

const SEATED = DOT_STATES.indexOf('seated');
const SHELTERING = DOT_STATES.indexOf('sheltering');

/** How many dots sit in each cell of this frame (seated or sheltering inside the bowl). */
export function seatedByCell(map: MapBundle, frame: TickFrame): Uint8Array {
  const out = new Uint8Array(map.width * map.height);
  for (let i = 0; i < frame.state.length; i++) {
    const s = frame.state[i];
    if (s !== SEATED && s !== SHELTERING) continue;
    const u = Math.floor(frame.x[i]! / CELL_SIZE_M);
    const v = Math.floor(frame.y[i]! / CELL_SIZE_M);
    if (u < 0 || v < 0 || u >= map.width || v >= map.height) continue;
    const c = v * map.width + u;
    if (out[c]! < 255) out[c]!++;
  }
  return out;
}

/** A filled section reads as a crowd: the seat colour lightened and speckled by how full it is. */
export function crowdColour(seat: Rgba, dots: number, cell: number): Rgba {
  if (dots <= 0) return seat;
  const full = Math.min(1, dots / 6);
  // A fixed speckle per cell, so a full stand looks like people, not paint.
  const speckle = ((cell * 2654435761) >>> 24) / 255;
  const k = 0.25 + 0.45 * full;
  const tone = 150 + speckle * 90;
  return [
    Math.round(seat[0] * (1 - k) + tone * k),
    Math.round(seat[1] * (1 - k) + tone * k),
    Math.round(seat[2] * (1 - k) + (tone - 10) * k),
    255,
  ];
}

/** The bowl's footprint as cell bounds, for telling a tile building that is the stadium. */
export function bowlBox(map: MapBundle): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let c = 0; c < map.cells.length; c++) {
    if (map.cells[c] !== 'stands') continue;
    const u = c % map.width;
    const v = (c / map.width) | 0;
    if (u < x0) x0 = u;
    if (u > x1) x1 = u;
    if (v < y0) y0 = v;
    if (v > y1) y1 = v;
  }
  return x1 >= x0 ? { x0, y0, x1, y1 } : null;
}

/** The turf, for the street-map look; over imagery the real field is already there. */
export function turfColumns(map: MapBundle, geo: MapGeoref): SeatColumn[] {
  return (map.field ?? []).map((cell) => {
    // Mown stripes every 10 m across the field's rows.
    const stripe = Math.floor(((cell / map.width) | 0) / 5) % 2;
    return {
      cell,
      position: cellToLngLat(geo, map.width, cell),
      elevation: 0.3,
      color: (stripe ? [58, 128, 66, 255] : [50, 116, 58, 255]) as Rgba,
    };
  });
}

/** Roof heights in meters, as in the close-up. */
const VEHICLE_H: Record<VehicleKind, number> = {
  compact: 1.42,
  sedan: 1.45,
  suv: 1.8,
  pickup: 1.9,
  minivan: 1.78,
  rideshare: 1.45,
  motorcycle: 1.15,
  rv: 3.6,
  bus: 3.5,
  police: 1.6,
  ambulance: 2.7,
};
/** Parked paint, picked per vehicle so a lot does not read as one grey slab. */
const PAINT: [number, number, number][] = [
  [226, 228, 230],
  [38, 41, 46],
  [150, 156, 163],
  [122, 28, 34],
  [36, 62, 104],
  [196, 198, 192],
  [84, 90, 96],
];

export interface VehicleBox {
  vehicle: number;
  /** The footprint's four corners, turned to the vehicle's heading. */
  polygon: [number, number][];
  height: number;
  color: Rgba;
}

/**
 * Every vehicle on the map as a box its real size, turned the way it faces.
 * Moving traffic keeps the flow colours (green, amber, red) when they are on;
 * parked vehicles get a paint colour of their own.
 */
export function vehicleBoxes(
  map: MapBundle,
  geo: MapGeoref,
  frame: TickFrame,
  showFlow: boolean,
  focus: VehicleKind | null,
): VehicleBox[] {
  const v = frame.vehicles;
  if (!v) return [];
  const out: VehicleBox[] = [];
  const maxX = map.width * CELL_SIZE_M;
  const maxY = map.height * CELL_SIZE_M;
  for (let i = 0; i < v.x.length; i++) {
    const x = v.x[i]!;
    const y = v.y[i]!;
    if (x < 0 || y < 0 || x >= maxX || y >= maxY) continue;
    const kind = VEHICLE_KINDS[v.kind[i]!]!;
    const type = VEHICLE_TYPES[kind];
    const heading = v.heading[i]!;
    const fx = (Math.cos(heading) * type.lengthM) / 2;
    const fy = (Math.sin(heading) * type.lengthM) / 2;
    const rx = (-Math.sin(heading) * type.widthM) / 2;
    const ry = (Math.cos(heading) * type.widthM) / 2;
    const corner = (a: number, b: number) => metresToLngLat(geo, map.width, x + a * fx + b * rx, y + a * fy + b * ry);
    const driving = isDriving(v.state[i]!);
    const rgb: [number, number, number] =
      kind === 'police'
        ? [30, 64, 175]
        : kind === 'ambulance'
          ? [240, 240, 236]
          : driving && showFlow
            ? ((FLOW_RGB[flowLevel(v.state[i]!, v.speed[i]!)] as [number, number, number] | undefined) ??
              PAINT[i % PAINT.length]!)
            : PAINT[i % PAINT.length]!;
    out.push({
      vehicle: i,
      polygon: [corner(1, 1), corner(1, -1), corner(-1, -1), corner(-1, 1)],
      height: VEHICLE_H[kind],
      color: [...rgb, focus !== null && focus !== kind ? 70 : 255] as Rgba,
    });
  }
  return out;
}
