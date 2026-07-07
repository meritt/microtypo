import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { clearSpecialChars } from '../../src/clear-special.js';
import { microtypo, MicroTypo } from '../../src/index.js';
import { unicodeToEntities } from '../../src/lib/glyphs.js';

const PARAMS = { render: { paragraphs: false }, rules: { 'hanging.*': false } };
const NBSP = '\u{00A0}';

describe('entity decode and round-trip', () => {
  test('single-encoded entities decode to their glyph', () => {
    assert.equal(microtypo('&trade;', { html: true, entities: false }), '<p>™</p>');
    assert.equal(microtypo('&copy;', { html: true, entities: false }), '<p>©</p>');
    assert.equal(microtypo('&reg;', { html: true, entities: false }), '<p>®</p>');
  });

  // &amp; is intentionally absent from the decode table, so it round-trips instead of collapsing to a bare &.
  test('&amp; and &#38; are preserved verbatim, never decoded to a bare &', () => {
    assert.equal(clearSpecialChars('&amp;'), '&amp;');
    assert.equal(clearSpecialChars('&#38;'), '&#38;');
  });

  test('&amp;copy; stays escaped through the pipeline, not decoded to &copy;', () => {
    assert.equal(
      microtypo('&amp;copy;', { input: { format: 'html' }, entities: true }),
      '&amp;copy;'
    );
  });

  test('ampersand-joined text keeps &amp;', () => {
    assert.equal(
      microtypo('Корвин &amp; Эрик', { html: true, render: { paragraphs: false } }),
      'Корвин &amp; Эрик'
    );
  });

  test('double-encoded entity is never decoded, stays literal', () => {
    assert.equal(clearSpecialChars('&amp;trade;'), '&amp;trade;');
    assert.equal(clearSpecialChars('&amp;reg;'), '&amp;reg;');
    assert.equal(clearSpecialChars('&amp;copy;'), '&amp;copy;');
  });

  test('double-encoded entity is identical literal in both output modes', () => {
    assert.equal(microtypo('&amp;trade;', { html: true, entities: false }), '<p>&amp;trade;</p>');
    assert.equal(microtypo('&amp;trade;', { html: true, entities: true }), '<p>&amp;trade;</p>');
  });

  test('&#769; decodes to the combining acute accent, not a backtick', () => {
    const out = clearSpecialChars('Корви&#769;н');
    assert.ok(!out.includes('`'), `backtick leaked: ${out}`);
    assert.ok(out.includes('́'), `combining acute missing: ${JSON.stringify(out)}`);
  });

  test('combining acute round-trips through the entity form', () => {
    const decoded = clearSpecialChars('Корви&#769;н');
    assert.equal(unicodeToEntities(decoded), 'Корви&#769;н');
  });
});

describe('author space preservation', () => {
  test('author &nbsp; round-trips to real NBSP (U+00A0), not plain space', () => {
    const out = microtypo('a&nbsp;b', PARAMS);
    assert.ok(out.includes(NBSP), `Expected U+00A0 in output. Got: ${JSON.stringify(out)}`);
    assert.equal(out.codePointAt(1), 0x00a0, `Got: ${JSON.stringify(out)}`);
  });

  test('author &#160; round-trips to real NBSP (U+00A0), not plain space', () => {
    const out = microtypo('a&#160;b', PARAMS);
    assert.ok(out.includes(NBSP), `Expected U+00A0 in output. Got: ${JSON.stringify(out)}`);
    assert.equal(out.codePointAt(1), 0x00a0, `Got: ${JSON.stringify(out)}`);
  });

  test('author raw U+00A0 NBSP survives normalisation unchanged', () => {
    const out = microtypo(`a${NBSP}b`, PARAMS);
    assert.equal(out.codePointAt(1), 0x00a0, `Got: ${JSON.stringify(out)}`);
  });

  test('author &thinsp; round-trips to real thin space (U+2009), not plain space', () => {
    const out = microtypo('a&thinsp;b', PARAMS);
    assert.equal(out.codePointAt(1), 0x2009, `Got: ${JSON.stringify(out)}`);
  });

  test('author U+2002 (en space) collapses to a canonical Unicode glyph, not ASCII space', () => {
    const out = microtypo('a\u{2002}b', PARAMS);
    assert.notEqual(out.codePointAt(1), 0x20, `Got: ${JSON.stringify(out)}`);
  });

  test('MicroTypo class preserves author &nbsp; as U+00A0', () => {
    const typo = new MicroTypo(PARAMS);
    const out = typo.process('До&nbsp;Амбера');
    const idx = out.indexOf('Амбера');
    assert.equal(out.codePointAt(idx - 1), 0x00a0, `Got: ${JSON.stringify(out)}`);
  });

  test('entity mode: author &nbsp; round-trips once, not lost, not doubled', () => {
    const typo = new MicroTypo({ ...PARAMS, entities: true });
    const out = typo.process('a&nbsp;b');
    assert.ok(out.includes('&nbsp;'), `Got: ${JSON.stringify(out)}`);
    assert.equal((out.match(/&nbsp;/g) ?? []).length, 1, `Got: ${JSON.stringify(out)}`);
  });

  test('engine-inserted NBSP before a unit still works', () => {
    const typo = new MicroTypo({ ...PARAMS, entities: true });
    assert.ok(typo.process('7 ГБ Козырей').includes('7&nbsp;ГБ'));
  });
});

describe('protected regions', () => {
  test('glyphs inside <script> survive entity mode byte-for-byte', () => {
    const src = '<script>re=/«Козырь»/;s="Корвин — Эрик"</script>';
    assert.equal(microtypo(src, { input: { format: 'html' }, entities: true }), src);
  });

  test('entity mode does not rewrite protected tag attributes', () => {
    const out = microtypo('<a title="— «Амбер»">Корвин - Эрик</a>', {
      entities: true,
      render: { paragraphs: false }
    });
    assert.ok(out.includes('title="— «Амбер»"'), out);
  });
});
