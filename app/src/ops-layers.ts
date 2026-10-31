import {
  CELL_SIZE_M,
  DOT_STATES,
  VEHICLE_KINDS,
  type DensityGrid,
  type MapBundle,
  type TickFrame,
  type VehicleKind,
} from '../../contracts.ts';
import type { GateStat, OfficerStatus, SceneInfo } from '../../engine/src/edits.ts';
import { cellCentreLngLat, type MapGeoref } from '../../world/src/osm/georef.ts';
import { coverage } from './coverage.ts';
import { flowLevel, FLOW_RGB, standingDensity, type PoliceHotspot } from './congestion.ts';
import { bandOf, HEAT_FLOOR, heatBands } from './heat.ts';
import { mapBounds, type Bounds } from './ops-geo.ts';
import { BARRICADE_SYMBOL, COVERAGE_SYMBOLS, HOTSPOT_SYMBOLS, INCIDENT_SYMBOL, UNIT_SYMBOLS } from './ops-symbols.ts';
import { STATE_RGB } from './people.ts';

/**
 * deck.gl layer props for the operations map, as plain objects. Keeping the
 * data and accessors here means the layers can be checked in Node, without a
 * WebGL context, and the component only turns them into layer instances.
 */

export type Rgba = [number, number, number, number];
export type LngLat = [number, number];

export interface PointDatum {
  position: LngLat;
  color: Rgba;
}

export interface PathDatum {
  path: LngLat[];
  color: Rgba;
  width: number;
}

export interface PolygonDatum {
  polygon: LngLat[];
  fill: Rgba;
  line: Rgba;
}

export interface TextDatum {
  position: LngLat;
  text: string;
}

export interface ScatterProps {
  id: string;
  data: PointDatum[];
  getPosition: (d: PointDatum) => LngLat;
  getFillColor: (d: PointDatum) => Rgba;
  getRadius: number | ((d: PointDatum) => number);
  radiusUnits: 'pixels' | 'meters';
  stroked: boolean;
  getLineColor: (d: PointDatum) => Rgba;
  getLineWidth: number;
  lineWidthUnits: 'pixels';
  visible: boolean;
  pickable: boolean;
}

export interface PathsProps {
  id: string;
  data: PathDatum[];
  getPath: (d: PathDatum) => LngLat[];
  getColor: (d: PathDatum) => Rgba;
  getWidth: (d: PathDatum) => number;
  widthUnits: 'pixels' | 'meters';
  visible: boolean;
  pickable: boolean;
}

export interface PolygonsProps {
  id: string;
  data: PolygonDatum[];
  getPolygon: (d: PolygonDatum) => LngLat[];
  getFillColor: (d: PolygonDatum) => Rgba;
  getLineColor: (d: PolygonDatum) => Rgba;
  stroked: boolean;
  filled: boolean;
  getLineWidth: number;
  lineWidthUnits: 'pixels';
  visible: boolean;
  pickable: boolean;
}

export interface TextsProps {
  id: string;
  data: TextDatum[];
  getPosition: (d: TextDatum) => LngLat;
  getText: (d: TextDatum) => string;
  getColor: [number, number, number, number];
  getSize: number;
  sizeUnits: 'pixels';
  getHaloColor: [number, number, number, number];
  getHaloWidth: number;
  visible: boolean;
  pickable: boolean;
}

export interface DensityProps {
  id: string;
  image: ImageData;
  bounds: Bounds;
  visible: boolean;
  pickable: boolean;
}

const BARRIER: Rgba = [...BARRICADE_SYMBOL.rgb, 150];
const BARRIER_LINE: Rgba = [...BARRICADE_SYMBOL.rgb, 235];
const COVER: Rgba = [...COVERAGE_SYMBOLS.covered.rgb, 55];
const REACH: Rgba = [...COVERAGE_SYMBOLS.reachable.rgb, 28];
const INCIDENT: Rgba = [...INCIDENT_SYMBOL.rgb, 235];
const FAN_ALPHA = 220;

const rgba = (rgb: [number, number, number], alpha = 255): Rgba => [rgb[0], rgb[1], rgb[2], alpha];

const metresToLngLat = (geo: MapGeoref, width: number, x: number, y: number): LngLat =>
  cellCentreLngLat(geo, width, x / geo.cellSizeM - 0.5, y / geo.cellSizeM - 0.5);

