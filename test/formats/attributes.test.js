import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MicroTypoConfigError } from '../../src/errors/index.js';
import { MicroTypo } from '../../src/index.js';
import { typesetAttributes } from '../../src/input/attributes.js';

const make = (attributes = ['alt', 'title', 'aria-label', 'placeholder', 'content']) =>
  new MicroTypo({ input: { format: 'html', attributes } });
describe('opt-in textual HTML attributes', () => {
  for (const attribute of ['alt', 'title', 'aria-label', 'placeholder']) {
    it(`typesets the selected ${attribute} value only`, () => {
      assert.equal(
        make([attribute]).process(`<img ${attribute}="Корвин - принц" data-value="А - б">`),
        `<img ${attribute}="Корвин\u00a0— принц" data-value="А - б">`
      );
    });
  }
  it('keeps existing references byte exact', () => {
    assert.equal(
      make().process('<img alt="А &quot;б&quot; &nbsp; &#160; &#xA0; - текст">'),
      '<img alt="А &quot;б&quot; &nbsp; &#160; &#xA0;\u00a0— текст">'
    );
  });
  it('does not produce markup even with HTML and rendering enabled', () => {
    const typo = new MicroTypo({
      html: true,
      entities: true,
      input: { format: 'html', attributes: ['alt'] }
    });
    const output = typo.process('<img alt="Корвин - принц">');
    assert.ok(output.includes('alt="Корвин\u00a0— принц"'));
    assert.ok(!output.includes('alt="<'));
    assert.equal(typo.process(output), output);
  });
  it('typesets meta description but preserves technical content', () => {
    assert.equal(
      make().process('<meta name="description" content="Корвин - принц">'),
      '<meta name="description" content="Корвин\u00a0— принц">'
    );
    assert.equal(
      make().process('<meta name="viewport" content="width=device-width, initial-scale=1">'),
      '<meta name="viewport" content="width=device-width, initial-scale=1">'
    );
  });
  it('recognizes metadata before or after content and preserves duplicate attributes', () => {
    assert.equal(
      make().process('<meta content="Корвин - принц" property="og:title">'),
      '<meta content="Корвин\u00a0— принц" property="og:title">'
    );
    assert.equal(
      make().process('<meta name="twitter:description" content="Корвин - принц">'),
      '<meta name="twitter:description" content="Корвин\u00a0— принц">'
    );
    assert.equal(
      make().process('<img ALT="Корвин - принц" alt="А - б">'),
      '<img ALT="Корвин\u00a0— принц" alt="А - б">'
    );
  });
  it('escapes a newly produced wrapper quote without creating markup', () => {
    const typo = make(['title']);
    typo.registerRuleGroup(
      { rules: [{ id: 'literal-quote', handler: (ctx) => ctx.text.replace('Альфа', '"новое"') }] },
      { name: 'other' }
    );
    assert.equal(
      typo.process('<span title="Альфа"></span>'),
      '<span title="&#34;новое&#34;"></span>'
    );
  });
  it('keeps inherited safe blocks and address placeholders separate from the attribute session', () => {
    const typo = make(['title']);
    typo.addSafeBlock({ id: 'own', open: '[[', close: ']]' });
    const source = '<span title="[[А - б]] https://example.com/a-b Корвин - принц"></span>';
    const expected = '<span title="[[А - б]] https://example.com/a-b Корвин\u00a0— принц"></span>';
    assert.equal(typo.process(source), expected);
    assert.equal(typo.process(expected), expected);
  });
  it('does not alter custom protected elements or an unclosed code element', () => {
    const typo = make();
    typo.addSafeTag('secret');
    const secret = '<secret title="А - б"><img alt="Корвин - принц"></secret>';
    assert.equal(typo.process(secret), secret);
    const unclosed = '<code title="А - б">Корвин - принц';
    assert.equal(typo.process(unclosed), unclosed);
  });
  it('uses glyph-only handling for unquoted values and preserves whitespace around values', () => {
    assert.equal(
      make().process('<img alt=Корвин... title="  Корвин - принц  ">'),
      '<img alt=Корвин… title="  Корвин\u00a0— принц  ">'
    );
  });
  it('leaves text attributes literal in plain, data and MDX formats', () => {
    const source = '<img alt="Корвин - принц">';
    assert.equal(
      new MicroTypo({ input: { format: 'mdx', attributes: ['alt'] } }).process(source),
      source
    );
    assert.equal(
      new MicroTypo({ input: { format: 'plain', attributes: ['alt'] } }).process(source),
      new MicroTypo({ input: 'plain' }).process(source)
    );
  });
  for (const tag of ['code', 'pre', 'script']) {
    it(`keeps ${tag} attributes and descendants protected`, () => {
      const source = `<${tag} title="А - б"><img alt="Корвин - принц"></${tag}>`;
      assert.equal(make().process(source), source);
    });
  }
  it('leaves all attribute bytes unchanged by default', () => {
    const source = '<img alt="Корвин - принц" title="А - б">';
    assert.equal(new MicroTypo({ input: 'html' }).process(source), source);
    assert.equal(make([]).process(source), source);
  });
  for (const attributes of [true, null, 'alt', ['href'], ['onclick'], [1], Array(1)]) {
    it(`rejects invalid attribute selection ${JSON.stringify(attributes)}`, () => {
      assert.throws(() => make(attributes), MicroTypoConfigError);
    });
  }
  it('preserves physical newlines within a textual attribute', () => {
    const source = '<img alt="Корвин - принц\r\nЭрик - король">';
    assert.equal(make().process(source), '<img alt="Корвин\u00a0— принц\r\nЭрик\u00a0— король">');
  });
  it('retains entity bytes and literal angle syntax within selected values', () => {
    const source = '<img alt=\'&quot;Амбер&quot; &amp; &lt;Корвин&gt; - принц\' title="x < y - z">';
    assert.equal(
      make(['alt']).process(source),
      '<img alt=\'&quot;Амбер&quot; &amp; &lt;Корвин&gt;\u00a0— принц\' title="x < y - z">'
    );
  });
  it('uses the parent deadline even when a custom attribute rule replaces checkBudget', () => {
    const typo = new MicroTypo({
      presets: false,
      maxProcessingMs: 50,
      input: { format: 'html', attributes: ['alt'] }
    });
    typo.registerRuleGroup(
      {
        rules: [
          {
            id: 'slow',
            handler: (ctx) => {
              if (ctx.text === 'slow') {
                ctx.checkBudget = () => {};
                const until = performance.now() + 80;
                while (performance.now() < until) {}
              }
              return ctx.text;
            }
          }
        ]
      },
      { name: 'slow' }
    );
    assert.throws(() => typo.process('<img alt="slow">'), { code: 'ERR_MICROTYPO_BUDGET' });
    assert.equal(typo.process('<img alt="quick">'), '<img alt="quick">');
  });
  it('copies the option and rejects changes after construction', () => {
    const attributes = ['alt'];
    const typo = make(attributes);
    attributes.push('title');
    assert.equal(
      typo.process('<img alt="А - б" title="А - б">'),
      '<img alt="А\u00a0— б" title="А - б">'
    );
    assert.throws(
      () => typo.applyOptions({ input: { format: 'html', attributes: ['title'] } }),
      MicroTypoConfigError
    );
    assert.doesNotThrow(() =>
      typo.applyOptions({ input: { format: 'html', attributes: ['alt'] } })
    );
  });
  it('retains reserved input, templates and localization tokens in selected attributes', () => {
    const typo = new MicroTypo({
      input: { format: 'html', attributes: ['alt'], template: 'handlebars', placeholders: 'all' }
    });
    const source = `<img alt="\uE000B0\uE001 {{ value }} %s \${name} Корвин - принц">`;
    assert.equal(typo.process(source), source.replace('Корвин - принц', 'Корвин\u00a0— принц'));
  });
  it('escapes new separators in an unquoted attribute and a single quote wrapper', () => {
    const typo = make(['alt']);
    typo.registerRuleGroup(
      { rules: [{ id: 'separators', handler: (ctx) => ctx.text.replace('Альфа', '\'" <x>=`') }] },
      { name: 'separators' }
    );
    assert.equal(typo.process('<img alt=Альфа>'), '<img alt=&#39;&#34;&#32;&#60;x&#62;&#61;&#96;>');
    assert.equal(typo.process("<img alt='Альфа'>"), "<img alt='&#39;\" <x>=`'>");
  });
  it('keeps comments, declarations, duplicate values and incomplete tags unchanged', () => {
    for (const source of [
      '<!-- <img alt="А - б"> -->',
      '<!DOCTYPE html>',
      '<img alt="А - б',
      '<img alt title="А - б">'
    ]) {
      const expected =
        source === '<img alt title="А - б">' ? '<img alt title="А\u00a0— б">' : source;
      assert.equal(make().process(source), expected);
    }
  });
  it('checks the budget inside long values and attribute names', () => {
    const stop = new Error('deadline');
    for (const source of [
      `<img alt="${'a'.repeat(100_000)}">`,
      `<img ${'x'.repeat(100_000)}="a">`
    ]) {
      let calls = 0;
      assert.throws(
        () =>
          typesetAttributes(
            source,
            new Set(['alt']),
            (value) => value,
            () => false,
            () => {
              if (++calls > 2) {
                throw stop;
              }
            }
          ),
        (error) => error === stop
      );
    }
  });
});
