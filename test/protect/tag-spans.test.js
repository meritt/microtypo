import assert from 'node:assert/strict';
import { test } from 'node:test';

import { tagSpans } from '../../src/protect/tag-spans.js';

test('each span runs from < to its terminating >', () => {
  const src = '<a>Корвин</a>';
  assert.deepEqual(
    tagSpans(src).map(([s, e]) => src.slice(s, e + 1)),
    ['<a>', '</a>']
  );
});

test('a > inside a quoted attribute does not end the span early', () => {
  const src = '<code title="Амбер > Тень">Корвин</code>';
  const [open] = tagSpans(src);
  assert.equal(src.slice(open[0], open[1] + 1), '<code title="Амбер > Тень">');
});

test('a nested tag inside a quoted attribute is not its own span', () => {
  const src = '<a title="<code>">Корвин</a>';
  assert.deepEqual(
    tagSpans(src).map(([s]) => s),
    [0, src.indexOf('</a>')]
  );
});

const RAW = new Set(['script', 'style', 'textarea']);

test('a quote inside raw text does not carry attribute state past the end tag', () => {
  const src = '<script><x title="</script><code>Корвин</code>';
  assert.deepEqual(
    tagSpans(src, RAW).map(([s]) => s),
    [0, src.indexOf('</script>'), src.indexOf('<code>'), src.indexOf('</code>')]
  );
});

test('raw text is matched case-insensitively and only up to its own end tag', () => {
  const src = '<STYLE>a { content: "<b>" }</STYLE><i>x</i>';
  assert.deepEqual(
    tagSpans(src, RAW).map(([s]) => s),
    [0, src.indexOf('</STYLE>'), src.indexOf('<i>'), src.indexOf('</i>')]
  );
});

test('an unclosed raw-text opener leaves the rest of the document readable as markup', () => {
  const src = '<script>const a = 1;<code>x</code>';
  assert.deepEqual(
    tagSpans(src, RAW).map(([s]) => s),
    [0, src.indexOf('<code>'), src.indexOf('</code>')]
  );
});

test('a self-closing raw-text tag is not an opener, so it opens no raw text', () => {
  const src = '<script/><code>x</code>';
  assert.deepEqual(
    tagSpans(src, RAW).map(([s]) => s),
    [0, src.indexOf('<code>'), src.indexOf('</code>')]
  );
});

// The scan remembers the names it has already failed to find a closer for. What it must not do is
// answer for a different name, or carry the answer into another document.
test('a name with no closer does not answer for a name that has one', () => {
  const src = '<script>a<style>b</style>c';
  assert.deepEqual(
    tagSpans(src, RAW).map(([s]) => s),
    [0, src.indexOf('<style>'), src.indexOf('</style>')]
  );
});

test('the same unclosed name still opens raw text in the next document', () => {
  const first = '<script>Корвин';
  const second = '<script>Корвин</script><i>x</i>';

  assert.deepEqual(
    tagSpans(first, RAW).map(([s]) => s),
    [0]
  );
  assert.deepEqual(
    tagSpans(second, RAW).map(([s]) => s),
    [0, second.indexOf('</script>'), second.indexOf('<i>'), second.indexOf('</i>')]
  );
});

test('a later opener of an unclosed name is still ordinary markup', () => {
  const src = '<script>a<script>b<code>c</code>';
  assert.deepEqual(
    tagSpans(src, RAW).map(([s]) => s),
    [0, src.indexOf('<script>', 1), src.indexOf('<code>'), src.indexOf('</code>')]
  );
});

test('with no raw-text set every element is read as ordinary markup', () => {
  const src = '<script><i>x</i></script>';
  assert.deepEqual(
    tagSpans(src).map(([s]) => s),
    [0, src.indexOf('<i>'), src.indexOf('</i>'), src.indexOf('</script>')]
  );
});
