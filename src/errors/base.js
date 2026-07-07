export class MicroTypoError extends Error {
  static code = 'ERR_MICROTYPO';

  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);

    this.name = new.target.name;
    this.code = new.target.code;

    if (options.details !== undefined) {
      this.details = options.details;
    }
  }
}
