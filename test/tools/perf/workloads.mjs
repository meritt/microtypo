const BASE =
  'Корвин вернулся в Амбер, Рэндом ждал у Лабиринта. 1000 рублей, 31 января 2009 года, 12 - 19. Он сказал: "Грейсвандир готов".';

const ALT =
  'Оберон отправил Бенедикта в Арден, а Фиона оставила знак у Колвира. 15 кг, 7 км, 10:30-12:05. Дворкин ответил: "Путь через Тень открыт".';

function repeatTo(text, target) {
  return text.repeat(Math.ceil(target / text.length)).slice(0, target);
}

function paragraphs(count) {
  return Array.from({ length: count }, (_, i) => (i % 2 === 0 ? BASE : ALT)).join('\n\n');
}

function htmlDocument() {
  const body = paragraphs(18);

  return `<article><h1>Амбер</h1><p>${body}</p><pre>${BASE}</pre><code>${ALT}</code><p>${body}</p></article>`;
}

function placeholderHeavyDocument(count = 2000) {
  return Array.from(
    { length: count },
    (_, i) =>
      `<p>Корвин ${i} - Рэндом</p><pre>Эрик ${i} - Бенедикт</pre> https://amber.example/${i}`
  ).join('\n');
}

function markdownDocument() {
  return `${paragraphs(12)}

\`\`\`
${BASE}
\`\`\`

[путь в Тень](/shadow/${'amber'.repeat(40)})

{{ user.name }}

${ALT}`;
}

function productMarkdownDocument() {
  const body = Array.from({ length: 16 }, (_, i) =>
    i % 2 === 0
      ? `${BASE} Путь: https://amber.example/shadow/${i}.`
      : `${ALT} Козырь указывает на /amber/path-${i}.`
  ).join('\n\n');

  return [
    '# Корвин - принц Амбера',
    '',
    body,
    '',
    '[Козырь в Тень](/shadow/amber-12 "Амбер - Тень")',
    '',
    '```',
    'const path = "Корвин - Эрик"; // 5x5',
    '```',
    '',
    '{{ user.name }}'
  ].join('\n');
}

function productHtmlDocument() {
  const body = Array.from(
    { length: 16 },
    (_, i) => `<p>${i % 2 === 0 ? BASE : ALT} Путь: https://amber.example/shadow/${i}.</p>`
  ).join('\n');

  return [
    '<article>',
    '<h1>Корвин - принц Амбера</h1>',
    body,
    `<pre>${BASE}</pre>`,
    '<code>const path = "Корвин - Эрик"; // 5x5</code>',
    '</article>'
  ].join('\n');
}

function yamlFrontmatterDocument() {
  return [
    '---',
    "title: 'Корвин - принц Амбера'",
    'summary: \'Рэндом сказал: "Грейсвандир - у Бенедикта". 1 250 рублей, 12 - 19.\'',
    '---',
    '',
    productMarkdownDocument()
  ].join('\n');
}

function jsonDocument(count = 120) {
  const items = Array.from({ length: count }, (_, i) => ({
    id: i,
    title: `Корвин ${i} - Рэндом`,
    body: i % 2 === 0 ? BASE : ALT,
    note: `Оберон сказал: "Амбер ждёт ${i}"`
  }));

  return JSON.stringify({ title: BASE, items }, null, 2);
}

const JSON_SELECTOR_MISSES = Array.from({ length: 45 }, (_, i) =>
  i % 2 === 0 ? `items.*.shadow${i}` : `/items/*/shadow${i}`
);
const JSON_SELECTOR_EXCLUDE_MISSES = Array.from({ length: 20 }, (_, i) =>
  i % 2 === 0 ? `items.${i}.shadow` : `/items/${i}/shadow`
);

function yamlDocument(count = 80) {
  const lines = ['items:'];

  for (let i = 0; i < count; i += 1) {
    lines.push(`  - title: 'Корвин ${i} - Рэндом'`);
    lines.push(`    body: '${i % 2 === 0 ? BASE : ALT}'`);
  }

  return lines.join('\n');
}

function tomlDocument(count = 80) {
  const chunks = [];

  for (let i = 0; i < count; i += 1) {
    chunks.push(`[[items]]\ntitle = 'Корвин ${i} - Рэндом'\nbody = '${i % 2 === 0 ? BASE : ALT}'`);
  }

  return chunks.join('\n\n');
}

function xmlDocument(count = 90) {
  const items = Array.from(
    { length: count },
    (_, i) =>
      `<item><title>Корвин ${i} - Рэндом</title><body>${i % 2 === 0 ? BASE : ALT}</body><code xml:space="preserve">${BASE}</code></item>`
  );

  return `<root>${items.join('')}</root>`;
}

