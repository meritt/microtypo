import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { microtypo, MicroTypo } from '../../src/index.js';

const PARAMS = { render: { paragraphs: false }, rules: { 'hanging.*': false } };

describe('defaults', () => {
  test('default output is unicode', () => {
    const out = microtypo('"Корвин" — принц', PARAMS);
    assert.ok(out.includes('«Корвин»'), `Got: ${out}`);
    assert.ok(out.includes('—'), `Got: ${out}`);
    assert.ok(!out.includes('&laquo;'));
    assert.ok(!out.includes('&mdash;'));
  });

  test('default output uses raw NBSP (U+00A0) not &nbsp;', () => {
    const out = microtypo('Отряд шёл до Амбера', PARAMS);
    assert.ok(out.includes('до\u{00A0}'), `Got: ${out}`);
    assert.ok(!out.includes('&nbsp;'));
  });

  test('explicit entities:false matches the default', () => {
    const typo = new MicroTypo({ ...PARAMS, entities: false });
    assert.equal(typo.process('"Corwin"'), '«Corwin»');
  });
});

describe('entity mode', () => {
  test('entities:true produces &laquo;/&raquo;/&mdash;', () => {
    const typo = new MicroTypo({ ...PARAMS, entities: true });
    const out = typo.process('"Корвин" — принц');
    assert.ok(out.includes('&laquo;Корвин&raquo;'), `Got: ${out}`);
    assert.ok(out.includes('&mdash;'), `Got: ${out}`);
    assert.ok(!out.includes('«'));
    assert.ok(!out.includes('»'));
  });

  test('entities:true produces &nbsp;', () => {
    const typo = new MicroTypo({ ...PARAMS, entities: true });
    const out = typo.process('Отряд шёл до Амбера');
    assert.ok(out.includes('до&nbsp;'), `Got: ${out}`);
  });

  test('entities:true converts the full glyph sweep', () => {
    const typo = new MicroTypo({ ...PARAMS, entities: true });
    assert.equal(typo.process('Корвин...'), 'Корвин&hellip;');
    assert.equal(typo.process('Амбер — истина'), 'Амбер&nbsp;&mdash; истина');
  });
});

test('bogus entities string throws a config error', () => {
  assert.throws(() => new MicroTypo({ entities: 'bogus' }), {
    code: 'ERR_MICROTYPO_CONFIG'
  });

  assert.throws(() => new MicroTypo({ entities: 'mixed' }), {
    code: 'ERR_MICROTYPO_CONFIG'
  });
});

describe('input-form symmetry', () => {
  test('entity input normalises like unicode and ascii quotes', () => {
    const a = microtypo('&laquo;Амбер&raquo;', PARAMS);
    const b = microtypo('«Амбер»', PARAMS);
    const c = microtypo('"Амбер"', PARAMS);
    assert.equal(a, b);
    assert.equal(b, c);
  });

  test('em-dash entity, ascii hyphen and unicode normalise alike', () => {
    const a = microtypo('Корвин - истина', PARAMS);
    const b = microtypo('Корвин — истина', PARAMS);
    const c = microtypo('Корвин &mdash; истина', PARAMS);
    assert.equal(a, b);
    assert.equal(b, c);
  });
});

describe('idempotency', () => {
  test('process twice equals once — unicode mode', () => {
    const text = '"Амбер" — истина 1000.';
    const once = microtypo(text, PARAMS);
    const twice = microtypo(once, PARAMS);
    assert.equal(twice, once, `\nonce:  ${once}\ntwice: ${twice}`);
  });

  test('process twice equals once — entity mode', () => {
    const text = '"Амбер" — истина 1000.';
    const typo = new MicroTypo({ ...PARAMS, entities: true });
    const once = typo.process(text);
    const twice = typo.process(once);
    assert.equal(twice, once);
  });
});

test('output mode is fixed per instance', () => {
  // entities is a constructor option, so two modes need two instances.
  const u = new MicroTypo({ ...PARAMS, entities: false });
  const e = new MicroTypo({ ...PARAMS, entities: true });
  assert.notEqual(u.process('"Corwin"'), e.process('"Corwin"'));
});

test('entity output equals post-converted unicode output', async () => {
  const { unicodeToEntities } = await import('../../src/lib/glyphs.js');
  const text = 'Вот «Козырь» — с меткой 1000.';
  const u = microtypo(text, PARAMS);
  const e = new MicroTypo({ ...PARAMS, entities: true }).process(text);
  assert.equal(unicodeToEntities(u), e);
});

test('hanging spans keep unicode glyphs in unicode mode', () => {
  const typo = new MicroTypo({ html: true, rules: { 'hanging.*': true } });
  const out = typo.process('Взгляни «Амбер» рядом');
  assert.ok(out.includes('»'), `Got: ${out}`);
  assert.ok(out.includes('<span style='), `Got: ${out}`);
});

describe('what is safe', () => {
  test('apostrophe becomes &rsquo; in entity mode', () => {
    const typo = new MicroTypo({ ...PARAMS, entities: true });
    assert.equal(typo.process("Corwin's"), 'Corwin&rsquo;s');
  });

  test('apostrophe becomes U+2019 in unicode mode', () => {
    assert.equal(microtypo("Corwin's", PARAMS), 'Corwin’s');
  });

  test('code content stays verbatim', () => {
    const typo = new MicroTypo({ entities: false });
    // <code> is a safe block: the inner "raw" quotes stay literal.
    const out = typo.process('Мерлин взял <code>"raw"</code> в Отражении');
    assert.ok(out.includes('<code>"raw"</code>'), `Got: ${out}`);
  });
});

