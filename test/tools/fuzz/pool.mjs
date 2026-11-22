import { Worker } from 'node:worker_threads';

const WORKER = new URL('worker.mjs', import.meta.url);

// `run(type, ...args)` calls the session method `type` on the first idle worker.
export function createPool(size, workerData) {
  const idle = [];
  const queue = [];
  const workers = [];
  let next = 0;

  const pump = () => {
    while (idle.length > 0 && queue.length > 0) {
      const worker = idle.pop();
      const task = queue.shift();

      worker.task = task;
      worker.postMessage({ id: task.id, type: task.type, args: task.args }, []);
    }
  };

  for (let n = 0; n < size; n++) {
    const worker = new Worker(WORKER, { workerData });

    worker.on('message', ({ result, error }) => {
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
    workers.push(worker);
    idle.push(worker);
  }

  return {
    run(type, ...args) {
      return new Promise((resolve, reject) => {
        queue.push({ id: next++, type, args, resolve, reject });
        pump();
      });
    },
    close() {
      queue.length = 0;

      return Promise.all(workers.map((worker) => worker.terminate()));
    }
  };
}
