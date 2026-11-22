import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MicroTypo } from '../../src/index.js';
import {
  scanFences,
  scanIndentedCode,
  scanReferenceDefinitions,
  scanLinkDestinations,
  scanUnclosedHtmlBlock
} from '../../src/input/markdown.js';
import { templateScanner } from '../../src/input/template.js';
import { scanToml } from '../../src/input/toml.js';
import { scanYaml } from '../../src/input/yaml.js';
import { tagSpans } from '../../src/protect/tag-spans.js';

test('paragraph gaps after author inline closures grow linearly', (t) => {
  const typo = new MicroTypo({
    html: true,
    presets: false,
    rules: { 'text.*': true },
    maxInputLength: 1_000_000,
    maxProcessingMs: 0
  });
  const unit = '<span>начало<p>абзац</p>конец</span>\n\nдалее\n\n';
  const times = [250, 500, 1000].map((n) => {
    const source = unit.repeat(n);
    let best = Infinity;
    for (let run = 0; run < 3; run += 1) {
      const start = performance.now();
      const output = typo.process(source);
      best = Math.min(best, performance.now() - start);
      assert.ok(!output.includes('<br>'));
    }
    return best;
  });
  t.diagnostic(`N / 2N / 4N: ${times.map((ms) => ms.toFixed(2)).join(' / ')} ms`);
  assert.ok(times[2] < times[0] * 8 + 10);
});

for (const [name, scan, build] of [
  [
    'kind-6 paragraph boundaries',
    scanIndentedCode,
    (n) => '> Проза\n<search>\n    Корвин\n\n'.repeat(n)
  ],
  ['self-closing pre blocks', scanFences, (n) => '<pre/>\n```\nКорвин\n\n'.repeat(n)],
  [
    'raw blocks across containers',
    scanUnclosedHtmlBlock,
    (n) => '> > - <pre>\n\nКорвин\n</pre>\n'.repeat(n)
  ],
  ['unclosed declarations', tagSpans, (n) => '<? "'.repeat(n)],
  ['unclosed bang declarations', tagSpans, (n) => '<! '.repeat(n)],
  [
    'malformed tags before paragraph blocks',
    scanUnclosedHtmlBlock,
    (n) => '> На <<n".\n\n<p>Первая\nВторая</p>\n\n'.repeat(n)
  ],
  [
    'literal comment boundaries',
    scanUnclosedHtmlBlock,
    (n) => 'проза <!--\n\n<pre>код</pre>\n-->\n'.repeat(n)
  ],
  [
    'raw xmp openers',
    (source) => tagSpans(source, new Set(['xmp', 'noembed', 'title'])),
    (n) => '<xmp><noembed><title>'.repeat(n)
  ],
  ['long definitions', scanReferenceDefinitions, (n) => `[${'я'.repeat(n)} - да]: /url\n\n`],
  [
    'XML template ownership',
    (source) =>
      new MicroTypo({
        input: { format: 'xml', template: 'liquid' },
        presets: false,
        maxInputLength: 5_000_000,
        maxProcessingMs: 0
      }).process(source),
    (n) => `<root>${'<x xml:space="preserve">{% raw %}</x> текст {% endraw %}'.repeat(n)}</root>`
  ],
  [
    'paragraph content indents',
    (source) =>
      new MicroTypo({
        html: true,
        presets: false,
        rules: { 'text.*': true },
        maxInputLength: 1_000_000,
        maxProcessingMs: 0
      }).process(source),
    (n) => `<p>${' '.repeat(n)}Строка</p>`
  ],
  [
    'HTML template ownership',
    (source) =>
      new MicroTypo({
        input: { template: 'liquid' },
        presets: false,
        maxInputLength: 5_000_000,
        maxProcessingMs: 0
      }).process(source),
    (n) => '<code>{% raw %}</code> текст {% endraw %}\n'.repeat(n)
  ],
  ['unclosed Liquid raw bodies', templateScanner('liquid'), (n) => '{% raw %}'.repeat(n)],
  [
    'closed Liquid comment bodies',
    templateScanner('liquid'),
    (n) => '{% comment %}код - "да"{% endcomment %}'.repeat(n)
  ],
  [
    'Handlebars raw bodies',
    templateScanner('handlebars'),
    (n) => '{{{{raw}}}}код - "да"{{{{/raw}}}}'.repeat(n)
  ],
  ['long second labels', scanLinkDestinations, (n) => `[текст][${'я'.repeat(n)} - да]`],
  ['TOML CRLF lines', scanToml, (n) => '# заголовок\r\n'.repeat(n)],
  [
    'document-local YAML tags',
    scanYaml,
    (n) => '%TAG !e! tag:yaml.org,2002:\n---\n{ !e!str x: текст }\n'.repeat(n)
  ],
  ['empty YAML keys', scanYaml, (n) => `[${'? : текст,'.repeat(n)}]`],
  [
    'multiline label spaces',
    scanReferenceDefinitions,
    (n) => `[Корвин\n${' '.repeat(n)}принц]: /url`
  ]
]) {
  test(`${name} grows linearly`, (t) => {
    const times = [4000, 8000, 16000].map((n) => {
      const source = build(n);
      let best = Infinity;
      for (let sample = 0; sample < 3; sample += 1) {
        const start = performance.now();
        scan(source);
        best = Math.min(best, performance.now() - start);
      }
      return best;
    });
    t.diagnostic(`N / 2N / 4N: ${times.map((ms) => ms.toFixed(2)).join(' / ')} ms`);
    assert.ok(times[2] < times[0] * 8 + 10);
  });
}
