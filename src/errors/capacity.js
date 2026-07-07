import { MicroTypoInputError } from './microtypo-input.js';

export const MAX_ENTRIES = 100_000;

export function capacityError(message, details) {
  return new MicroTypoInputError(message, { details: { reason: 'capacity', ...details } });
}
