import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import YAML from 'yaml';

import { MicroTypo } from '../../src/index.js';

// Example tests check the cases someone thought of. These generate documents and check them against
// serializers and parsers written here, so the engine is never its own oracle: a document goes in as
// a known shape and must come back as the same shape, with only its values typeset.

function generator(seed) {
  let state = seed;

  const next = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;

    return state / 0x7fffffff;
  };

  return {
    next,
    int: (n) => Math.floor(next() * n),
    pick: (items) => items[Math.floor(next() * items.length)]
  };
}

const VALUES = [
  'Корвин - принц',
  'Цена 100 руб.',
  'Отряд 12345 бойцов',
  'В 1979-1985 гг.',
  'Дворкин (c) 1979',
  'Путь 5 км за 2 ч',
  'Тень... и Амбер',
  'Формула x >= 5',
  'Оберон сказал: да!'
];

// The last five carry content a rule rewrites — `x1979-1985` gains an en dash, `trump-12345` a
// triad space — because an assertion over keys nothing can touch passes whatever the engine does to
// keys. Each one is still a name every format takes as written: an XML Name (a letter first), a TOML
// bare key (`[A-Za-z0-9_-]`), and a YAML plain key, with no `:` or `.` for the readers below to trip
// on.
const KEYS = [
  'title',
  'body',
  'note',
  'shadow',
  'trump',
  'deep',
  'list',
  'x1979-1985',
  'trump-12345',
  'd1-2',
  'note-12345',
  'shadow1-2'
];

// Leaves are strings or arrays of strings, branches are objects: exactly what every serializer below
// covers, so a shape mismatch after typesetting belongs to the engine, not to the generator.
function buildModel(rng, depth) {
  const out = {};
  const used = new Set();

  for (let i = 0; i <= rng.int(3); i += 1) {
    let key = rng.pick(KEYS);

    while (used.has(key)) {
      key = `${key}${i}`;
    }

    used.add(key);
    const kind = depth <= 0 ? rng.int(2) : rng.int(3);

    if (kind === 0) {
      out[key] = rng.pick(VALUES);
    } else if (kind === 1) {
      out[key] = Array.from({ length: 1 + rng.int(3) }, () => rng.pick(VALUES));
    } else {
      out[key] = buildModel(rng, depth - 1);
    }
  }

  return out;
}

function shapeOf(value) {
  if (typeof value === 'string') {
    return 'S';
  }

  if (Array.isArray(value)) {
    return `[${value.map(shapeOf).join(',')}]`;
  }

  return `{${Object.keys(value)
    .toSorted()
    .map((key) => `${key}:${shapeOf(value[key])}`)
    .join(',')}}`;
}

function leavesOf(value, out = []) {
  if (typeof value === 'string') {
    out.push(value);
  } else {
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      leavesOf(child, out);
    }
  }

  return out;
}

// One recursive-descent reader for both flow subsets: YAML separates a key from its value with ':',
// TOML with '='.
function readNested(src, separator) {
  let at = 0;

  const spaces = () => {
    while (src[at] === ' ') {
      at += 1;
    }
  };

  const value = () => {
    spaces();

    if (src[at] === '"') {
      const end = src.indexOf('"', at + 1);
      const text = src.slice(at + 1, end);
      at = end + 1;

      return text;
    }

    if (src[at] === '[') {
      at += 1;
      const items = [];

      for (spaces(); src[at] !== ']'; spaces()) {
        items.push(value());
        spaces();

        if (src[at] === ',') {
          at += 1;
        }
      }

      at += 1;

      return items;
    }

    assert.equal(src[at], '{', `unexpected token at ${at} in ${src}`);
    at += 1;
    const entries = {};

    for (spaces(); src[at] !== '}'; spaces()) {
      const mark = src.indexOf(separator, at);
      const key = src.slice(at, mark).trim();
      at = mark + 1;
      entries[key] = value();
      spaces();

      if (src[at] === ',') {
        at += 1;
      }
    }

    at += 1;

    return entries;
  };

  const parsed = value();
  spaces();
  assert.equal(at, src.length, `trailing content in ${src}`);

  return parsed;
}

