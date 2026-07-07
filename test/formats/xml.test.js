import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { MicroTypoInputError } from '../../src/errors/index.js';
import { microtypo } from '../../src/index.js';
import { doctypeEnd, validateXml } from '../../src/input/xml.js';

const NBSP = '\u{00A0}';

function tagsBalanced(xml) {
  try {
    validateXml(xml);

    return true;
  } catch {
    return false;
  }
}

function assertUnterminatedXmlConstruct(src, construct) {
  assert.throws(
    () => microtypo(src, { input: { format: 'xml' } }),
    (error) => {
      assert.ok(error instanceof MicroTypoInputError);
      assert.equal(error.code, 'ERR_MICROTYPO_INPUT');
      assert.match(error.message, /Unterminated XML/);
      assert.equal(error.details?.construct, construct);

      return true;
    }
  );
}

describe('XML input: text nodes typeset, structure verbatim', () => {
  test('RSS: title/description text nodes typeset, all tags byte-verbatim', () => {
    const src =
      '<rss><channel><title>Дневник Корвина - лучший</title>' +
      '<description>Отражение "в Тенях"</description></channel></rss>';
    const out = microtypo(src, { input: { format: 'xml' } });

    assert.equal(
      out,
      '<rss><channel><title>' +
        `Дневник Корвина${NBSP}— лучший` +
        '</title><description>' +
        `Отражение «в${NBSP}Тенях»` +
        '</description></channel></rss>'
    );
    assert.ok(tagsBalanced(out));
  });

  test('attribute values are verbatim, element text is typeset', () => {
    const src = '<a href="http://simonenko.xyz?a-b">Корвин - здесь</a>';
    const out = microtypo(src, { input: { format: 'xml' } });

    assert.equal(out, `<a href="http://simonenko.xyz?a-b">Корвин${NBSP}— здесь</a>`);
    assert.ok(
      out.includes('href="http://simonenko.xyz?a-b"'),
      'href must be unchanged, no em-dash inside'
    );
    assert.ok(tagsBalanced(out));
  });

  test('comment with an inner ">" stays byte-verbatim, surrounding text is typeset', () => {
    const src = '<x><!-- знак: a > b - c -->Рэндом - тут</x>';
    const out = microtypo(src, { input: { format: 'xml' } });

    assert.equal(out, `<x><!-- знак: a > b - c -->Рэндом${NBSP}— тут</x>`);
    assert.ok(
      !out.slice(0, out.indexOf('-->')).includes('—'),
      'no em-dash leaked into the comment'
    );
    assert.ok(tagsBalanced(out));
  });

  test('CDATA with inner ">" stays byte-verbatim, surrounding text is typeset', () => {
    const src = '<x><![CDATA[ if a > b - c ]]>подлинный - мир</x>';
    const out = microtypo(src, { input: { format: 'xml' } });

    assert.equal(out, `<x><![CDATA[ if a > b - c ]]>подлинный${NBSP}— мир</x>`);
    assert.ok(tagsBalanced(out));
  });

  test('processing instruction / xml declaration stays byte-verbatim', () => {
    const src = '<?xml version="1.0"?><x>Оберон - король</x>';
    const out = microtypo(src, { input: { format: 'xml' } });

    assert.equal(out, `<?xml version="1.0"?><x>Оберон${NBSP}— король</x>`);
    assert.ok(tagsBalanced(out));
  });

  test('DOCTYPE stays byte-verbatim', () => {
    const src = '<!DOCTYPE svg><svg><text>Амбер - центр</text></svg>';
    const out = microtypo(src, { input: { format: 'xml' } });

    assert.equal(out, `<!DOCTYPE svg><svg><text>Амбер${NBSP}— центр</text></svg>`);
    assert.ok(tagsBalanced(out));
  });

  test('xml doctype internal subset with a quoted > is preserved byte-for-byte', () => {
    const src = '<!DOCTYPE note [ <!ENTITY writer "a > Корвин - Эрик"> ]><note>&writer;</note>';
    const out = microtypo(src, { input: 'xml' });

    assert.ok(out.startsWith('<!DOCTYPE note [ <!ENTITY writer "a > Корвин - Эрик"> ]>'), out);
    assert.ok(!out.includes('Корвин —'), out);
  });

  test('xml element text after a doctype internal subset is still typographed', () => {
    const src = '<!DOCTYPE note [ <!ENTITY w "x"> ]><note>Корвин - Эрик</note>';
    const out = microtypo(src, { input: 'xml' });

    assert.ok(out.includes('<!ENTITY w "x">'), out);
    assert.ok(out.includes(`Корвин${NBSP}— Эрик`), out);
  });

  test('a comment nested in a doctype internal subset (carrying a bare ">") does not split the doctype span', () => {
    const src = '<!DOCTYPE note [ <!-- a > b --> <!ENTITY w "x"> ]><note>Корвин - Эрик</note>';
    const out = microtypo(src, { input: 'xml' });

    assert.ok(out.startsWith('<!DOCTYPE note [ <!-- a > b --> <!ENTITY w "x"> ]>'), out);
    assert.ok(out.includes(`Корвин${NBSP}— Эрик`), out);
    assert.ok(tagsBalanced(out));
  });

  test('entity references are not decoded, adjacent text is still typeset', () => {
    const src = '<x>Амбер&amp;Хаос - вражда</x>';
    const out = microtypo(src, { input: { format: 'xml' } });

    assert.equal(out, `<x>Амбер&amp;Хаос${NBSP}— вражда</x>`);
    assert.ok(tagsBalanced(out));
  });

  describe('xml-entity SafeBlock does not over-match past a bare "&"', () => {
    test('unrelated ";" after a bare "&" does not swallow the dash between them', () => {
      const src = '<x>Корвин - брат & Эрик - враг; Рэндом - друг</x>';
      const out = microtypo(src, { input: { format: 'xml' } });

      assert.equal(out, `<x>Корвин${NBSP}— брат & Эрик${NBSP}— враг; Рэндом${NBSP}— друг</x>`);
      assert.ok(tagsBalanced(out));
    });

    test('a bare "&" in one element does not blank out typesetting in a sibling element', () => {
      const src = '<x>Корвин & Эрик</x><y>Рэндом - Бенедикт;</y><z>Джулиан - Джерард</z>';
      const out = microtypo(src, { input: { format: 'xml' } });

      assert.equal(
        out,
        `<x>Корвин & Эрик</x><y>Рэндом${NBSP}— Бенедикт;</y><z>Джулиан${NBSP}— Джерард</z>`
      );
      assert.ok(tagsBalanced(out));
    });

    // Only the first " - " becomes a dash; ";" is not a dash left-context.
    test('a bare "&" inside an href does not swallow element text into the tag boundary', () => {
      const src = '<a href="arden?x=1&y=2">Грейсвандир - клинок & Козыри; колода</a>';
      const out = microtypo(src, { input: { format: 'xml' } });

      assert.equal(out, `<a href="arden?x=1&y=2">Грейсвандир${NBSP}— клинок & Козыри; колода</a>`);
      assert.ok(out.includes('href="arden?x=1&y=2"'), 'href must stay byte-verbatim');
      assert.ok(tagsBalanced(out));
    });

    test('genuine named entity stays verbatim, its own text still typesets', () => {
      const src = '<x>Корвин &amp; Эрик - дуэль</x>';
      const out = microtypo(src, { input: { format: 'xml' } });

      assert.equal(out, `<x>Корвин &amp; Эрик${NBSP}— дуэль</x>`);
      assert.ok(out.includes('&amp;'), 'named entity must stay byte-verbatim');
      assert.ok(tagsBalanced(out));
    });

    test('genuine decimal/hex/named char references all stay verbatim', () => {
      const src = '<x>&#160;&#x00A0;&nbsp; a - b</x>';
      const out = microtypo(src, { input: { format: 'xml' } });

      assert.equal(out, `<x>&#160;&#x00A0;&nbsp; a${NBSP}— b</x>`);
      assert.ok(out.includes('&#160;'), '&#160; must stay byte-verbatim');
      assert.ok(out.includes('&#x00A0;'), '&#x00A0; must stay byte-verbatim');
      assert.ok(out.includes('&nbsp;'), '&nbsp; must stay byte-verbatim');
      assert.ok(tagsBalanced(out));
    });
  });

  test('trailing document whitespace is preserved, not trimmed', () => {
    const src = '<x>a - b</x>\n';
    const out = microtypo(src, { input: { format: 'xml' } });

    assert.equal(out, `<x>a${NBSP}— b</x>\n`);
    assert.ok(out.endsWith('\n'));
  });

  test('leading/trailing document-edge whitespace survives interior space normalization', () => {
    assert.equal(
      microtypo('  <x>a - b</x>  ', { input: { format: 'xml' } }),
      `  <x>a${NBSP}— b</x>  `
    );
  });

  test('xml:space="preserve" element body is not whitespace-normalized', () => {
    const src = '<x xml:space="preserve">a  b\n\n\nc - d</x>';
    const out = microtypo(src, { input: { format: 'xml' } });

    assert.ok(out.includes('a  b\n\n\nc'), out);
  });

  test('xml:space="preserve" body is fully byte-verbatim (no typesetting inside)', () => {
    const src = '<x xml:space="preserve">a  b\n\n\nc - d</x>';
    const out = microtypo(src, { input: { format: 'xml' } });

    assert.equal(out, src);
  });

  test('sibling element without xml:space is typeset normally', () => {
    const src = '<r><x xml:space="preserve">a  b</x><y>c - d</y></r>';
    const out = microtypo(src, { input: { format: 'xml' } });

    assert.equal(out, `<r><x xml:space="preserve">a  b</x><y>c${NBSP}— d</y></r>`);
  });

  test('an unrecognized "<b <c>" opener inside the preserve scan does not misfire', () => {
    const src = '<a><b <c>d - e</c></a>';
    const out = microtypo(src, { input: { format: 'xml' } });

    assert.equal(out, `<a><b <c>d${NBSP}— e</c></a>`);
  });

  test('fields/exclude are silently ignored for xml input (no error)', () => {
    const src = '<x>Рэндом - тень</x>';

    assert.doesNotThrow(() => {
      microtypo(src, { input: { format: 'xml', fields: ['x'], exclude: ['x'] } });
    });
  });

  test('XML entities:true uses numeric refs, not named', () => {
    const out = microtypo('<x>я — «принц»</x>', { input: { format: 'xml' }, entities: true });

    assert.ok(out.includes('&#160;') && out.includes('&#8212;'));
    assert.ok(!/&(nbsp|mdash|laquo);/.test(out));
  });

  test('html:true does not inject <p>/<a> markup into an XML text node', () => {
    const src = '<x>Корвин http://simonenko.xyz - домой</x>';
    const out = microtypo(src, { input: { format: 'xml' }, html: true });

    assert.ok(!out.includes('<p>') && !out.includes('<a '), out);
    assert.ok(tagsBalanced(out));
  });
});

