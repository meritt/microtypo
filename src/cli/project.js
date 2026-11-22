import { dirname, relative, resolve } from 'node:path';

import { validateConfig } from '../schemas/config.js';
import { loadConfigFile } from './config.js';
import { CliUsageError } from './errors.js';
import { inferredFormat, matchesMasks, portablePath, validateMasks } from './paths.js';
import { isPlainObject, mergeConfig } from './util.js';

export const CLI_MAX_INPUT_LENGTH = 5_000_000;

// A layer that names the input by its format alone, `--input markdown` or `"input": "markdown"`,
// changes the format and keeps the template, pragmas and other input settings below it.
function layer(config, over) {
  return mergeConfig(
    config,
    typeof over?.input === 'string' ? { ...over, input: { format: over.input } } : over
  );
}

export async function loadProject(opts, cwd) {
  let root = cwd;
  const loaded = await loadConfigFile(opts.configPath, cwd, (path) => {
    root = dirname(path);
  });
  const { overrides = [], ...base } = loaded ?? {};
  if (!Array.isArray(overrides)) {
    throw new CliUsageError('overrides: expected an array');
  }
  for (const override of overrides) {
    if (
      !isPlainObject(override) ||
      !validateMasks(override.files) ||
      (override.exclude !== undefined && !validateMasks(override.exclude)) ||
      !isPlainObject(override.options) ||
      Object.keys(override).some((key) => !['files', 'exclude', 'options'].includes(key))
    ) {
      throw new CliUsageError('overrides: expected { files, exclude?, options }');
    }
    validateConfig(layer(base, override.options));
  }
  const configFor = (file) => {
    let config = layer(
      { maxInputLength: CLI_MAX_INPUT_LENGTH, input: { format: inferredFormat(file) } },
      base
    );
    if (file !== undefined) {
      const path = portablePath(relative(root, resolve(cwd, file)));
      for (const override of overrides) {
        if (
          matchesMasks(path, override.files) &&
          (override.exclude === undefined || !matchesMasks(path, override.exclude))
        ) {
          config = layer(config, override.options);
        }
      }
    }
    return layer(config, opts.config);
  };
  validateConfig(configFor());
  return { root, configFor };
}
