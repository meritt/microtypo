import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { defineRuleGroup } from '../../src/define-rule.js';
import { MicroTypoConfigError } from '../../src/errors/index.js';
import { microtypo, MicroTypo } from '../../src/index.js';

const OPEN = '\u{E000}';
const CLOSE = '\u{E001}';
const PARA_OPEN = '\u{E100}';
const PARA_CLOSE = '\u{E101}';
const NBSP = '\u{00A0}';
const HTML = { html: true, render: { paragraphs: false } };

describe('autolink safety', () => {
  test('javascript: URLs are NOT auto-linked', () => {
    const out = microtypo('Корвин javascript:alert(1) Амбер');
    assert.ok(!out.includes('href="javascript:'), `Got: ${out}`);
    assert.ok(!out.includes('<a '), 'No anchor tag should be produced');
  });

  test('data: URLs are NOT auto-linked', () => {
    const out = microtypo('Корвин data:text/html,<script>alert(1)</script> Амбер');
    assert.ok(!out.includes('href="data:'), `Got: ${out}`);
  });

  test('vbscript: URLs are NOT auto-linked', () => {
    const out = microtypo('Корвин vbscript:msgbox(1) Амбер');
    assert.ok(!out.includes('href="vbscript:'), `Got: ${out}`);
  });

  test('http URL with a quote in the path does not break out of href', () => {
    // The URL regex stops at ", so the breakout char stays outside the href.
    const out = microtypo('Корвин http://amber.example/"onerror=alert(1) Амбер');
    assert.ok(!/href="[^"]*"[^>]*onerror/.test(out), `Got: ${out}`);
  });
});

describe('tag() attribute escaping', () => {
  test('attribute values are HTML-escaped in custom tag()', () => {
    const typo = new MicroTypo({ html: true, presets: false });
    // No public entry point for tag building; exercise it through a custom group.
    typo.registerRuleGroup(
      {
        title: 'X',
        rules: [
          {
            id: 'r',
            pattern: /MARK/g,
            replacement: (_, ctx) => ctx.tag('Козырь', 'span', { 'data-x': '"><script>' })
          }
        ]
      },
      { name: 'X' }
    );

    const out = typo.process('Корвин MARK Амбер');
    assert.ok(out.includes('data-x="&quot;&gt;&lt;script&gt;"'), `Got: ${out}`);
  });
});

describe('vault isolation', () => {
  test('vault state does not leak across process() calls (same instance)', () => {
    const typo = new MicroTypo();
    typo.process('Корвин http://victim-secret.amber.example');
    // Forge a URL placeholder from the previous call.
    const out = typo.process('Амбер http://simonenko-xyz/A0SAFE0123456789ABCDEFNUM0ID Арден');
    assert.ok(!out.includes('victim-secret'), `Cross-call leak detected: ${out}`);
  });

  test('PUA marker chars in user input are stripped on entry', () => {
    const text = `Корвин\uE000T0\uE001Амбер`;
    const out = microtypo(text);
    // The forged vault token must not resolve; source text survives.
    assert.ok(out.includes('Корвин'), `Got: ${out}`);
    assert.ok(!out.includes(OPEN), `PUA char survived: ${JSON.stringify(out)}`);
  });
});

describe('input guards', () => {
  test('maxInputLength enforces input cap', () => {
    const typo = new MicroTypo({ maxInputLength: 100 });
    typo.process('x'.repeat(100));

    assert.throws(() => typo.process('x'.repeat(101)), {
      code: 'ERR_MICROTYPO_INPUT'
    });
  });

  test('default maxInputLength is 30K', () => {
    const typo = new MicroTypo();
    // ~28KB stays under the cap; ~49KB trips it.
    assert.doesNotThrow(() => typo.process('Корвин '.repeat(4_000)));
    assert.throws(() => typo.process('Корвин '.repeat(7_000)), {
      code: 'ERR_MICROTYPO_INPUT'
    });
  });

  test('non-string input throws MicroTypoInputError', () => {
    const typo = new MicroTypo();

    for (const x of [null, undefined, 1, true, [], {}]) {
      assert.throws(() => typo.process(x), {
        code: 'ERR_MICROTYPO_INPUT'
      });
    }
  });

  test('input with null byte does not crash', () => {
    assert.doesNotThrow(() => microtypo('Корвин\u{0000}Амбер'));
  });

  test('long line of repeated quote chars (potential ReDoS) returns quickly', () => {
    const start = Date.now();
    microtypo('"'.repeat(2000));
    const ms = Date.now() - start;
    assert.ok(ms < 1000, `Took ${ms}ms — possible ReDoS`);
  });

  test('deeply nested parens (URL regex stress) return quickly', () => {
    const start = Date.now();
    microtypo(`Корвин ${'('.repeat(100)}http://amber.example/y${')'.repeat(100)}`);
    const ms = Date.now() - start;
    assert.ok(ms < 1000, `Took ${ms}ms — possible ReDoS`);
  });
});

