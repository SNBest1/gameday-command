import type { WorkerIn, WorkerOut } from '../../contracts.ts';
import type { EditIn, EditOut } from './edits.ts';
import { startWorker, type WorkerHost } from './worker-core.ts';

/**
 * Browser worker entry. One worker per plan, so three plans run in three
 * isolated workers on the same seed. Typed here rather than via the WebWorker
 * lib — TypeScript refuses to load the DOM and WebWorker libs together, and the
 * app needs DOM.
 */
const host = globalThis as unknown as {
  postMessage(message: WorkerOut | EditOut, transfer?: Transferable[]): void;
  onmessage: ((event: { data: WorkerIn | EditIn }) => void) | null;
};

const workerHost: WorkerHost = {
  post: (message, transfer) => host.postMessage(message, transfer),
  onMessage: (handler) => {
    host.onmessage = (event) => handler(event.data);
  },
};

startWorker(workerHost);
