import { parentPort, workerData } from 'node:worker_threads';

import { createSession } from './session.mjs';

// The port holds messages until a listener is attached, so none is lost while the session loads.
const session = await createSession(workerData);

parentPort.on('message', ({ id, type, args }) => {
  try {
    parentPort.postMessage({ id, result: session[type](...args) }, []);
  } catch (error) {
    parentPort.postMessage({ id, error: error.stack ?? String(error) }, []);
  }
});