function writeYaml(rng, node, indent = 0) {
  const pad = ' '.repeat(indent);

  return Object.entries(node)
    .map(([key, value]) => {
      if (typeof value === 'string') {
        return `${pad}${key}: "${value}"`;
      }

      if (rng.next() < 0.35) {
        return `${pad}${key}: ${writeFlow(value, ': ')}`;
      }

      return Array.isArray(value)
        ? `${pad}${key}:\n${value.map((item) => `${pad}  - "${item}"`).join('\n')}`
        : `${pad}${key}:\n${writeYaml(rng, value, indent + 2)}`;
    })
    .join('\n');
}

function writeFlow(value, separator) {
  if (typeof value === 'string') {
    return `"${value}"`;
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => writeFlow(item, separator)).join(', ')}]`;
  }

  const body = Object.entries(value)
    .map(([key, child]) => `${key}${separator}${writeFlow(child, separator)}`)
    .join(', ');

  return `{ ${body} }`;
}

const indentOf = (line) => line.length - line.trimStart().length;

const yamlScalar = (raw) => {
  assert.ok(raw.startsWith('"') && raw.endsWith('"'), `not a quoted scalar: ${raw}`);

  return raw.slice(1, -1);
};

function readYaml(text) {
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  let at = 0;

  const sequence = (indent) => {
    const items = [];

    while (
      at < lines.length &&
      indentOf(lines[at]) === indent &&
      lines[at].trimStart().startsWith('- ')
    ) {
      items.push(yamlScalar(lines[at].trimStart().slice(2)));
      at += 1;
    }

    return items;
  };

  const mapping = (indent) => {
    const entries = {};

    while (at < lines.length && indentOf(lines[at]) === indent) {
      const body = lines[at].trimStart();
      const colon = body.indexOf(':');
      const key = body.slice(0, colon);
      const rest = body.slice(colon + 1).trim();
      at += 1;

      if (rest.startsWith('[') || rest.startsWith('{')) {
        entries[key] = readNested(rest, ':');
      } else if (rest !== '') {
        entries[key] = yamlScalar(rest);
      } else {
        entries[key] = lines[at].trimStart().startsWith('- ')
          ? sequence(indent + 2)
          : mapping(indent + 2);
      }
    }

    return entries;
  };

  return mapping(0);
}

function writeToml(rng, node) {
  const lines = [];

  const walk = (branch, path) => {
    if (path.length > 0) {
      lines.push(`[${path.join('.')}]`);
    }

    const deferred = [];

    for (const [key, value] of Object.entries(branch)) {
      if (typeof value === 'string') {
        lines.push(`${key} = "${value}"`);
      } else if (Array.isArray(value) || rng.next() < 0.35) {
        lines.push(`${key} = ${writeFlow(value, ' = ')}`);
      } else {
        deferred.push([key, value]);
      }
    }

    for (const [key, value] of deferred) {
      walk(value, [...path, key]);
    }
  };

  walk(node, []);

  return lines.join('\n');
}

function readToml(text) {
  const root = {};
  let node = root;

  for (const raw of text.split('\n')) {
    const line = raw.trim();

    if (line === '') {
      continue;
    }

    if (line.startsWith('[')) {
      node = root;

      for (const segment of line.slice(1, -1).split('.')) {
        node[segment] ??= {};
        node = node[segment];
      }

      continue;
    }

    const equals = line.indexOf('=');
    const key = line.slice(0, equals).trim();
    const rest = line.slice(equals + 1).trim();

    node[key] = rest.startsWith('"') ? rest.slice(1, -1) : readNested(rest, '=');
  }

  return root;
}

// Elements carry the model's keys, text nodes its leaves, and every attribute value is a leaf the
// engine must leave alone — attributes are markup, not prose.
function writeXml(rng, node, name = 'root') {
  const attribute = rng.next() < 0.4 ? ` note="${rng.pick(VALUES)}"` : '';

  if (typeof node === 'string') {
    return `<${name}${attribute}>${node}</${name}>`;
  }

  if (Array.isArray(node)) {
    return `<${name}${attribute}>${node.map((item) => writeXml(rng, item, 'item')).join('')}</${name}>`;
  }

  const body = Object.entries(node)
    .map(([key, value]) => writeXml(rng, value, key))
    .join('');

  return `<${name}${attribute}>${body}</${name}>`;
}

function readXml(text) {
  let at = 0;

  const element = () => {
    assert.equal(text[at], '<', `expected a tag at ${at} in ${text}`);
    const headEnd = text.indexOf('>', at);
    const head = text.slice(at + 1, headEnd);
    const [name, ...rest] = head.split(' ');
    const attributes = rest.join(' ');
    at = headEnd + 1;
    const children = [];
    let chunk = '';

    while (!text.startsWith(`</${name}>`, at)) {
      if (text[at] === '<') {
        children.push(element());
        continue;
      }

      chunk += text[at];
      at += 1;
    }

    at += name.length + 3;

    return { name, attributes, children: children.length > 0 ? children : chunk };
  };

  return element();
}

const xmlShape = (node) =>
  typeof node.children === 'string'
    ? `<${node.name} ${node.attributes}/>`
    : `<${node.name} ${node.attributes}>${node.children.map(xmlShape).join('')}</${node.name}>`;

const FORMATS = [
  ['json', (_rng, model) => JSON.stringify(model, null, 2), JSON.parse],
  ['yaml', writeYaml, readYaml],
  ['toml', writeToml, readToml]
];

const PROSE_TAIL = ['', '.', ',', '!', '?', ' - вот', ' "цитата"', '...', ':', ';'];
const NAMES = ['Корвин', 'Рэндом', 'Мерлин', 'Дворкин', 'Амбер', 'Тень', 'Арден', 'Образ'];

// Every block form below stands at column zero, so the generator alone cannot produce a construct
// standing behind a container prefix — where a fence or a reference definition classified in front
// of its `>` or its list marker is not recognised at all. These wrap a generated block in a
// container so the same forms are also generated behind one.
function quoted(prefix, blank) {
  return (lines) => lines.map((line) => (line === '' ? blank : prefix + line));
}

function itemised(prefix, indent) {
  return (lines) =>
    lines.map((line, i) => {
      if (i === 0) {
        return prefix + line;
      }

      return line === '' ? indent.trimEnd() : indent + line;
    });
}

const CONTAINERS = [
  quoted('> ', '>'),
  quoted('> > ', '> >'),
  itemised('- ', '  '),
  itemised('1. ', '   '),
  itemised('> - ', '>   ')
];

function buildMarkdown(rng) {
  const words = (n) => Array.from({ length: n }, () => rng.pick(NAMES)).join(' ');
  const prose = () => `${words(1 + rng.int(5))}${rng.pick(PROSE_TAIL)}${words(rng.int(3))}`;

  const blocks = [
    () => prose(),
    () => `# ${prose()}`,
    () => `- ${prose()}\n- ${prose()}`,
    () => `- ${prose()}\n  - ${prose()}\n    - ${prose()}`,
    () => `1. ${prose()}\n2. ${prose()}`,
    () => `> ${prose()}`,
    () => `> - ${prose()}\n> - ${prose()}`,
    () => `\`\`\`\n${prose()}\n\`\`\``,
    () => `\`\`\`js\nconst a = "b" - 1;\n\`\`\``,
    () => `~~~\n${prose()}\n~~~`,
    () => `    ${prose()}`,
    () => `Смотри \`${prose()}\` тут`,
    () => `Смотри \`\`\`${prose()}\`\`\` тут`,
    () => `Читай [${prose()}](https://amber.io/a_b "${prose()}") тут`,
    () => `[метка${rng.int(9)}]: /путь "${prose()}"`,
    () => `| a | b |\n| --- | --- |\n| ${prose()} | ${prose()} |`,
    () => `${prose()}  \n${prose()}`,
    () => '---',
    () => `**${prose()}** и *${prose()}*`,
    () => `<div class="x">${prose()}</div>`,
    () => `<!-- ${prose()} -->`
  ];

  return Array.from({ length: 1 + rng.int(5) }, () => {
    const block = rng.pick(blocks)();

    return rng.next() < 0.35 ? rng.pick(CONTAINERS)(block.split('\n')).join('\n') : block;
  }).join('\n\n');
}

