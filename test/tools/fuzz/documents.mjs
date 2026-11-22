import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';

import { BUNDLE_NAMES, SETTING_SELECTORS } from '../../../src/core/options.js';
import { DEFAULT_GROUPS } from '../../../src/rules/registry.js';
import { createGrammar, OUTSIDE_TAG } from './grammar.mjs';

export const FORMATS = [
  'text',
  'html',
  'plain',
  'markdown',
  'mdx',
  'json',
  'yaml',
  'toml',
  'xml',
  'frontmatter'
];

const TEMPLATES = ['handlebars', 'mustache', 'twig', 'jinja', 'nunjucks', 'liquid', 'erb'];

export const RULE_SELECTORS = [
  ...DEFAULT_GROUPS.flatMap(([group, def]) => {
    const selectors = def.rules.map((r) => `${group}.${r.id}`);

    selectors.unshift(group, `${group}.*`);

    return selectors;
  }),
  ...BUNDLE_NAMES,
  ...SETTING_SELECTORS,
  'nobr.nbsp_*',
  'dash.em*'
];

const esc = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

const BOOLEANISH = [true, false, true, false, 'on', 'off', 1, 0, '1', 'false'];
const RENDER_AXES = [
  ['paragraphs', 0.5, BOOLEANISH],
  ['autolink', 0.4, BOOLEANISH],
  ['breakline', 0.3, BOOLEANISH],
  ['nowrap', 0.3, ['nobr', 'span']],
  ['hanging', 0.3, ['style', 'class', 'both']],
  ['prefix', 0.2, ['mt-', false, 'x_']]
];
const KEYS = ['title', 'body', 'note', 'summary', 'label', 'text', 'description', 'caption'];

export function generateConfig(d, format) {
  const { pick, chance, int } = d;
  const config = {};

  if (chance(0.7)) {
    config.html = pick(BOOLEANISH);
  }

  if (chance(0.6)) {
    config.entities = pick(BOOLEANISH);
  }

  const input = { format };

  if (chance(0.2)) {
    input.template = pick(TEMPLATES);
  }

  if (chance(0.2)) {
    input.placeholders = pick(['icu', 'printf', 'interpolation', 'all']);
  }
  if (['text', 'html', 'markdown', 'frontmatter'].includes(format) && chance(0.15)) {
    input.pragmas = 'microtypo';
  }

  if (['json', 'yaml', 'toml'].includes(format) && chance(0.15)) {
    input[pick(['fields', 'exclude'])] = pick([['title'], ['body'], ['*.text'], ['*']]);
  }

  if (format !== 'text' || Object.keys(input).length > 1 || chance(0.3)) {
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

    for (let n = int(1, 5); n > 0; n--) {
      rules[pick(RULE_SELECTORS)] = pick(BOOLEANISH);
    }

    config.rules = rules;
  }

  if (chance(0.02)) {
    config.presets = false;
  }

  return config;
}

export function templateOf(config) {
  return typeof config.input === 'object' ? (config.input.template ?? null) : null;
}

// What a Markdown block construct needs in front of it to be one: the start of the document or a
// blank line, and for indented code a heading before that blank line.
const AFTER_BLANK = String.raw`(?:^(?:[ \t]*\r?\n)*|\n(?:[ \t]*\r?\n)+)`;
const AFTER_HEADING = String.raw`(?:^(?:[ \t]*\r?\n)*|(?:^|\n)#{1,6} [^\n]*\n(?:[ \t]*\r?\n)+)`;
// A container directive's fence is a line of its own, and one no HTML block holds: the stretch from
// the blank line or document start in front of it has no line opening with a tag.
const OUTSIDE_HTML_BLOCK = String.raw`(?:^|\n[ \t]*\r?\n)(?:(?![ \t]*<)[^\r\n]*\r?\n)*`;
const LINE_END = String.raw`(?:\r?\n|$)`;

