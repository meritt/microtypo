// What a corpus case is and how it runs: the build and the corpus test both go through here, so a
// case means the same thing to each of them.
import { MicroTypo } from '../../src/index.js';

function describeError(error) {
  const out = { name: error?.name ?? 'Error', message: String(error?.message ?? error) };

  if (error?.code !== undefined) {
    out.code = error.code;
  }

  if (error?.details !== undefined) {
    out.details = error.details;
  }

  return out;
}

// `construct` is set when the constructor throws. Otherwise `ops` lists what each recorded call
// threw (`null` for none) and is left out when none did, and the outcome of `process()` is `output`
// or `error`. An `engine` built from the case's `config` may be passed in and is then used as is.
export function replay(c, shared) {
  let engine = shared;

  if (engine === undefined) {
    try {
      engine = new MicroTypo(c.config);
    } catch (error) {
      return { construct: describeError(error) };
    }
  }

  const ops = c.ops.map(({ method, args }) => {
    try {
      engine[method](...args);
      return null;
    } catch (error) {
      return describeError(error);
    }
  });
  const outcome = ops.some((op) => op !== null) ? { ops } : {};

  if (!Object.hasOwn(c, 'text')) {
    return outcome;
  }

  try {
    return { ...outcome, output: engine.process(c.text, c.options) };
  } catch (error) {
    return { ...outcome, error: describeError(error) };
  }
}
