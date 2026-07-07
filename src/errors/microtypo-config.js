import { MicroTypoError } from './base.js';

export class MicroTypoConfigError extends MicroTypoError {
  static code = 'ERR_MICROTYPO_CONFIG';
}
