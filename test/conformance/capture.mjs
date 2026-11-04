// Loaded with `--import` while the build runs the suite: every import of the engine resolves to the
// recorder, which re-exports it with a recording `MicroTypo`, so each `process()` call the suite
// makes becomes a corpus case. Only the capture run loads this; the suite itself never sees it.
import { registerHooks } from 'node:module';

const ENGINE = new URL('../../src/engine.js', import.meta.url).href;
const RECORDER = new URL('./recorder.mjs', import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);

    return result.url === ENGINE && context.parentURL !== RECORDER
      ? { ...result, url: RECORDER }
      : result;
  }
});
