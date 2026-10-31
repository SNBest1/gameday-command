import type { TransferListItem } from 'node:worker_threads';
import { parentPort } from 'node:worker_threads';
import { startWorker, type WorkerHost } from './worker-core.ts';

const port = parentPort;
if (!port) throw new Error('worker-node.ts must run inside a worker thread');

const host: WorkerHost = {
  post: (message, transfer) => port.postMessage(message, transfer as TransferListItem[] | undefined),
  onMessage: (handler) => {
    port.on('message', handler);
  },
};

startWorker(host);
