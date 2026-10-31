import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { createNodeWebSocket } from '@hono/node-ws';
import type { Hono } from 'hono';
import type { WorkerIn, WorkerOut } from '../../contracts.ts';
import type { EditIn, EditOut } from '../../engine/src/edits.ts';
import { decode, encode } from '../../engine/src/wire.ts';

export interface PendingMessage {
  data: string | Uint8Array<ArrayBuffer>;
  type: string;
}

export const PENDING_MAX = 256;
const PROTECTED = new Set(['ready', 'done', 'error']);

/** Buffer startup messages until the first socket, dropping old frames first. */
export function addPending(pending: PendingMessage[], message: PendingMessage): void {
  if (pending.length < PENDING_MAX) {
    pending.push(message);
    return;
  }
  const oldestFrame = pending.findIndex((item) => item.type === 'frame');
  if (oldestFrame >= 0) {
    pending.splice(oldestFrame, 1);
    pending.push(message);
    return;
  }
  // Only ready/done/error can get here; keep them rather than exceeding the cap.
  if (PROTECTED.has(message.type)) return;
}

interface Run {
  id: string;
  worker: Worker;
  sockets: Set<{ send(data: string | Uint8Array<ArrayBuffer>): void; close(code?: number, reason?: string): void }>;
  pending: PendingMessage[];
  everConnected: boolean;
  cleanup: NodeJS.Timeout;
}

const runs = new Map<string, Run>();
const RUN_IDLE_MS = 10 * 60 * 1000;
let inject: ((server: unknown) => void) | null = null;

function broadcast(run: Run, message: string | Uint8Array<ArrayBuffer>, type: string): void {
  if (run.sockets.size > 0) {
    for (const socket of run.sockets) socket.send(message);
    return;
  }
  if (!run.everConnected) addPending(run.pending, { data: message, type });
}

function bump(run: Run): void {
  clearTimeout(run.cleanup);
  run.cleanup = setTimeout(() => stop(run.id), RUN_IDLE_MS);
  run.cleanup.unref();
}

function stop(id: string): void {
  const run = runs.get(id);
  if (!run) return;
  runs.delete(id);
  clearTimeout(run.cleanup);
  for (const socket of run.sockets) socket.close(1001, 'run terminated');
  run.sockets.clear();
  void run.worker.terminate();
}

/** Register the run registry routes. The returned injector is called after serve(). */
export function addRunRoutes(app: Hono, decisionBaseUrl: string): void {
  const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });
  inject = injectWebSocket as (server: unknown) => void;

  app.post('/api/runs', async (c) => {
    const init = await c.req.json<WorkerIn>();
    if (init.type !== 'init') return c.json({ error: 'POST /api/runs needs an init message' }, 400);
    const id = randomUUID();
    const worker = new Worker(new URL('../../engine/src/worker-node.ts', import.meta.url));
    const run: Run = {
      id,
      worker,
      sockets: new Set(),
      pending: [],
      everConnected: false,
      cleanup: setTimeout(() => {}, 0),
    };
    runs.set(id, run);
    worker.on('message', (message: WorkerOut | EditOut) => {
      broadcast(run, encode(message) as string | Uint8Array<ArrayBuffer>, message.type);
    });
    worker.on('error', (error) => {
      broadcast(
        run,
        encode({ type: 'error', message: error instanceof Error ? error.message : String(error) }) as
          | string
          | Uint8Array<ArrayBuffer>,
        'error',
      );
    });
    worker.on('exit', () => {
      runs.delete(id);
      clearTimeout(run.cleanup);
      for (const socket of run.sockets) socket.close(1000, 'run finished');
      run.sockets.clear();
    });
    bump(run);
    worker.postMessage({ ...init, serverUrl: decisionBaseUrl } satisfies WorkerIn);
    return c.json({ id });
  });

  app.get(
    '/api/runs/:id/ws',
    upgradeWebSocket((c) => {
      const id = c.req.param('id') ?? '';
      const run = runs.get(id);
      return {
        onOpen(_event, ws) {
          if (!run) {
            ws.close(1008, 'no such run');
            return;
          }
          ws.send(JSON.stringify({ type: 'hello', protocol: 'gameday-wire.1' }));
          run.everConnected = true;
          for (const message of run.pending) ws.send(message.data);
          run.pending.length = 0;
          run.sockets.add(ws);
          bump(run);
        },
        onMessage(event, _ws) {
          if (!run) return;
          const data = event.data;
          try {
            run.worker.postMessage(decode(data as string | ArrayBuffer | Uint8Array) as WorkerIn | EditIn);
          } catch (error) {
            run.worker.postMessage({
              type: 'error',
              message: error instanceof Error ? error.message : String(error),
            } satisfies WorkerOut);
          }
          bump(run);
        },
        onClose(_event, ws) {
          run?.sockets.delete(ws);
          if (run) bump(run);
        },
      };
    }),
  );

  app.delete('/api/runs/:id', (c) => {
    stop(c.req.param('id'));
    return c.json({ ok: true });
  });
}

export function injectRunWebSocket(server: unknown): void {
  if (!inject) throw new Error('addRunRoutes() must be called before injectRunWebSocket()');
  inject(server);
}
