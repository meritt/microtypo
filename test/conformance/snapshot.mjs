export class Unsupported extends Error {}

// A JSON value that means exactly what the caller passed. `undefined`, functions, regexes and other
// non-plain values would change meaning on the way through JSON, so a call carrying one is not a
// case.
export function snapshot(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new Unsupported('number');
    }

    return value;
  }

  if (Array.isArray(value)) {
    const out = [];

    for (let i = 0; i < value.length; i++) {
      if (!Object.hasOwn(value, i)) {
        throw new Unsupported('hole');
      }

      out.push(snapshot(value[i]));
    }

    return out;
  }

  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);

    if (
      (proto !== Object.prototype && proto !== null) ||
      Object.getOwnPropertySymbols(value).length > 0
    ) {
      throw new Unsupported('object');
    }

    // `fromEntries` defines each key, so an own `__proto__` stays a key instead of a prototype.
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshot(item)]));
  }

  throw new Unsupported(typeof value);
}
