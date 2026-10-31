import { describe, expect, it, vi } from 'vitest';
import { DECISION_DEFAULTS } from '../../brain/src/defaults.ts';
import { makePopulation } from '../../brain/src/fan-types.ts';
import type { SimConfig, TickFrame } from '../../contracts.ts';
import { VEHICLE_STATES } from '../../contracts.ts';
import { FlowMovement, Simulation } from '../../engine/src/index.ts';
import type { SceneInfo } from '../../engine/src/index.ts';
import { testGateSurge, windowFor } from '../../world/src/incidents.ts';
import { makeOfficers } from '../../world/src/officers.ts';
import { playbookFor } from '../../world/src/playbook.ts';
import { makeTestMap } from '../../world/src/test-map.ts';
import { heatBands } from './heat.ts';
import {
  densityProps,
  fanRows,
  fansProps,
  gateLabelRows,
  gatesProps,
  incidentLabelProps,
  opsLayerProps,
  unitLabelsProps,
  vehicleRows,
} from './ops-layers.ts';
import { flatGeoref } from './ops-geo.ts';

class TestImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

vi.stubGlobal('ImageData', TestImageData);

const map = makeTestMap();
const geo = flatGeoref(map.width);

function emptyFrame(): TickFrame {
  return {
    runId: 'test',
    t: 0,
    x: new Float32Array(0),
    y: new Float32Array(0),
    state: new Uint8Array(0),
    officerCells: new Int32Array(0),
  };
}

function shortRun(): Promise<{ frame: TickFrame; scene: SceneInfo }> {
  return (async () => {
    const incident = testGateSurge(map, 0);
    const config: SimConfig = {
      runId: 'ops-layers-test',
      label: 'A',
      seed: 20251023,
      startAt: windowFor(incident).startAt,
      endAt: windowFor(incident).startAt + 120,
      speed: 1_000_000,
      dangerDensity: 3.5,
      mapId: map.id,
      incident,
      plan: playbookFor('gate_surge', map)[0]!,
      officers: makeOfficers(map, 12),
    };
    const sim = new Simulation({
      config,
      map,
      population: makePopulation(1_200, 20251023),
      defaults: DECISION_DEFAULTS,
      serverUrl: '',
      movement: new FlowMovement(),
      replay: { runId: config.runId, answers: [] },
    });
    for (let i = 0; i < 8; i++) await sim.step();
    const scene: SceneInfo = {
      t: sim.ctx.t,
      officers: sim.officerStatus(true),
      gates: sim.gateStats(),
      closed: [],
      alerts: sim.takeAlerts(),
      barricades: sim.liveBarricades(),
      markers: sim.markerStatus(),
      orders: sim.ordersLog(),
      responseArrivals: sim.responseArrivals(),
      responses: sim.responseTimes([]),
    };
    return { frame: sim.frame(), scene };
  })();
}

