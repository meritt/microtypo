// RegExp skipped: freezing one makes a global-flag String.replace() throw writing lastIndex.
export function deepFreeze(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreeze(item);
    }

    return Object.freeze(value);
  }

  if (value !== null && typeof value === 'object' && value.constructor === Object) {
    for (const v of Object.values(value)) {
      deepFreeze(v);
    }

    return Object.freeze(value);
  }

  return value;
}
