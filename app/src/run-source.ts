import type { WorkerIn, WorkerOut } from '../../contracts.ts';
import { decode, encode, type EditIn, type EditOut } from '../../engine/src/index.ts';

export interface RunSource {
  post(message: WorkerIn | EditIn, transfer?: Transferable[]): void;
  onMessage(handler: (message: WorkerOut | EditOut) => void): void;
  close(): void;
}

/** The existing browser path: one real Web Worker per plan. */
export function workerSource(): RunSource {
  const worker = new Worker(new URL('../../engine/src/worker.ts', import.meta.url), { type: 'module' });
  return {
    post: (message, transfer) => (transfer ? worker.postMessage(message, transfer) : worker.postMessage(message)),
    onMessage: (handler) => {
      worker.onmessage = (event: MessageEvent<WorkerOut | EditOut>) => handler(event.data);
    },
    close: () => worker.terminate(),
  };
}

/**
 * The server path: POST the init payload, then talk to the run's WebSocket.
 * The server sends a hello text frame first; it is ignored here.
 */
export async function serverSource(init: WorkerIn): Promise<RunSource> {
  const base = globalThis.location?.origin ?? 'http://127.0.0.1:8787';
  const created = await fetch(new URL('/api/runs', base), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(init),
  });
  if (!created.ok) throw new Error(`POST /api/runs returned ${created.status}`);
  const { id } = (await created.json()) as { id: string };

  // Vite proxies HTTP but does not proxy the socket by default; in development
  // the API server is the one on 8787. A built app is same-origin.
  const loc = globalThis.location;
  const socketOrigin =
    loc && loc.port === '5173' ? 'ws://127.0.0.1:8787' : `${loc?.protocol === 'https:' ? 'wss' : 'ws'}://${loc?.host}`;
  const socket = new WebSocket(`${socketOrigin}/api/runs/${id}/ws`);
  socket.binaryType = 'arraybuffer';

  let handler: ((message: WorkerOut | EditOut) => void) | null = null;
  const queued: (WorkerIn | EditIn)[] = [];
  const incoming: (WorkerOut | EditOut)[] = [];
  const receive = (message: WorkerOut | EditOut) => {
    if (handler) handler(message);
    else incoming.push(message);
  };
  socket.onmessage = (event) => {
    if (typeof event.data === 'string') {
      const message = JSON.parse(event.data) as { type: string };
      if (message.type === 'hello') return;
      receive(message as WorkerOut | EditOut);
      return;
    }
    receive(decode(event.data as ArrayBuffer) as WorkerOut | EditOut);
  };
  socket.onopen = () => {
    for (const message of queued) socket.send(encode(message) as string | Uint8Array<ArrayBuffer>);
    queued.length = 0;
  };

  return {
    post(message) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(encode(message) as string | Uint8Array<ArrayBuffer>);
      } else {
        queued.push(message);
      }
    },
    onMessage(next) {
      handler = next;
      for (const message of incoming) next(message);
      incoming.length = 0;
    },
    close() {
      socket.close();
      void fetch(new URL(`/api/runs/${id}`, base), { method: 'DELETE' }).catch(() => {});
    },
  };
}
