import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Scorecard, SimConfig, WorkerIn, WorkerOut } from '../../contracts.ts';
import { DECISION_DEFAULTS } from '../../brain/src/defaults.ts';
import { makePopulation } from '../../brain/src/fan-types.ts';
import { testGateSurge } from '../../world/src/incidents.ts';
import { playbookFor } from '../../world/src/playbook.ts';
import { makeTestMap } from '../../world/src/test-map.ts';
import { decode, encode } from '../../engine/src/wire.ts';
import { openDb } from './db.ts';
import { createApp } from './index.ts';
import { addPending, injectRunWebSocket, PENDING_MAX, type PendingMessage } from './runs.ts';

function initPayload(runId: string): WorkerIn {
  const map = makeTestMap();
  const incident = testGateSurge(map, 0);
  const config: SimConfig = {
    runId,
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
  return {
    type: 'init',
    config,
    map,
    population: makePopulation(1_200, 20251023),
    defaults: DECISION_DEFAULTS,
    serverUrl: '',
  };
}

async function startServer(): Promise<{ base: string; close: () => void; server: ReturnType<typeof serve> }> {
  const app = createApp(openDb(':memory:'));
  const server = serve({ fetch: app.fetch, port: 0 });
  injectRunWebSocket(server);
  const port = (server.address() as AddressInfo).port;
  return { base: `http://127.0.0.1:${port}`, server, close: () => server.close() };
}

describe('server runs', () => {
  beforeEach(() => {
    process.env.RUNS_MAX = '1';
  });
  afterEach(() => {
    delete process.env.RUNS_MAX;
  });

  it('streams hello, frames and a scorecard over a WebSocket', async () => {
    const { base, close } = await startServer();
    try {
      const created = await fetch(`${base}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(initPayload('server-run-test')),
      });
      expect(created.ok).toBe(true);
      const { id } = (await created.json()) as { id: string };

      const ws = new WebSocket(`ws://127.0.0.1:${new URL(base).port}/api/runs/${id}/ws`);
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
      expect(scorecard!.runId).toBe('server-run-test');

      ws.close();
      await fetch(`${base}/api/runs/${id}`, { method: 'DELETE' });
    } finally {
      close();
    }
  }, 40_000);

  it('caps the pre-socket buffer and keeps ready, done and error', () => {
    const pending: PendingMessage[] = [];
    addPending(pending, { data: 'ready', type: 'ready' });
    for (let i = 0; i < PENDING_MAX + 10; i++) addPending(pending, { data: `frame-${i}`, type: 'frame' });
    addPending(pending, { data: 'done', type: 'done' });
    addPending(pending, { data: 'error', type: 'error' });
    expect(pending).toHaveLength(PENDING_MAX);
    expect(pending[0]?.type).toBe('ready');
    expect(pending[pending.length - 2]?.type).toBe('done');
    expect(pending[pending.length - 1]?.type).toBe('error');
    expect(pending.some((message) => message.type === 'frame')).toBe(true);
  });

  it('sends a bad socket message back as an error', async () => {
    const { base, close } = await startServer();
    try {
      const created = await fetch(`${base}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(initPayload('bad-message-test')),
      });
      const { id } = (await created.json()) as { id: string };
      const ws = new WebSocket(`ws://127.0.0.1:${new URL(base).port}/api/runs/${id}/ws`);
      ws.binaryType = 'arraybuffer';
      const error = new Promise<string>((resolve, reject) => {
        ws.onmessage = (event) => {
          if (typeof event.data !== 'string') return;
          const message = JSON.parse(event.data) as { type: string; message?: string };
          if (message.type === 'error') resolve(message.message ?? '');
        };
        ws.onerror = () => reject(new Error('WebSocket error'));
      });
      await once(ws, 'open');
      ws.send('not json');
      expect(await error).toContain('JSON');
      ws.close();
      await fetch(`${base}/api/runs/${id}`, { method: 'DELETE' });
    } finally {
      close();
    }
  }, 10_000);

  it('refuses a bad body with 400 and a run over the cap with 503', async () => {
    const { base, close } = await startServer();
    try {
      const bad = await fetch(`${base}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{',
      });
      expect(bad.status).toBe(400);

      const first = await fetch(`${base}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(initPayload('cap-test-1')),
      });
      expect(first.ok).toBe(true);
      const { id } = (await first.json()) as { id: string };

      const second = await fetch(`${base}/api/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(initPayload('cap-test-2')),
      });
      expect(second.status).toBe(503);
      expect(await second.json()).toEqual({ error: 'too many runs' });

      await fetch(`${base}/api/runs/${id}`, { method: 'DELETE' });
    } finally {
      close();
    }
  }, 10_000);
});
