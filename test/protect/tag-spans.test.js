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

// HTML ignores the slash on a non-void start tag, so `<script/>` opens raw text like `<script>`.
test('a raw-text opener ending in a slash still opens raw text', () => {
  const src = '<script/><x title="</script><code>x</code>';
  assert.deepEqual(
    tagSpans(src, RAW).map(([s]) => s),
    [0, src.indexOf('</script>'), src.indexOf('<code>'), src.indexOf('</code>')]
  );
});

test('a slash after the raw-text name does not open raw text for a longer name', () => {
  const src = '<scripts/><x title="</script><code>x</code>';
  assert.deepEqual(
    tagSpans(src, RAW).map(([s]) => s),
    [0, src.indexOf('<x ')]
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

const opensNothing = (src) => tagSpans(src, RAW).map(([s, , empty]) => [s, empty === true]);

test('a self-closing raw-text opener inside SVG opens nothing and reads on as markup', () => {
  const src = '<svg><script/></svg><x title="</script><code>x</code>';
  assert.deepEqual(opensNothing(src), [
    [0, false],
    [5, true],
    [14, false],
    [20, false]
  ]);
});

test('HTML in foreignObject and a breakout tag ignore the slash again', () => {
  const src = '<svg><foreignObject><script/></foreignObject><p/><style/></svg>';
  assert.deepEqual(opensNothing(src), [
    [0, false],
    [5, false],
    [src.indexOf('<script/>'), false],
    [src.indexOf('</foreignObject>'), false],
    [src.indexOf('<p/>'), false],
    [src.indexOf('<style/>'), false],
    [src.indexOf('</svg>'), false]
  ]);
});

// In SVG and MathML a CDATA section is text to its `]]>`; elsewhere `<![CDATA[` opens a bogus
// comment that ends at the first `>`.
test('a CDATA section inside SVG is one span, and SVG ends at its own end tag', () => {
  const cdata = `<![CDATA[x > <svg> " </svg> <math> ' >]]>`;
  const src = `<svg>${cdata}</svg><script/><x title="</script>`;
  assert.deepEqual(
    tagSpans(src, RAW).map(([s, e, empty]) => [src.slice(s, e + 1), empty === true]),
    [
      ['<svg>', false],
      [cdata, false],
      ['</svg>', false],
      ['<script/>', false],
      ['</script>', false]
    ]
  );
});

// The current node of foreignObject is an SVG element, so CDATA is text there as well.
test('a CDATA section inside MathML or foreignObject is one span too', () => {
  for (const src of [
    '<math><![CDATA[> <math>]]></math><script/>',
    '<svg><foreignObject><![CDATA[> </foreignObject>]]><script/>'
  ]) {
    assert.deepEqual(opensNothing(src).at(-1), [src.indexOf('<script/>'), false], src);
  }
});

test('an unclosed CDATA section inside SVG runs to the end of the document', () => {
  const src = '<svg><![CDATA[x > <script/>';
  assert.deepEqual(
    tagSpans(src, RAW).map(([s, e]) => [s, e]),
    [
      [0, 4],
      [5, src.length]
    ]
  );
});

test('outside SVG a CDATA opener ends at the first > and the tags after it count', () => {
  const src = '<![CDATA[x><svg>]]><script/></svg>';
  assert.deepEqual(opensNothing(src), [
    [0, false],
    [src.indexOf('<svg>'), false],
    [src.indexOf('<script/>'), true],
    [src.indexOf('</svg>'), false]
  ]);
});

// A browser ignores the end tag of an integration point while an HTML element opened inside it is
// still open, so the content after it is HTML.
test('an end tag of foreignObject with an HTML element open inside it does not leave HTML', () => {
  for (const inside of ['<div>', '<p>x', '<span>', '<b>', '<li>', '<table><tr><td>', '<p/>']) {
    const src = `<svg><foreignObject>${inside}</foreignObject><script/></svg>`;
    assert.deepEqual(opensNothing(src).at(-2), [src.indexOf('<script/>'), false], src);
  }
});

test('HTML closed inside foreignObject, with end tags or without, leaves it on its end tag', () => {
  for (const inside of [
    '<div><p>x</p></div>',
    '<p>a<p>b</p>',
    '<p>a<div>b</div>',
    '<div><p>a</div>',
    '<ul><li>a<li>b</ul>',
    '<dl><dt>a<dd>b<dt>c</dl>',
    '<table><tr><td>a<td>b<tr><th>c</table>',
    '<select><option>a<option>b</select>',
    '<ruby>a<rt>b</ruby>',
    '<br><img src=x><hr><input>',
    '<DIV>x</div>',
    '<div/></div>'
  ]) {
    const src = `<svg><foreignObject>${inside}</foreignObject><script/></svg>`;
    assert.deepEqual(opensNothing(src).at(-2), [src.indexOf('<script/>'), true], src);
  }
});

// The inner `<foreignObject>` is an HTML element of that name, closed by the first end tag.
test('an HTML element named like an integration point closes before the SVG one', () => {
  const src = '<svg><foreignObject><foreignObject></foreignObject></foreignObject><script/></svg>';
  assert.deepEqual(opensNothing(src).at(-2), [src.indexOf('<script/>'), true]);
});

// The search for the element an end tag closes is bounded; past the bound the tag settles on HTML.
test('an end tag whose element lies beyond the search bound leaves the slash to HTML', () => {
  const cases = [
    (k) => `<svg><g>${'<a>'.repeat(k)}</g><script/>`,
    (k) => `<svg><foreignObject><div>${'<rt>'.repeat(k)}</div></foreignObject><script/>`
  ];

  for (const build of cases) {
    assert.equal(opensNothing(build(10)).at(-1)[1], true, build(1));
    assert.equal(opensNothing(build(100)).at(-1)[1], false, build(1));
  }
});

test('an end tag does not close an SVG element across an HTML element open above it', () => {
  const src = '<svg><foreignObject><div><svg></foreignObject></svg><script/></div>';
  assert.deepEqual(opensNothing(src).at(-2), [src.indexOf('<script/>'), false]);
});

test('an SVG opened inside HTML in foreignObject reads its own slash tags as empty', () => {
  const src = '<svg><foreignObject><div><svg><script/></svg><script/></div></foreignObject></svg>';
  const scripts = opensNothing(src).filter(([s]) => src.startsWith('<script/>', s));
  assert.deepEqual(
    scripts.map(([, empty]) => empty),
    [true, false]
  );
});

test('with no raw-text set every element is read as ordinary markup', () => {
  const src = '<script><i>x</i></script>';
  assert.deepEqual(
    tagSpans(src).map(([s]) => s),
    [0, src.indexOf('<i>'), src.indexOf('</i>'), src.indexOf('</script>')]
  );
});
