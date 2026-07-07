import assert from 'node:assert/strict';
import { test } from 'node:test';

import { microtypo } from '../../src/index.js';

const opts = { render: { paragraphs: false }, rules: { 'hanging.*': false } };

test('attributed notg yields a balanced start/end pair', () => {
  const out = microtypo('<notg class=amber>"Корвин" - Эрик</notg>', { html: true, ...opts });
  assert.ok(out.includes('_notg_start') && out.includes('_notg_end'), out);
  assert.ok(!out.includes('<notg'), out);
});

test('inner content is not typeset', () => {
  const out = microtypo('<notg>"Корвин" - Эрик</notg>', { html: true, ...opts });
  assert.ok(out.includes('"Корвин" - Эрик'), out);
});

test('literal notg inside code is preserved', () => {
  assert.equal(
    microtypo('<code><notg>Грейсвандир</notg></code>', opts),
    '<code><notg>Грейсвандир</notg></code>'
  );
});

test('literal notg inside script is preserved', () => {
  assert.equal(
    microtypo('<script>const blade = "<notg>";</script>', opts),
    '<script>const blade = "<notg>";</script>'
  );
});

test('plain notg converts to marker spans', () => {
  const out = microtypo('<notg>Корвин</notg>', { html: true, ...opts });
  assert.ok(out.includes('_notg_start') && out.includes('_notg_end'), out);
});

test('reprocessing notg markers is idempotent', () => {
  const once = microtypo('<notg>"Корвин" - Эрик</notg>', { html: true, ...opts });
  const twice = microtypo(once, { html: true, ...opts });
  assert.equal(twice, once, `once:  ${once}\ntwice: ${twice}`);
});

test('notg inside a tag attribute is not converted', () => {
  const src = '<a title="<notg>Корвин</notg>">Амбер</a>';
  assert.equal(microtypo(src, { render: { paragraphs: false } }), src);
});
