import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import type { Scorecard, SimConfig, WorkerIn, WorkerOut } from '../../contracts.ts';
import { DECISION_DEFAULTS } from '../../brain/src/defaults.ts';
import { makePopulation } from '../../brain/src/fan-types.ts';
import { makeOfficers } from '../../world/src/officers.ts';
import { testGateSurge, windowFor } from '../../world/src/incidents.ts';
import { playbookFor } from '../../world/src/playbook.ts';
import { makeTestMap } from '../../world/src/test-map.ts';

describe('Node worker host', () => {
  it('runs the test map to a scorecard', async () => {
    const map = makeTestMap();
    const incident = testGateSurge(map, 0);
    const window = windowFor(incident);
    const config: SimConfig = {
      runId: 'worker-core-test',
      label: 'A',
      seed: 20251023,
      startAt: window.startAt,
      endAt: window.endAt,
      speed: 1_000_000,
      dangerDensity: 3.5,
      mapId: map.id,
      incident,
      plan: playbookFor('gate_surge', map)[0]!,
      officers: makeOfficers(map, 24),
    };

    const worker = new Worker(new URL('./worker-node.ts', import.meta.url));
    const done = new Promise<Scorecard>((resolve, reject) => {
      worker.on('message', (message: WorkerOut) => {
        if (message.type === 'done') resolve(message.scorecard);
        else if (message.type === 'error') reject(new Error(message.message));
      });
      worker.on('error', reject);
    });

    worker.postMessage({
      type: 'init',
      config,
      map,
      population: makePopulation(1_200, 20251023),
      defaults: DECISION_DEFAULTS,
      serverUrl: '',
    } satisfies WorkerIn);
    worker.postMessage({ type: 'play' } satisfies WorkerIn);

    try {
      const card = await done;
      expect(card.runId).toBe(config.runId);
      expect(card.label).toBe('A');
      expect(Number.isFinite(card.peakDensity)).toBe(true);
    } finally {
      await worker.terminate();
    }
  }, 30_000);
});