describe('prototype pollution', () => {
  test('prototype pollution via flat key', () => {
    const before = Object.prototype.toString;
    // Unknown group key -> config rejects it (at least as safe as a silent no-op).
    assert.throws(() => microtypo('Амбер', { '__proto__.polluted': 'on' }), MicroTypoConfigError);
    assert.equal(typeof {}.polluted, 'undefined');
    assert.equal(Object.prototype.toString, before);
  });

  test('prototype pollution via nested key', () => {
    microtypo('Амбер', { __proto__: { polluted: 'on' } });
    assert.equal(typeof {}.polluted, 'undefined');
  });

  test('prototype pollution via constructor.prototype', () => {
    assert.throws(
      () => microtypo('Амбер', { 'constructor.prototype.polluted': 'on' }),
      MicroTypoConfigError
    );
    assert.equal(typeof {}.polluted, 'undefined');
  });
});

describe('cycled-rule cap', () => {
  test('cycled-rule cap stops infinite oscillation', () => {
    const typo = new MicroTypo({ presets: false });
    let calls = 0;

    typo.registerRuleGroup(
      {
        title: 'Osc',
        rules: [
          {
            id: 'flip',
            cycled: true,
            pattern: /A|B/g,
            replacement: (m) => {
              calls++;

              return m[0] === 'A' ? 'B' : 'A';
            }
          }
        ]
      },
      { name: 'Osc' }
    );

    let limitHit = null;

    typo.onCycleLimit = (id, n) => {
      limitHit = { id, n };
    };

    typo.process('AB');
    assert.equal(limitHit?.id, 'flip');
    assert.equal(limitHit?.n, 100);
    assert.ok(calls < 500, `runaway: ${calls}`);
  });
});

describe('JSON PUA forgery', () => {
  // `JSON.parse` decodes `\uXXXX`, reintroducing reserved PUA past the entry strip, so the engine
  // has to strip again.

  test('escaped-PUA forgery of a vault placeholder is neutralized, sibling value intact', () => {
    const out = microtypo('{"a":"\\uE000B0\\uE001","secret":"Корвин - тут"}', {
      input: { format: 'json' }
    });

    // The forged placeholder decodes, loses its PUA chars, and survives as inert text "B0".
    assert.equal(out, `{"a":"B0","secret":"Корвин${NBSP}— тут"}`);

    const parsed = JSON.parse(out);

    assert.equal(parsed.a, 'B0');
    assert.equal(parsed.secret, `Корвин${NBSP}— тут`);
    assert.ok(!out.includes(OPEN) && !out.includes(CLOSE), 'no reserved PUA must reach output');
  });

  test('forged placeholder cannot steal a sibling vaulted block content', () => {
    // `<pre>` is a default safe block, so `secret` is really vaulted and the forged reference must
    // not resolve to it.
    const out = microtypo('{"a":"\\uE000B0\\uE001","secret":"<pre>AMBER-DONOTLEAK</pre>"}', {
      input: { format: 'json' }
    });

    assert.equal(out, '{"a":"B0","secret":"<pre>AMBER-DONOTLEAK</pre>"}');

    const parsed = JSON.parse(out);

    assert.equal(parsed.a, 'B0', 'must not resolve to the vaulted <pre> content');
    assert.ok(!parsed.a.includes('DONOTLEAK'), 'secret payload must not leak into a');
    assert.equal(
      parsed.secret,
      '<pre>AMBER-DONOTLEAK</pre>',
      'secret value must stay exactly as authored'
    );
  });

  test('escaped PUA mid-string is stripped, never reaches the restore step', () => {
    const out = microtypo(
      '{"a":"Корвин \\uE000 середина \\uE001 Амбер - Арден","b":"Рэндом - Бенедикт"}',
      {
        input: { format: 'json' }
      }
    );
    const parsed = JSON.parse(out);

    assert.ok(!out.includes(OPEN) && !out.includes(CLOSE), 'PUA chars must be stripped');
    assert.equal(parsed.a, `Корвин середина Амбер${NBSP}— Арден`);
    assert.equal(parsed.b, `Рэндом${NBSP}— Бенедикт`);
  });

  test('a forged OPEN in one field and a forged CLOSE in an adjacent field never combine', () => {
    // Each JSON value is typeset on its own, so a half-placeholder cannot assemble across two fields.
    const out = microtypo('{"a":"\\uE000T5 Корвин","b":"Рэндом \\uE001 Амбер"}', {
      input: { format: 'json' }
    });
    const parsed = JSON.parse(out);

    assert.ok(!out.includes(OPEN) && !out.includes(CLOSE), 'no reserved PUA must reach output');
    assert.equal(parsed.a, 'T5 Корвин');
    assert.equal(parsed.b, 'Рэндом Амбер');
    assert.ok(!parsed.a.includes('Амбер'), 'b content must not cross into a');
    assert.ok(!parsed.b.includes('Корвин'), 'a content must not cross into b');
  });

  test('legitimate value with real typesetting still works', () => {
    const out = microtypo('{"title":"Амбер - лучший"}', { input: { format: 'json' } });

    assert.equal(out, `{"title":"Амбер${NBSP}— лучший"}`);
    assert.equal(JSON.parse(out).title, `Амбер${NBSP}— лучший`);
  });
});

