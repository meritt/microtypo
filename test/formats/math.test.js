import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MicroTypoConfigError } from '../../src/errors/index.js';
import { MicroTypo } from '../../src/index.js';
import { scanMath } from '../../src/input/math.js';

describe('Markdown math', () => {
  for (const formula of [
    '$a - b<c$',
    '$a - b<c - d$',
    String.raw`\(a - b<c\)`,
    '$$a - b<c$$',
    String.raw`\[a - b<c\]`
  ]) {
    it(`lets earlier math own late angle syntax in ${formula}`, () => {
      const source = `${formula}> Корвин - принц`;
      const typo = new MicroTypo({ input: { format: 'markdown', math: true } });
      assert.deepEqual(scanMath(source), [[0, formula.length]]);
      assert.equal(typo.process(source), `${formula}> Корвин\u00a0— принц`);
    });
  }
  for (const ending of ['\n', '\r', '\r\n']) {
    for (const [open, close] of [
      ['$', '$'],
      [String.raw`\(`, String.raw`\)`]
    ]) {
      it(`does not hide a physical ${JSON.stringify(ending)} after backslash in ${open}`, () => {
        const source = `${open}a - b\\${ending}c - d${close}`;
        assert.deepEqual(scanMath(source), []);
        assert.equal(
          new MicroTypo({ input: { format: 'markdown', math: true } }).process(source),
          `${open}a\u00a0— b\\${ending}c\u00a0— d${close}`
        );
      });
    }
    for (const [open, close] of [
      ['$$', '$$'],
      [String.raw`\[`, String.raw`\]`]
    ]) {
      it(`keeps display math multiline after backslash and ${JSON.stringify(ending)}`, () => {
        const source = `${open}a - b\\${ending}c - d${close}`;
        assert.deepEqual(scanMath(source), [[0, source.length]]);
        assert.equal(
          new MicroTypo({ input: { format: 'markdown', math: true } }).process(source),
          source
        );
      });
    }
  }
  it('excludes real quoted attribute values while retaining math around tags', () => {
    const typo = new MicroTypo({ input: { format: 'markdown', math: true } });
    for (const quote of ['"', "'"]) {
      const source = `$a - b <i title=${quote}$${quote}>Корвин - принц</i>`;
      assert.deepEqual(scanMath(source), []);
      assert.equal(typo.process(source), new MicroTypo({ input: 'markdown' }).process(source));
      const formula = `$a - b <i title=${quote}$${quote}>c - d$`;
      assert.deepEqual(scanMath(formula), [[0, formula.length]]);
      assert.equal(typo.process(`${formula} Корвин - принц`), `${formula} Корвин\u00a0— принц`);
    }
  });
  it('checks the budget inside long delimiter runs', () => {
    const stop = new Error('deadline');
    for (const source of ['$'.repeat(20_000), `<i title="${'x'.repeat(20_000)}$">`]) {
      let calls = 0;
      assert.throws(
        () =>
          scanMath(source, () => {
            if (++calls > 3) {
              throw stop;
            }
          }),
        (error) => error === stop
      );
    }
  });
  for (const formula of [
    '$a - b$',
    '$$a - b$$',
    String.raw`\(a - b\)`,
    String.raw`\[a - b\]`,
    '$$\r\na - b\r\nx = "y"\r\n$$'
  ]) {
    it(`preserves ${JSON.stringify(formula)} and typesets prose`, () => {
      const typo = new MicroTypo({ input: { format: 'markdown', math: true } });
      const input = `Корвин - принц\n\n${formula}\n\nЭрик - король`;
      const expected = `Корвин\u00a0— принц\n\n${formula}\n\nЭрик\u00a0— король`;
      assert.equal(typo.process(input), expected);
      assert.equal(typo.process(expected), expected);
    });
  }

  for (const input of [
    '$5 и $10',
    'стоит $5, а не $10',
    '$ a - b$',
    '$a - b $',
    '$a - b$5',
    String.raw`\$a - b\$`,
    '$a - b\n c - d$',
    'слово $без пары - текст'
  ]) {
    it(`keeps the established prose policy for ${JSON.stringify(input)}`, () => {
      assert.equal(
        new MicroTypo({ input: { format: 'markdown', math: true } }).process(input),
        new MicroTypo({ input: 'markdown' }).process(input)
      );
    });
  }

  it('leaves code and fences opaque before pairing math', () => {
    const typo = new MicroTypo({ input: { format: 'markdown', math: true } });
    const source = '`$a - b$`\n\n```js\n$a - b$\n```\n\nКорвин - принц';
    assert.equal(typo.process(source), '`$a - b$`\n\n```js\n$a - b$\n```\n\nКорвин\u00a0— принц');
  });

  it('does not pair a delimiter in an HTML attribute with prose', () => {
    const source = '<span title="$">Корвин - принц $a</span>';
    assert.equal(
      new MicroTypo({ input: { format: 'markdown', math: true } }).process(source),
      new MicroTypo({ input: { format: 'markdown', math: false } }).process(source)
    );
  });
  it('does not use an attribute dollar sign as a math closer', () => {
    const source = '$a - b <i title="$">текст</i>';
    assert.equal(
      new MicroTypo({ input: { format: 'markdown', math: true } }).process(source),
      new MicroTypo({ input: { format: 'markdown', math: false } }).process(source)
    );
  });
  it('reads a space spelled as a reference as a space next to a dollar sign', () => {
    const typo = new MicroTypo({ entities: true, input: 'markdown' });
    assert.equal(typo.process('$&nbsp;2 - b$'), '$&nbsp;2&nbsp;&mdash; b$');
    assert.equal(typo.process('$a - b&#160;$'), '$a&nbsp;&mdash; b&nbsp;$');
    const once = typo.process('Цена $ 2 - "сто$"');
    assert.equal(once, 'Цена $&nbsp;2&nbsp;&mdash; &laquo;сто$&raquo;');
    assert.equal(typo.process(once), once);
  });

  it('reads a dollar sign bound to the amount before it as currency on the next pass', () => {
    for (const entities of [false, true]) {
      const typo = new MicroTypo({ entities, input: 'markdown' });
      const once = typo.process('Цена 5 долл. "$"\n\nФормула $x$');
      assert.equal(
        once,
        entities
          ? 'Цена 5&nbsp;$. &laquo;$&raquo;\n\nФормула $x$'
          : 'Цена 5\u{00A0}$. «$»\n\nФормула $x$'
      );
      assert.equal(typo.process(once), once);
    }
  });

  it('keeps angle syntax inside a formula owned by the earlier math opener', () => {
    const source = '$a<b - c$ и $x - y$';
    assert.equal(
      new MicroTypo({ input: { format: 'markdown', math: true } }).process(source),
      source
    );
  });

  it('keeps a formula in Markdown by default, unless math is off, and reads none outside Markdown', () => {
    const source = '$a - b$';
    assert.equal(new MicroTypo({ input: 'markdown' }).process(source), source);
    assert.equal(
      new MicroTypo({ input: { format: 'markdown', math: false } }).process(source),
      '$a — b$'
    );
    assert.equal(
      new MicroTypo({ input: { format: 'text', math: true } }).process(source),
      new MicroTypo({ input: { format: 'text', math: false } }).process(source)
    );
  });

  for (const math of ['yes', {}, [], null]) {
    it(`rejects invalid math ${JSON.stringify(math)}`, () => {
      assert.throws(
        () => new MicroTypo({ input: { format: 'markdown', math } }),
        MicroTypoConfigError
      );
    });
  }
  for (const format of ['mdx', 'frontmatter']) {
    it(`protects math in ${format} body together with code and prose`, () => {
      const prefix = format === 'frontmatter' ? '---\ntitle: "Корвин - принц"\n---\n\n' : '';
      const body = '$a - b$ `x - y` и \\(c - d\\)\n\nЭрик - король\n';
      assert.equal(
        new MicroTypo({ input: { format, math: true } }).process(prefix + body),
        prefix.replace('Корвин - принц', 'Корвин\u00a0— принц') +
          body.replace('Эрик - король', 'Эрик\u00a0— король')
      );
    });
  }
});
