import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, open, realpath, rename, stat, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { styleText } from 'node:util';

import { MicroTypoConfigError, MicroTypoInputError } from '../errors/index.js';
import { MicroTypo, VERSION } from '../index.js';
import { parse } from './args.js';
import { processInput, report } from './diagnostics.js';
import { CliUsageError } from './errors.js';
import { HELP } from './help.js';
import { loadIgnore, selectFiles } from './paths.js';
import { CLI_MAX_INPUT_LENGTH, loadProject } from './project.js';

// UTF-8 encodes any UTF-16 code unit in at most 3 bytes, so this byte cap never rejects input the
// engine's own length check would accept.
const BYTES_PER_CHAR_BOUND = 3;
const READ_CHUNK_BYTES = 64 * 1024;
const MAX_BATCH_UNITS = 50_000_000;

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

  let project;
  try {
    project = await loadProject(opts, io.cwd);
  } catch (err) {
    const code = err instanceof CliUsageError || err instanceof MicroTypoConfigError ? 2 : 1;
    return fail(err, stderr, code);
  }

  try {
    return await transform(project, opts, io);
  } catch (err) {
    const code = err instanceof CliUsageError || err instanceof MicroTypoConfigError ? 2 : 1;
    return fail(err, stderr, code);
  }
}

function maxInputLengthOf(config) {
  return typeof config.maxInputLength === 'number' ? config.maxInputLength : CLI_MAX_INPUT_LENGTH;
}

async function transform(project, opts, io) {
  const { write, outputFile } = opts;
  let { files } = opts;
  const { stdin, stdout, cwd } = io;

  if (write && outputFile) {
    throw new CliUsageError('--output-file cannot combine with --write');
  }
  if ((opts.check && opts.diff) || ((opts.check || opts.diff) && (write || outputFile))) {
    throw new CliUsageError('--check and --diff are separate read-only modes');
  }
  if (opts.stdinFilepath !== undefined && files.length > 0) {
    throw new CliUsageError('--stdin-filepath requires stdin input');
  }
  const ignored = await loadIgnore(project.root);

  if (files.length === 0) {
    if (stdin.isTTY) {
      stdout.write(HELP);
      return 0;
    }
    if (write) {
      throw new CliUsageError('--write requires file arguments');
    }
    const config = project.configFor(opts.stdinFilepath);
    const engine = new MicroTypo(config);
    const input = await readCappedStream(stdin, maxInputLengthOf(config));
    const skip = opts.stdinFilepath !== undefined && ignored(resolve(cwd, opts.stdinFilepath));
    const target = {
      file: opts.stdinFilepath ?? '<stdin>',
      ...(skip ? { input, output: input, edits: [], trace: [] } : processInput(engine, input, opts))
    };
    report(target, opts, io);
    if (!opts.check && !opts.diff) {
      await emit(target.output, outputFile, stdout, cwd);
    }
    return opts.check && target.edits.length > 0 ? 1 : 0;
  }

  files = await selectFiles(files, cwd, ignored);
  if (files.length === 0) {
    return 0;
  }

  if (files.length > 1 && !write && !opts.check && !opts.diff) {
    throw new CliUsageError('multiple files require --write');
  }

  // Phase 1: read, process and clear every target before any write, so everything that can be found
  // out in advance — an unreadable file, an oversized one, a processing error, a directory the
  // rename cannot write — is found before the first file is replaced.
  //
  // The working directory is resolved once: it is the same answer for every target, rather than a
  // `realpath` syscall per target.
  const root = write ? await resolvedRoot(cwd) : null;
  const targets = [];
  // Files that resolve to the same configuration share one engine. A configuration is JSON data —
  // the config file and the flags — so its serialization tells two apart.
  const engines = new Map();
  let units = 0;
  for (const file of files) {
    const config = project.configFor(file);
    const key = JSON.stringify(config);
    const engine = engines.get(key) ?? engines.set(key, new MicroTypo(config)).get(key);
    const abs = write ? await resolveTarget(resolve(cwd, file), root) : resolve(cwd, file);
    const { content, mode } = await readCappedFile(abs, maxInputLengthOf(config));
    units += content.length;
    if (units > MAX_BATCH_UNITS) {
      throw new MicroTypoInputError(`batch exceeds ${MAX_BATCH_UNITS} input UTF-16 units`, {
        details: { max: MAX_BATCH_UNITS }
      });
    }

    const target = { abs, mode, file, ...processInput(engine, content, opts) };

    // A file the run leaves as it is is not rewritten, so a read-only one does not stop the batch.
    if (write && target.output !== target.input) {
      await assertWritable(abs);
    }

    targets.push(target);
  }

  // Phase 2: every target survived phase 1, so writing is now safe. Each replace is atomic on its
  // own; the batch is not, and a failure here leaves the earlier files replaced.
  if (write) {
    for (const { abs, input, output, mode } of targets) {
      if (output !== input) {
        await atomicWrite(abs, output, mode);
      }
    }
  } else if (!opts.check && !opts.diff) {
    await emit(targets[0].output, outputFile, stdout, cwd);
  }
  for (const target of targets) {
    report(target, opts, io);
  }
  return opts.check && targets.some(({ edits }) => edits.length > 0) ? 1 : 0;
}

