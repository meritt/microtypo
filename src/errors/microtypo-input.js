import { MicroTypoError } from './base.js';

export class MicroTypoInputError extends MicroTypoError {
  static code = 'ERR_MICROTYPO_INPUT';
}