describe('mode matrix', () => {
  // One input spanning every axis: quotes, em-dash, nowrap phrase, autolinkable URL, two paragraphs.
  const INPUT =
    'Идём в "Амбер" - истинный, и т. д. См. http://simonenko.xyz тут.\n\nВторой Козырь.';

  test('{html:false, entities:false}: bare unicode text, zero tags', () => {
    const out = microtypo(INPUT, { html: false, entities: false });

    assert.match(out, /«Амбер»/u);
    assert.match(out, /—/u);
    assert.match(out, /и\u{00A0}т\.\u{00A0}д\./u, `nowrap phrase not NBSP-degraded: ${out}`);
    assert.match(out, /http:\/\/simonenko\.xyz/);
    assert.match(out, /\n\n/, 'paragraph boundary must stay a bare \\n\\n');
    assert.ok(!out.includes('<'), `expected zero tags: ${out}`);
  });

  test('{html:false, entities:true}: HTML entities, still zero structural tags', () => {
    const out = microtypo(INPUT, { html: false, entities: true });

    assert.match(out, /&laquo;Амбер&raquo;/);
    assert.match(out, /&mdash;/);
    assert.match(out, /и&nbsp;т\.&nbsp;д\./, `nowrap phrase not NBSP-degraded: ${out}`);
    assert.match(out, /http:\/\/simonenko\.xyz/);
    assert.match(out, /\n\n/, 'paragraph boundary must stay a bare \\n\\n');
    assert.ok(!out.includes('«'), 'unicode glyph leaked in entity mode');
    assert.ok(!out.includes('<'), `expected zero structural tags: ${out}`);
  });

  test('{html:true, entities:false}: markup pipeline active', () => {
    const out = microtypo(INPUT, { html: true, entities: false });

    assert.match(out, /«Амбер»/u);
    assert.match(out, /—/u);
    assert.match(
      out,
      /<span style="white-space:nowrap;">и т\. д\.<\/span>/,
      `nowrap phrase not wrapped: ${out}`
    );
    assert.match(out, /<a href="http:\/\/simonenko\.xyz">/, `URL not autolinked: ${out}`);
    assert.match(out, /<p>/, 'paragraphs should wrap by default under html:true');

    const explicit = microtypo(INPUT, {
      html: true,
      entities: false,
      render: { paragraphs: true }
    });

    assert.match(explicit, /<p>Идём/);
    assert.match(explicit, /<p>Второй Козырь\.<\/p>/);
  });

  test('{html:true, entities:true}: markup pipeline + entities', () => {
    const out = microtypo(INPUT, { html: true, entities: true });

    assert.match(out, /&laquo;Амбер&raquo;/);
    assert.match(out, /&mdash;/);
    assert.match(
      out,
      /<span style="white-space:nowrap;">и т\. д\.<\/span>/,
      `nowrap phrase not wrapped: ${out}`
    );
    assert.match(out, /<a href="http:\/\/simonenko\.xyz">/, `URL not autolinked: ${out}`);
    assert.match(out, /<p>/, 'paragraphs should wrap by default under html:true');
    assert.ok(!out.includes('«'), 'unicode glyph leaked in entity mode');
  });

  test('nowrap phrase collapses to NBSP under html:false', () => {
    const out = microtypo('и т. д.', { html: false });

    assert.ok(!out.includes('<nobr>'), `nobr leaked under html:false: ${out}`);
    assert.match(out, /и\u{00A0}т\.\u{00A0}д\./u, `Got: ${out}`);
  });

  test('autolink degrades to plain URL text under html:false', () => {
    const out = microtypo('см. http://simonenko.xyz тут', { html: false });

    assert.ok(!out.includes('<a '), `anchor leaked under html:false: ${out}`);
    assert.match(out, /http:\/\/simonenko\.xyz/);
  });
});

describe('newline invariants', () => {
  // html:false disables the text group (paragraphs + breakline), isolating the raw newline-collapse invariant.
  test('3+ consecutive newlines collapse to exactly \\n\\n', () => {
    assert.equal(microtypo('Корвин\n\n\n\nЭрик', { html: false }), 'Корвин\n\nЭрик');
  });

  test('a blank line (\\n\\n) is preserved as-is', () => {
    assert.equal(microtypo('Корвин\n\nЭрик', { html: false }), 'Корвин\n\nЭрик');
  });

  test('a single newline (soft break) is preserved as-is', () => {
    assert.equal(microtypo('Корвин\nЭрик', { html: false }), 'Корвин\nЭрик');
  });

  test('with <p> wrapping on, the boundary is </p>\\n\\n<p>', () => {
    assert.equal(microtypo('Корвин\n\nЭрик', { html: true }), '<p>Корвин</p>\n\n<p>Эрик</p>');
  });

  test('idempotent under repeated processing', () => {
    const once = microtypo('Корвин\n\n\n\nЭрик\n\nРэндом\nБенедикт');
    const twice = microtypo(once);

    assert.equal(twice, once);
  });
});
