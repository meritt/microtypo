import assert from 'node:assert/strict';
import { test } from 'node:test';

import { microtypo, MicroTypo } from '../../src/index.js';
import { SafeBlocks } from '../../src/protect/blocks.js';

// presets:false runs only protect/restore, so no rule touches the text.
function plain() {
  return new MicroTypo({ presets: false });
}

test('pipeline round-trips arbitrary text with no rules active', () => {
  const typo = plain();

  const inputs = [
    'дорога в Амбер',
    '<pre>сырой "код" Лабиринта 1-2-3</pre>',
    'посети https://example.com/corwin?x=1 затем пиши на corwin@example.org',
    '<script>const a = "<b>";</script> тень',
    'data URI: data:text/plain;base64,YQo= затем ещё'
  ];

  for (const text of inputs) {
    assert.equal(typo.process(text), text.trim(), `round-trip differs for: ${text}`);
  }
});

test('functional api returns a string', () => {
  const out = microtypo('Corwin in Amber', {});
  assert.equal(typeof out, 'string');
});

test('safe blocks preserve content inside <pre> exactly', () => {
  const typo = plain();
  const text = '<pre>"единорог" --- не тронут -- в Амбере</pre>';
  assert.equal(typo.process(text), text);
});

test('<notg> wrapper is replaced with span markers by default', () => {
  const typo = plain();
  const text = '<notg>"Грейсвандир"</notg>';
  const expected = '<span class="_notg_start"></span>"Грейсвандир"<span class="_notg_end"></span>';
  assert.equal(typo.process(text), expected);
});

test('internal markers never leak into output', () => {
  const typo = plain();

  const inputs = [
    '<pre>Козырь</pre>',
    'http://example.com Арден',
    'corwin@amber.example',
    '<a href="amber">Козырь</a>',
    '<span>Корвин</span>'
  ];

  for (const text of inputs) {
    const out = typo.process(text);

    assert.ok(
      !/[-]/u.test(out),
      `marker leaked in output of: ${text}\nGot: ${JSON.stringify(out)}`
    );
  }
});

test('empty safe-block delimiters are rejected', () => {
  const typo = new MicroTypo();
  assert.throws(() => typo.addSafeBlock({ id: 'e', open: '', close: '' }), /delimiter|open|close/i);
});

test('capturing groups in unsafeRegex delimiters do not corrupt the body', () => {
  const typo = new MicroTypo({ presets: false });
  typo.addSafeBlock({ id: 'g', open: '(<<)', close: '(>>)', unsafeRegex: true });
  assert.equal(typo.process('Тир <<"тень" - Корвин>> Амбер'), 'Тир <<"тень" - Корвин>> Амбер');
});

test('nested same-name safe tags protect the outer region', () => {
  const out = microtypo('<code><code>"и" - Тень</code> "о" - Козырь</code>', {
    render: { paragraphs: false }
  });
  assert.ok(!out.includes('«о»') && !out.includes('«и»') && !out.includes('—'), out);
});

test('safe-tag opener with ">" in a quoted attr is not truncated', () => {
  const sb = new SafeBlocks();
  sb.addTag('code');
  const src = '<code title="Амбер > Тень">Корвин - Козырь</code>';
  const protectedText = sb.protect(src);
  assert.ok(
    protectedText.startsWith('<code title="Амбер > Тень">'),
    `opener truncated: ${JSON.stringify(protectedText.slice(0, 30))}`
  );
});

test('comment with inner ">" preserved in text mode', () => {
  assert.equal(
    microtypo('<!-- Амбер > Тень - Колвир --> Корвин - Козырь', { render: { paragraphs: false } }),
    '<!-- Амбер > Тень - Колвир --> Корвин\u{00A0}— Козырь'
  );
});

test('paren inside a character class is not turned into a group', () => {
  const sb = new SafeBlocks();
  // "[(]" is a literal "("; corrupted to a group, "?" would open and vault "Тень (Козырь".
  sb.add({ id: 'paren', open: '[(]', close: '[)]', unsafeRegex: true });
  const protectedText = sb.protect('Корвин ? Тень (Козырь) Амбер');
  assert.ok(
    protectedText.startsWith('Корвин ? Тень ('),
    `character class corrupted: ${JSON.stringify(protectedText)}`
  );
});

test('</tag> inside a quoted attr is not a close event (double quotes)', () => {
  const sb = new SafeBlocks();
  sb.addTag('code');
  const src = '<code data-x="</code>">Корвин - Козырь</code> Эрик - Хаос';
  const out = sb.protect(src);
  assert.ok(out.startsWith('<code data-x="</code>">'), `opener corrupted: ${out}`);
  assert.ok(!out.includes('</code></code>'), `spurious close inserted: ${out}`);
  assert.ok(out.endsWith('</code> Эрик - Хаос'), `tail corrupted: ${out}`);
});

test('</tag> inside a single-quoted attr is not a close event', () => {
  const sb = new SafeBlocks();
  sb.addTag('code');
  const src = "<code data-x='</code>'>Корвин</code> Эрик";
  const out = sb.protect(src);
  assert.ok(!out.includes('</code></code>'), `spurious close inserted: ${out}`);
});

test('a safe-tag opener inside another tag attr does not start a block', () => {
  const sb = new SafeBlocks();
  sb.addTag('code');
  const src = '<a title="<code>">Корвин - Эрик</a></code> Грейсвандир';
  const out = sb.protect(src);
  // nothing is vaulted: the <code> is attribute text, the </code> has no opener
  assert.equal(out, src);
});

test('nested same-name safe tags still vault the outermost span', () => {
  const sb = new SafeBlocks();
  sb.addTag('code');
  const out = sb.protect('<code><code>i</code> o</code>');
  assert.ok(out.startsWith('<code>') && out.endsWith('</code>'), out);
  assert.ok(!out.includes('<code><code>'), `inner not vaulted: ${out}`);
});

test('safe-tag body with </tag> in its attr stays verbatim; tail is typeset', () => {
  const typo = new MicroTypo({ html: true, render: { paragraphs: false } });
  const out = typo.process('<code data-x="</code>">Корвин - Эрик</code> Хаос - Логрус');
  assert.ok(
    out.startsWith('<code data-x="</code>">Корвин - Эрик</code>'),
    `body not verbatim: ${out}`
  );
  assert.ok(out.includes('Хаос\u{00A0}— Логрус'), `tail not typeset: ${out}`);
});
