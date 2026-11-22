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
    const run = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], {
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

function localizationDocument(format, text) {
  switch (format) {
    case 'json':
      return JSON.stringify({ title: text });
    case 'yaml':
      return `title: ${JSON.stringify(text)}\r\n`;
    case 'toml':
      return `title = ${JSON.stringify(text)}\r\n`;
    case 'xml':
      return `<doc>${escapeXml(text)}</doc>\r\n`;
    case 'frontmatter':
      return `---\r\ntitle: ${JSON.stringify(text)}\r\n---\r\n\r\n${text}\r\n`;
    default:
      return text;
  }
}

function formatCases() {
  const cases = [];
  const add = (text, input, html = false) => cases.push({ text, config: { html, input }, ops: [] });
  const placeholders = {
    icu: '{name}: {n, plural, one {# день - "текст"} other {# дней - "тексты"}}',
    printf: '%1$s - "текст", %d и %@',
    interpolation: `\${user.name} - "текст"`,
    all: `\${name} {count} %1$s - "текст"`
  };
  for (const [mode, text] of Object.entries(placeholders)) {
    for (const format of [
      'text',
      'html',
      'plain',
      'markdown',
      'json',
      'yaml',
      'toml',
      'xml',
      'frontmatter'
    ]) {
      const source = localizationDocument(format, text);
      for (const html of [false, true]) {
        add(source, { format, placeholders: mode }, html);
      }
    }
  }
  for (const format of ['text', 'html', 'markdown', 'frontmatter']) {
    for (const directive of [
      'file',
      'start',
      'start -->\r\nКод - "текст"\r\n<!-- microtypo-ignore-end'
    ]) {
      const text = `Корвин - принц\r\n<!-- microtypo-ignore-${directive} -->\r\nЭрик - король\r\n`;
      for (const pragmas of ['off', 'microtypo']) {
        add(text, { format, pragmas });
      }
    }
  }
  for (const text of [
    'если a<b, то "c" - d',
    '<code>Корвин - принц</code>',
    '<!-- Корвин - принц -->',
    'Назад <- сюда'
  ]) {
    for (const html of [false, true]) {
      add(text, { format: 'plain' }, html);
    }
  }
  for (const ending of ['\n', '\r\n']) {
    add(`| Альфа | Бета |${ending}| :- | -: |${ending}| Корвин - принц | Эрик |${ending}`, {
      format: 'markdown'
    });
    add(
      `---${ending}title: "Корвин - принц"${ending}---${ending}${ending}${ending}Эрик - король${ending}`,
      { format: 'frontmatter' }
    );
  }
  for (const format of ['markdown', 'mdx', 'frontmatter']) {
    for (const math of [false, true]) {
      const text =
        '$a - b$ \\(x - y\\) $$\r\na - b = "c"\r\n$$\r\n\r\nстоит $5, а не $10; Корвин - принц\r\n';
      add(format === 'frontmatter' ? `---\r\ntitle: "А - б"\r\n---\r\n\r\n${text}` : text, {
        format,
        math
      });
    }
  }
  for (const html of [false, true]) {
    for (const text of [
      'import X from "./x.js"\nexport const label = "А - б"\n\nКорвин - принц',
      '<Box value={<Inner>{"}"}</Inner>}>Корвин - принц</Box>',
      '{(() => { if (ok) {} /}}/.test(value); return "А - б"; })()} Корвин - принц',
      '{String.raw`А - б\n~~~\nВ - г`}\n\nКорвин - принц',
      '{unfinished - "source"\n\nКорвин - принц'
    ]) {
      add(text, { format: 'mdx' }, html);
    }
  }
  for (const format of ['text', 'html', 'markdown', 'frontmatter']) {
    for (const attributes of [[], ['alt', 'title', 'content']]) {
      add(
        '<img alt=\'"Амбер" - город &quot;текст&quot;\' title="А - б"><meta property="og:description" content="Корвин - принц"><code title="А - б">А - б</code>',
        { format, attributes }
      );
    }
  }
  for (const input of [
    { format: 'mdx', math: 'invalid' },
    { attributes: ['href'] },
    { attributes: 'alt' }
  ]) {
    add('А - б', input);
  }
  cases.push(
    { config: { input: 'chaos' }, ops: [] },
    { config: {}, ops: [], text: 'Амбер - вечен\n' }
  );
  return cases;
}

function diagnosticCases() {
  const documents = {
    text: '\uFEFF"Амбер" в <em>доме</em>. 10:00-12:00\r\n',
    html: '\uFEFF<p title="Амбер - город">"Амбер" в <em>доме</em>.</p>\r\n',
    plain: '😀 "Амбер" <b>в доме</b>',
    markdown: '\uFEFF`"код"`\r\n\n"Амбер" в *доме*.\n',
    mdx: 'export const x = "код";\n\n"Амбер" <X value={"код"} />\n',
    json: '\uFEFF{"a":"\\u0022Амбер\\u0022 😀", "b":"\\u0022Амбер\\u0022 😀"}\r\n',
    yaml: 'a: \'"Амбер"\'\r\nb: \'"Амбер"\'\n',
    toml: 'a = \'"Амбер"\'\r\nb = \'"Амбер"\'\n',
    xml: '\uFEFF<doc>"Амбер" &amp; "Тень"</doc>\r\n',
    frontmatter: '\uFEFF---\r\ntitle: \'"Амбер"\'\r\n---\r\n\n"Амбер" в *доме*.\n'
  };
  const cases = [];
  for (const [format, text] of Object.entries(documents)) {
    for (const html of [false, true]) {
      for (const entities of [false, true]) {
        for (let mask = 1; mask < 8; mask++) {
          const options = {
            changes: (mask & 1) !== 0,
            edits: (mask & 2) !== 0,
            trace: (mask & 4) !== 0
          };
          cases.push({
            name: `diagnostics-${format}-${mask}-${html}-${entities}`,
            text,
            config: {
              html,
              entities,
              input: { format, attributes: format === 'html' ? ['title'] : [] }
            },
            ops: [],
            options
          });
        }
      }
    }
  }
  const ruleGroups = [
    {
      name: 'terms',
      rules: [
        { id: 'first', pattern: { source: 'a', flags: 'g' }, replacement: 'b' },
        { id: 'unchanged', pattern: { source: 'b', flags: 'g' }, replacement: 'b' },
        { id: 'second', pattern: { source: '(b)(b)', flags: 'g' }, replacement: '$2$1c' }
      ]
    }
  ];
  cases.push({
    name: 'diagnostics-rejected-inline-trial',
    text: '5 <i>руб.</i>',
    config: { html: true, render: { paragraphs: false } },
    ops: [],
    options: { trace: true, edits: true }
  });
  const roundtrip = {
    rules: [
      {
        id: 'roundtrip',
        pattern: [
          { source: 'a', flags: 'g' },
          { source: 'b', flags: 'g' }
        ],
        replacement: ['b', 'a']
      }
    ]
  };
  for (const [format, text] of Object.entries({
    text: '\uFEFFa <code>a</code>',
    html: '<code>a</code><b title="a">a</b><b title="a">a</b>',
    plain: '😀a a',
    markdown: '`a`\r\n\na *a*\n',
    mdx: 'export const x = "a";\n\na *a*\n',
    json: '\uFEFF{"x":"\\u0061","y":"a"}\r\n',
    xml: '<doc>a &amp; a</doc>\r\n',
    yaml: 'first: a\r\nlast: a\n',
    toml: "first = 'a'\r\nlast = 'a'\n",
    frontmatter: '\uFEFF---\r\nfirst: a\r\n---\r\n\na *a*\n'
  })) {
    cases.push({
      name: `diagnostics-net-zero-${format}`,
      text,
      config: { presets: false, input: { format, attributes: format === 'html' ? ['title'] : [] } },
      ops: [{ method: 'registerRuleGroup', args: [roundtrip, { name: 'terms' }] }],
      options: { trace: true, edits: true, changes: true }
    });
  }
  cases.push({
    name: 'diagnostics-engine-year-step',
    text: '12.05.20г и 13.05.20г',
    config: {},
    ops: [],
    options: { trace: true, edits: true }
  });
  for (const [name, extra] of [
    ['enabled', {}],
    ['group-disabled', { rules: { terms: false } }],
    ['mask-disabled', { rules: { 'terms.sec*': false } }]
  ]) {
    cases.push({
      name: `data-rules-${name}`,
      config: { presets: false, ruleGroups, ...extra },
      ops: [],
      text: 'aa aa <code>aa</code>',
      options: { trace: true, edits: true, changes: true }
    });
  }
  cases.push({
    name: 'data-rules-registration',
    config: { presets: false },
    ops: [
      { method: 'registerRuleGroup', args: [ruleGroups[0], { name: 'terms' }] },
      { method: 'applyOptions', args: [{ rules: { 'terms.second': false } }] }
    ],
    text: 'aa aa',
    options: { trace: true, edits: true }
  });
  for (const pattern of [
    { source: '(', flags: 'g' },
    { source: 'a', flags: 'gg' }
  ]) {
    cases.push({
      name: `data-rules-invalid-${pattern.source === '(' ? 'source' : 'flags'}`,
      config: {
        ruleGroups: [{ name: 'terms', rules: [{ id: 'invalid', pattern, replacement: 'b' }] }]
      },
      ops: [],
      text: 'a'
    });
  }
  return cases;
}

const captured = captureSuite();
const all = [...captured, ...generatedCases(prosePool()), ...formatCases(), ...diagnosticCases()];
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