const cellToLngLat = (geo: MapGeoref, width: number, cell: number): LngLat =>
  cellCentreLngLat(geo, width, cell % width, Math.floor(cell / width));

const vertexToLngLat = (geo: MapGeoref, width: number, x: number, y: number): LngLat =>
  cellCentreLngLat(geo, width, x - 0.5, y - 0.5);

const cellPolygon = (geo: MapGeoref, width: number, cell: number): LngLat[] => {
  const x = cell % width;
  const y = Math.floor(cell / width);
  return [
    vertexToLngLat(geo, width, x, y),
    vertexToLngLat(geo, width, x + 1, y),
    vertexToLngLat(geo, width, x + 1, y + 1),
    vertexToLngLat(geo, width, x, y + 1),
  ];
};

/** Standing density in the heat bands, transparent below the floor. */
export function densityProps(
  map: MapBundle,
  geo: MapGeoref,
  frame: TickFrame,
  density: Float32Array | undefined,
  dangerDensity: number,
  selectedBand: number | null,
): DensityProps {
  const image = new ImageData(map.width, map.height);
  if (density) {
    const standing = standingDensity(map, frame, density);
    const bands = heatBands(dangerDensity);
    const data = image.data;
    for (let i = 0; i < standing.length; i++) {
      const value = standing[i]!;
      if (value < HEAT_FLOOR) continue;
      const band = bandOf(value, bands);
      if (selectedBand !== null && band !== selectedBand) continue;
      const definition = bands[band]!;
      const o = i * 4;
      data[o] = definition.rgb[0];
      data[o + 1] = definition.rgb[1];
      data[o + 2] = definition.rgb[2];
      data[o + 3] = Math.round(definition.alpha * 255);
    }
  }
  return {
    id: 'ops-density',
    image,
    bounds: mapBounds(geo, map.width, map.height),
    visible: true,
    pickable: false,
  };
}

export interface FanRow extends PointDatum {
  dot: number;
}

export function fanRows(map: MapBundle, geo: MapGeoref, frame: TickFrame, zoom: number): FanRow[] {
  if (zoom < 17) return [];
  const rows: FanRow[] = [];
  const gone = DOT_STATES.indexOf('gone');
  for (let i = 0; i < frame.x.length; i++) {
    const x = frame.x[i]!;
    const y = frame.y[i]!;
    if (x < 0 || y < 0) continue;
    if (x >= map.width * CELL_SIZE_M || y >= map.height * CELL_SIZE_M) continue;
    const state = frame.state[i]!;
    if (state === gone) continue;
    rows.push({
      dot: i,
      position: metresToLngLat(geo, map.width, x, y),
      color: rgba(STATE_RGB[state] ?? [200, 200, 200], FAN_ALPHA),
    });
  }
  return rows;
}

export function fansProps(
  map: MapBundle,
  geo: MapGeoref,
  frame: TickFrame,
  zoom: number,
  selected: number | null,
): ScatterProps {
  return {
    id: 'ops-fans',
    data: fanRows(map, geo, frame, zoom),
    getPosition: (d) => d.position,
    getFillColor: (d) => d.color,
    getRadius: 5,
    radiusUnits: 'pixels',
    stroked: true,
    getLineColor: (d) => ((d as FanRow).dot === selected ? [255, 255, 255, 255] : [0, 0, 0, 0]),
    getLineWidth: 2,
    lineWidthUnits: 'pixels',
    visible: zoom >= 17,
    pickable: true,
  };
}

export interface VehicleRow extends PointDatum {
  vehicle: number;
  kind: VehicleKind;
}

