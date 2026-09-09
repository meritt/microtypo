import { DEFAULT_MAX_INPUT_LENGTH, MicroTypo } from './engine.js';

export function microtypo(text, options) {
  return new MicroTypo(options).process(text);
}

export { DEFAULT_MAX_INPUT_LENGTH, MicroTypo };

export const VERSION = '0.2.0';
