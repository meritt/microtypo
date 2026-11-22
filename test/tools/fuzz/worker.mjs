import { parentPort, workerData } from 'node:worker_threads';

import { createSession } from './session.mjs';

// What the pool watches: how many cases this thread has begun, and the index of the one in hand.
const cells = new Int32Array(workerData.cells);

// The port holds messages until a listener is attached, so none is lost while the session loads.
const session = await createSession({
  ...workerData,
  onCase(index) {
    Atomics.store(cells, 1, index);
    Atomics.add(cells, 0, 1);
  }
});

parentPort.on('message', async ({ id, type, args }) => {
  try {
    parentPort.postMessage({ id, result: await session[type](...args) }, []);
  } catch (error) {
    parentPort.postMessage({ id, error: error.stack ?? String(error) }, []);
  }
});