export function vehicleRows(
  map: MapBundle,
  geo: MapGeoref,
  frame: TickFrame,
  showFlow: boolean,
  focus: VehicleKind | null,
  selected: number | null,
): VehicleRow[] {
  const vehicles = frame.vehicles;
  if (!vehicles) return [];
  const rows: VehicleRow[] = [];
  for (let i = 0; i < vehicles.x.length; i++) {
    const x = vehicles.x[i]!;
    const y = vehicles.y[i]!;
    if (x < 0 || y < 0) continue;
    if (x >= map.width * CELL_SIZE_M || y >= map.height * CELL_SIZE_M) continue;
    const kind = VEHICLE_KINDS[vehicles.kind[i]!]!;
    const level = flowLevel(vehicles.state[i]!, vehicles.speed[i]!);
    const colour = showFlow ? (FLOW_RGB[level] ?? [190, 195, 200]) : [190, 195, 200];
    const alpha = focus !== null && focus !== kind ? 60 : i === selected ? 255 : 220;
    rows.push({
      vehicle: i,
      kind,
      position: metresToLngLat(geo, map.width, x, y),
      color: rgba(colour as [number, number, number], alpha),
    });
  }
  return rows;
}

export function vehiclesProps(
  map: MapBundle,
  geo: MapGeoref,
  frame: TickFrame,
  showVehicles: boolean,
  showFlow: boolean,
  focus: VehicleKind | null,
  selected: number | null,
): ScatterProps {
  return {
    id: 'ops-vehicles',
    data: vehicleRows(map, geo, frame, showFlow, focus, selected),
    getPosition: (d) => d.position,
    getFillColor: (d) => d.color,
    getRadius: 6,
    radiusUnits: 'pixels',
    stroked: true,
    getLineColor: (d) => ((d as VehicleRow).vehicle === selected ? [255, 255, 255, 255] : [0, 0, 0, 0]),
    getLineWidth: 2,
    lineWidthUnits: 'pixels',
    visible: showVehicles,
    pickable: true,
  };
}

export interface OfficerRow extends PointDatum {
  id: string;
  unit: string;
  state: OfficerStatus['state'];
}

export function officerRows(
  map: MapBundle,
  geo: MapGeoref,
  scene: SceneInfo | null,
  selected: string | null,
): OfficerRow[] {
  if (!scene) return [];
  return scene.officers.map((officer) => ({
    id: officer.id,
    unit: officer.unit,
    state: officer.state,
    position: metresToLngLat(geo, map.width, officer.x, officer.y),
    color: rgba(UNIT_SYMBOLS[officer.state].rgb, officer.id === selected ? 255 : 235),
  }));
}

/** Split a polyline into dashes, so a route reads as a route rather than a road. */
export function dashPolyline(points: LngLat[], dashM = 6, gapM = 4): LngLat[][] {
  if (points.length < 2) return [];
  const dashes: LngLat[][] = [];
  let current: LngLat[] = [points[0]!];
  let drawing = true;
  let left = dashM;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    // Longitude and latitude are close enough to metres at this scale; use the
    // cell size to keep the dash/gap rhythm independent of latitude.
    const span = Math.hypot(b[0] - a[0], b[1] - a[1]) * 111_320;
    if (span === 0) continue;
    let at = 0;
    while (at < span) {
      const step = Math.min(left, span - at);
      const t = (at + step) / span;
      const point: LngLat = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      if (drawing) current.push(point);
      at += step;
      left -= step;
      if (left <= 1e-6) {
        if (drawing && current.length >= 2) dashes.push(current);
        drawing = !drawing;
        left = drawing ? dashM : gapM;
        current = drawing ? [point] : [];
      }
    }
  }
  if (drawing && current.length >= 2) dashes.push(current);
  return dashes;
}

export function officerRouteRows(map: MapBundle, geo: MapGeoref, scene: SceneInfo | null): PathDatum[] {
  if (!scene) return [];
  const rows: PathDatum[] = [];
  for (const officer of scene.officers) {
    const cells = officer.route?.length ? officer.route : null;
    if (!cells) continue;
    const points = cells.map((cell) => cellToLngLat(geo, map.width, cell));
    for (const dash of dashPolyline(points)) {
      rows.push({ path: dash, color: rgba(UNIT_SYMBOLS[officer.state].rgb, 210), width: 2 });
    }
  }
  return rows;
}

export function officersProps(
  map: MapBundle,
  geo: MapGeoref,
  scene: SceneInfo | null,
  selected: string | null,
): ScatterProps {
  return {
    id: 'ops-officers',
    data: officerRows(map, geo, scene, selected),
    getPosition: (d) => d.position,
    getFillColor: (d) => d.color,
    getRadius: 7,
    radiusUnits: 'pixels',
    stroked: true,
    getLineColor: (d) => ((d as OfficerRow).id === selected ? [255, 255, 255, 255] : [0, 0, 0, 0]),
    getLineWidth: 2,
    lineWidthUnits: 'pixels',
    visible: true,
    pickable: true,
  };
}