// Every region here is verbatim by contract, so each one must come back out unchanged.
const PROTECTED_PATTERNS = [
  /```[\s\S]*?```/g,
  /~~~[\s\S]*?~~~/g,
  /(?<!`)`[^`\n]+`(?!`)/g,
  /<!--[\s\S]*?-->/g
];

describe('generated Markdown', () => {
  // html:true adds inline markup only, so the source keeps its block syntax and both modes hold the
  // same two properties.
  for (const html of [false, true]) {
    test(`protected regions come back verbatim and typesetting is stable (html:${html})`, () => {
      const rng = generator(20_260_202);
      const typo = new MicroTypo({ input: 'markdown', html });

      for (let round = 0; round < 500; round += 1) {
        const source = buildMarkdown(rng);
        const once = typo.process(source);

        assert.equal(typo.process(once), once, `not idempotent:\n${source}\n->\n${once}`);

        for (const pattern of PROTECTED_PATTERNS) {
          for (const region of source.match(pattern) ?? []) {
            assert.ok(once.includes(region), `lost ${JSON.stringify(region)} in:\n${once}`);
          }
        }
      }
    });
  }
});

describe('structured documents keep their shape', () => {
  for (const [format, write, read] of FORMATS) {
    test(format, () => {
      const rng = generator(20_260_101);
      const typo = new MicroTypo({ input: format, maxInputLength: 200_000 });

      for (let round = 0; round < 200; round += 1) {
        const model = buildModel(rng, 3);
        const source = write(rng, model);
        const output = typo.process(source);
        const parsed = read(output);

        assert.equal(shapeOf(parsed), shapeOf(model), `source: ${source}\noutput: ${output}`);

        // Typography rewrites glyphs; it never empties a value.
        for (const [i, value] of leavesOf(parsed).entries()) {
          assert.ok(value.length > 0, `empty value at ${i} in ${output}`);
        }

        assert.equal(typo.process(output), output, `not idempotent: ${output}`);
      }
    });
  }

  test('xml', () => {
    const rng = generator(20_260_303);
    const typo = new MicroTypo({ input: 'xml', maxInputLength: 200_000 });

    for (let round = 0; round < 200; round += 1) {
      const model = buildModel(rng, 3);
      const source = writeXml(rng, model);
      const output = typo.process(source);

      // Element names and attributes are markup: the tree they describe must come back identical.
      assert.equal(xmlShape(readXml(output)), xmlShape(readXml(source)), `output: ${output}`);
      assert.equal(typo.process(output), output, `not idempotent: ${output}`);
    }
  });

  test('frontmatter', () => {
    const rng = generator(20_260_404);
    const typo = new MicroTypo({ input: 'frontmatter', maxInputLength: 200_000 });

    for (let round = 0; round < 200; round += 1) {
      const model = buildModel(rng, 2);
      const yaml = rng.next() < 0.5;
      const fence = yaml ? '---' : '+++';
      const header = yaml ? writeYaml(rng, model) : writeToml(rng, model);
      const body = buildMarkdown(rng);
      const source = `${fence}\n${header}\n${fence}\n\n${body}`;
      const output = typo.process(source);

      assert.ok(output.startsWith(`${fence}\n`), `header delimiter lost: ${output}`);

      const close = output.indexOf(`\n${fence}\n`, fence.length);
      assert.ok(close !== -1, `closing delimiter lost: ${output}`);

      const typedHeader = output.slice(fence.length + 1, close);
      const parsed = yaml ? readYaml(typedHeader) : readToml(typedHeader);

      assert.equal(shapeOf(parsed), shapeOf(model), `header: ${typedHeader}`);
      assert.equal(typo.process(output), output, `not idempotent: ${output}`);
    }
  });
});

// The writer above emits the one block form every serializer shares, and the forms it does not
// reach — a node behind a run of `-` markers, an explicit `?` key, a block scalar standing as one —
// are where a YAML key gets corrupted. These generate exactly those, with YAML's own parser as the
// oracle: the generator cannot drift into invalid input without the source parse failing first.
//
// Its own builder, because `buildModel` keeps arrays to strings — a TOML array of tables is a
// different construct again, and an array of strings can never put a node behind a `-` marker.
function buildYamlModel(rng, depth) {
  const kind = depth <= 0 ? 0 : rng.int(3);

  if (kind === 0) {
    return rng.pick(VALUES);
  }

  if (kind === 1) {
    return Array.from({ length: 1 + rng.int(2) }, () => buildYamlModel(rng, depth - 1));
  }

  const out = {};
  const used = new Set();

  for (let i = 0; i <= rng.int(2); i += 1) {
    let key = rng.pick(KEYS);

    while (used.has(key)) {
      key = `${key}${i}`;
    }

    used.add(key);
    out[key] = buildYamlModel(rng, depth - 1);
  }

  return out;
}

function writeYamlBlock(rng, node, indent, out) {
  const pad = ' '.repeat(indent);

  if (Array.isArray(node)) {
    for (const item of node) {
      if (typeof item === 'string') {
        out.push(`${pad}- "${item}"`);
        continue;
      }

      // Compact: the item's node starts on the marker line, the rest of it two columns in.
      if (rng.next() < 0.6) {
        const inner = [];
        writeYamlBlock(rng, item, indent + 2, inner);
        out.push(`${pad}- ${inner[0].trimStart()}`, ...inner.slice(1));
        continue;
      }

      out.push(`${pad}-`);
      writeYamlBlock(rng, item, indent + 2, out);
    }

    return;
  }

  for (const [key, child] of Object.entries(node)) {
    if (typeof child !== 'string') {
      out.push(`${pad}${key}:`);
      writeYamlBlock(rng, child, indent + 2, out);
      continue;
    }

    const form = rng.int(4);

    if (form === 0) {
      out.push(`${pad}${key}: "${child}"`);
    } else if (form === 1) {
      out.push(`${pad}${key}: |`, `${pad}  ${child}`);
    } else if (form === 2) {
      out.push(`${pad}? ${key}`, `${pad}: "${child}"`);
    } else {
      out.push(`${pad}? |`, `${pad}  ${key}`, `${pad}: "${child}"`);
    }
  }
}

function yamlShape(value) {
  if (value instanceof Map) {
    return `{${[...value].map(([k, v]) => `${JSON.stringify(k)}:${yamlShape(v)}`).join(',')}}`;
  }

  if (Array.isArray(value)) {
    return `[${value.map(yamlShape).join(',')}]`;
  }

  return 'S';
}

describe('YAML block forms keep their keys', () => {
  test('compact markers, explicit keys and block scalars', () => {
    const rng = generator(20_260_907);
    const typo = new MicroTypo({ input: 'yaml', maxInputLength: 200_000 });

    for (let round = 0; round < 400; round += 1) {
      const model = buildYamlModel(rng, 3);
      const lines = [];
      writeYamlBlock(rng, typeof model === 'string' ? { title: model } : model, 0, lines);
      const source = lines.join('\n');

      if (source === '') {
        continue;
      }

      const before = YAML.parse(source, { mapAsMap: true });
      const output = typo.process(source);
      const after = YAML.parse(output, { mapAsMap: true });

      assert.equal(yamlShape(after), yamlShape(before), `in:\n${source}\nout:\n${output}`);
      assert.equal(typo.process(output), output, `not idempotent:\n${output}`);
    }
  });
});
