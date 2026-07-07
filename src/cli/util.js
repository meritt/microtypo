import { CliUsageError } from './errors.js';

export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// __proto__/prototype/constructor can reach the shared Object.prototype through a plain-object write; reject them before any node[key] access.
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function assertSafeKey(key) {
  if (UNSAFE_KEYS.has(key)) {
    throw new CliUsageError(`unsafe config key: "${key}"`);
  }
}

export function mergeConfig(base, override) {
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    assertSafeKey(key);
    result[key] =
      isPlainObject(value) && isPlainObject(result[key]) ? mergeConfig(result[key], value) : value;
  }
  return result;
}

export function setPath(target, path, value) {
  const keys = path.split('.');
  keys.forEach(assertSafeKey);

  let node = target;
  for (const key of keys.slice(0, -1)) {
    if (!isPlainObject(node[key])) {
      node[key] = {};
    }
    node = node[key];
  }
  node[keys.at(-1)] = value;
}

export function coerceScalar(raw) {
  if (raw === 'true') {
    return true;
  }
  if (raw === 'false') {
    return false;
  }
  if (raw !== '' && !Number.isNaN(Number(raw))) {
    return Number(raw);
  }
  return raw;
}
