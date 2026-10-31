import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkerIn } from '../../contracts.ts';
import { encode } from '../../engine/src/index.ts';
import { serverSource } from './run-source.ts';

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  binaryType = 'blob';
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: (string | Uint8Array)[] = [];
  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  send(data: string | Uint8Array): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
  }
}

const init: WorkerIn = {
  type: 'init',
  config: {
    runId: 'run-source-test',
    label: 'A',
    seed: 1,
    startAt: 0,
    endAt: 1,
    speed: 1,
    dangerDensity: 4,
    mapId: 'test',
    incident: { id: 'i', kind: 'gate_surge', at: 0, cells: [], safeCount: 0 },
    plan: { id: 'p', name: 'p', forIncident: 'gate_surge', officersAvailable: 0, actions: [] },
    officers: [],
  },
  map: {
    version: 'gameday.v3',
    id: 'test',
    name: 'test',
    width: 1,
    height: 1,
    cells: ['walk'],
    places: [],
    closables: [],
    sources: [],
  },
  population: { seed: 1, totalFans: 0, dots: 0, types: [] },
  defaults: {
    typeIndex: 0,
    patience: 0.5,
    compliance: 0.5,
    mobility: 1,
    groupSize: 1,
    walkSpeedMps: 1,
    options: [],
  } as never,
  serverUrl: '',
};

afterEach(() => {
  vi.unstubAllGlobals();
  FakeWebSocket.instances = [];
});

describe('serverSource', () => {
  it('decodes a binary worker frame into the worker shape', async () => {
    vi.stubGlobal('location', {
      origin: 'http://localhost:5173',
      protocol: 'http:',
      host: 'localhost:5173',
      port: '5173',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ id: 'run-1' }) })),
    );
    vi.stubGlobal('WebSocket', FakeWebSocket);

    const source = await serverSource(init);
    expect(FakeWebSocket.instances).toHaveLength(1);
    const socket = FakeWebSocket.instances[0]!;
    expect(socket.url).toBe('ws://127.0.0.1:8787/api/runs/run-1/ws');

    const received: unknown[] = [];
    source.onMessage((message) => received.push(message));
    const message = { type: 'types', typeIndex: new Uint16Array([5, 6, 7]) } as const;
    const encoded = encode(message as never) as Uint8Array;
    socket.onmessage?.({
      data: encoded.buffer as ArrayBuffer,
    });
    expect(received).toHaveLength(1);
    const decoded = received[0]! as { type: string; typeIndex: Uint16Array };
    expect(decoded.type).toBe('types');
    expect(decoded.typeIndex).toBeInstanceOf(Uint16Array);
    expect([...decoded.typeIndex]).toEqual([5, 6, 7]);
    source.close();
  });
});