describe('XML well-formedness guards', () => {
  test('mismatched close tag is rejected', () => {
    assert.throws(
      () => microtypo('<x><y>a</x>', { input: { format: 'xml' } }),
      MicroTypoInputError
    );
  });

  test('unclosed tag at end of document is rejected', () => {
    assert.throws(
      () => microtypo('<x><y>a</y>', { input: { format: 'xml' } }),
      MicroTypoInputError
    );
  });

  test('unterminated attribute quote is rejected', () => {
    assert.throws(
      () => microtypo('<x attr="a>Корвин - тут</x>', { input: { format: 'xml' } }),
      MicroTypoInputError
    );
  });

  test('unterminated top-level XML comment is rejected before typography', () => {
    assertUnterminatedXmlConstruct('<!-- Корвин - Эрик', '<!--');
  });

  test('unterminated top-level XML CDATA is rejected before typography', () => {
    assertUnterminatedXmlConstruct('<![CDATA[ Корвин - Эрик', '<![CDATA[');
  });

  test('unterminated top-level XML processing instruction is rejected before typography', () => {
    assertUnterminatedXmlConstruct('<?pi Корвин - Эрик', '<?');
  });

  test('unterminated top-level XML doctype is rejected before typography', () => {
    assertUnterminatedXmlConstruct('<!DOCTYPE note [ <!ENTITY w "Корвин - Эрик"> ', '<!DOCTYPE');
  });

  test('unterminated XML comment inside an element reports the construct, not the parent tag', () => {
    assertUnterminatedXmlConstruct('<x><!-- Корвин - Эрик</x>', '<!--');
  });

  test('unterminated XML comment inside preserve subtree is rejected before typography', () => {
    assertUnterminatedXmlConstruct('<x xml:space="preserve"><!-- Корвин - Эрик</x>', '<!--');
  });

  test('unterminated XML CDATA inside an element reports the construct, not the parent tag', () => {
    assertUnterminatedXmlConstruct('<x><![CDATA[ Корвин - Эрик</x>', '<![CDATA[');
  });

  test('unterminated XML processing instruction inside an element reports the construct, not the parent tag', () => {
    assertUnterminatedXmlConstruct('<x><?pi Корвин - Эрик</x>', '<?');
  });

  test('unterminated XML doctype inside an element reports the construct, not the parent tag', () => {
    assertUnterminatedXmlConstruct(
      '<x><!DOCTYPE note [ <!ENTITY w "Корвин - Эрик"> </x>',
      '<!DOCTYPE'
    );
  });

  test('properly nested tags are NOT rejected', () => {
    const src = '<x><y>a - b</y></x>';
    const out = microtypo(src, { input: { format: 'xml' } });

    assert.equal(out, `<x><y>a${NBSP}— b</y></x>`);
  });

  test('self-closing tags are NOT rejected', () => {
    const src = '<x><br/><img src="a - b"/>Рэндом - тут</x>';
    const out = microtypo(src, { input: { format: 'xml' } });

    assert.equal(out, `<x><br/><img src="a - b"/>Рэндом${NBSP}— тут</x>`);
  });

  test('an attribute value containing ">" is NOT mistaken for an unterminated quote', () => {
    const src = '<x attr="1>2">Эрик - тут</x>';
    const out = microtypo(src, { input: { format: 'xml' } });

    assert.equal(out, `<x attr="1>2">Эрик${NBSP}— тут</x>`);
  });

  test('a fake tag-like string inside a comment does not trigger a false mismatch', () => {
    const src = '<x><!-- <y> --></x>';
    const out = microtypo(src, { input: { format: 'xml' } });

    assert.equal(out, src);
  });

  test('a bare "<" in text (not a tag opener) does not confuse the tag-stack scan', () => {
    const src = '<x>a < b - c</x>';
    const out = microtypo(src, { input: { format: 'xml' } });

    assert.equal(out, `<x>a < b${NBSP}— c</x>`);
  });

  test('an incomplete tag opener followed by another "<" is rejected as malformed', () => {
    assert.throws(() => microtypo('<x <y>', { input: { format: 'xml' } }), MicroTypoInputError);
  });

  test('a CDATA body containing the literal text "<!--" does not corrupt tag masking', () => {
    const src = '<rss><item><![CDATA[<div><!-- hi --></div>]]></item></rss>';
    const out = microtypo(src, { input: { format: 'xml' } });

    assert.equal(out, src);
    assert.ok(tagsBalanced(out));
  });

  test('valid RSS with CDATA-embedded raw HTML: surrounding text typesets, CDATA stays verbatim', () => {
    const src =
      '<rss><item><title>Хроника - тут</title>' +
      '<content:encoded><![CDATA[<p>Тень<!-- знак --></p>]]></content:encoded></item></rss>';
    const out = microtypo(src, { input: { format: 'xml' } });

    assert.equal(
      out,
      '<rss><item><title>' +
        `Хроника${NBSP}— тут` +
        '</title><content:encoded><![CDATA[<p>Тень<!-- знак --></p>]]></content:encoded></item></rss>'
    );
    assert.ok(tagsBalanced(out));
  });

  test('a genuinely unclosed comment is rejected', () => {
    assert.throws(
      () => microtypo('<x><!-- Корвин', { input: { format: 'xml' } }),
      MicroTypoInputError
    );
  });
});

describe('doctypeEnd: comment/PI bracket-awareness in the internal subset', () => {
  test('doctypeEnd skips an unbalanced ] inside a comment in the internal subset', () => {
    const src = '<!DOCTYPE d [ <!-- x ] y --> <!ENTITY w "z"> ]> tail';
    const end = doctypeEnd(src, 0);

    assert.equal(src.slice(0, end), '<!DOCTYPE d [ <!-- x ] y --> <!ENTITY w "z"> ]>');
  });

  test('doctypeEnd skips a PI carrying > inside the internal subset', () => {
    const src = '<!DOCTYPE d [ <?pi a > b?> ]> tail';
    const end = doctypeEnd(src, 0);

    assert.equal(src.slice(0, end), '<!DOCTYPE d [ <?pi a > b?> ]>');
  });
});
