import { describe, expect, it } from 'vitest';
import type { EditOut, SceneInfo } from './edits.ts';
import { DECISION_DEFAULTS } from '../../brain/src/defaults.ts';
import { makePopulation } from '../../brain/src/fan-types.ts';
import { makeOfficers } from '../../world/src/officers.ts';
import { testGateSurge, windowFor } from '../../world/src/incidents.ts';
import { playbookFor } from '../../world/src/playbook.ts';
import { makeTestMap } from '../../world/src/test-map.ts';
import type { SimConfig, WorkerOut } from '../../contracts.ts';
import { FlowMovement } from './movement-flow.ts';
import { Simulation } from './sim.ts';
import { decode, encode, type WireMessage } from './wire.ts';

describe('wire protocol', () => {
  it('round-trips real worker messages and preserves typed arrays', async () => {
    const map = makeTestMap();
    const incident = testGateSurge(map, 0);
    const window = windowFor(incident);
    const config: SimConfig = {
      runId: 'wire-test',
      label: 'A',
      seed: 20251023,
      startAt: window.startAt,
      endAt: window.startAt + 120,
      speed: 1_000_000,
      dangerDensity: 3.5,
      mapId: map.id,
      incident,
      plan: playbookFor('gate_surge', map)[0]!,
      officers: makeOfficers(map, 24),
    };
    const sim = new Simulation({
      config,
      map,
      population: makePopulation(1_200, 20251023),
      defaults: DECISION_DEFAULTS,
      serverUrl: '',
      movement: new FlowMovement(),
      replay: { runId: 'wire-test', answers: [] },
    });
    for (let i = 0; i < 10; i++) await sim.step();

    const frameMessage: WorkerOut = {
      type: 'frame',
      frame: sim.frame(),
      density: sim.ctx.density.toGrid(sim.ctx.t),
    };
    const scene: SceneInfo = {
      t: sim.ctx.t,
      officers: sim.officerStatus(true),
      gates: sim.gateStats(),
      closed: sim.closedIds(),
      alerts: [...sim.takeAlerts(), { t: 0, dots: new Int32Array([1, 2, 3]) }],
      barricades: sim.liveBarricades(),
      markers: sim.markerStatus(),
      orders: sim.ordersLog(),
      responseArrivals: sim.responseArrivals(),
      responses: sim.responseTimes([]),
    };
    const sceneMessage: EditOut = { type: 'scene', scene };
    const snapshotMessage: WorkerOut = { type: 'snapshot', snapshot: sim.snapshot() };
    const scorecardMessage: WorkerOut = { type: 'done', scorecard: sim.scorecard() };

    for (const message of [frameMessage, sceneMessage, snapshotMessage] as WireMessage[]) {
      const encoded = encode(message);
      expect(encoded).toBeInstanceOf(Uint8Array);
      expect(decode(encoded)).toEqual(message);
    }
    const text = encode(scorecardMessage);
    expect(typeof text).toBe('string');
    expect(decode(text)).toEqual(scorecardMessage);
    expect(
      ArrayBuffer.isView((decode(encode(frameMessage)) as WorkerOut & { frame: { x: Float32Array } }).frame.x),
    ).toBe(true);
  }, 30_000);
});
