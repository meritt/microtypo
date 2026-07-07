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
    const out = typo.process('Амбер http://simonenko.xyz/A0SAFESEQNUM0ID Арден');
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
  // JSON.parse decodes \uXXXX, reintroducing reserved PUA past the entry strip; the engine must re-strip.

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
    // <pre> is a default safe block, so "secret" is really vaulted; the forged reference must not resolve to it.
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
    // Each JSON value is typeset independently, so a half-placeholder can't assemble across two fields.
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
  // A rule may relocate placeholders and mint fresh ones; any extra occurrence it types must be defused before restore.

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
              // Re-emit the SAME id: occurrence budgeting, not unknown-id handling, must catch it.
              const url = ctx.text.match(/http:\/\/simonenko\.xyz\/(A0SAFE[0-9A-F]+NUM)\d+(ID)/);
              const email = ctx.text.match(/(A1SAFE[0-9A-F]+NUM)\d+(ID@simonenko\.xyz)/);
              let out = ctx.text;

              if (url) {
                out += ` LEAK-URL:http://simonenko.xyz/${url[1]}0${url[2]}`;
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
              const m = ctx.text.match(/http:\/\/simonenko\.xyz\/(A0SAFE[0-9A-F]+NUM)\d+(ID)/);

              return m ? `${ctx.text} LEAK:http://simonenko.xyz/${m[1]}0${m[2]}` : ctx.text;
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
            // Wraps ctx.text (relocating its real anchor) then forges a 2nd reference; mint credit must cover only fresh tokens.
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
            // One field mints a secret placeholder, another retypes it; mint credit must not carry across the field boundary.
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

describe('deterministic placeholder forgery', () => {
  test('forged unknown safe-sequence URL placeholder stays intact', () => {
    const out = microtypo('http://simonenko.xyz/A0SAFESEQNUM999ID Амбер', {
      render: { paragraphs: false }
    });

    assert.ok(out.includes('SAFESEQNUM999ID'), `Got: ${out}`);
  });

  test('deterministic placeholder cannot hijack a stored URL', () => {
    const out = microtypo(
      'Корвин http://amber.example подмена http://simonenko.xyz/A0SAFESEQNUM0ID',
      HTML
    );
    // The forged placeholder must NOT acquire the real URL's content.
    const linksToExample = (out.match(/href="http:\/\/amber\.example"/g) || []).length;
    assert.equal(linksToExample, 1, `Real URL leaked via forgery: ${out}`);
  });

  test('deterministic placeholder cannot hijack a stored email', () => {
    const out = microtypo(
      'Корвин oberon@amber.example подмена A1SAFESEQNUM0ID@simonenko.xyz',
      HTML
    );
    const linksToAdmin = (out.match(/href="mailto:oberon@amber\.example"/g) || []).length;
    assert.equal(linksToAdmin, 1, `Real email leaked via forgery: ${out}`);
  });
});
