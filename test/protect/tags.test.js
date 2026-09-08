import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { microtypo, MicroTypo } from '../../src/index.js';

const plain = () => new MicroTypo({ presets: false });
const flat = { render: { paragraphs: false } };

describe('tag interior is byte-preserved', () => {
  test('real tag with trailing space keeps its bytes', () => {
    const typo = plain();
    assert.equal(typo.process('<span >Корвин - Эрик</span >'), '<span >Корвин - Эрик</span >');
    assert.equal(typo.process('<x attr="Амбер" >Корвин</x >'), '<x attr="Амбер" >Корвин</x >');
  });

  test('genuine tag survives the full pipeline', () => {
    assert.equal(plain().process('<b>Корвин</b>'), '<b>Корвин</b>');
  });
});

describe('">" inside a quoted attribute value', () => {
  test('double-quoted attribute with ">" does not truncate the tag', () => {
    assert.equal(
      microtypo('<option value="1>2">Корвин</option>'),
      '<option value="1>2">Корвин</option>'
    );
  });

  test('single-quoted attribute with ">" does not truncate the tag', () => {
    assert.equal(microtypo("<a title='Амбер>Эрик'>Оберон</a>"), "<a title='Амбер>Эрик'>Оберон</a>");
  });

  test('plain tag with no quoted ">" is unaffected', () => {
    assert.equal(microtypo('<b>Амбер</b>'), '<b>Амбер</b>');
  });

  // An unbalanced attribute quote fails the tag match at the `<`, so the run falls through to the
  // rules and `--` becomes an em dash.
  test('unbalanced attribute quote falls through to text', () => {
    assert.equal(
      microtypo('<img alt="Корвин -- Эрик>Амбер'),
      '<img alt="Корвин\u{00A0}— Эрик>Амбер'
    );
  });
});

describe('safe-tag opener with ">" in a quoted attribute', () => {
  const tags = ['pre', 'code', 'script', 'style', 'kbd', 'samp', 'var', 'tt'];

  for (const tag of tags) {
    for (const q of ['"', "'"]) {
      test(`<${tag} title=${q}…>${q} opener is byte-preserved`, () => {
        const src = `<${tag} title=${q}Амбер > Эрик${q}>Корвин - Оберон</${tag}>`;
        assert.equal(plain().process(src), src);
      });
    }
  }
});

describe('block tags and generated <br>', () => {
  const BLOCK_ADJACENT_BR =
    /<br\s*\/?>\s*<(?:blockquote|ul|ol|table|figure|section|div|h[1-6])\b|<\/(?:blockquote|ul|ol|table|figure|section|div|h[1-6])>\s*<br\s*\/?>/i;
  const around = 'Корвин.\n\n<blockquote>Тень Оберона.</blockquote>\n\nЕщё Амбер.';

  test('no spurious <br> around a block tag on first pass', () => {
    const out = microtypo(around, { html: true });
    assert.ok(!BLOCK_ADJACENT_BR.test(out), `spurious <br> around block tag: ${out}`);
  });

  test('author <br> between block tags is preserved', () => {
    assert.match(microtypo('<p>Корвин</p><br><p>Эрик</p>', { html: true }), /<br\s*\/?>/);
  });

  test('reprocessing html output is idempotent around a block', () => {
    const once = microtypo(around, { html: true });
    const twice = microtypo(once, { html: true });
    assert.equal(twice, once, `not idempotent:\n  once:  ${once}\n  twice: ${twice}`);
    assert.ok(
      !/<br\s*\/?>\s*<blockquote/.test(twice) && !/<\/blockquote>\s*<br\s*\/?>/.test(twice),
      `spurious <br> around blockquote: ${twice}`
    );
  });

  test('unrelated newlines still convert when an author <br> exists', () => {
    const out = microtypo('Корвин<br>\nЭрик\nРэндом', {
      html: true,
      render: { paragraphs: false }
    });
    assert.ok(
      out.includes('Эрик<br>') || out.includes('Эрик <br'),
      `newline not converted: ${out}`
    );
  });

  test('attributed author <br> is not doubled', () => {
    const out = microtypo('Корвин<br class="x">\nЭрик', {
      html: true,
      render: { paragraphs: false }
    });
    assert.ok(!/<br class="x"><br\s*\/?>/.test(out), `doubled <br>: ${out}`);
  });

  for (const hr of ['<hr>', '<hr/>', '<hr />']) {
    test(`reprocessing is idempotent around a void block tag (${hr})`, () => {
      const src = `Корвин.\n\n${hr}\n\nЭрик.`;
      const once = microtypo(src, { html: true });
      const twice = microtypo(once, { html: true });
      assert.equal(twice, once, `not idempotent:\n  once:  ${once}\n  twice: ${twice}`);
      assert.ok(
        !/<br\s*\/?>\s*<hr\b/.test(twice) && !/<hr\b[^>]*>\s*<br\s*\/?>/.test(twice),
        `spurious <br> around ${hr}: ${twice}`
      );
    });
  }
});

