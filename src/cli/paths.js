import { glob, lstat, readFile, stat } from 'node:fs/promises';
import { extname, join, matchesGlob, relative, resolve, sep } from 'node:path';

import { CliUsageError } from './errors.js';

const FORMATS = new Map([
  ['.txt', 'text'],
  ['.html', 'html'],
  ['.htm', 'html'],
  ['.md', 'markdown'],
  ['.markdown', 'markdown'],
  ['.mdx', 'mdx'],
  ['.json', 'json'],
  ['.xml', 'xml'],
  ['.svg', 'xml'],
  ['.yaml', 'yaml'],
  ['.yml', 'yaml'],
  ['.toml', 'toml']
]);
// A directory holds a project's manifests, lockfiles and data next to its documents, and typesetting
// their strings corrupts them, so a walk over one takes only markup documents; a mask or a file names
// the rest.
const DOCUMENT_EXTENSIONS = new Set(
  [...FORMATS]
    .filter(([, format]) => ['html', 'markdown', 'mdx'].includes(format))
    .map(([ext]) => ext)
);
const MAX_FILES = 10_000;
const MAX_VISITED = 100_000;
const DISCOVERY_MS = 30_000;

export const inferredFormat = (path) => FORMATS.get(extname(path ?? '').toLowerCase()) ?? 'text';
export const portablePath = (path) => path.split(sep).join('/');

export function matchesMasks(path, masks) {
  return (Array.isArray(masks) ? masks : [masks]).some((mask) => matchesGlob(path, mask));
}

export function validateMasks(masks) {
  return (
    (typeof masks === 'string' && masks.length > 0 && masks.length <= 1024) ||
    (Array.isArray(masks) &&
      masks.length > 0 &&
      masks.length <= 128 &&
      masks.every((mask) => typeof mask === 'string' && mask.length > 0 && mask.length <= 1024))
  );
}

export async function loadIgnore(root) {
  let source;
  try {
    source = await readFile(join(root, '.microtypoignore'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return () => false;
    }
    throw error;
  }
  const rules = [];
  for (const raw of source.split(/\r\n?|\n/u)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const negate = line.startsWith('!');
    const body = negate ? line.slice(1) : line;
    if (body === '' || body.includes('\\') || /[{}]|[!+@?*]\(/u.test(body) || body.length > 1024) {
      throw new CliUsageError('unsupported .microtypoignore pattern');
    }
    const anchored = body.startsWith('/');
    const mask = body.replace(/^\//u, '').replace(/\/$/u, '');
    rules.push({
      negate,
      directory: body.endsWith('/'),
      mask: anchored || mask.includes('/') ? mask : `**/${mask}`
    });
  }
  return (absolute) => {
    const path = portablePath(relative(root, absolute));
    if (path === '..' || path.startsWith('../')) {
      return false;
    }
    const parts = path.split('/');
    let ignored = false;
    for (const { negate, mask, directory } of rules) {
      if (
        parts.some(
          (_, i) =>
            (!directory || i < parts.length - 1) &&
            matchesGlob(parts.slice(0, i + 1).join('/'), mask)
        )
      ) {
        ignored = !negate;
      }
    }
    return ignored;
  };
}

async function info(path, inspect = stat) {
  try {
    return await inspect(path);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function selectFiles(arguments_, cwd, ignored) {
  const selected = new Set();
  const start = performance.now();
  let visited = 0;
  const add = (path) => {
    if (!ignored(path)) {
      selected.add(path);
      if (selected.size > MAX_FILES) {
        throw new CliUsageError(`too many files (max ${MAX_FILES})`);
      }
    }
  };
  for (const argument of arguments_) {
    const absolute = resolve(cwd, argument);
    let entry = await info(absolute, lstat);
    if (entry?.isSymbolicLink()) {
      entry = (await info(absolute)) ?? entry;
    }
    if (entry !== null && !entry.isDirectory()) {
      add(absolute);
      continue;
    }
    const root = entry === null ? cwd : absolute;
    const pattern = entry === null ? argument : '**/*';
    const selects = entry === null ? FORMATS : DOCUMENT_EXTENSIONS;
    let matched = false;
    for await (const path of glob(pattern, {
      cwd: root,
      followSymlinks: false,
      exclude: ['**/.git/**', '**/node_modules/**']
    })) {
      visited++;
      if (visited > MAX_VISITED || performance.now() - start > DISCOVERY_MS) {
        throw new CliUsageError('file discovery exceeded its entry or time limit');
      }
      const file = resolve(root, path);
      // A link found by a walk or a mask was named by whoever wrote the tree, not by the caller, and
      // it can lead anywhere on the disk; only a path the caller names is followed.
      const details = await info(file, lstat);
      if (details === null || details.isDirectory() || details.isSymbolicLink()) {
        continue;
      }
      matched = true;
      if (selects.has(extname(file).toLowerCase()) && !file.endsWith('.microtyporc.json')) {
        add(file);
      }
    }
    if (entry === null && !matched) {
      throw new CliUsageError(`no files match: ${argument}`);
    }
  }
  return [...selected].toSorted().map((path) => portablePath(relative(cwd, path)));
}