describe('custom-group forgery', () => {
  // A rule may relocate placeholders and mint fresh ones, so any extra occurrence it types has to be
  // defused before restore.

  test('forged block/tag/anchor tokens do not duplicate protected content', () => {
    const typo = new MicroTypo();

    typo.registerRuleGroup(
      defineRuleGroup({
        title: 'forge',
        rules: [
          {
            id: 'f',
            handler: (ctx) =>
              `${ctx.text}\nLEAK:\uE000B0\uE001\nTAG:<\uE000T0\uE001>\nANCHOR:<\uE000A0\uE001>`
          }
        ]
      }),
      { name: 'forge', position: 'end' }
    );

    const out = typo.process(
      '<pre>AMBER-RAW</pre><b class="amber">Амбер</b><a href="http://arden.example/secret">Корвин</a>'
    );

    assert.ok(!out.includes(OPEN) && !out.includes(CLOSE), `reserved PUA reached output: ${out}`);
    assert.equal(out.split('AMBER-RAW').length - 1, 1, `<pre> content duplicated: ${out}`);
    assert.equal(
      out.split('http://arden.example/secret').length - 1,
      1,
      `anchor href duplicated: ${out}`
    );
    // Forged references may leave only inert leftover text, never a second real <pre>/<a>.
    assert.ok(!/TAG:<pre|ANCHOR:<a /i.test(out), out);
  });

  test('forged paragraph tokens do not inject markup the input never had', () => {
    const typo = new MicroTypo({ html: true });

    typo.registerRuleGroup(
      defineRuleGroup({
        title: 'forge-para',
        rules: [
          {
            id: 'f',
            handler: (ctx) =>
              `${ctx.text}${PARA_OPEN}POP${PARA_CLOSE}FORGED${PARA_OPEN}PCL${PARA_CLOSE}`
          }
        ]
      }),
      { name: 'forge-para', position: 'end' }
    );

    const out = typo.process('Корвин.');

    assert.ok(
      !out.includes(PARA_OPEN) && !out.includes(PARA_CLOSE),
      `reserved paragraph PUA reached output: ${out}`
    );
    assert.ok(!out.includes('<p>FORGED</p>'), `forged paragraph materialized: ${out}`);
    assert.ok(out.includes('<p>Корвин.</p>'), `legitimate paragraph broken: ${out}`);
  });

  test('forged URL/email tokens do not duplicate protected content', () => {
    const typo = new MicroTypo({ render: { paragraphs: false } });

    typo.registerRuleGroup(
      defineRuleGroup({
        title: 'forge-seq',
        rules: [
          {
            id: 'f',
            handler(ctx) {
              // Re-emits the same id, so occurrence budgeting rather than unknown-id handling has
              // to catch it.
              const url = ctx.text.match(/http:\/\/simonenko-xyz\/(A0SAFE[0-9A-F]+NUM)\d+(ID)/);
              const email = ctx.text.match(/(A1SAFE[0-9A-F]+NUM)\d+(ID@simonenko\.xyz)/);
              let out = ctx.text;

              if (url) {
                out += ` LEAK-URL:http://simonenko-xyz/${url[1]}0${url[2]}`;
              }

              if (email) {
                out += ` LEAK-EMAIL:${email[1]}0${email[2]}`;
              }

              return out;
            }
          }
        ]
      }),
      { name: 'forge-seq', position: 'end' }
    );

    const out = typo.process('Корвин http://amber.example/secret или corwin@amber.example');

    assert.equal(out.split('http://amber.example/secret').length - 1, 1, out);
    assert.equal(out.split('corwin@amber.example').length - 1, 1, out);
  });

  test('cross-field JSON forgery does not cross the field boundary', () => {
    const typo = new MicroTypo({ input: { format: 'json' } });

    typo.registerRuleGroup(
      defineRuleGroup({
        title: 'seq-forge',
        rules: [
          {
            id: 'leak',
            handler(ctx) {
              const m = ctx.text.match(/http:\/\/simonenko-xyz\/(A0SAFE[0-9A-F]+NUM)\d+(ID)/);

              return m ? `${ctx.text} LEAK:http://simonenko-xyz/${m[1]}0${m[2]}` : ctx.text;
            }
          }
        ]
      }),
      { name: 'seq-forge', position: 'end' }
    );

    const out = typo.process(
      JSON.stringify({
        a: 'Корвин http://probe.amber.example/x',
        secret: 'http://secret.amber.example/private'
      })
    );
    const parsed = JSON.parse(out);

    assert.ok(!parsed.a.includes('secret.amber.example'), `secret leaked into field a: ${out}`);
    assert.ok(parsed.secret.includes('secret.amber.example'), out);
  });

  test('a custom group can still mint a tag via ctx.tag()', () => {
    const typo = new MicroTypo({ html: true, render: { paragraphs: false } });

    typo.registerRuleGroup(
      defineRuleGroup({
        title: 'mark',
        rules: [
          {
            id: 'mark',
            handler: (ctx) => ctx.text.replace('Козырь', () => ctx.tag('Козырь', 'mark', {}))
          }
        ]
      }),
      { name: 'mark', position: 'end' }
    );

    const out = typo.process('Корвин поднял Козырь высоко');

    assert.equal(out, 'Корвин поднял <mark>Козырь</mark> высоко');
  });

  test('a custom group can still mint an iblock via ctx.iblock()', () => {
    const typo = new MicroTypo({ render: { paragraphs: false } });

    typo.registerRuleGroup(
      defineRuleGroup({
        title: 'hide',
        rules: [
          {
            id: 'hide',
            handler: (ctx) => ctx.text.replace('AMBER-MARKER', () => ctx.iblock('AMBER-MARKER'))
          }
        ]
      }),
      { name: 'hide', position: 'end' }
    );

    const out = typo.process('Корвин - AMBER-MARKER - Амбер');

    assert.ok(out.includes('AMBER-MARKER'), out);
  });

  test('ctx.tag() mint credit excludes placeholders already in its content argument', () => {
    const typo = new MicroTypo({ html: true, render: { paragraphs: false } });

    typo.registerRuleGroup(
      defineRuleGroup({
        title: 'wrap-then-forge',
        rules: [
          {
            // Wraps `ctx.text`, relocating its real anchor, then forges a second reference: mint
            // credit must cover only fresh tokens.
            id: 'f',
            handler: (ctx) => `${ctx.tag(ctx.text, 'mark', {})}\nSTOLEN:<\uE000A0\uE001>`
          }
        ]
      }),
      { name: 'wrap-then-forge', position: 'end' }
    );

    const out = typo.process('<a href="http://victim.amber.example/secret-path">Корвин</a>');

    assert.ok(!out.includes(OPEN) && !out.includes(CLOSE), `reserved PUA reached output: ${out}`);
    assert.equal(
      out.split('http://victim.amber.example/secret-path').length - 1,
      1,
      `anchor href duplicated via ctx.tag() content-rescan: ${out}`
    );
    assert.ok(!/STOLEN:<a /i.test(out), `forged reference materialized a second live tag: ${out}`);
  });

  test('mint credit does not carry across JSON field boundaries', () => {
    const typo = new MicroTypo({ input: { format: 'json' } });
    let stolenPlaceholder = null;

    typo.registerRuleGroup(
      defineRuleGroup({
        title: 'mint-then-leak',
        rules: [
          {
            // One field mints a secret placeholder and another retypes it, so mint credit must not
            // carry across the field boundary.
            id: 'f',
            handler(ctx) {
              if (ctx.text.includes('MINT-HERE')) {
                stolenPlaceholder = ctx.iblock('SECRET-PAYLOAD');

                return ctx.text.replace('MINT-HERE', stolenPlaceholder);
              }

              if (ctx.text.includes('LEAK-HERE') && stolenPlaceholder) {
                return `${ctx.text} ${stolenPlaceholder}`;
              }

              return ctx.text;
            }
          }
        ]
      }),
      { name: 'mint-then-leak', position: 'end' }
    );

    const out = typo.process(
      JSON.stringify({ leakField: 'Корвин LEAK-HERE Амбер', mintField: 'Арден MINT-HERE Колвир' })
    );
    const parsed = JSON.parse(out);

    assert.ok(!out.includes(OPEN) && !out.includes(CLOSE), `reserved PUA reached output: ${out}`);
    assert.ok(
      !parsed.leakField.includes('SECRET-PAYLOAD'),
      `hidden secret leaked into leakField: ${out}`
    );
    assert.ok(parsed.mintField.includes('SECRET-PAYLOAD'), `legitimate iblock mint broke: ${out}`);
  });

  // `ctx.tag()` and `ctx.iblock()` vault what they are handed, where the scrub of the returned text
  // cannot read it. A group that hid a token there kept a copy the accounting never saw.
  describe('what a group hands in is budgeted like what it hands back', () => {
    const withHandler = (handler) => {
      const typo = new MicroTypo(HTML);

      typo.registerRuleGroup(defineRuleGroup({ title: 'hide', rules: [{ id: 'f', handler }] }), {
        name: 'hide',
        position: 'end'
      });

      return typo.process('<pre>AMBER-RAW</pre> Цель');
    };

    const forged = `${OPEN}B0${CLOSE}`;

    test('a token hidden in an iblock does not duplicate protected content', () => {
      const out = withHandler((ctx) => ctx.text + ctx.iblock(forged));

      assert.equal(out.split('AMBER-RAW').length - 1, 1, `<pre> content duplicated: ${out}`);
      assert.ok(!out.includes(OPEN) && !out.includes(CLOSE), `reserved PUA reached output: ${out}`);
    });

    test('a token hidden in an attribute value does not duplicate protected content', () => {
      const out = withHandler((ctx) => ctx.text + ctx.tag('X', 'span', { title: forged }));

      assert.equal(out.split('AMBER-RAW').length - 1, 1, `<pre> content duplicated: ${out}`);
    });

    test('a token hidden in an href does not duplicate protected content', () => {
      const out = withHandler((ctx) => ctx.text + ctx.tag('X', 'a', { href: forged }));

      assert.equal(out.split('AMBER-RAW').length - 1, 1, `<pre> content duplicated: ${out}`);
    });

    // The budget reads strings, and everything that decides which string an attribute carries — a
    // `String` object, a number, the group's own class-to-style mapping — has to have run before it
    // looks.
    test('a token that is not yet a string is budgeted like one', () => {
      const out = withHandler(
        (ctx) => ctx.text + ctx.tag('X', 'span', { title: { toString: () => forged } })
      );

      assert.equal(out.split('AMBER-RAW').length - 1, 1, `<pre> content duplicated: ${out}`);
    });

    test('a token reached through the group class mapping is budgeted too', () => {
      const typo = new MicroTypo(HTML);

      typo.registerRuleGroup(
        defineRuleGroup({
          title: 'hide',
          classes: { probe: forged },
          rules: [
            { id: 'f', handler: (ctx) => ctx.text + ctx.tag('X', 'span', { class: 'probe' }) }
          ]
        }),
        { name: 'hide', position: 'end' }
      );

      const out = typo.process('<pre>AMBER-RAW</pre> Цель');

      assert.equal(out.split('AMBER-RAW').length - 1, 1, `<pre> content duplicated: ${out}`);
    });

    // Escaping is the last thing that can read an attribute value, so what is still opaque when it
    // runs comes back afterwards — past the escaping — and the quote inside it closes the attribute.
    test('protected text placed in an attribute cannot open a second attribute', () => {
      const typo = new MicroTypo({ presets: false, html: true });

      typo.registerRuleGroup(
        defineRuleGroup({
          title: 'tooltip',
          rules: [{ id: 'f', handler: (ctx) => ctx.tag('X', 'span', { title: ctx.text }) }]
        }),
        { name: 'tooltip' }
      );

      const out = typo.process('<pre>" data-probe="injected</pre>');

      assert.ok(
        !/data-probe=/.test(out.replace(/title="[^"]*"/, '')),
        `attribute injected: ${out}`
      );
      assert.ok(out.includes('&quot;'), `the quote was not escaped: ${out}`);
    });

    // A paragraph belongs to a document and an attribute holds none, so a marker that cannot become
    // a `<p>` goes out whole rather than losing only its delimiters.
    test('a paragraph marker does not reach an attribute', () => {
      const typo = new MicroTypo({ html: true });

      typo.registerRuleGroup(
        defineRuleGroup({
          title: 'tooltip',
          rules: [{ id: 'f', handler: (ctx) => ctx.tag('X', 'span', { title: ctx.text }) }]
        }),
        { name: 'tooltip', position: 'end' }
      );

      const out = typo.process('Корвин помнит Амбер\n\nДворкин чертит Узор');
      const title = out.match(/title="([^"]*)"/u)?.[1];

      assert.ok(title?.includes('Корвин помнит Амбер'), out);
      assert.ok(title?.includes('Дворкин чертит Узор'), out);
      assert.ok(!/POP|PCL|BR/.test(title), `a paragraph marker reached the attribute: ${out}`);
    });

    test('wrapping protected content in a tag still works', () => {
      const out = withHandler((ctx) => ctx.tag(ctx.text, 'span', { class: 'nowrap' }));

      assert.equal(out.split('AMBER-RAW').length - 1, 1, out);
      assert.ok(out.includes('<span><pre>AMBER-RAW</pre>'), out);
    });

    test('nesting one minted tag inside another still works', () => {
      const out = withHandler((ctx) => `${ctx.text}${ctx.tag(ctx.tag('Икс', 'small'), 'sub')}`);

      assert.ok(out.includes('<sub><small>Икс</small></sub>'), out);
    });
  });

  // The accounting decides whether the group forged anything, so the group must not be able to
  // clear it, credit itself, or switch it off — and `builtin` is the switch that turns it off for
  // every later run.
  describe('a group cannot reach the accounting behind it', () => {
    const reachOut = (handler) => {
      const typo = new MicroTypo(HTML);

      typo.registerRuleGroup(defineRuleGroup({ title: 'reach', rules: [{ id: 'f', handler }] }), {
        name: 'reach',
        position: 'end'
      });

      return typo.process('<pre>AMBER-RAW</pre> Цель');
    };

    test('ctx carries no minting state', () => {
      let keys = null;

      reachOut((ctx) => {
        keys = Object.keys(ctx);

        return ctx.text;
      });

      assert.deepEqual(
        keys.filter((key) => /mint|track/i.test(key)),
        []
      );
    });

    test('ctx.group cannot be marked builtin', () => {
      let outcome = null;

      reachOut((ctx) => {
        try {
          ctx.group.builtin = true;
          outcome = ctx.group.builtin === true ? 'mutated' : 'ignored';
        } catch {
          outcome = 'threw';
        }

        return ctx.text;
      });

      assert.notEqual(outcome, 'mutated');
    });

    test('a group still reads its own settings and classes', () => {
      let seen = null;

      const typo = new MicroTypo(HTML);

      typo.registerRuleGroup(
        defineRuleGroup({
          title: 'reads',
          classes: { nowrap: 'white-space:nowrap;' },
          rules: [
            {
              id: 'f',
              handler(ctx) {
                seen = ctx.group.raw.classes.nowrap;

                return ctx.text;
              }
            }
          ]
        }),
        { name: 'reads', position: 'end' }
      );

      typo.process('Корвин');

      assert.equal(seen, 'white-space:nowrap;');
    });
  });

  test('self-duplication neutralizes to empty, not a vault-id fragment', () => {
    const typo = new MicroTypo({ render: { paragraphs: false } });

    typo.registerRuleGroup(
      defineRuleGroup({
        title: 'self-dup',
        rules: [{ id: 'f', handler: (ctx) => ctx.text + ctx.text }]
      }),
      { name: 'self-dup', position: 'end' }
    );

    const out = typo.process('<pre>AMBER-RAW</pre>');

    assert.ok(!out.includes(OPEN) && !out.includes(CLOSE), `reserved PUA reached output: ${out}`);
    assert.equal(out.split('AMBER-RAW').length - 1, 1, `<pre> content duplicated: ${out}`);
    assert.ok(!/[TB]\d/.test(out), `neutralized copy leaked a visible vault-id fragment: ${out}`);
  });
});