// The placeholder prefix is what a later rule reads to tell a block boundary from inline markup, so
// a tag a rule group mints has to be classified by the same question as one read out of the
// document.
describe('a generated tag is classified like an authored one', () => {
  const render = { html: true, render: { paragraphs: false }, rules: { 'hanging.*': false } };

  const wrapping = (tag) => {
    const engine = new MicroTypo(render);

    engine.registerRuleGroup(
      {
        title: 'Gen',
        rules: [
          { id: 'wrap', handler: (ctx) => ctx.text.replace('MARK', () => ctx.tag('100 руб.', tag)) }
        ]
      },
      { name: 'Gen', position: 'start' }
    );

    return engine.process('MARK 3 ошибки.');
  };

  for (const tag of ['p', 'div', 'li', 'section', 'blockquote']) {
    test(`ctx.tag(…, '${tag}') ends the sentence like <${tag}>`, () => {
      assert.equal(wrapping(tag), microtypo(`<${tag}>100 руб.</${tag}> 3 ошибки.`, render));
    });
  }

  test('an inline tag stays transparent', () => {
    assert.equal(wrapping('em'), microtypo('<em>100 руб.</em> 3 ошибки.', render));
  });
});

describe('void and block tags are not <p>-wrapped', () => {
  test('<hr> is unwrapped', () => {
    const out = microtypo('<hr>', { html: true });
    assert.ok(!/<p>\s*<hr\s*\/?>\s*<\/p>/.test(out), `hr left wrapped: ${out}`);
  });

  test('<hr/> is unwrapped', () => {
    const out = microtypo('<hr/>', { html: true });
    assert.ok(!/<p>\s*<hr\s*\/?>\s*<\/p>/.test(out), `hr left wrapped: ${out}`);
  });

  for (const tag of ['main', 'menu', 'dialog']) {
    test(`<${tag}> is not <p>-wrapped`, () => {
      const out = microtypo(`<${tag}>Корвин - Эрик</${tag}>`, { html: true });
      assert.ok(!out.includes(`<p><${tag}`), `${tag} left wrapped: ${out}`);
    });
  }
});