const YAML_PLAIN_RE = /^[А-Яа-яЁёA-Za-z][^:#\n\r]*[^\s:#]$/u;

export function withRuleSet(config, ruleSet) {
  return ruleSet === 'random' ? config : { ...config, presets: true, rules: {} };
}

export function createDocuments(lexicon, d) {
  const { int, pick, chance, weighted } = d;
  const g = createGrammar(lexicon, d);

  function eolFor() {
    return weighted([
      [6, '\n'],
      [3, '\r\n'],
      [1, () => (chance(0.5) ? '\n' : '\r\n')]
    ]);
  }

  const prose = (ctx) => g.finish(ctx, g.paragraph(ctx));
  const line = (ctx) => g.finish(ctx, g.sentence(ctx));
  const nl = (ctx) => g.nl(ctx);

  function formatsII(format, config) {
    const input = typeof config.input === 'object' ? { ...config.input } : { format };
    config.input = input;
    const ctx = g.context({ eol: pick(['\n', '\r\n']), lines: false });
    const sentence = () => `${g.word()} - ${g.word()} и "${g.word()}"`;
    const guard = (kind, source) => g.guard(ctx, kind, source);
    const e = nl(ctx);
    let source;
    const expectedProse = [];
    const reviewProse = () => {
      config.html = false;
      config.entities = false;
      config.presets = true;
      config.rules = {};
      expectedProse.push({ source: 'Корвин - принц', expected: 'Корвин\u00a0— принц' });
    };
    const attributeShapes = [];
    if (format === 'mdx') {
      input.math = chance(0.5);
      const review = chance(0.4);
      const expression = pick(
        review
          ? [
              '{(() => { if (ok) {} else /}}/.test(x); return "А - б"; })()}',
              '{(() => { label: {} /}}/.test(x); return "А - б"; })()}',
              '{(async () => { for await (const x of xs) /}}/.test(x); return "А - б"; })()}',
              '{(() => { const x = function() {} / 2; return "А - б"; })()}',
              '{(() => { const value = class {} / 2; return "А - б"; })()}',
              '{(() => { const value = class extends Bases[{}] {} / 2; return "А - б"; })()}',
              '{(() => { class Value {} /}}/.test(x); return "А - б"; })()}'
            ]
          : [
              '{({ value: "} - text", nested: { a: 1 } })}',
              `{\`А - \${\`б \${value} - в\`} г\`}`,
              '{(() => { if (ok) {} /}}/.test(value); return "А - б"; })()}',
              '{x++ / 2 + obj.return / 2}',
              '{/* А - "б" */}',
              '{<Inner>{"}"}</Inner>}'
            ]
      );
      const unclosed = pick([
        '{unfinished - "source"',
        '<Box title="А - б',
        '{/* А - б',
        '{/unterminated'
      ]);
      source = `${guard('mdx-esm', `import X from "./a-b.js"${e}export const value = "А - б"`)}${e}${e}${sentence()} ${guard('mdx-expression', expression)}${review ? ' Корвин - принц' : ''}${e}${e}${guard('mdx-jsx', '<Box value={<Inner>{"}"}</Inner>}>')}${sentence()}${guard('mdx-jsx', '</Box>')}${e}${e}${guard('mdx-expression', `{String.raw\`А - б${e}~~~${e}В - г\`}`)}${e}${e}${sentence()}${e}${e}${guard('mdx-unclosed', unclosed)}${e}${e}${sentence()}`;
      if (review) {
        reviewProse();
      }
    } else if (chance(0.5) && ['markdown', 'frontmatter'].includes(format)) {
      input.math = true;
      const formula = pick([
        '$a - b$',
        '$$a - b$$',
        String.raw`\(a - b\)`,
        String.raw`\[a - b\]`,
        '$a - b<c$',
        String.raw`\(a - b<c\)`,
        `$$${e}a - b = "c"${e}$$`
      ]);
      source = `${sentence()} ${guard('md-math', formula)}${formula.includes('<') ? '>' : ''}${e}${e}$5 и $10, стоит $5, а не $10${e}${e}${guard('md-code', '`$a - b$`')}${e}${e}${sentence()}`;
      if (chance(0.5)) {
        reviewProse();
        const ending = pick(['\n', '\r', '\r\n']);
        const [open, close] = pick([
          ['$', '$'],
          [String.raw`\(`, String.raw`\)`]
        ]);
        const physical = `${open}a - b\\${ending}c - d${close}`;
        expectedProse.push({
          source: physical,
          expected: `${open}a\u00a0— b\\${ending}c\u00a0— d${close}`
        });
        source += `${e}${e}${physical}${e}${e}Корвин - принц`;
      }
    } else {
      const attribute = pick(['alt', 'title', 'aria-label', 'placeholder']);
      input.attributes = pick([
        [attribute],
        [attribute, 'content'],
        ['alt', 'content', 'placeholder', 'aria-label']
      ]);
      const quote = pick(['"', "'"]);
      const entities = ['&quot;', '&#34;', '&#x22;', '&amp;', '&lt;', '&nbsp;']
        .map((entity) => guard('attribute-entity', entity))
        .join(' ');
      const prefix = `<img data-j6="image" ${attribute}=${quote}`;
      const suffix = `${quote} src="a-b.png">`;
      const valueText = `${g.word()} - ${g.word()} ${quote === '"' ? "'Амбер'" : '"Амбер"'}`;
      source = `${sentence()}${e}${prefix}${valueText} ${entities}${suffix}${e}<meta data-j6="meta" name="description" content="${g.word()} - ${g.word()}">${e}${guard('attribute-protected', '<code title="А - б"><img alt="А - б"></code>')}${e}${sentence()}`;
      const attributePattern = quote === '"' ? '[^"<>]*' : "[^'<>]*";
      attributeShapes.push({
        marker: 'data-j6="image"',
        pattern: RegExp.escape(prefix) + attributePattern + RegExp.escape(suffix)
      });
      attributeShapes.push({
        marker: 'data-j6="meta"',
        pattern: '<meta data-j6="meta" name="description" content="[^"<>]*">'
      });
      guard('attribute-unselected', 'src="a-b.png"');
    }
    if (input.math && format === 'mdx') {
      source += `${e}${e}${guard('md-math', '$a - b$')} ${sentence()}`;
    }
    if (format === 'frontmatter') {
      source = `---${e}title: "${g.word()} - ${g.word()}"${e}---${e}${e}${source}`;
    }
    return {
      format,
      config,
      text: g.strip(source),
      protect: ctx.protect,
      attributeShapes,
      expectedProse
    };
  }

  function text(ctx) {
    const paragraphs = [];

    for (let n = int(1, 5); n > 0; n--) {
      const indent = chance(0.15) ? pick(['  ', '\t', '    ', '\u{A0}\u{A0}']) : '';

      paragraphs.push(indent + prose(ctx));
    }

    const lead = chance(0.1) ? pick([' ', '\n', '  \n', '\t']) : '';
    const tail = chance(0.1) ? pick([' ', '\n', '\n\n', ' \t']) : '';
    const join = () =>
      weighted([
        [6, nl(ctx) + nl(ctx)],
        [2, nl(ctx)],
        [1, nl(ctx) + nl(ctx) + nl(ctx)],
        [1, `${nl(ctx)}  ${nl(ctx)}`]
      ]);

    return lead + paragraphs.reduce((all, p) => `${all}${join()}${p}`) + tail;
  }

  function plain(ctx) {
    return `${pick(['если a<b, то "c" - d', '<code>Корвин - принц</code>', 'значение < предел'])}${nl(ctx)}${text(ctx)}`;
  }

  function html(ctx) {
    const tag = (t) =>
      t === '<p>' || t === '</p>' ? t : g.guard(ctx, 'tag', t, { before: OUTSIDE_TAG });
    const blocks = [];

    for (let n = int(1, 5); n > 0; n--) {
      blocks.push(
        weighted([
          [5, () => `${tag('<p>')}${prose(ctx)}${tag('</p>')}`],
          [
            2,
            () => {
              const level = int(1, 6);
              return `${tag(`<h${level}>`)}${line(ctx)}${tag(`</h${level}>`)}`;
            }
          ],
          [
            2,
            () =>
              `${tag('<ul>')}${nl(ctx)}${tag('<li>')}${line(ctx)}${tag('</li>')}${nl(ctx)}${tag('<li>')}${line(ctx)}${tag('</li>')}${nl(ctx)}${tag('</ul>')}`
          ],
          [1, () => `${tag('<blockquote>')}${prose(ctx)}${tag('</blockquote>')}`],
          [
            1,
            () => `${tag('<div class="note">')}${nl(ctx)}${prose(ctx)}${nl(ctx)}${tag('</div>')}`
          ],
          [
            1,
            () =>
              `${tag('<table>')}${tag('<tr>')}${tag('<td>')}${line(ctx)}${tag('</td>')}${tag('</tr>')}${tag('</table>')}`
          ],
          [2, () => prose(ctx)],
          [1, () => g.finish(ctx, g.chunk({ ...ctx, markup: true }))]
        ])()
      );
    }

    const lead = chance(0.2) ? `${tag('<!DOCTYPE html>')}${nl(ctx)}` : '';

    return lead + blocks.join(chance(0.7) ? nl(ctx) + nl(ctx) : nl(ctx));
  }

  function markdownBlocks(ctx) {
    const blocks = [];
    // Indented code is code only after a block that cannot continue into it, and a heading is the
    // one block the check can recognise in front of it.
    let codeMayFollow = false;

    for (let n = int(1, 7); n > 0; n--) {
      const choices = [
        [3, 'heading'],
        [6, 'paragraph'],
        [2, 'list'],
        [1, 'ordered'],
        [1, 'quote'],
        [2, 'fence'],
        [codeMayFollow ? 1 : 0, 'indented'],
        [1, 'definition'],
        [1, 'html'],
        [1, 'table'],
        [1, 'rule'],
        [1, 'comment'],
        [1, 'container'],
        [1, 'math'],
        [1, 'hardbreak']
      ];
      const kind = weighted(choices);
      const e = () => nl(ctx);

      const block = {
        heading: () => `${'#'.repeat(int(1, 6))} ${line(ctx)}`,
        paragraph: () => prose(ctx),
        list: () =>
          [
            `${pick(['-', '*', '+'])} ${line(ctx)}`,
            `${pick(['-', '*'])} ${line(ctx)}`,
            `  - ${line(ctx)}`
          ]
            .slice(0, int(1, 3))
            .join(e()),
        ordered: () => `1. ${line(ctx)}${e()}2${pick(['.', ')'])} ${line(ctx)}`,
        quote: () => `> ${line(ctx)}${e()}> ${chance(0.3) ? '> ' : ''}${line(ctx)}`,
        fence: () => {
          const fence = pick(['```', '~~~', '````']);
          const info = pick(['', 'js', 'text', 'sh', 'python title="a - b"']);
          const body = [g.bait({ ...ctx, lines: false }), g.bait({ ...ctx, lines: false })]
            .slice(0, int(1, 2))
            .join(e());
          return `${e()}${g.guard(ctx, 'md-fence', `${fence}${info}${e()}${body}${e()}${fence}`, { before: AFTER_BLANK })}`;
        },
        indented: () =>
          `${e()}${g.guard(ctx, 'md-indented', `    ${g.bait({ ...ctx, lines: false })}${e()}    ${g.bait({ ...ctx, lines: false })}`, { before: AFTER_HEADING })}`,
        definition: () =>
          `${e()}${g.guard(ctx, 'md-definition', `[${pick(['ref', 'a-b', '1'])}]: ${g.url()}${chance(0.5) ? ` "${g.word()} - ${g.word()}"` : ''}`, { before: AFTER_BLANK })}`,
        html: () => `<div class="x">${e()}${prose({ ...ctx, markdown: false })}${e()}</div>`,
        table: () => {
          const header = `| ${g.word()} | ${g.word()} |${e()}`;
          const delimiter = `|${pick(['-', '--', '---', ':-', ':-:'])}|${pick(['-', '--', '-:', ':-:'])}|`;
          return `${header}${g.guard(ctx, 'md-table-delimiter', delimiter, { before: `(?<=${RegExp.escape(header)})`, after: LINE_END })}${e()}| ${g.finish(ctx, g.chunk(ctx))} | ${g.finish(ctx, g.chunk(ctx))} |`;
        },
        rule: () => pick(['---', '***', '* * *', '___']),
        comment: () => g.guard(ctx, 'comment', `<!-- ${g.word()} - "${g.word()}" -->`),
        container: () => {
          const fence = (source) =>
            g.guard(ctx, 'md-directive', source, { before: OUTSIDE_HTML_BLOCK, after: LINE_END });
          const name = pick([
            'note',
            'warning',
            ' tip Заголовок - "тире"',
            'note{.x title="a - b"}'
          ]);

          return `${fence(`:::${name}`)}${e()}${prose(ctx)}${e()}${fence(pick([':::', '::::']))}`;
        },
        math: () => `$$${e()}a - b = "c"${e()}$$`,
        hardbreak: () => `${line(ctx)}  ${e()}${line(ctx)}`
      }[kind]();

      codeMayFollow = kind === 'heading';
      blocks.push(block);
    }

    return blocks.join(chance(0.85) ? nl(ctx) + nl(ctx) : nl(ctx));
  }

  function markdown(ctx) {
    const header = chance(0.1)
      ? `${g.guard(ctx, 'md-header', `---${nl(ctx)}title: "${g.word()} - ${g.word()}"${nl(ctx)}---`, { before: '^' })}${nl(ctx)}${nl(ctx)}`
      : '';

    // Spaces closing the document are the one place Markdown leaves trailing spaces to the rules.
    ctx.bodyOffset = header.length;
    return header + markdownBlocks(ctx) + (chance(0.05) ? pick(['  ', '   ', ' ']) : '');
  }

  function value(ctx) {
    return weighted([
      [5, () => line(ctx)],
      [3, () => prose(ctx)],
      [1, () => g.finish(ctx, g.chunk(ctx))],
      [1, () => ''],
      [1, () => `  ${line(ctx)} `]
    ])();
  }

  function jsonValue(ctx, depth) {
    return weighted([
      [8, () => value(ctx)],
      [1, () => int(-5, 1000)],
      [1, () => Number(`${int(0, 99)}.${int(1, 99)}`)],
      [1, () => chance(0.5)],
      [1, () => null],
      [depth < 3 ? 2 : 0, () => Array.from({ length: int(0, 3) }, () => jsonValue(ctx, depth + 1))],
      [depth < 3 ? 2 : 0, () => jsonObject(ctx, depth + 1)]
    ])();
  }

  function jsonObject(ctx, depth) {
    const object = {};

    for (let n = int(1, 4); n > 0; n--) {
      object[chance(0.7) ? pick(KEYS) : g.latin()] = jsonValue(ctx, depth);
    }

    return object;
  }

  function json(ctx) {
    let out = JSON.stringify(jsonObject(ctx, 0), null, pick([0, 2, '\t', 4]));

    if (chance(0.3)) {
      out = out.replaceAll(
        /[\u{A0}\u{E000}\u{E001}\u{E100}\u{E101}]/gu,
        (c) => `\\u${c.codePointAt(0).toString(16).padStart(4, '0')}`
      );
    }

    if (chance(0.2)) {
      out = out.replaceAll('/', '\\/');
    }

    return ctx.eol === '\r\n' ? out.replaceAll('\n', '\r\n') : out;
  }

  const yamlScalar = (s) => {
    const clean = s.replaceAll('\\', '/');

    if (YAML_PLAIN_RE.test(clean) && chance(0.5)) {
      try {
        if (parseYaml(`k: ${clean}`)?.k === clean) {
          return clean;
        }
      } catch {
        // Not a plain scalar after all; quoted below.
      }
    }

    if (!clean.includes('\n') && chance(0.3)) {
      return `'${clean.replaceAll("'", "''")}'`;
    }

    return JSON.stringify(clean);
  };

  function yamlBody(ctx, eol) {
    const lines = [];

    for (let n = int(1, 6); n > 0; n--) {
      const key = `${chance(0.7) ? pick(KEYS) : g.latin()}${n}`;

      lines.push(
        weighted([
          [6, () => `${key}: ${yamlScalar(value(ctx))}`],
          [
            2,
            () => {
              const style = pick(['|', '>', '|-', '>-', '|+']);
              const content = Array.from({ length: int(1, 3) }, () => `  ${line(ctx).trimStart()}`);
              return `${key}: ${style}${eol}${content.join(eol)}`;
            }
          ],
          [2, () => `${key}:${eol}  - ${yamlScalar(line(ctx))}${eol}  - ${yamlScalar(line(ctx))}`],
          [1, () => `${key}:${eol}  sub: ${yamlScalar(line(ctx))}${eol}  n: ${int(0, 9)}`],
          [
            1,
            () => `${key}: ${pick(['42', '3.14', 'true', 'null', '2024-01-01', '~', '0x1F', '-7'])}`
          ],
          [1, () => `# ${g.word()} - "${g.word()}"`],
          [1, () => `${key}: [${yamlScalar(g.word())}, ${int(1, 9)}]`]
        ])()
      );
    }

    return lines.join(eol);
  }

  function yaml(ctx) {
    const eol = chance(0.8) ? '\n' : '\r\n';
    const lead = chance(0.15) ? `---${eol}` : '';
    let doc = lead + yamlBody({ ...ctx, eol: ' ' }, eol);

    try {
      parseYaml(doc);
    } catch {
      doc = `title: ${JSON.stringify(line({ ...ctx, eol: ' ' }))}`;
    }

    return doc;
  }

  const tomlString = (s) => {
    const clean = s.replaceAll('\\', '/');

    return weighted([
      [5, () => JSON.stringify(clean)],
      [clean.includes("'") || clean.includes('\n') ? 0 : 2, () => `'${clean}'`],
      [clean.includes('"""') ? 0 : 1, () => `"""${chance(0.5) ? '\n' : ''}${clean}"""`],
      [clean.includes("'''") ? 0 : 1, () => `'''${clean}'''`]
    ])();
  };

  function tomlBody(ctx, eol) {
    const lines = [];
    let tables = 0;

    for (let n = int(1, 6); n > 0; n--) {
      const key = chance(0.7) ? `${pick(KEYS)}${n}` : `${g.latin()}${n}`;

      lines.push(
        weighted([
          [6, () => `${key} = ${tomlString(value(ctx))}`],
          [
            1,
            () =>
              `${key} = ${pick(['42', '3.14', 'true', '1979-05-27T07:32:00Z', '1979-05-27', '-7', '1_000'])}`
          ],
          [1, () => `${key} = [${tomlString(g.word())}, ${tomlString(line(ctx))}]`],
          [1, () => `${key} = { a = ${tomlString(line(ctx))}, n = ${int(1, 9)} }`],
          [1, () => `# ${g.word()} - "${g.word()}"`],
          [1, () => `${eol}[${pick(['section', 'meta', 'texts'])}${(tables += 1)}]`],
          [1, () => `${eol}[[items]]${eol}name = ${tomlString(line(ctx))}`]
        ])()
      );
    }

    return lines.join(eol);
  }

  function toml(ctx) {
    const eol = chance(0.8) ? '\n' : '\r\n';
    let doc = tomlBody({ ...ctx, eol: ' ' }, eol);

    try {
      parseToml(doc);
    } catch {
      doc = `title = ${JSON.stringify(line({ ...ctx, eol: ' ' }))}`;
    }

    return doc;
  }

  function xml(ctx) {
    const tag = (t) => g.guard(ctx, 'tag', t);
    const children = [];

    for (let n = int(1, 5); n > 0; n--) {
      const name = pick(['title', 'p', 'item', 'description', 'note']);

      children.push(
        weighted([
          [5, () => `${tag(`<${name}>`)}${prose(ctx)}${tag(`</${name}>`)}`],
          [
            2,
            () =>
              `${tag(`<${name} type="${esc(`${g.word()} - "${g.word()}"`)}">`)}${line(ctx)}${tag(`</${name}>`)}`
          ],
          [
            1,
            () => {
              const safe = pick(['code', 'math']);
              return g.guard(
                ctx,
                `<${safe}>`,
                `<${safe}>${esc(g.bait({ lines: false }))}</${safe}>`
              );
            }
          ],
          [
            1,
            () =>
              g.guard(
                ctx,
                'xml:space',
                `<pre xml:space="preserve">  ${esc(g.bait({ lines: false }))}  </pre>`
              )
          ],
          [1, () => tag('<br/>')],
          [
            1,
            () =>
              `${tag('<section>')}${nl(ctx)}  ${tag('<p>')}${line(ctx)}${tag('</p>')}${nl(ctx)}${tag('</section>')}`
          ]
        ])()
      );
    }

    const decl = chance(0.8) ? `<?xml version="1.0" encoding="UTF-8"?>${nl(ctx)}` : '';
    const doctype = chance(0.1) ? `<!DOCTYPE doc>${nl(ctx)}` : '';

    return `${decl}${doctype}<doc lang="ru">${nl(ctx)}${children.join(nl(ctx))}${nl(ctx)}</doc>${chance(0.3) ? nl(ctx) : ''}`;
  }

  function frontmatter(ctx) {
    const eol = chance(0.8) ? '\n' : '\r\n';
    const body = markdownBlocks(ctx);
    // The header's values are data: Markdown there is text the scanners may still see, not syntax.
    const header = { ...ctx, eol: ' ', data: true };

    const prefix = weighted([
      [5, () => `---${eol}${yamlBody(header, eol)}${eol}---${eol}${eol.repeat(int(1, 3))}`],
      [2, () => `+++${eol}${tomlBody(header, eol)}${eol}+++${eol}${eol.repeat(int(1, 3))}`],
      [1, () => '']
    ])();
    ctx.bodyOffset = prefix.length;
    return prefix + body;
  }

  const BUILDERS = { text, html, plain, markdown, json, yaml, toml, xml, frontmatter };
  const FLAGS = {
    text: { markup: true },
    html: { markup: true },
    plain: {},
    markdown: { markup: true, markdown: true },
    json: { markup: true },
    yaml: { markup: true },
    toml: { markup: true },
    xml: { xml: true },
    frontmatter: { markup: true, markdown: true }
  };

  return function generate(format) {
    const config = generateConfig(d, format);
    if (
      format === 'mdx' ||
      (['text', 'html', 'markdown', 'frontmatter'].includes(format) && chance(0.2))
    ) {
      return formatsII(format, config);
    }
    const eol = eolFor();
    const structured = ['json', 'yaml', 'toml'].includes(format);
    const flags = { ...FLAGS[format] };

    if (structured && chance(0.5)) {
      flags.markup = false;
    }

    const template = templateOf(config);
    const ctx = g.context({
      ...flags,
      // An ERB tag opens with `<`, which an XML document cannot carry as text.
      template: format === 'xml' && template === 'erb' ? null : template,
      placeholders:
        (typeof config.input === 'object' ? config.input.placeholders : undefined) ?? 'all',
      comments: !structured && format !== 'plain',
      eol: structured ? ' ' : eol,
      // A line break inside a construct would end a Markdown heading, list item or table row.
      lines: format === 'text' || format === 'html' || format === 'plain'
    });
    let source = BUILDERS[format](ctx);
    if (
      (config.input?.pragmas ?? 'microtypo') === 'microtypo' &&
      ['text', 'html', 'markdown', 'frontmatter'].includes(format)
    ) {
      const start = '<!-- microtypo-ignore-start -->';
      const end = chance(0.2) ? '' : '<!-- microtypo-ignore-end -->';
      source += `${nl(ctx)}${g.guard(ctx, 'pragma-region', `${start}${nl(ctx)}Код - "текст"${nl(ctx)}${end}`, { before: OUTSIDE_TAG })}`;
      if (chance(0.15)) {
        // The directive must precede any unclosed code or template body, outside metadata.
        const at = ctx.bodyOffset ?? 0;
        source = g.guard(
          ctx,
          'pragma-file',
          `${source.slice(0, at)}<!-- microtypo-ignore-file -->${nl(ctx)}${source.slice(at)}`
        );
      }
    }
    if (
      ['markdown', 'frontmatter', 'json', 'yaml', 'toml', 'xml'].includes(format) &&
      chance(0.3)
    ) {
      source += (typeof eol === 'function' ? eol() : eol).repeat(int(1, 3));
    }
    return { format, config, text: g.strip(source), protect: ctx.protect };
  };
}
