// Builds `corpus.jsonl`: the engine's behaviour as data, for any other implementation to replay.
//
//   node test/conformance/build.mjs
//
// Cases come from two places. Every `process()` call the test suite makes is captured with its
// configuration, which carries the inputs the suite was written around; a seeded generator then
// crosses sample documents with option combinations the suite never spells out. Each case is run
// here, twice, and what the engine returns is the expectation; a case whose first result, written
// as JSON and read back, is not what the second run returns, or that hits the time budget, is left
// out.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { globSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { BUNDLE_NAMES, SETTING_SELECTORS } from '../../src/core/options.js';
import { VERSION } from '../../src/index.js';
import { DEFAULT_GROUPS } from '../../src/rules/registry.js';
import { replay } from './replay.mjs';

const ROOT = new URL('../../', import.meta.url);
const OUT = new URL('./corpus.jsonl', import.meta.url);
const CAPTURE = new URL('./capture.mjs', import.meta.url);

// Longer inputs say nothing a shorter one does not, and keep the corpus small enough to diff.
const MAX_TEXT = 20_000;

function captureSuite() {
  const dir = mkdtempSync(join(tmpdir(), 'microtypo-capture-'));
  const files = globSync('test/**/*.test.js', { cwd: ROOT }).filter(
    (f) => !f.startsWith('test/conformance/')
  );
  try {
    const run = spawnSync(process.execPath, ['--test', ...files], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'inherit'],
      maxBuffer: Infinity,
      env: {
        ...process.env,
        MICROTYPO_CAPTURE_DIR: dir,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${CAPTURE.href}`.trim()
      }
    });

    if (run.status !== 0) {
      process.stderr.write(run.stdout);
      throw new Error(`the test suite failed under capture (exit ${run.status}); fix it first`);
    }

    return readdirSync(dir).flatMap((name) =>
      readFileSync(join(dir, name), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// mulberry32: a fixed seed keeps the generated half of the corpus stable between builds.
function rng(seed) {
  let a = seed >>> 0;

  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = rng(0x6d7479);
const pick = (items) => items[Math.floor(random() * items.length)];
const chance = (p) => random() < p;

function prosePool() {
  const corpus = JSON.parse(readFileSync(new URL('test/fixtures/corpus.json', ROOT), 'utf8')).map(
    (c) => c.text
  );
  // Sorted: `globSync` returns directory order, which differs between file systems, and the seeded
  // picks below index into this list.
  const big = globSync('test/fixtures/big-text/*.input.txt', { cwd: ROOT })
    .toSorted()
    .map((f) => readFileSync(new URL(f, ROOT), 'utf8'));

  return [...corpus, ...big];
}

const escapeXml = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const indent = (s, by) =>
  s
    .split('\n')
    .map((line) => by + line)
    .join('\n');

// One document per format, built around prose so every format has something to typeset.
const SHAPES = {
  text: (a) => a,
  html: (a, b) =>
    pick([a, `<p>${a}</p>\n<pre>${b}</pre>`, `<div><em>${a}</em> <code>${b}</code></div>`]),
  markdown: (a, b, c) =>
    `# ${a.split('\n')[0]}\n\n${b}\n\n- ${c.split('\n')[0]}\n\n\`\`\`\ncode - "x" -- 'y'\n\`\`\`\n\n> ${a.split('\n')[0]} \`a - b\` [ссылка](http://example.com/a-b "t")\n`,
  json: (a, b, c) =>
    JSON.stringify({ title: a, body: { text: b, tags: [c, 'id-1'] }, n: 1 }, null, pick([0, 2])),
  xml: (a, b) =>
    `<?xml version="1.0"?>\n<doc lang="ru"><title>${escapeXml(a)}</title><!-- "x" - y --><p>${escapeXml(b)}</p></doc>`,
  yaml: (a, b, c) =>
    `title: ${JSON.stringify(a)}\nbody: |\n${indent(b, '  ')}\nlist:\n  - '${c.replaceAll("'", "''").split('\n')[0]}'\nn: 1\n`,
  toml: (a, b) => `title = ${JSON.stringify(a)}\nn = 1\n\n[body]\ntext = ${JSON.stringify(b)}\n`,
  frontmatter: (a, b) => `---\ntitle: ${JSON.stringify(a.split('\n')[0])}\n---\n\n${b}`
};

const TEMPLATES = ['handlebars', 'mustache', 'twig', 'jinja', 'nunjucks', 'liquid', 'erb'];
const TEMPLATE_BITS = [
  '{{ name }} - "x"',
  '{% if a %}"b"{% endif %}',
  '<%= "a" - b %>',
  '{# - "c" #}'
];

const RULE_SELECTORS = [
  ...DEFAULT_GROUPS.flatMap(([group, def]) => [
    group,
    `${group}.*`,
    ...def.rules.map((r) => `${group}.${r.id}`)
  ]),
  ...BUNDLE_NAMES,
  ...SETTING_SELECTORS,
  'nobr.nbsp_*',
  'dash.em*'
];
const BOOLEANISH = [true, false, true, false, 'on', 'off', 1, 0, '1', 'false'];
const RENDER_AXES = [
  ['paragraphs', 0.5, BOOLEANISH],
  ['autolink', 0.4, BOOLEANISH],
  ['breakline', 0.3, BOOLEANISH],
  ['nowrap', 0.3, ['nobr', 'span']],
  ['hanging', 0.3, ['style', 'class', 'both']],
  ['prefix', 0.2, ['mt-', false, 'x_']]
];

function generatedConfig(format) {
  const config = {};

  if (chance(0.7)) {
    config.html = pick(BOOLEANISH);
  }
  if (chance(0.6)) {
    config.entities = pick(BOOLEANISH);
  }

  if (format !== 'text' || chance(0.3)) {
    const input = { format };

    if (chance(0.15)) {
      input.template = pick(TEMPLATES);
    }
    if (['json', 'yaml', 'toml'].includes(format) && chance(0.3)) {
      input[pick(['fields', 'exclude'])] = pick([['title'], ['body.text'], ['body.*'], ['*'], []]);
    }

    config.input = chance(0.3) && Object.keys(input).length === 1 ? format : input;
  }

  if (chance(0.6)) {
    const render = {};

    for (const [key, p, values] of RENDER_AXES) {
      if (chance(p)) {
        render[key] = pick(values);
      }
    }

    config.render = render;
  }

  if (chance(0.7)) {
    const rules = {};

    for (let n = Math.floor(random() * 5); n > 0; n--) {
      rules[pick(RULE_SELECTORS)] = pick(BOOLEANISH);
    }

    config.rules = rules;
  }

  if (chance(0.03)) {
    config.presets = false;
  }
  if (chance(0.03)) {
    config.maxInputLength = pick([0, 10, 100]);
  }

  // A few invalid configurations, so the errors are part of the contract too.
  if (chance(0.03)) {
    Object.assign(
      config,
      pick([
        { unknown: 1 },
        { html: 'yes' },
        { render: { hanging: 'x' } },
        { rules: { 'nope.x': true } },
        { input: 'csv' },
        { render: { prefix: 'a b' } }
      ])
    );
  }

  return config;
}

function generatedOps() {
  const ops = [];

  if (chance(0.15)) {
    ops.push({
      method: 'applyOptions',
      args: [{ rules: { [pick(RULE_SELECTORS)]: pick(BOOLEANISH) } }]
    });
  }
  if (chance(0.05)) {
    ops.push({ method: 'setPrefix', args: [pick(['mt-', '', true, false, 'a b'])] });
  }
  if (chance(0.05)) {
    ops.push({ method: 'setLayout', args: [pick(['style', 'class', 'both', 'none'])] });
  }
  if (chance(0.03)) {
    ops.push({ method: 'addSafeTag', args: [pick(['kbd', 'var', 'samp'])] });
  }
  if (chance(0.03)) {
    ops.push({ method: 'addSafeBlock', args: [{ id: 'mark', open: '\\[\\[', close: '\\]\\]' }] });
  }

  return ops;
}

function generatedCases(prose) {
  const cases = [];
  const formats = Object.keys(SHAPES);

  for (let i = 0; i < 4000; i++) {
    const format = pick(formats);
    let text = SHAPES[format](pick(prose), pick(prose), pick(prose));

    if (chance(0.1)) {
      text = `${text}\n${pick(TEMPLATE_BITS)}`;
    }

    const c = { config: generatedConfig(format), ops: generatedOps(), text };

    if (chance(0.3)) {
      c.options = { changes: true };
    }

    cases.push(c);
  }

  // Every rule flipped from its default on its own, over a fixed slice of the prose, in both output
  // modes: each rule's effect is then a case of its own, not only what it adds to the defaults.
  const sample = prose.filter((_, i) => i % 7 === 0);

  for (const [group, def] of DEFAULT_GROUPS) {
    for (const rule of def.rules) {
      for (const [i, text] of sample.entries()) {
        const html = i % 2 === 0;

        cases.push({
          config: {
            html,
            entities: !html,
            rules: { [`${group}.${rule.id}`]: rule.enabled === false }
          },
          ops: [],
          text
        });
      }
    }
  }

  return cases;
}

function caseKey(c) {
  return JSON.stringify([
    Object.hasOwn(c, 'config') ? c.config : '\u0000none',
    c.ops,
    c.text ?? null,
    c.options ?? null
  ]);
}

const captured = captureSuite();
const all = [...captured, ...generatedCases(prosePool())];
const unique = new Map();

for (const c of all) {
  if (c.text?.length > MAX_TEXT) {
    continue;
  }

  unique.set(caseKey(c), c);
}

const lines = [];
let dropped = 0;

for (const [key, c] of unique) {
  const expect = replay(c);
  const budget = [expect.construct, expect.error, ...(expect.ops ?? [])].some(
    (e) => e?.name === 'MicroTypoBudgetError'
  );

  // Compared as the corpus will hold it, so a value with no JSON form, such as an `undefined` in an
  // error's details, cannot be written as something the engine does not return.
  const written = JSON.stringify(expect);

  if (budget || !isDeepStrictEqual(JSON.parse(written), replay(c))) {
    dropped++;
    continue;
  }

  const id = createHash('sha256').update(key).digest('hex').slice(0, 16);

  lines.push({ id, ...c, expect });
}

// Ids are distinct hex strings, so plain comparison is the order.
lines.sort((a, b) => (a.id < b.id ? -1 : 1));

const header = { corpus: 'microtypo-conformance', schema: 1, engine: VERSION, cases: lines.length };

writeFileSync(OUT, `${[header, ...lines].map((l) => JSON.stringify(l)).join('\n')}\n`);

process.stdout.write(
  `${lines.length} cases (${captured.length} captured, ${dropped} not reproducible) → ${fileURLToPath(OUT)}\n`
);
