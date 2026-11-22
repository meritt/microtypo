import { MicroTypo } from '../../src/index.js';

// Keep the shared instance and everything it owns reachable during both collections.
globalThis.typo = new MicroTypo();
globalThis.gc();
const before = process.memoryUsage().heapUsed;

for (let i = 0; i < 5000; i++) {
  globalThis.typo.process(
    `<pre>amber-${i}</pre> http://amber.example/${i} corwin${i}@amber.example "${i}"`
  );
}

globalThis.gc();
const after = process.memoryUsage().heapUsed;
process.stdout.write(String(after - before));
