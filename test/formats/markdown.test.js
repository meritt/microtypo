import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { microtypo, MicroTypo } from '../../src/index.js';
import { scanFences, scanLinkDestinations } from '../../src/input/markdown.js';

const base = { html: false, entities: false };
const md = { ...base, input: 'markdown' };
const mdRender = { ...base, input: { format: 'markdown' }, render: { paragraphs: false } };

test('without markdown mode, dashes inside backticks are converted', () => {
  assert.match(microtypo('Корвин `a -- b` Эрик', base), /—/);
});

test('markdown mode preserves single-backtick code spans', () => {
  const out = microtypo('Корвин `--no-verify` Эрик', md);
  assert.match(out, /`--no-verify`/);
  assert.doesNotMatch(out.replace(/`[^`]*`/g, ''), /—/);
});

test('markdown mode preserves triple-backtick fences', () => {
  const out = microtypo('Корвин\n```\nlet x = a -- b\n```\nЭрик', md);
  assert.match(out, /a -- b/);
});

test('markdown mode preserves double-backtick spans containing a backtick', () => {
  const out = microtypo('Корвин `` echo `hi` `` Эрик', md);
  assert.match(out, /`` echo `hi` ``/);
});

test('markdown mode still typesets surrounding text', () => {
  const out = microtypo('"Корвин" -- Эрик, `code -- here`', md);
  assert.match(out, /«Корвин»/);
  assert.match(out, /— Эрик/);
  assert.match(out, /`code -- here`/);
});

test('markdown mode on backtick-free text matches text mode', () => {
  const a = new MicroTypo(base).process('"Corwin" -- Amber');
  const b = new MicroTypo(md).process('"Corwin" -- Amber');
  assert.equal(a, b);
});

test('markdown mode preserves multiple fences', () => {
  const out = microtypo('```\na -- b\n```\nКорвин "Амбер" Эрик\n```\nc -- d\n```', md);
  assert.match(out, /a -- b/);
  assert.match(out, /c -- d/);
  assert.match(out, /«Амбер»/);
});

test('markdown mode preserves backticks inside quotes', () => {
  const out = microtypo('Корвин "путь `--flag` даёт" Эрик', md);
  assert.match(out, /`--flag`/);
  assert.match(out, /«путь/);
});

test('markdown mode: fence immediately followed by inline code', () => {
  const out = microtypo('```\na -- b\n```\n`c -- d`', md);
  assert.match(out, /a -- b/);
  assert.match(out, /`c -- d`/);
});

test('markdown mode: inline code on same line as quoted text', () => {
  const out = microtypo('Корвин "x" `y -- z` Эрик "q"', md);
  assert.match(out, /«x»/);
  assert.match(out, /`y -- z`/);
  assert.match(out, /«q»/);
});

test('markdown mode: empty code span does not crash', () => {
  assert.equal(typeof microtypo('Корвин `` Эрик', md), 'string');
});

test('markdown mode: unclosed fence runs to EOF and stays protected', () => {
  assert.equal(microtypo('```\na -- b', md), '```\na -- b');
});

test('markdown mode preserves multi-item list markers', () => {
  const out = microtypo('- Корвин\n- Эрик', md);
  assert.match(out, /^- Корвин/);
  assert.match(out, /- Эрик$/);
});

test('markdown mode preserves an indented code block', () => {
  const out = microtypo('Амбер\n\n    const a = "b" - 1;\n\nОтражение', md);
  assert.match(out, /    const a = "b" - 1;/);
});

test('markdown mode preserves hard-break trailing spaces', () => {
  const out = microtypo('Корвин  \nЭрик', md);
  assert.match(out, /Корвин {2}\n/);
});

test('markdown mode preserves a link destination with a hyphen', () => {
  const out = microtypo('[Лабиринт](/posts/10-19)', md);
  assert.match(out, /\[Лабиринт\]\(\/posts\/10-19\)/);
});

test('markdown mode: image destination survives number grouping', () => {
  const out = microtypo('![единорог](/img/12345.jpg)', md);
  assert.match(out, /!\[единорог\]\(\/img\/12345\.jpg\)/);
});

test('markdown mode preserves image title quotes', () => {
  const out = microtypo('![единорог](x.jpg "Белый единорог")', md);
  assert.match(out, /!\[единорог\]\(x\.jpg "Белый единорог"\)/);
});

test('markdown mode preserves a 4-backtick fence', () => {
  const out = microtypo('````\nconst a = "b" - 1;\n````', md);
  assert.match(out, /````\nconst a = "b" - 1;\n````/);
});

test('markdown mode preserves a 5-backtick fence', () => {
  const out = microtypo('`````\nconst a = "b" - 1;\n`````', md);
  assert.match(out, /`````\nconst a = "b" - 1;\n`````/);
});

test('markdown mode preserves a tilde fence', () => {
  const out = microtypo('~~~\nconst a = "b" - 1;\n~~~', md);
  assert.match(out, /~~~\nconst a = "b" - 1;\n~~~/);
});

test('markdown mode: spaced thematic break survives the dash rule', () => {
  assert.equal(microtypo('- - -', md), '- - -');
});

test('markdown mode keeps leading indented-code indentation', () => {
  assert.equal(microtypo('    Корвин\n    Эрик\n', md), '    Корвин\n    Эрик');
});

test('text mode does not apply the edge-code-preserving trim', () => {
  // Plain text has no indented-code concept, so a blank-prefix plus indentation is fully trimmed.
  assert.equal(microtypo('\n\n    Корвин\nЭрик\n\n', base), 'Корвин\nЭрик');
});

test('markdown mode: inline same-length fence inside code keeps the block open', () => {
  const src = '```\nconst s = "a ``` b";\nnext - line\n```';
  const out = microtypo(src, md);
  assert.ok(out.includes('next - line'), out);
});

test('markdown mode: same-line triple-backtick pair is not a fence', () => {
  const out = microtypo('```code```\n"w"', md);
  assert.match(out, /```code```/);
  assert.match(out, /«w»/);
});

test('markdown mode preserves a destination with balanced parens and a title', () => {
  const src = '[x](/img/a_(b)-c.jpg "Амбер - Тень")';
  assert.equal(microtypo(src, md), src);
});

test('markdown mode preserves an image destination with balanced parens', () => {
  const src = '![alt](/img/a_(b)-c.jpg)';
  assert.equal(microtypo(src, md), src);
});

test('markdown mode: text after a link still gets typeset', () => {
  // The closing ')' is visible to the dash rule again, so the trailing " - " converts.
  const out = microtypo('Смотри [Козырь](/img.jpg) - здесь', mdRender);
  assert.equal(out, 'Смотри [Козырь](/img.jpg) — здесь');
  assert.match(out, /\(\/img\.jpg\)/);
});

test('markdown mode: destination with balanced paren then trailing dash text', () => {
  const out = microtypo('Смотри [x](/img/a_(b)-c.jpg "Амбер - Тень") - потом', mdRender);
  assert.match(out, /\[x\]\(\/img\/a_\(b\)-c\.jpg "Амбер - Тень"\)/);
  assert.equal(out, 'Смотри [x](/img/a_(b)-c.jpg "Амбер - Тень") — потом');
});

const spanText = (src, spans) => spans.map(([start, end]) => src.slice(start, end));

describe('scanFences', () => {
  test('closing fence line may itself be indented up to 3 spaces', () => {
    const src = '```\ncode\n   ```';

    assert.deepEqual(spanText(src, scanFences(src)), [src]);
  });

  test('closing fence line may have trailing spaces after the run', () => {
    const src = '```\ncode\n```   ';

    assert.deepEqual(spanText(src, scanFences(src)), [src]);
  });

  test('4+ leading spaces on a would-be close line disqualifies it', () => {
    const src = '```\ncode\n    ```\nmore\n```';

    // The 4-space-indented ``` doesn't close - the fence keeps scanning and closes on the last line.
    assert.deepEqual(spanText(src, scanFences(src)), [src]);
  });

  test('a longer closing run than the opener is a valid close', () => {
    const src = '```\ncode\n````';

    assert.deepEqual(spanText(src, scanFences(src)), [src]);
  });

  test('a shorter run than the opener does not close', () => {
    const src = '````\ncode\n```\nmore\n````';

    assert.deepEqual(spanText(src, scanFences(src)), [src]);
  });

  test('tilde fence tolerates a backtick in its info string', () => {
    const src = '~~~info`with`backtick\ncode\n~~~';

    assert.deepEqual(spanText(src, scanFences(src)), [src]);
  });

  test('non-fence text produces no spans', () => {
    assert.deepEqual(scanFences('Корвин идёт Тенями домой в Амбер'), []);
  });
});