export const WORKLOADS = Object.freeze([
  {
    name: 'text-short',
    kind: 'text',
    priority: 'P0',
    scenario: 'single short plain-text call',
    tags: ['text', 'short', 'functional'],
    text: BASE,
    config: {}
  },
  {
    name: 'text-medium',
    kind: 'text',
    priority: 'P0',
    scenario: 'medium prose on reused instance',
    tags: ['text', 'prose', 'reused'],
    text: paragraphs(24),
    config: {}
  },
  {
    name: 'text-near-cap',
    kind: 'text',
    priority: 'P3',
    scenario: 'near default maxInputLength prose',
    tags: ['text', 'near-cap', 'security-budget'],
    text: repeatTo(`${BASE}\n\n${ALT}\n\n`, 29_000),
    config: {}
  },
  {
    name: 'html-medium',
    kind: 'html',
    priority: 'P1',
    scenario: 'article HTML with generated markup',
    tags: ['html', 'article', 'tags'],
    text: htmlDocument(),
    config: { html: true, input: 'html' }
  },
  {
    name: 'placeholder-heavy',
    kind: 'html',
    priority: 'P3',
    scenario: 'large HTML with many safe blocks and URLs',
    tags: ['html', 'safe-blocks', 'urls', 'large'],
    text: placeholderHeavyDocument(),
    config: { html: true, input: 'html', maxInputLength: 5_000_000 }
  },
  {
    name: 'markdown-template',
    kind: 'markdown',
    priority: 'P1',
    scenario: 'Markdown article with fences links and template span',
    tags: ['markdown', 'fences', 'links', 'template'],
    text: markdownDocument(),
    config: { html: true, input: { format: 'markdown', template: 'handlebars' } }
  },
  {
    name: 'markdown-prose-original',
    kind: 'markdown',
    priority: 'P1',
    scenario: 'Markdown publishing prose preserving original format',
    tags: ['markdown', 'publishing', 'original-format'],
    text: productMarkdownDocument(),
    config: {
      input: { format: 'markdown', template: 'handlebars' },
      maxInputLength: 500_000,
      maxProcessingMs: 0
    }
  },
  {
    name: 'markdown-prose-html',
    kind: 'markdown',
    priority: 'P1',
    scenario: 'Markdown publishing prose with generated HTML output',
    tags: ['markdown', 'publishing', 'html-output'],
    text: productMarkdownDocument(),
    config: {
      html: true,
      input: { format: 'markdown', template: 'handlebars' },
      render: { paragraphs: true, breakline: true, autolink: true },
      maxInputLength: 500_000,
      maxProcessingMs: 0
    }
  },
  {
    name: 'html-article-original',
    kind: 'html',
    priority: 'P1',
    scenario: 'HTML article preserving original format',
    tags: ['html', 'publishing', 'original-format'],
    text: productHtmlDocument(),
    config: { input: 'html', maxInputLength: 500_000, maxProcessingMs: 0 }
  },
  {
    name: 'html-article-rendered',
    kind: 'html',
    priority: 'P1',
    scenario: 'HTML article with generated HTML output',
    tags: ['html', 'publishing', 'html-output'],
    text: productHtmlDocument(),
    config: {
      html: true,
      input: 'html',
      render: { paragraphs: true, breakline: true, autolink: true },
      maxInputLength: 500_000,
      maxProcessingMs: 0
    }
  },
  {
    name: 'json-many-values',
    kind: 'json',
    priority: 'P2',
    scenario: 'JSON document with selected values',
    tags: ['json', 'structured', 'selected-values'],
    text: jsonDocument(),
    config: {
      input: { format: 'json', fields: ['/title', '/items/*/body', '/items/*/note'] },
      maxInputLength: 5_000_000
    }
  },
  {
    name: 'json-selector-heavy',
    kind: 'json',
    priority: 'P2',
    scenario: 'JSON document with many selectors',
    tags: ['json', 'structured', 'selectors'],
    text: jsonDocument(180),
    config: {
      input: {
        format: 'json',
        fields: [...JSON_SELECTOR_MISSES, 'items.*.title', 'items.*.body', '/items/*/note'],
        exclude: [...JSON_SELECTOR_EXCLUDE_MISSES, 'items.17.body', '/items/23/note']
      },
      maxInputLength: 5_000_000
    }
  },
  {
    name: 'yaml-many-values',
    kind: 'yaml',
    priority: 'P2',
    scenario: 'YAML document with selected values',
    tags: ['yaml', 'structured', 'selected-values'],
    text: yamlDocument(),
    config: {
      input: { format: 'yaml', fields: ['/items/*/body', '/items/*/title'] },
      maxInputLength: 5_000_000
    }
  },
  {
    name: 'toml-many-values',
    kind: 'toml',
    priority: 'P2',
    scenario: 'TOML document with selected values',
    tags: ['toml', 'structured', 'selected-values'],
    text: tomlDocument(),
    config: {
      input: { format: 'toml', fields: ['/items/*/body', '/items/*/title'] },
      maxInputLength: 5_000_000
    }
  },
  {
    name: 'yaml-frontmatter-original',
    kind: 'frontmatter',
    priority: 'P2',
    scenario: 'YAML frontmatter with Markdown body preserving original format',
    tags: ['frontmatter', 'yaml', 'markdown', 'original-format'],
    text: yamlFrontmatterDocument(),
    config: {
      input: { format: 'frontmatter', fields: ['/title', '/summary'] },
      maxInputLength: 500_000,
      maxProcessingMs: 0
    }
  },
  {
    name: 'xml-preserve',
    kind: 'xml',
    priority: 'P4',
    scenario: 'XML with preserve subtrees',
    tags: ['xml', 'preserve', 'scanner'],
    text: xmlDocument(),
    config: { input: 'xml', maxInputLength: 5_000_000 }
  },
  {
    name: 'xml-preserve-rendered',
    kind: 'xml',
    priority: 'P4',
    scenario: 'XML with preserve subtrees and XML entity output',
    tags: ['xml', 'preserve', 'entities'],
    text: xmlDocument(),
    config: { entities: true, input: 'xml', maxInputLength: 5_000_000 }
  }
]);
