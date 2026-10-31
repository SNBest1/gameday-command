import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DANGER_DENSITY,
  type MapBundle,
  type Scorecard,
  type SimConfig,
  type TickFrame,
  type WorkerIn,
  type WorkerOut,
} from '../../contracts.ts';
import { DECISION_DEFAULTS } from '../../brain/src/defaults.ts';
import { makePopulation } from '../../brain/src/fan-types.ts';
import { gateSurge } from '../../world/src/incidents.ts';
import { makeOfficers } from '../../world/src/officers.ts';
import { playbookFor } from '../../world/src/playbook.ts';
import { buildStadiumMap, extractExists, loadExtract } from '../../world/src/osm/stadium.ts';
import { makeTestMap } from '../../world/src/test-map.ts';
import { startWorker, type WorkerHost } from '../../engine/src/worker-core.ts';
import { decode, encode } from '../../engine/src/wire.ts';
import { addRunRoutes, injectRunWebSocket } from './runs.ts';

interface Init {
  config: SimConfig;
  map: MapBundle;
  population: ReturnType<typeof makePopulation>;
}

function makeInit(map: MapBundle, runId: string, officers: number): Init {
  const incident = gateSurge(map, 0);
  const config: SimConfig = {
    runId,
    label: 'A',
    seed: 20251023,
    startAt: -600,
    endAt: 600,
    speed: 1_000_000,
    dangerDensity: DEFAULT_DANGER_DENSITY,
    mapId: map.id,
    incident,
    plan: playbookFor('gate_surge', map)[0]!,
    officers: makeOfficers(map, officers),
  };
  return { config, map, population: makePopulation(map.id === 'test-3gate' ? 1_200 : 100_000, 20251023) };
}

function initMessage(init: Init): WorkerIn {
  return {
    type: 'init',
    config: init.config,
    map: init.map,
    population: init.population,
    defaults: DECISION_DEFAULTS,
    serverUrl: '',
  };
}

interface Result {
  scorecard: Scorecard;
  frames: Extract<WorkerOut, { type: 'frame' }>[];
}

function runInProcess(init: Init): Promise<Result> {
  const frames: Result['frames'] = [];
  let done: ((result: Result) => void) | null = null;
  const host: WorkerHost = {
    post(message) {
      if (message.type === 'frame') frames.push(message);
      else if (message.type === 'done') done?.({ scorecard: message.scorecard, frames });
    },
    onMessage(handler) {
      handler(initMessage(init));
      handler({ type: 'play' });
      void handler;
    },
  };
  return new Promise((resolve) => {
    done = resolve;
    startWorker(host);
  });
}

async function runServer(init: Init): Promise<Result> {
  const app = new Hono();
  // No /api/decide route: the worker's decision requests fail fast and take the
  // defaults, which is the only path this parity test compares.
  addRunRoutes(app, 'http://127.0.0.1:1');
  const server = serve({ fetch: app.fetch, port: 0 });
  injectRunWebSocket(server);
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const created = await fetch(`${base}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(initMessage(init)),
    });
    const { id } = (await created.json()) as { id: string };
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/runs/${id}/ws`);
    ws.binaryType = 'arraybuffer';
    const frames: Result['frames'] = [];
    const result = new Promise<Result>((resolve, reject) => {
      ws.onmessage = (event) => {
        const message = typeof event.data === 'string' ? (JSON.parse(event.data) as WorkerOut) : (decode(event.data) as WorkerOut);
        if (message.type === 'frame') frames.push(message);
        else if (message.type === 'done') resolve({ scorecard: message.scorecard, frames });
        else if (message.type === 'error') reject(new Error(message.message));
      };
      ws.onerror = () => reject(new Error('WebSocket error'));
    });
    await once(ws, 'open');
    ws.send(encode({ type: 'play' }) as string);
    const out = await Promise.race([
      result,
      new Promise<Result>((_, reject) => setTimeout(() => reject(new Error('timed out')), 120_000)),
    ]);
    ws.close();
    await fetch(`${base}/api/runs/${id}`, { method: 'DELETE' });
    return out;
  } finally {
    server.close();
  }
}

async function parses(init: Init): Promise<void> {
  const inProcess = await runInProcess(init);
  const viaServer = await runServer(init);
  expect(viaServer.scorecard).toEqual(inProcess.scorecard);
  const a = inProcess.frames[inProcess.frames.length - 1]!;
  const b = viaServer.frames[viaServer.frames.length - 1]!;
  expect(b.frame).toEqual(a.frame);
  expect(b.density).toEqual(a.density);
  const frame = (f: Extract<WorkerOut, { type: 'frame' }>): TickFrame => f.frame;
  expect(frame(b)).toEqual(frame(a));
}

describe('in-process and server runs', () => {
  it('give identical scorecards and final frames on the test map', async () => {
    await parses(makeInit(makeTestMap(), 'parity-test', 24));
  }, 130_000);

  const stadium = extractExists() ? describe : describe.skip;
  stadium('stadium parity', () => {
    it('is identical for 10 minutes past the incident', async () => {
      await parses(makeInit(buildStadiumMap(loadExtract()), 'parity-stadium', 24));
    }, 130_000);
  });
});
