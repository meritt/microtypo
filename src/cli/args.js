import { parseArgs } from 'node:util';

import { CliUsageError } from './errors.js';
import { coerceScalar, setPath } from './util.js';

const OPTIONS = {
  html: { type: 'boolean' },
  entities: { type: 'boolean' },
  input: { type: 'string' },
  hanging: { type: 'boolean' },
  'max-input': { type: 'string' },
  'max-ms': { type: 'string' },
  rule: { type: 'string', multiple: true },
  render: { type: 'string', multiple: true },
  set: { type: 'string', multiple: true },
  config: { type: 'string' },
  write: { type: 'boolean', short: 'w' },
  'output-file': { type: 'string', short: 'o' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean' }
};

export function parse(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: OPTIONS,
      strict: true,
      allowPositionals: true,
      allowNegative: true
    });
  } catch (err) {
    throw new CliUsageError(err.message);
  }

  const { values, positionals } = parsed;
  return {
    help: values.help === true,
    version: values.version === true,
    write: values.write === true,
    outputFile: values['output-file'],
    configPath: values.config,
    files: positionals,
    config: buildConfig(values)
  };
}

function buildConfig(values) {
  const config = {};

  if (values.html !== undefined) {
    config.html = values.html;
  }
  if (values.entities !== undefined) {
    config.entities = values.entities;
  }
  if (values.input !== undefined) {
    config.input = values.input;
  }
  if (values['max-input'] !== undefined) {
    config.maxInputLength = Number(values['max-input']);
  }
  if (values['max-ms'] !== undefined) {
    config.maxProcessingMs = Number(values['max-ms']);
  }

  const rules = {};
  if (values.hanging !== undefined) {
    rules['hanging.quote'] = values.hanging;
    rules['hanging.bracket'] = values.hanging;
  }
  for (const entry of values.rule ?? []) {
    const [id, raw] = splitPair(entry);
    rules[id] = coerceScalar(raw);
  }
  if (Object.keys(rules).length > 0) {
    config.rules = rules;
  }

  const render = {};
  for (const entry of values.render ?? []) {
    const [key, raw] = splitPair(entry);
    render[key] = coerceScalar(raw);
  }
  if (Object.keys(render).length > 0) {
    config.render = render;
  }

  for (const entry of values.set ?? []) {
    const [path, raw] = splitPair(entry);
    setPath(config, path, coerceScalar(raw));
  }

  return config;
}

function splitPair(entry) {
  const eq = entry.indexOf('=');
  if (eq === -1) {
    throw new CliUsageError(`expected key=value, got: ${entry}`);
  }
  return [entry.slice(0, eq), entry.slice(eq + 1)];
}