// A path the run is about to write may simply not exist yet, and that is not a failure for any of
// the three questions below — only a real error is.
async function ifPresent(ask) {
  try {
    return await ask();
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

function isInside(root, target) {
  const rel = relative(root, target);

  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

// Both spellings of the working directory the check below compares against: the path as named, and
// the path with every symlink above it followed.
async function resolvedRoot(cwd) {
  return { named: resolve(cwd), real: await realpath(cwd) };
}

// A rewrite replaces the directory entry, so writing to a symlink by its own path would leave a
// plain file where the link was and never touch what it pointed at: it is followed and the target
// rewritten, and a link resolving to nothing is a target error like any other. Following is also how
// a path named inside the working directory reaches anywhere on the disk — the link can sit on the
// file or on any directory above it — so a target that leaves the tree it was addressed from is
// refused. A path named outside the tree was never redirected and stays the caller's own business.
async function resolveTarget(abs, root) {
  const entry = await ifPresent(() => lstat(abs));
  const followed = entry?.isSymbolicLink() ? await ifPresent(() => realpath(abs)) : abs;

  if (followed === undefined) {
    throw new CliUsageError(`${abs}: symlink target does not exist`);
  }

  // The parent has to exist to be resolved, and a target named under a directory that is not there
  // is the caller's mistake like every other one in this function — not a raw ENOENT from a syscall
  // the caller never made, with the exit code that means an internal failure.
  const parent = await ifPresent(() => realpath(dirname(followed)));

  if (parent === undefined) {
    throw new CliUsageError(`${abs}: directory ${dirname(followed)} does not exist`);
  }

  const real = resolve(parent, basename(followed));

  if (isInside(root.named, abs) && !isInside(root.real, real)) {
    throw new CliUsageError(`${abs}: resolves to ${real}, outside the working directory`);
  }

  return real;
}

// Two ways an atomic replace can still fail after the read: 0444 on the file, which is how a reader
// says "do not rewrite this", and a directory the rename cannot write. Both are checked before any
// target is written, so a refusal here leaves the whole batch alone. That is the preparatory phase,
// not a transaction: a failure during the writes themselves keeps the files already replaced.
async function assertWritable(abs) {
  await access(dirname(abs), constants.W_OK);
  await ifPresent(() => access(abs, constants.W_OK));
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

  // `size` is a snapshot, and a FIFO or a device reports 0 whatever it delivers, so the cap is held
  // on the bytes actually read: never more than one past it, and no read left pending to block the
  // close until the writer's EOF.
  await using handle = await open(abs, 'r');
  let buffer = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, maxBytes + 1));
  let bytes = 0;

  for (;;) {
    if (bytes === buffer.length) {
      const grown = Buffer.allocUnsafe(Math.min(buffer.length * 2, maxBytes + 1));

      buffer.copy(grown, 0, 0, bytes);
      buffer = grown;
    }

    const { bytesRead } = await handle.read({
      buffer,
      offset: bytes,
      length: buffer.length - bytes
    });

    if (bytesRead === 0) {
      break;
    }
    bytes += bytesRead;
    if (bytes > maxBytes) {
      throw new MicroTypoInputError(
        `${abs} exceeds the ${maxBytes}-byte pre-read cap for maxInputLength ${maxInputLength}`,
        { details: { path: abs, maxBytes, maxInputLength } }
      );
    }
  }

  return { content: buffer.toString('utf8', 0, bytes), mode: info.mode & 0o777 };
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
    const abs = await resolveTarget(resolve(cwd, outputFile), await resolvedRoot(cwd));
    await assertWritable(abs);
    await atomicWrite(abs, output, await existingMode(abs));
  } else {
    stdout.write(output);
  }
}

// An existing target's mode is captured so the atomic replace preserves it rather than applying a
// umask-masked default.
async function existingMode(abs) {
  const info = await ifPresent(() => stat(abs));

  return info && info.mode & 0o777;
}

// A temp file in the same directory keeps the rename atomic, on one filesystem, and the chmod is
// explicit because `open`'s mode is masked by the umask. The name is short and says nothing about
// the target: carrying the target's own basename can push a name a filesystem accepts past its
// length limit, leaving a writable file that cannot be rewritten.
async function atomicWrite(abs, content, mode) {
  const tmp = resolve(
    dirname(abs),
    `.microtypo.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  );
  try {
    {
      await using handle = await open(tmp, 'w', mode ?? 0o666);
      await handle.writeFile(content, 'utf8');
      if (mode !== undefined) {
        await handle.chmod(mode);
      }
      await handle.sync();
    }
    await rename(tmp, abs);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

function fail(err, stderr, code) {
  const message = `error: ${err.message}\n`;
  stderr.write(styleText('red', message, { stream: stderr }));
  if (code === 2) {
    stderr.write('run `microtypo --help` for usage\n');
  }
  return code;
}
