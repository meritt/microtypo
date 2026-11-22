import { Worker } from 'node:worker_threads';

const WORKER = new URL('worker.mjs', import.meta.url);

// `run(type, ...args)` calls the session method `type` on the first idle worker. A worker counts the
// cases it begins in memory shared with the pool, and one that spends longer than `timeout` ms on a
// case is replaced: its task fails with `stalled`, the index of the case in a scan and -1 otherwise.
// The clock starts at a worker's first case, so a thread slow to load is not taken for a hang.
export function createPool(size, workerData, timeout = Infinity) {
  const idle = [];
  const queue = [];
  const workers = new Set();
  let next = 0;

  const pump = () => {
    while (idle.length > 0 && queue.length > 0) {
      const worker = idle.pop();
      const task = queue.shift();

      worker.task = task;
      worker.beats = Atomics.load(worker.cells, 0);
      worker.since = null;
      worker.postMessage({ id: task.id, type: task.type, args: task.args }, []);
    }
  };

  const spawn = () => {
    const cells = new Int32Array(new SharedArrayBuffer(8)).fill(-1, 1);
    const worker = new Worker(WORKER, { workerData: { ...workerData, cells: cells.buffer } });

    worker.cells = cells;
    worker.on('message', ({ result, error }) => {
      if (!workers.has(worker)) {
        return;
      }

      const { task } = worker;

      worker.task = null;
      idle.push(worker);

      if (error === undefined) {
        task.resolve(result);
      } else {
        task.reject(new Error(error));
      }

      pump();
    });
    worker.on('error', (error) => {
      worker.task?.reject(error);
      worker.task = null;
    });
    workers.add(worker);
    idle.push(worker);
  };

  const stall = (worker) => {
    const { task } = worker;
    const at = Atomics.load(worker.cells, 1);
    const error = new Error(`case ${at}: no answer in ${timeout} ms`);

    error.stalled = at;
    workers.delete(worker);
    worker.task = null;
    worker.terminate();
    task.reject(error);
    spawn();
    pump();
  };

  const watch = Number.isFinite(timeout)
    ? setInterval(
        () => {
          const now = performance.now();

          for (const worker of workers) {
            if (!worker.task) {
              continue;
            }

            const beats = Atomics.load(worker.cells, 0);

            if (beats !== worker.beats) {
              worker.beats = beats;
              worker.since = now;
            } else if (worker.since !== null && now - worker.since > timeout) {
              stall(worker);
            }
          }
        },
        Math.min(1000, timeout / 4)
      ).unref()
    : null;

  for (let n = 0; n < size; n++) {
    spawn();
  }

  return {
    run(type, ...args) {
      const { promise, resolve, reject } = Promise.withResolvers();

      queue.push({ id: next++, type, args, resolve, reject });
      pump();

      return promise;
    },
    async close() {
      clearInterval(watch);
      queue.length = 0;

      await Promise.all([...workers].map((worker) => worker.terminate()));
    },
    [Symbol.asyncDispose]() {
      return this.close();
    }
  };
}
