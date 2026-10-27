import { access, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { CliUsageError } from './errors.js';
import { isPlainObject } from './util.js';

const RC_NAME = '.microtyporc.json';

export async function loadConfigFile(explicitPath, cwd) {
  const path = explicitPath ? resolve(cwd, explicitPath) : await discover(cwd);
  if (!path) {
    return {};
  }

  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    throw new CliUsageError(`cannot read config file: ${path}`);
  }

  let config;
  try {
    config = JSON.parse(raw);
  } catch {
    throw new CliUsageError(`invalid JSON in config file: ${path}`);
  }

  // The merge spreads the file into an object, which would turn an array or a scalar into `{}`
  // before the schema could see it. `null` is the schema's own empty config and passes through.
  if (config !== null && !isPlainObject(config)) {
    const got = Array.isArray(config) ? 'an array' : typeof config;
    throw new CliUsageError(`config file must hold an object, got ${got}: ${path}`);
  }

  return config;
}

async function discover(cwd) {
  let dir = cwd;
  while (dir) {
    const candidate = join(dir, RC_NAME);
    if (await fileExists(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
  return null;
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