describe('inert markup is never welded into a tag', () => {
  // `< img …>` reads as text, so the space-before-bracket rule spaces `alert(1)`, which is a separate
  // question from the tag property.
  test('inert "< img …>" stays text', () => {
    assert.equal(
      microtypo('Корвин < img src=x onerror=alert(1) > Эрик', flat),
      'Корвин < img src=x onerror=alert (1) > Эрик'
    );
  });

  test('"</ script >" stays text', () => {
    assert.equal(microtypo('Корвин </ script > Эрик', flat), 'Корвин </ script > Эрик');
  });

  // The trailing conjunction glues to the next word with an nbsp; the "<"/">" stay inert.
  test('comparison text is not turned into a tag', () => {
    assert.equal(
      microtypo('Корвин < Эрик и Рэндом > Оберон', flat),
      'Корвин < Эрик и\u{00A0}Рэндом > Оберон'
    );
  });

  test('"<"+whitespace never opens a new tag', () => {
    for (const s of [
      'Corwin < Amber >',
      'Corwin < Amber и Grayswandir > Corwin',
      'Amber </ Grayswandir >'
    ]) {
      const out = microtypo(s, flat);
      assert.equal(
        /<[A-Za-z]/.test(out),
        false,
        `manufactured tag from ${JSON.stringify(s)}: ${out}`
      );
    }
  });
});

describe('block-level tags stay outside <p>', () => {
  test('<blockquote> is not wrapped in <p>', () => {
    const out = microtypo('<blockquote>"Козыри Амбера"</blockquote>');
    assert.ok(!out.startsWith('<p><blockquote'), `Got: ${out}`);
    assert.equal(out, '<blockquote>«Козыри Амбера»</blockquote>');
  });

  test('<ul>/<li> is not wrapped in <p>', () => {
    assert.equal(
      microtypo('<ul><li>Корвин</li><li>Эрик</li></ul>'),
      '<ul><li>Корвин</li><li>Эрик</li></ul>'
    );
  });

  test('<table> is not wrapped in <p>', () => {
    assert.equal(
      microtypo('<table><tr><td>Корвин</td></tr></table>'),
      '<table><tr><td>Корвин</td></tr></table>'
    );
  });

  test('<h1>..<h6> are not wrapped in <p>', () => {
    for (const h of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
      assert.equal(microtypo(`<${h}>Грейсвандир</${h}>`), `<${h}>Грейсвандир</${h}>`);
    }
  });
});

describe('attributed <p> keeps its attributes', () => {
  test('<p class="lead"> keeps its attribute, single-wrapped, dash converts', () => {
    const out = microtypo('<p class="lead">Корвин - Эрик</p>', { html: true });
    assert.equal(out, '<p class="lead">Корвин\u{00A0}— Эрик</p>');
    assert.ok(out.includes('class="lead"'), `attribute dropped: ${out}`);
    assert.ok(!/<p>\s*<p/.test(out) && !out.includes('</p></p>'), `double-wrapped: ${out}`);
  });

  test('loose text wraps in a plain <p>', () => {
    assert.equal(microtypo('Корвин - Эрик', { html: true }), '<p>Корвин\u{00A0}— Эрик</p>');
  });

  test('two <p> tags: first attribute kept, second stays plain, idempotent', () => {
    const input = '<p id="corwin">Оберон</p>\n\n<p>Эрик</p>';
    const once = microtypo(input, { html: true });
    const twice = microtypo(once, { html: true });
    assert.equal(once, '<p id="corwin">Оберон</p>\n\n<p>Эрик</p>');
    assert.ok(once.includes('id="corwin"'), `id dropped: ${once}`);
    assert.ok(!once.includes('<p><p') && !once.includes('</p></p>'), `double-wrapped: ${once}`);
    assert.equal(twice, once, 'not idempotent');
  });
});

describe('<code>/<pre> content is protected', () => {
  test('<code> content is not typeset', () => {
    assert.equal(
      microtypo('<code>const realm = "amber"</code>', flat),
      '<code>const realm = "amber"</code>'
    );
  });

  test('<pre> content is not typeset', () => {
    assert.equal(
      microtypo('<pre>Корвин - Эрик - Рэндом</pre>', flat),
      '<pre>Корвин - Эрик - Рэндом</pre>'
    );
  });

  test('nested <code><pre> is protected and restored', () => {
    assert.equal(
      microtypo('<code><pre>"Амбер" - Корвин</pre></code>', flat),
      '<code><pre>"Амбер" - Корвин</pre></code>'
    );
  });
});
