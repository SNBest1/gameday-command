import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { describe, expect, it } from 'vitest';
import type { Scorecard, SimConfig, WorkerIn, WorkerOut } from '../../contracts.ts';
import { DECISION_DEFAULTS } from '../../brain/src/defaults.ts';
import { makePopulation } from '../../brain/src/fan-types.ts';
import { testGateSurge } from '../../world/src/incidents.ts';
import { playbookFor } from '../../world/src/playbook.ts';
import { makeTestMap } from '../../world/src/test-map.ts';
import { decode, encode } from '../../engine/src/wire.ts';
import { openDb } from './db.ts';
import { createApp } from './index.ts';
import { injectRunWebSocket } from './runs.ts';

describe('server runs', () => {
  it('streams hello, frames and a scorecard over a WebSocket', async () => {
    const map = makeTestMap();
    const incident = testGateSurge(map, 0);
    const config: SimConfig = {
      runId: 'server-run-test',
      label: 'A',
      seed: 20251023,
      startAt: -600,
      endAt: 600,
      speed: 1_000_000,
      dangerDensity: 3.5,
      mapId: map.id,
      incident,
      plan: playbookFor('gate_surge', map)[0]!,
      officers: [],
    };
    const app = createApp(openDb(':memory:'));
    const server = serve({ fetch: app.fetch, port: 0 });
    injectRunWebSocket(server);
    const port = (server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;
    const controller = new AbortController();
    try {
      const created = await fetch(`${base}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'init',
          config,
          map,
          population: makePopulation(1_200, 20251023),
          defaults: DECISION_DEFAULTS,
          serverUrl: '',
        } satisfies WorkerIn),
        signal: controller.signal,
      });
      expect(created.ok).toBe(true);
      const { id } = (await created.json()) as { id: string };

      const ws = new WebSocket(`ws://127.0.0.1:${port}/api/runs/${id}/ws`);
      ws.binaryType = 'arraybuffer';
      let hello: string | null = null;
      let frames = 0;
      let scorecard: Scorecard | null = null;
      const done = new Promise<void>((resolve, reject) => {
        ws.onmessage = (event) => {
          const data = event.data;
          const message =
            typeof data === 'string'
              ? (JSON.parse(data) as { type: string; protocol?: string })
              : (decode(data as ArrayBuffer) as WorkerOut);
          if (message.type === 'hello') hello = message.protocol ?? null;
          else if (message.type === 'frame') frames++;
          else if (message.type === 'done') {
            scorecard = (message as Extract<WorkerOut, { type: 'done' }>).scorecard;
            resolve();
          } else if (message.type === 'error') reject(new Error((message as { message: string }).message));
        };
        ws.onerror = () => reject(new Error('WebSocket error'));
      });
      await once(ws, 'open');
      ws.send(encode({ type: 'play' }) as string);
      await Promise.race([
        done,
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error('timed out')), 30_000)),
      ]);
      expect(hello).toBe('gameday-wire.1');
      expect(frames).toBeGreaterThan(0);
      expect(scorecard).not.toBeNull();
      expect(scorecard!.runId).toBe(config.runId);

      ws.close();
      await fetch(`${base}/api/runs/${id}`, { method: 'DELETE', signal: controller.signal });
    } finally {
      controller.abort();
      server.close();
    }
  }, 40_000);
});