describe('operations map layer props', () => {
  it('shows fans only at zoom 17 or more and skips off-map dots', async () => {
    const run = await shortRun();
    expect(fanRows(map, geo, run.frame, 16)).toHaveLength(0);
    expect(fansProps(map, geo, run.frame, 16, null).visible).toBe(false);
    expect(fanRows(map, geo, run.frame, 17).length).toBeGreaterThan(0);

    const offMap = emptyFrame();
    offMap.x = Float32Array.from([-1, map.width * 2 + 1, 10]);
    offMap.y = Float32Array.from([10, 10, 10]);
    offMap.state = Uint8Array.from([3, 3, 3]);
    expect(fanRows(map, geo, offMap, 18)).toHaveLength(1);

    const vehicles = emptyFrame();
    vehicles.vehicles = {
      x: Float32Array.from([-1, 10]),
      y: Float32Array.from([10, 10]),
      heading: new Float32Array(2),
      speed: new Float32Array(2),
      kind: new Uint8Array(2),
      state: new Uint8Array(2),
      waitedS: new Float32Array(2),
    };
    expect(vehicleRows(map, geo, vehicles, 18, true, null, null)).toHaveLength(1);
  });

  it('never paints a parked vehicle in the jam colour', () => {
    const frame = emptyFrame();
    frame.vehicles = {
      x: Float32Array.from([10]),
      y: Float32Array.from([10]),
      heading: new Float32Array(1),
      speed: new Float32Array(1),
      kind: new Uint8Array(1),
      state: Uint8Array.from([VEHICLE_STATES.indexOf('parked')]),
      waitedS: new Float32Array(1),
    };
    const rows = vehicleRows(map, geo, frame, 18, true, null, null);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.driving).toBe(false);
    expect(rows[0]!.color.slice(0, 3)).not.toEqual([0xff, 0x30, 0x40]);
    expect(rows[0]!.radiusPx).toBeLessThan(6);
    expect(vehicleRows(map, geo, frame, 14, true, null, null)).toHaveLength(0);
  });

  it('paints danger density in the danger band and nothing below the floor', () => {
    const density = new Float32Array(map.width * map.height);
    density[0] = 4.2;
    density[1] = 0.01;
    const props = densityProps(map, geo, emptyFrame(), density, 3.5, null);
    const danger = heatBands(3.5)[4]!;
    expect([...props.image.data.slice(0, 3)]).toEqual(danger.rgb);
    expect(props.image.data[3]).toBeGreaterThan(0);
    expect(props.image.data[7]).toBe(0);

    const isolated = densityProps(map, geo, emptyFrame(), density, 3.5, 0);
    expect(isolated.image.data[3]).toBe(0);
  });

  it('labels a closed gate at every zoom and open gates only when close', async () => {
    const run = await shortRun();
    const gates = run.scene.gates.map((gate) => ({ ...gate, open: false }));
    const scene = { ...run.scene, gates };
    const closed = gateLabelRows(map, geo, scene, 10);
    expect(closed[0]?.text).toBe('Gate 1 closed');

    const open = { ...run.scene, gates: run.scene.gates.map((gate) => ({ ...gate, open: true, inPerMin: 105 })) };
    expect(gateLabelRows(map, geo, open, 10)).toHaveLength(0);
    expect(gateLabelRows(map, geo, open, 16)[0]?.text).toBe('Gate 1 · 105/min');
  });

  it('draws theme-aware text with a real SDF outline', async () => {
    const run = await shortRun();
    const light = gatesProps(map, geo, run.scene, 16, 'light');
    const dark = gatesProps(map, geo, run.scene, 16, 'dark');
    for (const props of [light, dark]) {
      expect(props.outlineWidth).toBeGreaterThan(0);
      expect(props.fontSettings).toEqual({ sdf: true });
    }
    expect(light.getColor).not.toEqual(dark.getColor);
    expect(light.outlineColor).not.toEqual(dark.outlineColor);
    expect(unitLabelsProps(map, geo, run.scene, 'light').outlineWidth).toBeGreaterThan(0);
    const incident = incidentLabelProps([0, 1, map.width, map.width + 1], map, geo, 'Gate surge', 'dark');
    expect(incident.data[0]?.text).toBe('Gate surge');
    expect(incident.outlineWidth).toBeGreaterThan(0);

    const linear = (value: number) => {
      const v = value / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (rgb: [number, number, number, number]) =>
      0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
    const contrast = (a: [number, number, number, number], b: [number, number, number, number]) => {
      const x = luminance(a);
      const y = luminance(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    // The observed Positron and OpenFreeMap Dark backgrounds.
    expect(contrast(light.getColor, [242, 243, 240, 255])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark.getColor, [12, 12, 12, 255])).toBeGreaterThanOrEqual(4.5);
  });

  it('builds every layer prop from one frame and scene', async () => {
    const run = await shortRun();
    const props = opsLayerProps({
      map,
      geo,
      frame: run.frame,
      density: {
        t: run.frame.t,
        width: map.width,
        height: map.height,
        peoplePerM2: new Float32Array(map.width * map.height),
      },
      scene: run.scene,
      zoom: 18,
      theme: 'light',
      dangerDensity: 3.5,
      selectedBand: null,
      showVehicles: true,
      showFlow: true,
      vehicleFocus: null,
      selectedVehicle: null,
      selectedOfficer: null,
      selected: null,
      showCoverage: false,
      hotspots: [],
      incidentCells: [0, 1, map.width, map.width + 1],
      incidentLabel: 'Gate surge',
    });
    expect(props.density.id).toBe('ops-density');
    expect(props.fans.visible).toBe(true);
    expect(props.officers.data.length).toBe(run.scene.officers.length);
    expect(props.incident.data.length).toBeGreaterThan(0);
    expect(props.gates.data.length).toBeGreaterThan(0);
  });
});