describe('scanLinkDestinations', () => {
  // Spans are interior-only: strictly between "](" and ")", neither delimiter included.
  test('angle-bracket destination form with a space inside', () => {
    const src = '[x](<a b> "t")';

    assert.deepEqual(spanText(src, scanLinkDestinations(src)), ['<a b> "t"']);
  });

  test('angle-bracket destination with a backslash-escaped ">"', () => {
    const src = '[x](<a\\>b>)';

    assert.deepEqual(spanText(src, scanLinkDestinations(src)), ['<a\\>b>']);
  });

  test('angle-bracket destination unterminated is left unprotected', () => {
    assert.deepEqual(scanLinkDestinations('[x](<abc)'), []);
  });

  test('angle-bracket destination with an embedded raw newline is malformed, left unprotected', () => {
    assert.deepEqual(scanLinkDestinations('[x](<a\nb>)'), []);
  });

  test('bare destination with a backslash-escaped space', () => {
    const src = '[x](a\\ b)';

    assert.deepEqual(spanText(src, scanLinkDestinations(src)), ['a\\ b']);
  });

  test('a backslash-escaped "(" does not open a nesting level', () => {
    // Escaped paren is a literal, not a depth-increment: "a\(b" is the whole destination, leaving "c" with no valid title.
    assert.deepEqual(scanLinkDestinations('[x](a\\(b c)'), []);
  });

  test('leading whitespace/newline between "(" and the destination is skipped', () => {
    const src = '[x](  \n  /path "t")';

    assert.deepEqual(spanText(src, scanLinkDestinations(src)), ['  \n  /path "t"']);
  });

  test("title with a backslash-escaped closing quote doesn't end the title early", () => {
    const src = '[x](/p "a\\"b")';

    assert.deepEqual(spanText(src, scanLinkDestinations(src)), ['/p "a\\"b"']);
  });

  test('paren-delimited title form', () => {
    const src = '[x](/p (a title))';

    assert.deepEqual(spanText(src, scanLinkDestinations(src)), ['/p (a title)']);
  });

  test('unterminated title is left unprotected', () => {
    assert.deepEqual(scanLinkDestinations('[x](/p "no close'), []);
  });

  test('single-quoted title form', () => {
    const src = "[x](/p 'a title')";

    assert.deepEqual(spanText(src, scanLinkDestinations(src)), ["/p 'a title'"]);
  });

  test('trailing content after a title that never reaches ")" is left unprotected', () => {
    assert.deepEqual(scanLinkDestinations('[x](/p "t" stray)'), []);
  });

  test('no "](" anywhere produces no spans', () => {
    assert.deepEqual(scanLinkDestinations('Корвин [Тень] (Амбер) Эрик'), []);
  });

  test('a destination/title exceeding the scan bound fails closed, not silently unprotected', () => {
    const huge = 'a'.repeat(20_000);
    const src = `[x](${huge})`;

    assert.throws(
      () => scanLinkDestinations(src),
      (e) => e.code === 'ERR_MICROTYPO_INPUT' && e.details?.reason === 'link-overlimit'
    );
  });

  test('a long unclosed ]( with no ) anywhere stays literal', () => {
    const src = `[x](${'Амбер'.repeat(2000)}`; // >8192 chars of destination, no ')'
    assert.deepEqual(scanLinkDestinations(src), []);
  });

  test('a ]( whose ) lies past the scan bound throws', () => {
    const src = `[x](${'Амбер'.repeat(2000)})`; // ')' beyond MAX_LINK_SCAN
    assert.throws(
      () => scanLinkDestinations(src),
      (e) => e.details?.reason === 'link-overlimit'
    );
  });

  test('markdown mode: a long unclosed ]( passes through literal, not thrown', () => {
    const out = microtypo(`[x](${'Амбер'.repeat(2000)}`, { input: 'markdown' });
    assert.ok(out.startsWith('[x](Амбер'), `expected literal passthrough: ${out.slice(0, 16)}`);
  });
});

test('over-limit markdown link destination fails closed, never typographed', () => {
  const long = 'a'.repeat(9000);
  const src = `[Амбер](/amber/10-19${long})`;
  assert.throws(
    () => microtypo(src, { input: 'markdown', render: { paragraphs: false } }),
    (e) => e.code === 'ERR_MICROTYPO_INPUT' && e.details?.reason === 'link-overlimit'
  );
});

test('in-bound markdown link destination stays byte-identical (not typographed)', () => {
  const src = '[Амбер](/amber/10-19-foo)';
  const out = microtypo(src, { input: 'markdown', render: { paragraphs: false } });
  assert.ok(out.includes('/amber/10-19-foo'), out);
  assert.ok(!out.includes('10–19'), out);
});
