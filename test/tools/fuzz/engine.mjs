// The engine the fuzzer runs: a copy of src/ with hooks, loaded from a temporary directory.
//
// - The nonce placeholders carry comes from a seeded generator restarted before every check, not
//   from Web Crypto. A leaked placeholder is typeset by what its nonce happens to hold, so with a
//   random nonce one case gives different violations from run to run, and neither a replay of the
//   case nor a summary of the run would come out the same. Both passes of a check still draw
//   different nonces, as two calls do in use.
// - The rule runner, and the lifting of inline markup a builtin group's rules run behind, record
//   each rule that changed the text at its own step, for coverage.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SRC = join(import.meta.dirname, '../../../src');

export const TRACE = Symbol.for('microtypo.fuzz.trace');
const RANDOM = Symbol.for('microtypo.fuzz.random');
const RESTART = Symbol.for('microtypo.fuzz.restart');
const UNFILTERED = Symbol.for('microtypo.fuzz.unfiltered');

const PATCHES = [
  [
    'engine.js',
    '      canSkipValue(value) {\n',
    (anchor) =>
      `${anchor}        if (globalThis[Symbol.for('microtypo.fuzz.unfiltered')]) return false;\n`
  ],
  [
    'lib/rule-features.js',
    '  const required = rule.requires ?? 0;\n',
    (anchor) => `  if (globalThis[Symbol.for('microtypo.fuzz.unfiltered')]) return true;\n${anchor}`
  ],
  [
    'rule-runner.js',
    '    ctx.text = next;\n',
    (anchor) =>
      [
        anchor.trimEnd(),
        '    if (ctx.text !== input) {',
        "      globalThis[Symbol.for('microtypo.fuzz.trace')]?.add(compiled.name + '.' + rule.id);",
        '    }',
        ''
      ].join('\n')
  ],
  // A rule of a builtin group runs on the text with its inline markup lifted out.
  [
    'inline-lift.js',
    '  if (next !== state) {\n',
    (anchor) =>
      `${anchor}    globalThis[Symbol.for('microtypo.fuzz.trace')]?.add(ctx.group.name + '.' + rule.id);\n`
  ],
  [
    'inline-lift.js',
    '    group.marked = output;\n',
    (anchor) =>
      `${anchor}    if (output !== input) {\n      globalThis[Symbol.for('microtypo.fuzz.trace')]?.add(ctx.group.name + '.' + rule.id);\n    }\n`
  ],
  [
    'protect/sequences.js',
    'globalThis.crypto.getRandomValues(randomPool)',
    () => "globalThis[Symbol.for('microtypo.fuzz.random')](randomPool)"
  ],
  [
    'protect/sequences.js',
    'let poolAt = 0;\n',
    (anchor) =>
      `${anchor}globalThis[Symbol.for('microtypo.fuzz.restart')] = () => {\n  poolAt = poolHex.length;\n};\n`
  ]
];

const START = 0x6d2b79f5;
let state = START;

// mulberry32, one byte per step.
globalThis[RANDOM] = (bytes) => {
  for (let i = 0; i < bytes.length; i++) {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);

    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    bytes[i] = (t ^ (t >>> 14)) & 0xff;
  }

  return bytes;
};

// `restart()` puts the nonces back to their first value; call it before each case is run.
// The engine imports nothing from disk once loaded, so the copy goes at once.
export async function loadEngine() {
  const temp = mkdtempSync(join(tmpdir(), 'microtypo-fuzz-'));

  try {
    cpSync(SRC, join(temp, 'src'), { recursive: true });
    writeFileSync(join(temp, 'package.json'), '{"type":"module"}\n');

    for (const [file, anchor, replace] of PATCHES) {
      const path = join(temp, 'src', file);
      const code = readFileSync(path, 'utf8');

      if (!code.includes(anchor)) {
        throw new Error(
          `fuzz: src/${file} changed; update the hook anchor ${JSON.stringify(anchor)}`
        );
      }

      writeFileSync(
        path,
        code.replace(anchor, () => replace(anchor))
      );
    }

    const { MicroTypo } = await import(pathToFileURL(join(temp, 'src/index.js')));

    return {
      MicroTypo,
      unfiltered(run) {
        const previous = globalThis[UNFILTERED];
        globalThis[UNFILTERED] = true;
        try {
          return run();
        } finally {
          globalThis[UNFILTERED] = previous;
        }
      },
      restart() {
        state = START;
        globalThis[RESTART]();
      }
    };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
