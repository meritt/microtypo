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