export function routesProps(map: MapBundle, geo: MapGeoref, scene: SceneInfo | null): PathsProps {
  return {
    id: 'ops-routes',
    data: officerRouteRows(map, geo, scene),
    getPath: (d) => d.path,
    getColor: (d) => d.color,
    getWidth: (d) => d.width,
    widthUnits: 'pixels',
    visible: true,
    pickable: false,
  };
}

export interface UnitLabelRow extends TextDatum {
  id: string;
  code: string;
}

export function unitLabelRows(map: MapBundle, geo: MapGeoref, scene: SceneInfo | null): UnitLabelRow[] {
  if (!scene) return [];
  return scene.officers.map((officer) => ({
    id: officer.id,
    code: UNIT_SYMBOLS[officer.state].code,
    position: metresToLngLat(geo, map.width, officer.x, officer.y),
    text: UNIT_SYMBOLS[officer.state].code,
  }));
}

export function unitLabelsProps(map: MapBundle, geo: MapGeoref, scene: SceneInfo | null): TextsProps {
  return {
    id: 'ops-unit-labels',
    data: unitLabelRows(map, geo, scene),
    getPosition: (d) => d.position,
    getText: (d) => d.text,
    getColor: [255, 255, 255, 255],
    getSize: 10,
    sizeUnits: 'pixels',
    getHaloColor: [0, 0, 0, 180],
    getHaloWidth: 1,
    visible: true,
    pickable: false,
  };
}

export interface ClosureRow extends PolygonDatum {
  cell: number;
  kind: 'closure' | 'barricade';
}

export function closureRows(map: MapBundle, geo: MapGeoref, scene: SceneInfo | null): ClosureRow[] {
  if (!scene) return [];
  const cells = new Map<number, 'closure' | 'barricade'>();
  for (const id of scene.closed) {
    const closable = map.closables.find((c) => c.id === id);
    if (closable) for (const cell of closable.cells) cells.set(cell, 'closure');
  }
  for (const barricade of scene.barricades ?? []) {
    for (const cell of barricade.cells) cells.set(cell, 'barricade');
  }
  return [...cells.entries()].map(([cell, kind]) => ({
    cell,
    kind,
    polygon: cellPolygon(geo, map.width, cell),
    fill: BARRIER,
    line: BARRIER_LINE,
  }));
}

export function closuresProps(map: MapBundle, geo: MapGeoref, scene: SceneInfo | null): PolygonsProps {
  return {
    id: 'ops-closures',
    data: closureRows(map, geo, scene),
    getPolygon: (d) => d.polygon,
    getFillColor: (d) => d.fill,
    getLineColor: (d) => d.line,
    stroked: true,
    filled: true,
    getLineWidth: 1,
    lineWidthUnits: 'pixels',
    visible: true,
    pickable: false,
  };
}

function gateLabel(stat: GateStat, name: string): string {
  const short = name.replace(/\s*\(.*\)/, '');
  if (!stat.open) return `${short} closed`;
  const flow = stat.outPerMin > stat.inPerMin ? stat.outPerMin : stat.inPerMin;
  return `${short} · ${Math.round(flow)}/min`;
}

export interface GateLabelRow extends TextDatum {
  place: number;
  open: boolean;
}

export function gateLabelRows(map: MapBundle, geo: MapGeoref, scene: SceneInfo | null, zoom: number): GateLabelRow[] {
  if (!scene) return [];
  const rows: GateLabelRow[] = [];
  for (const stat of scene.gates) {
    if (stat.open && zoom < 15) continue;
    const place = map.places[stat.place];
    if (!place || place.cells.length === 0) continue;
    rows.push({
      place: stat.place,
      open: stat.open,
      position: cellToLngLat(geo, map.width, place.cells[0]!),
      text: gateLabel(stat, place.name),
    });
  }
  return rows;
}

