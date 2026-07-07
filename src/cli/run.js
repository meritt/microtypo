import { randomBytes } from 'node:crypto';
import { open, rename, stat, unlink } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { styleText } from 'node:util';

import { MicroTypoConfigError, MicroTypoInputError } from '../errors/index.js';
import { DEFAULT_MAX_INPUT_LENGTH, MicroTypo, VERSION } from '../index.js';
import { parse } from './args.js';
import { loadConfigFile } from './config.js';
import { CliUsageError } from './errors.js';
import { HELP } from './help.js';
import { mergeConfig } from './util.js';

// UTF-8 encodes any UTF-16 code unit in at most 3 bytes, so this byte cap never rejects input the engine's own length check would accept.
const BYTES_PER_CHAR_BOUND = 3;

export async function run(argv, io) {
  const { stderr } = io;

  let opts;
  try {
    opts = parse(argv);
  } catch (err) {
    return fail(err, stderr, 2);
  }

  if (opts.help) {
    io.stdout.write(HELP);
    return 0;
  }
  if (opts.version) {
    io.stdout.write(`${VERSION}\n`);
    return 0;
  }

  let engine;
  let config;
  try {
    const fileConfig = await loadConfigFile(opts.configPath, io.cwd);
    config = mergeConfig(fileConfig, opts.config);
    engine = new MicroTypo(config);
  } catch (err) {
    const code = err instanceof CliUsageError || err instanceof MicroTypoConfigError ? 2 : 1;
    return fail(err, stderr, code);
  }

  try {
    return await transform(engine, opts, io, maxInputLengthOf(config));
  } catch (err) {
    const code = err instanceof CliUsageError ? 2 : 1;
    return fail(err, stderr, code);
  }
}

function maxInputLengthOf(config) {
  return typeof config.maxInputLength === 'number'
    ? config.maxInputLength
    : DEFAULT_MAX_INPUT_LENGTH;
}

async function transform(engine, opts, io, maxInputLength) {
  const { files, write, outputFile } = opts;
  const { stdin, stdout, cwd } = io;

  if (write && outputFile) {
    throw new CliUsageError('--output-file cannot combine with --write');
  }

  if (files.length === 0) {
    if (stdin.isTTY) {
      stdout.write(HELP);
      return 0;
    }
    if (write) {
      throw new CliUsageError('--write requires file arguments');
    }
    const output = engine.process(await readCappedStream(stdin, maxInputLength));
    await emit(output, outputFile, stdout, cwd);
    return 0;
  }

  if (files.length > 1 && !write) {
    throw new CliUsageError('multiple files require --write');
  }

  // Phase 1: read and process every target before any write, so a later failure can't leave earlier files already rewritten.
  const targets = [];
  for (const file of files) {
    const abs = resolve(cwd, file);
    const { content, mode } = await readCappedFile(abs, maxInputLength);
    targets.push({ abs, mode, output: engine.process(content) });
  }

  // Phase 2: every target survived phase 1, so writing is now safe.
  if (write) {
    for (const { abs, output, mode } of targets) {
      await atomicWrite(abs, output, mode);
    }
  } else {
    await emit(targets[0].output, outputFile, stdout, cwd);
  }
  return 0;
}

async function readCappedFile(abs, maxInputLength) {
  const info = await stat(abs);
  const maxBytes = maxInputLength * BYTES_PER_CHAR_BOUND;

  if (info.size > maxBytes) {
    throw new MicroTypoInputError(
      `${abs}: file size ${info.size} bytes exceeds the ${maxBytes}-byte pre-read cap for maxInputLength ${maxInputLength}`,
      { details: { path: abs, size: info.size, maxBytes, maxInputLength } }
    );
  }

  const handle = await open(abs, 'r');
  try {
    return { content: await handle.readFile('utf8'), mode: info.mode & 0o777 };
  } finally {
    await handle.close();
  }
}

async function readCappedStream(stream, maxInputLength) {
  const maxBytes = maxInputLength * BYTES_PER_CHAR_BOUND;
  const chunks = [];
  let bytes = 0;

  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
    bytes += buf.length;
    if (bytes > maxBytes) {
      stream.destroy?.();
      throw new MicroTypoInputError(
        `stdin exceeds the ${maxBytes}-byte pre-read cap for maxInputLength ${maxInputLength}`,
        { details: { maxBytes, maxInputLength } }
      );
    }
    chunks.push(buf);
  }

  return Buffer.concat(chunks).toString('utf8');
}

async function emit(output, outputFile, stdout, cwd) {
  if (outputFile) {
    const abs = resolve(cwd, outputFile);
    await atomicWrite(abs, output, await existingMode(abs));
  } else {
    stdout.write(output);
  }
}

// Capture an existing target's mode so the atomic replace preserves it instead of applying a umask-masked default.
async function existingMode(abs) {
  try {
    const info = await stat(abs);
    return info.mode & 0o777;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return;
    }
    throw err;
  }
}

// Temp file in the same directory makes the rename atomic (same filesystem); explicit chmod because open's mode is masked by the umask.
async function atomicWrite(abs, content, mode) {
  const tmp = resolve(
    dirname(abs),
    `.${basename(abs)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  );
  const handle = await open(tmp, 'w', mode ?? 0o666);
  try {
    try {
      await handle.writeFile(content, 'utf8');
      if (mode !== undefined) {
        await handle.chmod(mode);
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, abs);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

function fail(err, stderr, code) {
  const message = `error: ${err.message}\n`;
  stderr.write(stderr.isTTY ? styleText('red', message, { validateStream: false }) : message);
  if (code === 2) {
    stderr.write('run `microtypo --help` for usage\n');
  }
  return code;
}