describe('paragraph-token forgery', () => {
  test('PUA paragraph tokens (U+E100/U+E101) cannot inject <p>/<br>', () => {
    const evil = `${PARA_OPEN}POP${PARA_CLOSE} Корвин ${PARA_OPEN}POP${PARA_CLOSE} Амбер`;
    const out = microtypo(evil, { html: true });
    const pCount = (out.match(/<p>/g) ?? []).length;
    assert.equal(pCount, 1, `Got too many <p>: ${out}`);
  });

  test('PUA U+E100/U+E101 cannot forge <br>', () => {
    const evil = `Корвин${PARA_OPEN}BR${PARA_CLOSE}Амбер`;
    const out = microtypo(evil);
    assert.ok(!out.includes('<br'), `<br> forged: ${out}`);
  });
});

// The forged nonce is hex and the id is in range, so only the live-nonce check can reject these;
// a non-hex nonce would be turned away by the literal shape alone and prove nothing.
describe('deterministic placeholder forgery', () => {
  const FORGED_URL = 'http://simonenko-xyz/A0SAFE0123456789ABCDEFNUM0ID';
  const FORGED_EMAIL = 'A1SAFE0123456789ABCDEFNUM0ID@simonenko.xyz';

  test('forged unknown safe-sequence URL placeholder stays intact', () => {
    const out = microtypo(`${FORGED_URL.replace('NUM0ID', 'NUM999ID')} Амбер`, {
      render: { paragraphs: false }
    });

    assert.ok(out.includes('A0SAFE0123456789ABCDEFNUM999ID'), `Got: ${out}`);
  });

  test('deterministic placeholder cannot hijack a stored URL', () => {
    const out = microtypo(`Корвин http://amber.example подмена ${FORGED_URL}`, HTML);
    // The forged placeholder must NOT acquire the real URL's content.
    const linksToExample = (out.match(/href="http:\/\/amber\.example"/g) || []).length;
    assert.equal(linksToExample, 1, `Real URL leaked via forgery: ${out}`);
    assert.ok(out.includes('A0SAFE0123456789ABCDEFNUM0ID'), `Forgery consumed: ${out}`);
  });

  test('deterministic placeholder cannot hijack a stored email', () => {
    const out = microtypo(`Корвин oberon@amber.example подмена ${FORGED_EMAIL}`, HTML);
    const linksToAdmin = (out.match(/href="mailto:oberon@amber\.example"/g) || []).length;
    assert.equal(linksToAdmin, 1, `Real email leaked via forgery: ${out}`);
    assert.ok(out.includes('A1SAFE0123456789ABCDEFNUM0ID'), `Forgery consumed: ${out}`);
  });

  // An autolink body that allowed the reserved delimiters would run a greedy match through the
  // vaulted closing tag and the paragraph marker behind it and carry both into the href.
  test('a link at the end of a paragraph does not swallow a placeholder', () => {
    const out = microtypo('<p>https://arden.io/1 https://arden.io/2</p>', {
      input: 'html',
      html: true
    });

    assert.ok(
      !/[\u{E000}\u{E001}\u{E100}\u{E101}]/u.test(out),
      `reserved codepoint reached the output: ${JSON.stringify(out)}`
    );
    assert.ok(!out.includes('PCL'), out);
  });

  test('many links in one paragraph keep the output free of placeholders', () => {
    const body = Array.from({ length: 30 }, (_, i) => `https://arden.io/${i}`).join(' ');
    const out = microtypo(`<p>${body}</p>`, { input: 'html', html: true });

    assert.ok(!/[\u{E000}\u{E001}\u{E100}\u{E101}]/u.test(out), out.slice(0, 200));
  });
});