export function gatesProps(map: MapBundle, geo: MapGeoref, scene: SceneInfo | null, zoom: number): TextsProps {
  return {
    id: 'ops-gates',
    data: gateLabelRows(map, geo, scene, zoom),
    getPosition: (d) => d.position,
    getText: (d) => d.text,
    getColor: [24, 27, 30, 255],
    getSize: 12,
    sizeUnits: 'pixels',
    getHaloColor: [255, 255, 255, 230],
    getHaloWidth: 2,
    visible: true,
    pickable: false,
  };
}

/** Outline rings around the union of the incident cells. */
export function cellOutlineRings(cells: number[], width: number): { x: number; y: number }[][] {
  const inside = new Set(cells);
  const edges = new Map<string, { x: number; y: number }>();
  const add = (ax: number, ay: number, bx: number, by: number) => {
    const a = `${ax},${ay}`;
    if (!edges.has(a)) edges.set(a, { x: bx, y: by });
  };
  for (const cell of cells) {
    const x = cell % width;
    const y = Math.floor(cell / width);
    if (!inside.has(cell - width)) add(x, y, x + 1, y);
    if (!inside.has(cell + 1)) add(x + 1, y, x + 1, y + 1);
    if (!inside.has(cell + width)) add(x + 1, y + 1, x, y + 1);
    if (!inside.has(cell - 1)) add(x, y + 1, x, y);
  }
  const rings: { x: number; y: number }[][] = [];
  while (edges.size > 0) {
    const [startKey, first] = edges.entries().next().value as [string, { x: number; y: number }];
    const ring = [{ x: Number(startKey.split(',')[0]), y: Number(startKey.split(',')[1]) }];
    edges.delete(startKey);
    let at = first;
    let guard = cells.length * 4 + 8;
    while (guard-- > 0) {
      const key = `${at.x},${at.y}`;
      if (key === startKey) break;
      ring.push(at);
      const next = edges.get(key);
      if (!next) break;
      edges.delete(key);
      at = next;
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

export interface IncidentRow extends PolygonDatum {
  label: string;
}

export function incidentRows(
  cells: number[] | undefined,
  map: MapBundle,
  geo: MapGeoref,
  label: string | undefined,
): IncidentRow[] {
  if (!cells || cells.length === 0) return [];
  return cellOutlineRings(cells, map.width).map((ring) => ({
    label: label ?? 'Incident',
    polygon: ring.map((p) => vertexToLngLat(geo, map.width, p.x, p.y)),
    fill: [255, 45, 111, 28],
    line: INCIDENT,
  }));
}

export function incidentProps(
  cells: number[] | undefined,
  map: MapBundle,
  geo: MapGeoref,
  label: string | undefined,
): PolygonsProps {
  return {
    id: 'ops-incident',
    data: incidentRows(cells, map, geo, label),
    getPolygon: (d) => d.polygon,
    getFillColor: (d) => d.fill,
    getLineColor: (d) => d.line,
    stroked: true,
    filled: true,
    getLineWidth: 2,
    lineWidthUnits: 'pixels',
    visible: true,
    pickable: false,
  };
}

export interface HotspotRow extends PointDatum {
  rank: number;
  level: PoliceHotspot['level'];
  radiusM: number;
}

export function hotspotRows(geo: MapGeoref, width: number, spots: PoliceHotspot[]): HotspotRow[] {
  return spots.map((spot) => {
    const areaCells = (spot.x1 - spot.x0 + 1) * (spot.y1 - spot.y0 + 1);
    return {
      rank: spot.rank,
      level: spot.level,
      position: metresToLngLat(geo, width, spot.cx, spot.cy),
      color: [...HOTSPOT_SYMBOLS[spot.level].rgb, 210] as Rgba,
      radiusM: Math.max(CELL_SIZE_M, Math.sqrt((areaCells * CELL_SIZE_M * CELL_SIZE_M) / Math.PI)),
    };
  });
}

export function hotspotsProps(geo: MapGeoref, width: number, spots: PoliceHotspot[]): ScatterProps {
  const data = hotspotRows(geo, width, spots);
  return {
    id: 'ops-hotspots',
    data,
    getPosition: (d) => d.position,
    getFillColor: (d) => d.color,
    getRadius: (d) => (d as HotspotRow).radiusM,
    radiusUnits: 'meters',
    stroked: false,
    getLineColor: () => [0, 0, 0, 0],
    getLineWidth: 0,
    lineWidthUnits: 'pixels',
    visible: true,
    pickable: false,
  };
}

export interface CoverageRow extends PolygonDatum {
  reachable: boolean;
}

export function coverageRows(
  map: MapBundle,
  geo: MapGeoref,
  officers: OfficerStatus[],
  spots: PoliceHotspot[],
): CoverageRow[] {
  if (officers.length === 0) return [];
  const result = coverage(map, officers, spots);
  const rows: CoverageRow[] = [];
  const block = 6;
  for (let by = 0; by * block < map.height; by++) {
    for (let bx = 0; bx * block < map.width; bx++) {
      const value = result.grid[by * result.width + bx];
      if (!value) continue;
      const x0 = bx * block;
      const y0 = by * block;
      rows.push({
        reachable: value === 2,
        polygon: [
          vertexToLngLat(geo, map.width, x0, y0),
          vertexToLngLat(geo, map.width, Math.min(map.width, x0 + block), y0),
          vertexToLngLat(geo, map.width, Math.min(map.width, x0 + block), Math.min(map.height, y0 + block)),
          vertexToLngLat(geo, map.width, x0, Math.min(map.height, y0 + block)),
        ],
        fill: value === 2 ? REACH : COVER,
        line: value === 2 ? REACH : COVER,
      });
    }
  }
  return rows;
}

export function coverageProps(
  map: MapBundle,
  geo: MapGeoref,
  officers: OfficerStatus[],
  spots: PoliceHotspot[],
  show: boolean,
): PolygonsProps {
  return {
    id: 'ops-coverage',
    data: show ? coverageRows(map, geo, officers, spots) : [],
    getPolygon: (d) => d.polygon,
    getFillColor: (d) => d.fill,
    getLineColor: (d) => d.line,
    stroked: false,
    filled: true,
    getLineWidth: 0,
    lineWidthUnits: 'pixels',
    visible: show,
    pickable: false,
  };
}

export interface OpsLayerProps {
  density: DensityProps;
  fans: ScatterProps;
  vehicles: ScatterProps;
  officers: ScatterProps;
  unitLabels: TextsProps;
  routes: PathsProps;
  closures: PolygonsProps;
  gates: TextsProps;
  incident: PolygonsProps;
  hotspots: ScatterProps;
  coverage: PolygonsProps;
}

export interface OpsLayersInput {
  map: MapBundle;
  geo: MapGeoref;
  frame: TickFrame;
  density: DensityGrid | undefined;
  scene: SceneInfo | null;
  zoom: number;
  dangerDensity: number;
  selectedBand: number | null;
  showVehicles: boolean;
  showFlow: boolean;
  vehicleFocus: VehicleKind | null;
  selectedVehicle: number | null;
  selectedOfficer: string | null;
  selected: number | null;
  showCoverage: boolean;
  hotspots: PoliceHotspot[];
  incidentCells: number[] | undefined;
  incidentLabel: string | undefined;
}

/** Every layer prop the Map view draws, from one frame and one scene. */
export function opsLayerProps(input: OpsLayersInput): OpsLayerProps {
  const {
    map,
    geo,
    frame,
    density,
    scene,
    zoom,
    dangerDensity,
    selectedBand,
    showVehicles,
    showFlow,
    vehicleFocus,
    selectedVehicle,
    selectedOfficer,
    selected,
    showCoverage,
    hotspots,
    incidentCells,
    incidentLabel,
  } = input;
  return {
    density: densityProps(map, geo, frame, density?.peoplePerM2, dangerDensity, selectedBand),
    fans: fansProps(map, geo, frame, zoom, selected),
    vehicles: vehiclesProps(map, geo, frame, showVehicles, showFlow, vehicleFocus, selectedVehicle),
    officers: officersProps(map, geo, scene, selectedOfficer),
    unitLabels: unitLabelsProps(map, geo, scene),
    routes: routesProps(map, geo, scene),
    closures: closuresProps(map, geo, scene),
    gates: gatesProps(map, geo, scene, zoom),
    incident: incidentProps(incidentCells, map, geo, incidentLabel),
    hotspots: hotspotsProps(geo, map.width, hotspots),
    coverage: coverageProps(map, geo, scene?.officers ?? [], hotspots, showCoverage),
  };
}
