// Timings here compare only under `pnpm test:perf` on an otherwise idle machine: Node pinned in
// `package.json`, one file at a time, and no other test run, coverage or build beside it. Ratio
// checks hold on any machine; absolute limits were set on an Intel i9-10910 under macOS and are
// smoke limits elsewhere.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MicroTypo } from '../../src/index.js';

// One paragraph of thousands of words with inline markup lifted out of it, at 1x, 2x and 4x, best of
// three at each size. Lifting, placing the markup back and settling the engine's wrappers read the
// paragraph a fixed number of times: 4x the input lands near 4x the time, a pass per tag near 16x.
function assertLinear(name, config, build, n = 2000) {
  const typo = new MicroTypo({ ...config, maxInputLength: 5_000_000 });
  const best = (k) => {
    const text = build(n * k);
    let ms = Infinity;

    for (let i = 0; i < 3; i += 1) {
      const start = performance.now();

      typo.process(text);
      ms = Math.min(ms, performance.now() - start);
    }

    return ms;
  };

  best(1);

  const [one, two, four] = [best(1), best(2), best(4)];

  assert.ok(
    four < one * 8 + 5,
    `${name}: 1x ${one.toFixed(1)}ms, 2x ${two.toFixed(1)}ms, 4x ${four.toFixed(1)}ms (${(four / one).toFixed(1)}x)`
  );
}

const HTML = { input: 'html', html: false };
const WRAPPERS = { input: 'html', html: true };
const MARKDOWN = { input: 'markdown', html: false };

test('each word in a tag of its own', () => {
  assertLinear('words in tags', HTML, (n) => `<p>${'<em>слово</em> в '.repeat(n)}доме</p>`);
  assertLinear(
    'words in tags, wrappers',
    WRAPPERS,
    (n) => `<p>${'<em>слово</em> в '.repeat(n)}доме</p>`
  );
});

test('nested tags, closed and unclosed', () => {
  assertLinear('nested', HTML, (n) => `<p>${'<b>в '.repeat(n)}доме${'</b>'.repeat(n)}</p>`);
  assertLinear('unclosed', HTML, (n) => `<p>${'<b>в '.repeat(n)}доме</p>`);
  assertLinear('unopened', HTML, (n) => `<p>${'в</b> '.repeat(n)}доме</p>`);
  assertLinear(
    'nested around wrappers',
    WRAPPERS,
    (n) => `<p>${'<span>и т.д. '.repeat(n)}${'</span>'.repeat(n)}</p>`
  );
});

test('tags in a row with no text', () => {
  assertLinear('empty tags', HTML, (n) => `<p>в ${'<i></i><b></b>'.repeat(n)} доме</p>`);
  assertLinear(
    'empty tags between words',
    HTML,
    (n) => `<p>${'в <i></i><b></b> доме '.repeat(n)}</p>`
  );
});

test('Markdown of markers alone, and of markers and links around words', () => {
  assertLinear('markers', MARKDOWN, (n) => '*_'.repeat(n), 8000);
  assertLinear('markers around words', MARKDOWN, (n) => '*в* _доме_ [и](/x) **саду** '.repeat(n));
  assertLinear(
    'openers, then closers',
    MARKDOWN,
    (n) => `${'_а в '.repeat(n)}${'а* в '.repeat(n)}`
  );
  assertLinear('unpaired link closers', MARKDOWN, (n) => 'в x](/x) '.repeat(n));
  assertLinear('unclosed brackets', MARKDOWN, (n) => '[в *доме* '.repeat(n));
});

// Each line and each link's text is read to its own end, not to the end of the document.
test('Markdown of many lines, paragraphs, links and code spans', () => {
  assertLinear('paragraphs with emphasis', MARKDOWN, (n) => 'Он в *доме* и саду.\n\n'.repeat(n));
  assertLinear('lines with emphasis', MARKDOWN, (n) => 'Он в *доме*\nи саду\n'.repeat(n));
  assertLinear('links on one line', MARKDOWN, (n) => 'в [доме](/x) и '.repeat(n));
  assertLinear('a link on each line', MARKDOWN, (n) => 'в [доме](/x) и\n'.repeat(n));
  assertLinear('code spans and emphasis', MARKDOWN, (n) => '`к` *в* '.repeat(n));
  assertLinear('nested links', MARKDOWN, (n) => `${'['.repeat(n)}в${'](/x)'.repeat(n)}`);
});

// A closing tag finds the element it ends by its name, past any number of open elements of others.
test('stray closing tags after many unclosed elements', () => {
  assertLinear('stray closers', HTML, (n) => `<p>${'<b>в '.repeat(n)}${'</i> д '.repeat(n)}</p>`);
  assertLinear('stray closers, text', {}, (n) => `${'<b>в '.repeat(n)}${'</i> д '.repeat(n)}`);
  assertLinear(
    'stray closers across paragraphs',
    HTML,
    (n) => `${'<p><b>в</p>'.repeat(n)}${'<p></i> д</p>'.repeat(n)}`
  );
});

// A rule that rewrites a word next to markup runs again with that markup in the text, a fixed number
// of rounds; a wrapper that would cross an element gives way to no-break spaces.
test('a rewrite next to every tag, and a wrapper crossing every element', () => {
  assertLinear('rewrites', HTML, (n) => `<p>${'и <i>т.д.</i> 5 <b>руб.</b> '.repeat(n)}</p>`);
  assertLinear(
    'rewrites, wrappers',
    WRAPPERS,
    (n) => `<p>${'и <i>т.д.</i> "<b>сл</b>" '.repeat(n)}</p>`
  );
  assertLinear('crossing wrappers', WRAPPERS, (n) => `<p>${'<b>Он и</b> т.д. '.repeat(n)}</p>`);
});
