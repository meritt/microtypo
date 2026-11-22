import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MicroTypo } from '../../src/index.js';
import { mdxReader } from '../../src/input/mdx.js';

const make = () => new MicroTypo({ input: 'mdx' });
describe('MDX syntax protection', () => {
  for (const expression of [
    '{(() => { if (ok) {} else /}}/.test(x); return "А - б"; })()}',
    '{(() => { label: {} /}}/.test(x); return "А - б"; })()}',
    '{(async () => { for await (const x of xs) /}}/.test(x); return "А - б"; })()}',
    '{(async () => { for /*head*/ await /*head*/ (const x of xs) {} /}}/.test(x); return "А - б"; })()}',
    '{(() => { if (ok) /}}/.test(x); else if (other) /}}/.test(y); return "А - б"; })()}',
    '{(() => { outer: inner: { value(); } /}}/.test(x); return "А - б"; })()}',
    '{(() => { function fn() {} /}}/.test(x); return "А - б"; })()}',
    '{(() => { const x = function() {} / 2; return "А - б"; })()}',
    '{(() => { const x = function named() {} / 2 / 3; return "А - б"; })()}',
    '{(async () => { const x = async function() {} / 2; return "А - б"; })()}',
    '{(() => { const x = function* named() {} / 2; return "А - б"; })()}',
    '{(() => { const value = class {} / 2; return "А - б"; })()}',
    '{(() => { const value = class Named {} / 2; return "А - б"; })()}',
    '{(() => { class Value {} /}}/.test(x); return "А - б"; })()}',
    '{(() => { const value = class extends factory({ x: 1 }) {} / 2; return "А - б"; })()}',
    '{(() => { const value = class extends (class {}) {} / 2; return "А - б"; })()}',
    '{(() => { const value = class extends Bases[{}] {} / 2; return "А - б"; })()}',
    '{(() => { const value = class extends Bases[({})] {} / 2; return "А - б"; })()}',
    '{(() => { const x = (() => {}) / 2 + ({}) / 3; return "А - б"; })()}',
    '{(() => { const x = obj.else / 2 + obj.for / 2; return "А - б"; })()}'
  ]) {
    it(`keeps slash context and subsequent prose for ${expression}`, () => {
      const source = `${expression} Корвин - принц`;
      assert.equal(mdxReader(source).read(0)[1], expression.length);
      const expected = `${expression} Корвин\u00a0— принц`;
      assert.equal(make().process(source), expected);
      assert.equal(make().process(expected), expected);
    });
  }
  it('reads comments, regex classes, control blocks and templates without leaking into prose', () => {
    for (const expression of [
      '{(() => { try {} finally {} /[}\\/]/g.test(x); })()}',
      '{(() => { while (ok) /}}/.test(x); elseValue / 2; })()}',
      '{(() => { // } - "source"\nreturn /\\}/g; })()}',
      `{({ x: "\\"}", y: /[{}]/u, z: \`a \\\` \${value}\` })}`,
      '{<A title="x > y"><B value={{ x: "}" }}/>{value}</A>}',
      '{value ? <><A/>А - б</> : <B/>}',
      '{obj?.return / 2 + ++x / 3}'
    ]) {
      assert.equal(
        make().process(`${expression} Корвин - принц`),
        `${expression} Корвин\u00a0— принц`
      );
    }
  });
  it('bounds malformed JSX, quotes, comments and regex by a paragraph', () => {
    for (const source of [
      '<Box title="А - б',
      '<Box value={a - b',
      '{"А - б',
      '{/* А - б',
      '{/unterminated',
      '{`А - б',
      '<Box value={<A></B>}'
    ]) {
      assert.equal(
        make().process(`${source}\n\nКорвин - принц`),
        `${source}\n\nКорвин\u00a0— принц`
      );
    }
  });
  it('checks the budget while reading large expressions and tags', () => {
    const stop = new Error('deadline');
    for (const source of ['{'.repeat(10_000), `<Box title="${'x'.repeat(10_000)}>`]) {
      let calls = 0;
      const reader = mdxReader(source, () => {
        if (++calls > 12) {
          throw stop;
        }
      });
      assert.throws(
        () => reader.read(0),
        (error) => error === stop
      );
    }
  });
  it('keeps MDX blocks outside explicitly requested paragraphs on both passes', () => {
    const typo = new MicroTypo({ html: true, input: 'mdx', render: { paragraphs: true } });
    const source =
      'import X from "./x.js"\n\n{value}\n\nКорвин - принц\n\n{unfinished - "source"\n\nЭрик - король';
    const output = typo.process(source);
    assert.ok(output.startsWith('import X from "./x.js"\n\n{value}\n\n'));
    assert.ok(output.includes('<p>Корвин\u00a0— принц</p>'));
    assert.ok(output.includes('{unfinished - "source"\n\n<p>Эрик\u00a0— король</p>'));
    assert.equal(typo.process(output), output);
  });
  it('keeps paragraphs after an incomplete JSX tag stable across passes', () => {
    const typo = new MicroTypo({ html: true, input: 'mdx', rules: { text: true } });
    const output = typo.process('<B\n\nКорвин - принц');
    assert.equal(output, '<B\n\n<p>Корвин\u00a0— принц</p>');
    assert.equal(typo.process(output), output);
  });
  it('keeps overlapping comment markers and following prose in their own scopes', () => {
    for (const expression of [
      '{/*/x*/ value}',
      '{/* /* nested-looking */ value}',
      '{/*/}',
      '{/*/**/*/ value}'
    ]) {
      const source = `${expression}\n\nКорвин - принц`;
      assert.equal(make().process(source), source.replace('Корвин - принц', 'Корвин\u00a0— принц'));
    }
  });
  for (const code of [
    'import X from "./x.js"',
    'export const label = "А - б"',
    'import {\n  Box,\n  Text\n} from "./x.js"'
  ]) {
    it(`preserves the ESM block ${JSON.stringify(code)}`, () => {
      assert.equal(
        make().process(`${code}\n\nКорвин - принц\n`),
        `${code}\n\nКорвин\u00a0— принц\n`
      );
    });
  }
  for (const expression of [
    '{a - b}',
    '{/* Корвин - "принц" */}',
    '{({ value: "} - text", nested: { a: 1 } })}',
    `{\`А - \${value} { б }\`}`,
    '{foo("escaped \\\" } - quote")}'
  ]) {
    it(`preserves the expression ${JSON.stringify(expression)}`, () => {
      const expected = `Корвин\u00a0— принц ${expression} Эрик\u00a0— король`;
      assert.equal(make().process(`Корвин - принц ${expression} Эрик - король`), expected);
      assert.equal(make().process(expected), expected);
    });
  }
  it('preserves JSX tag bytes and typesets the body as Markdown', () => {
    assert.equal(
      make().process('<Box title="А - б" value={{ text: ">" }}>\nКорвин - принц\n</Box>\n'),
      '<Box title="А - б" value={{ text: ">" }}>\nКорвин\u00a0— принц\n</Box>\n'
    );
    assert.equal(make().process('<Component prop="А - б" />'), '<Component prop="А - б" />');
  });
  it('distinguishes JSX components from lowercase protected HTML elements', () => {
    for (const name of ['Code', 'Pre', 'Script', 'Textarea']) {
      assert.equal(
        make().process(`<${name}>Корвин - принц</${name}>`),
        `<${name}>Корвин\u00a0— принц</${name}>`
      );
    }
    for (const name of ['code', 'pre', 'script', 'textarea']) {
      const source = `<${name}>Корвин - принц</${name}>`;
      assert.equal(make().process(source), source);
    }
    const component = '<Code>Корвин - принц</Code>';
    assert.equal(new MicroTypo({ input: 'markdown' }).process(component), component);
    assert.equal(new MicroTypo({ input: 'html' }).process(component), component);
  });
  it('bounds an unclosed expression by the next empty line', () => {
    assert.equal(
      make().process('{unfinished - "source"\nsecond - line\n\nКорвин - принц'),
      '{unfinished - "source"\nsecond - line\n\nКорвин\u00a0— принц'
    );
  });
  it('keeps delimiters in regular expressions and nested template interpolation opaque', () => {
    for (const source of [
      '{/}/.test(value)}',
      '{/[{}]/u.test(value)}',
      '{(() => { return /}/; })()}',
      `{\`А \${\`б \${value} - в\`} г\`}`
    ]) {
      assert.equal(make().process(source), source);
    }
  });
  it('distinguishes division after postfix operators and property names from regular expressions', () => {
    for (const expression of ['{x++ / 2}', '{obj.return / 2}', '{obj?.return / 2}', '{x-- / 2}']) {
      assert.equal(
        make().process(`${expression} Корвин - принц`),
        `${expression} Корвин\u00a0— принц`
      );
    }
  });
  it('recognizes a regex expression statement after control parentheses', () => {
    const expression = '{(() => { if (ok) /}/.test(value); return 1; }).call(null, "a - b")}';
    assert.equal(
      make().process(`${expression} Корвин - принц`),
      `${expression} Корвин\u00a0— принц`
    );
  });
  it('keeps a closed expression across a blank physical line', () => {
    const source = '{({\n\nvalue: "А - б"\n})}';
    assert.equal(make().process(source), source);
  });
  it('keeps multiline JSX attributes and fragment tags byte exact', () => {
    assert.equal(
      make().process('<Box title="А\n\nб - в">Корвин - принц</Box>'),
      '<Box title="А\n\nб - в">Корвин\u00a0— принц</Box>'
    );
    assert.equal(make().process('<>Корвин - принц</>'), '<>Корвин\u00a0— принц</>');
    assert.equal(
      make().process('<Box title="a\\">Корвин - принц</Box>'),
      '<Box title="a\\">Корвин\u00a0— принц</Box>'
    );
  });
  it('does not let a backtick in a JavaScript string pair with a later Markdown span', () => {
    const source = '{"` - source"} Корвин - принц `код - текст`';
    assert.equal(make().process(source), '{"` - source"} Корвин\u00a0— принц `код - текст`');
  });
  it('leaves fenced code and ordinary Markdown syntax unchanged', () => {
    const source = '```jsx\nimport X from "./x.js"\n{a - b}\n```\n\n# Корвин - принц\n';
    assert.equal(
      make().process(source),
      '```jsx\nimport X from "./x.js"\n{a - b}\n```\n\n# Корвин\u00a0— принц\n'
    );
  });
  it('does not enable MDX syntax protection for Markdown', () => {
    const source = '{a - b}';
    assert.equal(new MicroTypo({ input: 'markdown' }).process(source), '{a\u00a0— b}');
  });
  it('keeps regular expressions after JavaScript statement blocks inside the expression', () => {
    const expression = '{(() => { if (ok) {} /}}/.test(value); return "А - б"; })()}';
    assert.equal(
      make().process(`${expression} Корвин - принц`),
      `${expression} Корвин\u00a0— принц`
    );
  });
  it('protects JSX trees inside expressions without swallowing following prose', () => {
    for (const jsx of [
      '<Inner>{"}"}</Inner>',
      '<Inner title="А - б"/>',
      '<><Inner>{value}</Inner>А - б</>'
    ]) {
      const source = `<Box value={${jsx}}>Корвин - принц</Box> Эрик - король`;
      assert.equal(
        make().process(source),
        source
          .replace('Корвин - принц', 'Корвин\u00a0— принц')
          .replace('Эрик - король', 'Эрик\u00a0— король')
      );
    }
  });
  it('reads deeply nested JSX expressions without recursion', () => {
    const source = `${'<A value={'.repeat(2000)}1${'}/>'.repeat(2000)} Корвин - принц`;
    assert.equal(
      new MicroTypo({ input: 'mdx', maxInputLength: 100_000 }).process(source),
      source.replace('Корвин - принц', 'Корвин\u00a0— принц')
    );
  });
  it('does not interpret indentation inside a multiline expression as Markdown code', () => {
    const source = '{`А - б\n\n    В - г`}\n\nКорвин - принц';
    assert.equal(make().process(source), source.replace('Корвин - принц', 'Корвин\u00a0— принц'));
  });
  it('keeps expressions opaque to HTML block ownership', () => {
    const expression = '{"<pre>"}';
    assert.equal(
      make().process(`${expression}\n\nКорвин - принц`),
      `${expression}\n\nКорвин\u00a0— принц`
    );
  });
  it('does not open Markdown fences inside a multiline expression', () => {
    const expression = '{`А - б\n~~~\nВ - г`}';
    assert.equal(
      make().process(`${expression}\n\nКорвин - принц`),
      `${expression}\n\nКорвин\u00a0— принц`
    );
  });
});
