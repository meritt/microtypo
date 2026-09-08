import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { microtypo, MicroTypo } from '../../src/index.js';
import {
  codeSpanReader,
  scanCodeSpans,
  scanFences,
  scanIndentedCode,
  scanLinePrefix,
  scanLinkDestinations,
  scanReferenceDefinitions
} from '../../src/input/markdown.js';

const base = { html: false, entities: false };
const md = { ...base, input: 'markdown' };
const mdRender = { ...base, input: { format: 'markdown' }, render: { paragraphs: false } };
const NBSP = '\u{00A0}';

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

    // The four-space-indented ``` does not close: the fence keeps scanning to the last line.
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

  test('a fence opens behind a container prefix and keeps its code', () => {
    for (const [open, body, close] of [
      ['> ```js', '> const x = "а - б";', '> ```'],
      ['- ```js', '  const x = "а - б";', '  ```'],
      ['> ~~~', '> а - б', '> ~~~'],
      ['- ~~~', '  а - б', '  ~~~'],
      ['> > ```', '> > а - б', '> > ```'],
      ['> - ```', '>   а - б', '>   ```'],
      ['1. ```', '   а - б', '   ```']
    ]) {
      const src = `${open}\n${body}\n${close}`;

      assert.deepEqual(spanText(src, scanFences(src)), [src], src);
      assert.equal(microtypo(src, mdRender), src, src);
    }
  });

  test('a fence is bounded by the container it opened in', () => {
    const stray = '> ```\n\nпроза - тут';

    assert.deepEqual(spanText(stray, scanFences(stray)), ['> ```']);
    assert.match(microtypo(stray, mdRender), /проза\u{00A0}— тут/u);

    const listClose = '```\nа - б\n- ```\nв - г\n```';

    assert.deepEqual(spanText(listClose, scanFences(listClose)), [listClose]);
  });

  // A list item is continued by indentation to its content column, a blockquote by repeating its
  // `>`, and the two are different questions.
  test('every container carries its own continuation to the closing fence', () => {
    const CONTAINERS = [
      ['', ''],
      ['> ', '> '],
      ['> > ', '> > '],
      ['- ', '  '],
      ['* ', '  '],
      ['1. ', '   '],
      ['10. ', '    '],
      ['1) ', '   '],
      ['> - ', '>   '],
      ['> 10. ', '>     ']
    ];
    const code = 'const a = "код - тут";';

    for (const [first, cont] of CONTAINERS) {
      for (const [open, close] of [
        ['```', '```'],
        ['```js', '```'],
        ['~~~', '~~~']
      ]) {
        const closed = `${first}${open}\n${cont}${code}\n${cont}${close}\n\nпроза - тут`;
        const out = microtypo(closed, mdRender);

        assert.ok(out.includes(code), `code changed: ${closed} -> ${out}`);
        assert.match(out, /проза\u{00A0}— тут/u, closed);

        // Leaving the container ends the block, so what follows is prose again even with no closer.
        if (first !== '') {
          const unclosed = `${first}${open}\n${cont}${code}\n\nпроза - тут`;
          const loose = microtypo(unclosed, mdRender);

          assert.ok(loose.includes(code), `code changed: ${unclosed} -> ${loose}`);
          assert.match(loose, /проза\u{00A0}— тут/u, unclosed);
        }
      }
    }
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
    // An escaped paren is a literal rather than a depth increment: `a\(b` is the whole destination,
    // leaving `c` with no valid title.
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

describe('code spans of any delimiter length', () => {
  for (const len of [1, 2, 3, 4, 5]) {
    const ticks = '`'.repeat(len);

    test(`${len}-backtick span keeps its interior verbatim`, () => {
      const src = `Мерлин пишет ${ticks}a = "b" - 1${ticks} дальше.`;
      assert.equal(microtypo(src, mdRender), src);
    });
  }

  test('two spans on one line each stay protected', () => {
    const src = 'Мерлин: ```a - "b"``` и ```c - "d"``` готово.';
    assert.equal(microtypo(src, mdRender), src);
  });

  test('a span closes only on a run of its own length', () => {
    const src = 'Мерлин ``a ` b - "c"`` дальше.';
    assert.equal(microtypo(src, mdRender), src);
  });

  test('an unclosed run stays prose and is typeset', () => {
    const out = microtypo('Мерлин ```не закрыл "код" - вот.', mdRender);
    assert.match(out, /«код»\u{00A0}— вот/u);
  });

  test('a triple run inside a fence never opens a span', () => {
    const src = '```\nconst s = "a ``` b";\nnext - line\n```\nКорвин "тут"';
    const out = microtypo(src, mdRender);
    assert.ok(out.includes('next - line'), out);
    assert.match(out, /«тут»/);
  });
});

describe('scanCodeSpans', () => {
  test('interior-only spans, delimiters excluded', () => {
    const src = 'a ```b``` c';

    assert.deepEqual(spanText(src, scanCodeSpans(src)), ['b']);
  });

  test('a longer run does not close a shorter opener', () => {
    const src = '`a``b`';

    assert.deepEqual(spanText(src, scanCodeSpans(src)), ['a``b']);
  });

  test('backtick-free text produces no spans', () => {
    assert.deepEqual(scanCodeSpans('Корвин идёт Тенями в Амбер'), []);
  });

  test('a lone run produces no span', () => {
    assert.deepEqual(scanCodeSpans('Корвин ``` Эрик'), []);
  });

  test('the reader resumes from any position without reading the document again', () => {
    const src = '`а` `б` `в`';
    const next = codeSpanReader(src);

    assert.deepEqual(next(0), [1, 2, 3]);
    assert.deepEqual(next(0), [1, 2, 3], 'asking twice from one place gives one answer');
    assert.deepEqual(next(3), [5, 6, 7]);
    assert.deepEqual(next(7), [9, 10, 11]);
    assert.equal(next(11), null);
  });

  test('a run the walk has spent as a closer cannot open the next span', () => {
    const src = '`а` `б`';
    const next = codeSpanReader(src);
    const first = next(0);

    assert.deepEqual(spanText(src, [first]), ['а']);
    assert.deepEqual(spanText(src, [next(first[2])]), ['б']);
  });
});

// Which of the two opaque inline constructs a stretch belongs to is settled by which opened first,
// read off the document's own bytes and never off a masked copy.
describe('code spans and template expressions against each other', () => {
  const TMPL = {
    input: { format: 'markdown', template: 'mustache' },
    render: { paragraphs: false }
  };

  test('a quote inside a code span still leaves the expression around it unterminated', () => {
    for (const quote of ['"', "'"]) {
      const src = `{{Дворы - Хаоса\`\`x${quote}{{\`\`}}`;

      assert.equal(microtypo(src, TMPL), `{{Дворы${NBSP}— Хаоса\`\`x${quote}{{\`\`}}`, quote);
    }
  });

  test('an expression that opens first keeps the backticks inside it', () => {
    const src = '{{ `Амбер - город` }} Корвин - принц';

    assert.equal(microtypo(src, TMPL), `{{ \`Амбер - город\` }} Корвин${NBSP}— принц`);
  });

  test('a code span that opens first keeps the braces inside it', () => {
    const src = '`{{Амбер - город}}` Корвин - принц';

    assert.equal(microtypo(src, TMPL), `\`{{Амбер - город}}\` Корвин${NBSP}— принц`);
  });

  test('an expression that cuts a code span in half leaves no span behind', () => {
    const src = '{{a`b}}c` Корвин - принц';

    assert.equal(microtypo(src, TMPL), `{{a\`b}}c\` Корвин${NBSP}— принц`);
  });

  test('a quote inside a real expression still hides a close from it', () => {
    const src = '{{ "a }}" }} Корвин - принц';

    assert.equal(microtypo(src, TMPL), `{{ "a }}" }} Корвин${NBSP}— принц`);
  });
});

describe('link reference definitions', () => {
  test('a title keeps its straight quotes and hyphen', () => {
    const src = '[амбер]: /path/to-thing "Хроники - Амбера"';
    assert.equal(microtypo(src, mdRender), src);
  });

  test('an angle-bracket destination is protected', () => {
    const src = '[амбер]: </путь/к цели> "Хроники - Амбера"';
    assert.equal(microtypo(src, mdRender), src);
  });

  test('a paren-delimited title is protected', () => {
    const src = '[амбер]: /p (Хроники - Амбера)';
    assert.equal(microtypo(src, mdRender), src);
  });

  test('a definition without a title is protected', () => {
    const src = '[амбер]: /path/to-thing';
    assert.equal(microtypo(src, mdRender), src);
  });

  test('the paragraph around a definition is still typeset', () => {
    const out = microtypo('Читай "Хроники" [Амбер][амбер] тут.\n\n[амбер]: /p "Т - т"', mdRender);
    assert.match(out, /«Хроники»/);
    assert.match(out, /\[амбер]: \/p "Т - т"/);
  });

  test('a footnote definition stays prose', () => {
    const out = microtypo('[^1]: Дворкин - автор "Образа".', mdRender);
    assert.match(out, /Дворкин\u{00A0}— автор «Образа»/u);
  });

  test('trailing content after the title disqualifies the line', () => {
    const out = microtypo('[амбер]: /p "Т - т" лишнее', mdRender);
    assert.match(out, /«Т\u{00A0}— т»/u);
  });

  // A `>` or a list marker in front is the container's, not the definition's. Guillemets are not a
  // title delimiter CommonMark reads, so a typeset title unmakes the definition, and matching labels
  // do not save it.
  test('a definition behind a container prefix keeps its bytes', () => {
    for (const prefix of ['> ', '- ', '> > ', '> - ', '1. ', '  > ']) {
      const src = `${prefix}[амбер]: /path/to-thing "Хроники - Амбера"`;

      assert.equal(microtypo(src, mdRender), src, src);
    }
  });

  test('a definition behind a prefix still names its uses', () => {
    const src = '> [Корвин - принц]: /p "Т - т"\n>\n> См. [Корвин - принц] тут.';
    const out = microtypo(src, mdRender);

    assert.match(out, /\[Корвин - принц]: \/p "Т - т"/);
    assert.match(out, /См\. \[Корвин - принц] тут\./);
  });
});

describe('indented code versus nested lists', () => {
  test('a list item nested four spaces deep is typeset, not treated as code', () => {
    const out = microtypo('- Корвин "раз"\n  - Рэндом "два"\n    - Мерлин "три"', mdRender);
    assert.equal(out, '- Корвин «раз»\n  - Рэндом «два»\n    - Мерлин «три»');
  });

  test('a code block after a blank line stays verbatim', () => {
    const src = 'Амбер\n\n    const a = "b" - 1;\n\nОтражение';
    assert.ok(microtypo(src, mdRender).includes('    const a = "b" - 1;'));
  });

  test('a multi-line code block keeps every line, including after a blank one', () => {
    const src = 'Амбер\n\n    a = "b" - 1;\n    c = "d" - 2;\n\n    e = "f" - 3;\n\nОтражение';
    const out = microtypo(src, mdRender);
    assert.ok(out.includes('    a = "b" - 1;'), out);
    assert.ok(out.includes('    c = "d" - 2;'), out);
    assert.ok(out.includes('    e = "f" - 3;'), out);
  });

  test('an indented line continuing a paragraph is typeset', () => {
    const out = microtypo('Корвин шёл Тенями\n    и нашёл "Образ" - вот.', mdRender);
    assert.match(out, /«Образ»\u{00A0}— вот/u);
  });
});

describe('leading indentation is structure', () => {
  test('a paragraph continuing a list item keeps its indent', () => {
    assert.equal(
      microtypo('- Корвин "раз"\n\n  Продолжение "два"', mdRender),
      '- Корвин «раз»\n\n  Продолжение «два»'
    );
  });

  test('an ordered list continuation keeps its three spaces', () => {
    assert.equal(
      microtypo('1. Корвин "раз"\n\n   Продолжение "два"', mdRender),
      '1. Корвин «раз»\n\n   Продолжение «два»'
    );
  });

  test('a lazy continuation line keeps its indent', () => {
    assert.equal(
      microtypo('Текст "раз"\n  продолжение "два"', mdRender),
      'Текст «раз»\n  продолжение «два»'
    );
  });

  test('runs of spaces inside a line are still collapsed', () => {
    assert.equal(microtypo('Корвин   шёл   в Амбер.', mdRender), 'Корвин шёл в\u{00A0}Амбер.');
  });
});

describe('scanLinePrefix', () => {
  test('only the leading run of a line with content is a span', () => {
    const src = 'a\n  b\n\n   \n\tc';

    assert.deepEqual(spanText(src, scanLinePrefix(src)), ['  ', '\t']);
  });

  test('unindented text produces no spans', () => {
    assert.deepEqual(scanLinePrefix('Корвин\nЭрик'), []);
  });

  // Every character of the prefix, its white space included: what a rule needs in front of the
  // content is a boundary, and the end of the span is one.
  test('a blockquote chain takes the whole run behind every marker', () => {
    assert.deepEqual(spanText('>   Корвин', scanLinePrefix('>   Корвин')), ['>   ']);
    assert.deepEqual(spanText('>>  Корвин', scanLinePrefix('>>  Корвин')), ['>>  ']);
    assert.deepEqual(spanText('  >  Корвин', scanLinePrefix('  >  Корвин')), ['  >  ']);
    assert.deepEqual(spanText('> \tКорвин', scanLinePrefix('> \tКорвин')), ['> \t']);
  });

  test('a blockquote with no space behind it is still structure', () => {
    assert.deepEqual(spanText('>Корвин', scanLinePrefix('>Корвин')), ['>']);
    assert.deepEqual(spanText('  >Корвин', scanLinePrefix('  >Корвин')), ['  >']);
  });

  test('a marker takes its whole run of spaces', () => {
    assert.deepEqual(spanText('-   Корвин', scanLinePrefix('-   Корвин')), ['-   ']);
    assert.deepEqual(spanText('1.   Корвин', scanLinePrefix('1.   Корвин')), ['1.   ']);
    assert.deepEqual(spanText('###  Амбер', scanLinePrefix('###  Амбер')), ['###  ']);
    assert.deepEqual(spanText('> - Корвин', scanLinePrefix('> - Корвин')), ['> - ']);
  });

  test('what only looks like a marker is not one', () => {
    for (const src of ['---', '#hashtag', '1.5 короны', '#######  Амбер', '-Корвин']) {
      assert.deepEqual(scanLinePrefix(src), [], src);
    }
  });
});

describe('blockquote list markers', () => {
  test('a list marker inside a blockquote stays a marker', () => {
    const out = microtypo('> - Корвин "раз"\n> - Рэндом "два"', mdRender);
    assert.equal(out, '> - Корвин «раз»\n> - Рэндом «два»');
  });

  test('a dash opening a blockquote line without a list is still an em dash', () => {
    const out = microtypo('> Корвин - принц Амбера.', mdRender);
    assert.match(out, /Корвин\u{00A0}— принц/u);
  });

  test('every space of a line prefix survives', () => {
    for (const src of [
      '>   Дворкин пишет законы',
      '>>  Дворкин пишет законы',
      '  >  Дворкин пишет законы',
      '#   Амбер вечен',
      '###  Дорога Теней',
      '-   Корвин',
      '1.   Корвин',
      '> -   Корвин'
    ]) {
      assert.equal(microtypo(src, mdRender), src);
    }
  });

  // A double hyphen needs a space to its left, and the prefix span is what stands there.
  test('a double hyphen inside a blockquote still becomes a dash', () => {
    assert.equal(
      microtypo('Пролог\n> Корвин -- принц\nЭпилог', mdRender),
      `Пролог\n> Корвин\u{00A0}— принц\nЭпилог`
    );
  });

  test('a thematic break is not a list marker', () => {
    assert.equal(microtypo('Корвин\n\n- - -\n\nРэндом', mdRender), 'Корвин\n\n- - -\n\nРэндом');
  });
});

describe('scanIndentedCode', () => {
  test('an indented line after a blank line is code', () => {
    const src = 'Амбер\n\n    код\n';

    assert.deepEqual(spanText(src, scanIndentedCode(src)), ['    код']);
  });

  test('an indented line continuing a paragraph is not code', () => {
    assert.deepEqual(scanIndentedCode('Амбер\n    продолжение\n'), []);
  });

  // One or more chunks separated by blank lines are one block (CommonMark §4.4), so the blank lines
  // between them are inside it and not the engine's to normalise.
  test('blank lines between two indented chunks are inside the block', () => {
    const src = 'Пролог\n\n    merlin.walk("Амбер")\n\n\n    merlin.walk("Хаос")\n';

    assert.deepEqual(spanText(src, scanIndentedCode(src)), [
      '    merlin.walk("Амбер")\n\n\n    merlin.walk("Хаос")'
    ]);
    assert.equal(microtypo(src, md), src.trimEnd());
  });

  test('blank lines after the last chunk stay outside the block', () => {
    const src = 'Пролог\n\n    merlin.walk("Амбер")\n\n\nЭпилог\n';

    assert.deepEqual(spanText(src, scanIndentedCode(src)), ['    merlin.walk("Амбер")']);
  });

  // The indent is counted from the content column, so the `>` and the one space it takes are part
  // of neither the four columns that make the block nor the span.
  test('the content column inside a blockquote is where the indent is counted', () => {
    const src = '>\n>     merlin.walk()\n';

    assert.deepEqual(spanText(src, scanIndentedCode(src)), ['    merlin.walk()']);
    assert.equal(microtypo(src, mdRender), '>\n>     merlin.walk()');
  });

  test('a lazy continuation inside a blockquote is still not code', () => {
    assert.deepEqual(scanIndentedCode('> Амбер\n>     продолжение\n'), []);
  });

  test('entering a blockquote starts a block, so its first indented line is code', () => {
    const src = 'Амбер\n>     merlin.walk()\n';

    assert.deepEqual(spanText(src, scanIndentedCode(src)), ['    merlin.walk()']);
  });

  test('a tab-indented line at the document start is code', () => {
    const src = '\tкод';

    assert.deepEqual(spanText(src, scanIndentedCode(src)), ['\tкод']);
  });

  // Indented code cannot interrupt a paragraph, but a heading, a break and a fence are not
  // paragraphs.
  describe('a block that has finished opens the line under it', () => {
    test('an indented line after an ATX heading is code', () => {
      const src = '# Амбер\n    Корвин - принц';

      assert.deepEqual(spanText(src, scanIndentedCode(src)), ['    Корвин - принц']);
      assert.equal(microtypo(src, mdRender), src);
    });

    test('an indented line after a closed ATX heading is code', () => {
      const src = '## Амбер ##\n    Корвин - принц';

      assert.deepEqual(spanText(src, scanIndentedCode(src)), ['    Корвин - принц']);
    });

    test('seven hashes are prose, so the line under them continues a paragraph', () => {
      assert.deepEqual(scanIndentedCode('####### Амбер\n    Корвин - принц'), []);
    });

    test('an indented line after a thematic break is code', () => {
      const src = '- - -\n    Корвин - принц';

      assert.deepEqual(spanText(src, scanIndentedCode(src)), ['    Корвин - принц']);
    });

    test('an emphasis line is prose, not a break', () => {
      assert.deepEqual(scanIndentedCode('***жирный***\n    Корвин - принц'), []);
    });

    test('an indented line after a setext underline is code', () => {
      const src = 'Амбер\n===\n    Корвин - принц';

      assert.deepEqual(spanText(src, scanIndentedCode(src)), ['    Корвин - принц']);
    });

    test('an indented line after a closed fence is code', () => {
      const src = '```\nmerlin.walk()\n```\n    Корвин - принц';

      assert.equal(microtypo(src, mdRender), src);
    });

    // A setext underline is one `-` or more, three being where it also becomes a thematic break, and
    // it needs the paragraph it underlines: `-` alone elsewhere opens a list item, and the indented
    // line below belongs to that item's content.
    test('a single-dash setext underline ends the paragraph above it', () => {
      const src = 'Амбер\n-\n    Корвин - принц';

      assert.deepEqual(spanText(src, scanIndentedCode(src)), ['    Корвин - принц']);
      assert.equal(microtypo(src, mdRender), src);
    });

    test('a lone dash with no paragraph above it is a list item, not an underline', () => {
      assert.deepEqual(scanIndentedCode('-\n    Корвин - принц'), []);
    });

    // A definition is taken from the front of a paragraph and does not end one, so the indented line
    // under it continues that paragraph rather than starting code: CommonMark 0.31.2 renders this as
    // `<p>Корвин - принц</p>`.
    test('an indented line after a reference definition continues its paragraph', () => {
      assert.equal(
        microtypo('[ref]: /url\n    Корвин - принц', mdRender),
        `[ref]: /url\n    Корвин${NBSP}— принц`
      );
    });

    test('an indented line after a blank line is code again', () => {
      const src = '[ref]: /url\n\n    Корвин - принц';

      assert.equal(microtypo(src, mdRender), src);
    });

    test('an indented line after an HTML block is code', () => {
      const src = '<pre>Амбер</pre>\n    Корвин - принц';

      assert.equal(microtypo(src, mdRender), src);
    });
  });
});

describe('scanReferenceDefinitions', () => {
  test('the whole definition line is one span', () => {
    const src = '[а]: /p "т"';

    assert.deepEqual(spanText(src, scanReferenceDefinitions(src)), [src]);
  });

  test('an empty label is not a definition', () => {
    assert.deepEqual(scanReferenceDefinitions('[]: /p'), []);
  });

  test('a nested bracket in the label is not a definition', () => {
    assert.deepEqual(scanReferenceDefinitions('[a[b]: /p'), []);
  });

  test('no "]:" anywhere produces no spans', () => {
    assert.deepEqual(scanReferenceDefinitions('Корвин идёт в Амбер'), []);
  });

  // CommonMark normalises a label's whitespace and case but not its punctuation, so a definition
  // kept byte-exact while its uses are typeset stops resolving.
  describe('a label is the same bytes wherever it is used', () => {
    const definition = '\n\n[Амбер - Хаос]: /path';

    test('the label of a full reference is protected, its visible text is not', () => {
      const src = `[Книга - том][Амбер - Хаос]${definition}`;

      assert.equal(microtypo(src, mdRender), `[Книга${NBSP}— том][Амбер - Хаос]${definition}`);
    });

    test('a collapsed reference keeps its label', () => {
      const src = `[Амбер - Хаос][]${definition}`;

      assert.equal(microtypo(src, mdRender), src);
    });

    test('a shortcut reference keeps its label', () => {
      const src = `[Амбер - Хаос]${definition}`;

      assert.equal(microtypo(src, mdRender), src);
    });

    test('a reference image keeps its label', () => {
      const src = `![Амбер - Хаос]${definition}`;

      assert.equal(microtypo(src, mdRender), src);
    });

    test('a label matches its definition folded and whitespace-collapsed', () => {
      const src = `[Книга][АМБЕР  -  ХАОС]${definition}`;

      assert.equal(microtypo(src, mdRender), src);
    });

    test('every use of one label is protected', () => {
      const src = `Текст [Книга][Амбер - Хаос] и [Амбер - Хаос] тут.${definition}`;

      assert.equal(microtypo(src, mdRender), src);
    });

    test('brackets with no definition behind them stay prose', () => {
      const src = '[Корвин - принц]\n\n[Амбер]: /path';

      assert.equal(microtypo(src, mdRender), `[Корвин${NBSP}— принц]\n\n[Амбер]: /path`);
    });

    test('the text of an inline link is not a label', () => {
      const src = '[Корвин - принц](/path)\n\n[Амбер]: /path';

      assert.equal(microtypo(src, mdRender), `[Корвин${NBSP}— принц](/path)\n\n[Амбер]: /path`);
    });

    // Only a destination that parses makes an inline link. What follows a `(` that never becomes one
    // is not a destination, and the brackets in front of it may still name a definition.
    test('brackets before an unparseable destination are still a shortcut reference', () => {
      const src = '[Амбер - Хаос](не ссылка)\n\n[Амбер - Хаос]: /path';

      // The label is protected on both sides; what never became a destination is ordinary prose and
      // is typeset like any other.
      assert.equal(
        microtypo(src, mdRender),
        `[Амбер - Хаос](не${NBSP}ссылка)\n\n[Амбер - Хаос]: /path`
      );
    });

    // CommonMark matches labels case-folded, and folding is not lowercasing: `ß` folds to `ss`.
    test('a label matches its definition under a real case fold', () => {
      const src = '[Книга][STRASSE - HAUS]\n\n[Straße - Haus]: /path';

      assert.equal(microtypo(src, mdRender), src);
    });

    // The same address is one vault entry, so both labels read as the same text.
    test('a label holding an address matches the definition holding the same one', () => {
      const src =
        '[Книга][corwin@simonenko.xyz - Корвин]\n\n[corwin@simonenko.xyz - Корвин]: /path';

      assert.equal(microtypo(src, mdRender), src);
    });

    // Two spellings of one address are two placeholders, so the comparison reads the bytes behind
    // them rather than the vault ids.
    test('a label matches an address written in another case', () => {
      const src =
        '[Книга][CORWIN@simonenko.xyz - Корвин]\n\n[corwin@simonenko.xyz - Корвин]: /path';

      assert.equal(microtypo(src, mdRender), src);
    });

    // `ẞ` is already uppercase, so an upper-then-lower pass never reaches the `ß` that folds to `ss`.
    test('a capital sharp s folds like the two letters it stands for', () => {
      const src = '[Книга][STRAẞE - HAUS]\n\n[STRASSE - HAUS]: /path';

      assert.equal(microtypo(src, mdRender), src);
    });
  });
});

// Block structure is resolved before inline, and inline code outranks link grouping. Both hold at
// once: a backtick inside a definition belongs to that block and pairs with nothing outside it,
// while a label may not reach into a code span that the prose around it opened.
describe('block definitions and inline code keep their order', () => {
  test('a backtick inside a definition does not pair with one in the prose', () => {
    const src = '[ref]: /url "title ` text"\n\nКод `a - "b"`';

    assert.equal(microtypo(src, mdRender), src);
  });

  test('a backtick inside a label still opens a code span', () => {
    const src = '[tag `] Корвин - "Рэндом" `\n\n[tag `]: /path';

    assert.equal(microtypo(src, mdRender), src);
  });

  test('a definition and a code span side by side both survive', () => {
    const src = '[амбер]: /url\n\nСмотри `Корвин - принц` и [Книга][амбер] тут';

    assert.equal(microtypo(src, mdRender), src);
  });

  // Code inside a label is part of the label; code the label runs into carries the label's own `]`
  // away and leaves it without an end.
  describe('code inside a label is not code across its edge', () => {
    const definition = '\n\n[a `b` - c]: /path';

    for (const [form, use] of [
      ['a shortcut', '[a `b` - c]'],
      ['a collapsed', '[a `b` - c][]'],
      ['a full', '[Книга][a `b` - c]'],
      ['an image', '![a `b` - c][]']
    ]) {
      test(`${form} reference keeps a label that holds code`, () => {
        const src = use + definition;

        assert.equal(microtypo(src, mdRender), src);
      });
    }

    test('a code span crossing the closing bracket leaves no label behind', () => {
      const src = 'Амбер - Хаос `и] Рэндом` тут';

      assert.equal(microtypo(src, mdRender), `Амбер${NBSP}— Хаос \`и] Рэндом\` тут`);
    });
  });
});

// Protect runs before the pipeline collapses newlines, so every line scanner sees the '\r' itself.
describe('CRLF source', () => {
  test('a blank CRLF line still opens an indented code block', () => {
    const src = 'Пролог\r\n\r\n    Корвин - принц\r\n';

    assert.deepEqual(spanText(src, scanIndentedCode(src)), ['    Корвин - принц']);
    assert.equal(microtypo(src, mdRender), 'Пролог\n\n    Корвин - принц');
  });

  test('a CRLF reference definition is protected', () => {
    const src = '[amber]: http://amber.example "Город"\r\nТекст\r\n';

    assert.equal(microtypo(src, mdRender), '[amber]: http://amber.example "Город"\nТекст');
  });

  test('a whitespace-only CRLF line carries no indent to vault', () => {
    assert.deepEqual(scanLinePrefix('Абзац\r\n  \r\nВторой\r\n'), []);
  });

  // The '\r' sits between the closing run and the newline, so a fence that does not accept it never
  // closes and vaults the rest of the document.
  test('a CRLF fence closes and the text after it is typeset', () => {
    const src = 'Пролог\r\n\r\n```\r\nx - y\r\n```\r\n\r\nЭпилог - конец\r\n';
    const out = microtypo(src, mdRender);

    assert.ok(out.includes('x - y'), out);
    assert.ok(out.includes('Эпилог\u{00A0}— конец'), out);
  });

  test('scanFences ends a CRLF fence at its closing run', () => {
    const src = '```\r\nx\r\n```\r\nдальше\r\n';

    assert.deepEqual(spanText(src, scanFences(src)), ['```\r\nx\r\n```']);
  });
});

// A container is entered by its own token and continued by its own rule, and the two do not
// commute: one depth plus one summed indent carries neither the order nor the columns.
describe('block containers and columns', () => {
  test('an empty CRLF line stays inside the list item holding the fence', () => {
    const src = '- ~~~\r\n\r\n  код - тут';

    assert.equal(microtypo(src, md), src);
  });

  test('a tab continues a list item to its content column', () => {
    const src = '- ~~~\n\tкод - тут\n  еще - код\n  ~~~\n\nпроза - тут';

    assert.equal(
      microtypo(src, mdRender),
      `- ~~~\n\tкод - тут\n  еще - код\n  ~~~\n\nпроза${NBSP}— тут`
    );
  });

  // A tab is never split, so one straddling a container's content column carries the cursor past it,
  // and every column-counted bound still counts from the column the container declares.
  test('the columns a straddling tab spends are not lost', () => {
    assert.equal(microtypo('-\t\tкод - тут', md), '-\t\tкод - тут');
    assert.equal(microtypo('- ~~~\n\t  ~~~\n  код - тут', md), '- ~~~\n\t  ~~~\n  код - тут');
    assert.equal(microtypo('-\tпункт - тут', mdRender), `-\tпункт${NBSP}— тут`);
  });

  test('a tab past a blockquote is two columns, not a code block', () => {
    assert.equal(microtypo('> \tпроза - тут', mdRender), `> \tпроза${NBSP}— тут`);
    assert.equal(microtypo('> \t~~~\n> код - тут', md), '> \t~~~\n> код - тут');
  });

  // The tab is what sets the column, so collapsing it stops the line behind it being a fence.
  test('a quote prefix reaches the output with its tab intact', () => {
    const source = '> > Корвин\n> > \t~~~\n> > Мерлин - чародей';

    assert.equal(microtypo(source, md), `> > Корвин\n> > \t~~~\n> > Мерлин${NBSP}— чародей`);
  });

  test('a container prefix does not change how the content behind it is typeset', () => {
    for (const prefix of ['> ', '>  ', '- ', '* ', '1. ', '# ', '> - ', '- > ', '>> ']) {
      for (const body of ['-- Корвин', 'Корвин - принц', 'т. е. Амбер', '5 -- 7']) {
        assert.equal(
          microtypo(prefix + body, mdRender),
          prefix + microtypo(body, mdRender),
          `${prefix}|${body}`
        );
      }
    }
  });

  test('leaving the list item ends the fence its blockquote held', () => {
    assert.equal(microtypo('- > ~~~\n> проза - тут', mdRender), `- > ~~~\n> проза${NBSP}— тут`);
  });

  test('a quote marker inside a fence is content, not a container', () => {
    const src = '- ~~~\n  > код - тут';

    assert.equal(microtypo(src, md), src);
  });

  test('the prefix protects every container on the line, not one of each', () => {
    assert.equal(microtypo('- > - проза - тут', mdRender), `- > - проза${NBSP}— тут`);
  });

  test('five spaces after a marker make the rest code inside the item', () => {
    for (const src of ['-     код - тут', '- >     код - тут']) {
      assert.equal(microtypo(src, md), src);
    }
  });

  test('a paragraph indented under its list item is prose, not code', () => {
    assert.equal(
      microtypo('- пункт\n\n    проза - тут', mdRender),
      `- пункт\n\n    проза${NBSP}— тут`
    );
  });

  test('a thematic break opens no list item', () => {
    const src = '- - -\n    Корвин - принц';

    assert.deepEqual(spanText(src, scanIndentedCode(src)), ['    Корвин - принц']);
  });
});

describe('container prefix and what may open one', () => {
  test('four columns of indent is code, not a fence', () => {
    assert.equal(microtypo('    ~~~\nпроза - тут', mdRender), `    ~~~\nпроза${NBSP}— тут`);
    assert.equal(microtypo('   ~~~\nкод - тут\n   ~~~', md), '   ~~~\nкод - тут\n   ~~~');
  });

  // An item's content column is an offset from its own container's, not an absolute one: a
  // blockquote prefix spelled with a different indent moves everything inside it.
  test('a shifted blockquote prefix moves the item column with it', () => {
    assert.equal(microtypo('> - ~~~\n  > проза - тут', mdRender), `> - ~~~\n  > проза${NBSP}— тут`);
    // Indentation to the item's content column is what continues it; a second marker opens a new
    // item instead, and the fence of the one above ends there.
    assert.equal(microtypo('> - ~~~\n>   код - тут', md), '> - ~~~\n>   код - тут');
    assert.equal(microtypo('> - ~~~\n> - проза - тут', mdRender), `> - ~~~\n> - проза${NBSP}— тут`);
  });

  // A list interrupts a paragraph only on its own terms: content on its first line, and 1 if it is
  // ordered.
  test('a non-interrupting list does not open under a paragraph', () => {
    assert.equal(
      microtypo('вступление\n10.     проза - тут', mdRender),
      `вступление\n10.     проза${NBSP}— тут`
    );
    assert.equal(microtypo('10.     код - тут', md), '10.     код - тут');
    assert.equal(microtypo('вступление\n-     код - тут', md), 'вступление\n-     код - тут');
  });

  // Paragraph state belongs to its own container: a line that opens one starts a block the paragraph
  // outside cannot reach into.
  test('a definition opening a container of its own is still a definition', () => {
    const src = 'x\n> [r]: / "код - тут"\n\n[r]';

    assert.equal(microtypo(src, md), src);
  });

  test('a title standing in a container of its own is not the definition above', () => {
    assert.equal(microtypo('[r]: /\n> "код - тут"', mdRender), `[r]: /\n> «код${NBSP}— тут»`);
  });

  // A continuation line may drop the prefixes it stands under, which is what makes it lazy, and a
  // definition whose title is not a title is no definition. CommonMark §5.1.
  test('a lazy title need not repeat the containers it stands in', () => {
    const src = '> [r]: /\n"код - тут"\n\n[r]';

    assert.equal(microtypo(src, md), src);
  });

  // A second marker opens a second item, and the definition in the first one does not reach into it.
  test('a title behind a marker of its own is prose', () => {
    assert.equal(
      microtypo('- [r]: /path\n- "код - тут"', mdRender),
      `- [r]: /path\n- «код${NBSP}— тут»`
    );
  });

  // The definition stands at its item's own content column, which the line above it establishes.
  test('a definition on a continuation line keeps its list context', () => {
    const src = '10. x\n\n    [r]: / "код - тут"\n\n[r]';

    assert.equal(microtypo(src, md), src);
  });

  test('a fence on a continuation line keeps its list context', () => {
    const src = '10. x\n\n    ~~~\n    код - тут\n    ~~~';

    assert.equal(microtypo(src, md), src);
  });

  // The `>` is not a break character, so a break read from the head of the line is invisible behind
  // one.
  test('a thematic break is recognised behind a container prefix', () => {
    const src = '> * * *\n>     код - тут';

    assert.equal(microtypo(src, md), src);
    assert.equal(microtypo('> - - -\n>     код - тут', md), '> - - -\n>     код - тут');
  });

  // A tab is never split by index, so the optional space after `>` takes one of its columns and the
  // rest stay indentation. CommonMark §2.2 reads `>\t\tfoo` as code with two spaces left over.
  test('a tab after the blockquote marker lends it one column', () => {
    assert.equal(microtypo('> текст\n>\n>\t\tкод - тут', md), '> текст\n>\n>\t\tкод - тут');
    // One tab leaves two columns of indent, which is prose. The prefix's own tab is collapsed by
    // `collapse_spaces` on the way out, so only what the columns decided is asserted here.
    assert.ok(microtypo('> текст\n>\n>\tпроза - тут', mdRender).includes(`проза${NBSP}— тут`));
    assert.equal(
      microtypo('> 1. ~~~\n>\t~~~\n>    код - тут', md),
      '> 1. ~~~\n>\t~~~\n>    код - тут'
    );
  });
});

// A template expression is opaque bytes, so a backtick inside it is not a delimiter.
describe('a template expression is opaque to the inline scanners', () => {
  for (const template of ['handlebars', 'mustache', 'twig', 'jinja', 'nunjucks', 'liquid']) {
    test(`a backtick inside an expression is no delimiter (${template})`, () => {
      const cfg = { input: { format: 'markdown', template } };
      const src = '{{ "`Амбер" }} `';

      assert.equal(microtypo(src, cfg), src);
    });
  }

  // The other direction of the same rule: a backtick standing before the `{{` opens a code span
  // first, and the expression cannot reach into it.
  test('a code span opened first keeps its closer', () => {
    const cfg = { input: { format: 'markdown', template: 'handlebars' } };
    const src = '`Корвин - принц {{ x` }}';

    assert.equal(microtypo(src, cfg), src);
  });

  // The reference reader decides which labels are uses by where the code spans fall, and has to see
  // the same spans the pipeline will.
  test('a reference use survives beside a template expression', () => {
    const cfg = { input: { format: 'markdown', template: 'handlebars' } };
    const src = '{{ "`Амбер" }} [Путь - Корвина] `\n\n[Путь - Корвина]: /path';

    assert.equal(microtypo(src, cfg), src);
  });

  // The other half: a block construct still wins where the two interleave, so an expression cannot
  // reach across a fence and take it apart.
  test('a fence still bounds what an expression may span', () => {
    const cfg = { input: { format: 'markdown', template: 'handlebars' } };
    const src = '```\n{{ "Амбер\n```\n" }}';

    assert.equal(microtypo(src, cfg), microtypo(src, cfg));
    assert.ok(microtypo(src, cfg).startsWith('```\n{{ "Амбер\n```'));
  });

  // Which construct owns a stretch is decided by the opener that really comes first, and the two
  // lists are each right only about the text the other one leaves.
  describe('the two opaque constructs are settled by the first real opener', () => {
    const cfg = { input: { format: 'markdown', template: 'handlebars' } };

    test('a template dropped for a code span that never existed is found again', () => {
      const src = '{{ "`" }} {{ "Амбер - Хаос" }} `';

      assert.equal(microtypo(src, cfg), src);
    });

    test('a template swallowed by an opener inside a code span is found again', () => {
      const src = '`x {{ y` {{ "Амбер - Хаос" }}';

      assert.equal(microtypo(src, cfg), src);
    });

    test('a template overlapping a re-found code span does not duplicate it', () => {
      const src = '{{ "`" }} `x {{ "Амбер - Хаос" }}`';

      assert.equal(microtypo(src, cfg), src);
    });

    test('a backtick immediately in front of an opener owns it', () => {
      const src = '`{{` Амбер - Хаос {{ "Мерлин" }}';

      assert.equal(microtypo(src, cfg), `\`{{\` Амбер${NBSP}— Хаос {{ "Мерлин" }}`);
    });

    test('a document whose two constructs alternate stays linear', () => {
      const src = '{{ ` }}'.repeat(2000);

      assert.equal(microtypo(src, cfg), src);
    });
  });
});

// A fenced block interrupts a paragraph, so the line that opens one is not a lazy continuation of
// the paragraph above it and does not keep the containers that line has left.
describe('a fence opener is not a lazy continuation', () => {
  test('a fence under a blockquote paragraph opens outside the quote', () => {
    const src = '> Корвин\n~~~\nМерлин - чародей';

    assert.equal(microtypo(src, md), src);
    assert.deepEqual(scanFences(src), [[9, src.length]]);
  });

  test('a fence under a list item paragraph opens outside the item', () => {
    const src = '- Корвин\n~~~\nМерлин - чародей';

    assert.equal(microtypo(src, md), src);
  });

  test('a backtick fence behaves the same as a tilde one', () => {
    const src = '> Корвин\n```\nМерлин - чародей';

    assert.equal(microtypo(src, md), src);
  });

  test('ordinary prose after a quote is still the lazy continuation it was', () => {
    assert.equal(
      microtypo('> Корвин\nМерлин - чародей\n\n- пункт', md),
      `> Корвин\nМерлин${NBSP}— чародей\n\n- пункт`
    );
  });

  test('four columns in, the same run is indented code and interrupts nothing', () => {
    assert.equal(
      microtypo('> Корвин\n    ~~~ - тут\nМерлин - чародей', md),
      `> Корвин\n    ~~~${NBSP}— тут\nМерлин${NBSP}— чародей`
    );
  });
});

// A paragraph belongs to the container it stands in and what it forbids reaches no further, while a
// line that leaves a container and opens nothing continues that same paragraph. Both halves hold at
// once.
describe('paragraph state belongs to its own container', () => {
  test('a list outside the container it left may open', () => {
    const src = '> Амбер\n2. [r]: / "Принцы - Амбера"\n\n[r]';

    assert.equal(microtypo(src, md), src);
    assert.equal(
      microtypo('- Амбер\n2. [r]: / "Принцы - Амбера"\n\n[r]', md),
      '- Амбер\n2. [r]: / "Принцы - Амбера"\n\n[r]'
    );
  });

  test('a line that opens nothing there is lazy continuation', () => {
    assert.equal(
      microtypo('> вступление\n[r]: /path "заголовок - тут"\n\n[r]', mdRender),
      `> вступление\n[r]: /path «заголовок${NBSP}— тут»\n\n[r]`
    );
    assert.equal(
      microtypo('- вступление\n[r]: /path "заголовок - тут"\n\n[r]', mdRender),
      `- вступление\n[r]: /path «заголовок${NBSP}— тут»\n\n[r]`
    );
  });

  // The number the marker means, not the way it is spelled.
  test('a zero-padded ordered marker still starts at one', () => {
    for (const marker of ['1.', '01.', '001.', '1)', '01)']) {
      const src = `Амбер\n${marker} [r]: / "Принцы - Амбера"\n\n[r]`;

      assert.equal(microtypo(src, md), src, marker);
    }
  });

  test('a marker that is not one may not interrupt', () => {
    assert.equal(
      microtypo('Амбер\n02. [r]: / "Принцы - Амбера"\n\n[r]', mdRender),
      `Амбер\n02. [r]: / «Принцы${NBSP}— Амбера»\n\n[r]`
    );
  });

  // The fence reader carries paragraph state too, or a list that cannot exist opens there and its
  // `~~~` is read as a fence.
  test('the fence reader knows the paragraph too', () => {
    const src = 'Корвин\n2. ~~~\n   ~~~\nМерлин - чародей';

    assert.equal(microtypo(src, md), src);
    assert.equal(
      microtypo('10. Корвин\n    2. ~~~\n       Мерлин - чародей', mdRender),
      `10. Корвин\n    2. ~~~\n       Мерлин${NBSP}— чародей`
    );
  });

  // A line carrying a container marker is not blank, even when nothing follows the marker.
  test('a quote-only line keeps its indentation', () => {
    const src = '10. > Амбер\n    >\n    > Корвин';

    assert.equal(microtypo(src, md), src);
  });

  // Neither indented code nor an empty list item is a paragraph, so the list under one may open.
  test('a block that is no paragraph does not refuse the list under it', () => {
    for (const prelude of ['    Амбер', '-', '*', '10.']) {
      const src = `${prelude}\n2. ~~~\n   Мерлин - чародей`;

      assert.equal(microtypo(src, md), src, JSON.stringify(prelude));
    }
  });

  // A definition is taken from the front of a paragraph and does not end one, so the list under it
  // may not interrupt — CommonMark keeps `2. ~~~` as prose and opens the fence on the line below.
  test('a definition leaves its paragraph open', () => {
    const src = '[r]: /\n2. ~~~\n   ~~~\nМерлин - чародей';

    assert.equal(microtypo(src, md), src);
  });

  // The paragraph a list would have to interrupt is the one outside every container the line has
  // already opened: inside a blockquote just opened there is none.
  test('a container opened on the line clears what the outer paragraph forbids', () => {
    const src = 'Амбер\n> 2. [r]: / "Принцы - Амбера"\n\n[r]';

    assert.equal(microtypo(src, md), src);
  });

  // Laziness does not close the container it continues, so the line after a lazy one still stands
  // outside a quote that is still open — and the list it opens closes that quote instead.
  test('a lazy continuation keeps its container open', () => {
    const src = '> Амбер\nРэндом\n2. [r]: / "Принцы - Амбера"\n\n[r]';

    assert.equal(microtypo(src, md), src);
  });

  // A blank line matches the chain in front of its first blockquote, which is a number the chain
  // carries rather than a walk per blank line.
  test('blank lines under a deep chain stay linear', () => {
    const k = 8000;
    const source = `${'- '.repeat(k)}Корвин\n${'\n'.repeat(k)}Амбер`;
    const started = performance.now();

    microtypo(source, { input: 'markdown', maxProcessingMs: 0 });
    assert.ok(performance.now() - started < 60, 'the fence scanner re-walked the saved depth');
  });
});

// A backslash escapes the backtick behind it and only that one, so the rest of the run still opens a
// span, while closing keeps counting the whole run: inside a span a backslash is literal content.
describe('an escaped backtick takes one backtick, not the run', () => {
  test('the suffix of an escaped run still opens a span', () => {
    assert.equal(microtypo('\\``код - тут`', md), '\\``код - тут`');
    assert.equal(microtypo('\\```код - тут``', md), '\\```код - тут``');
  });

  test('an escape on both ends is two escapes, not a pair', () => {
    assert.equal(microtypo('\\`не код - тут\\`', mdRender), `\\\`не код${NBSP}— тут\\\``);
  });

  test('a run whose only backtick is escaped still closes a span', () => {
    assert.equal(microtypo('`код - тут\\`', md), '`код - тут\\`');
  });
});

describe('inline constructs across line endings', () => {
  // CRLF is one line ending, and whitespace inside a link's parentheses spans it.
  test('a CRLF inside a link tail keeps it a link', () => {
    const src = '[x](</path>\r\n "заголовок - тут")';

    assert.equal(microtypo(src, md), src);
  });

  // The run after the title spans the ending too, so a tail read without the `\r` never reaches
  // its `)`.
  test('a CRLF between a link title and its closing paren keeps it a link', () => {
    const src = '[Отражение](/pattern "Путь Корвина - к Амберу"\r\n)';

    assert.equal(microtypo(src, md), src);
  });

  // CommonMark reads a destination and the title under it as one definition.
  test('a title on the line under the destination stays part of the definition', () => {
    const src = '[r]: /path\n  "заголовок - тут"\n\n[r]';

    assert.equal(microtypo(src, md), src);
  });

  // A definition cannot interrupt a paragraph, so under one the same bytes are ordinary prose.
  test('a definition-shaped line under a paragraph is typeset', () => {
    const out = microtypo('вступление\n[метка - тут]: /path "заголовок - тут"\n\n[метка - тут]', {
      ...mdRender
    });

    assert.ok(out.includes(`[метка${NBSP}— тут]: /path «заголовок${NBSP}— тут»`), out);
  });

  // An escape is a rule about opening a span, not about closing one: inside a span a backslash is
  // literal content. CommonMark example 348.
  test('a backslash inside a code span does not take its closing backtick away', () => {
    for (const src of ['`код - тут\\`', '``код - тут\\``', '`код\\` и `ещё - тут`']) {
      const out = microtypo(src, mdRender);

      assert.ok(out.includes('код - тут') || out.includes('код\\'), out);
    }

    assert.equal(microtypo('`код - тут\\`', mdRender), '`код - тут\\`');
  });

  // A code span lives inside one paragraph, and a backslash-escaped backtick is an escape.
  test('backticks do not pair across a blank line or out of an escape', () => {
    const across = microtypo('проза `код - тут\n\nещё - проза` конец', mdRender);
    const escaped = microtypo('проза \\`не код - тут\\` конец', mdRender);

    assert.ok(across.includes(`код${NBSP}— тут`), across);
    assert.ok(escaped.includes(`не код${NBSP}— тут`), escaped);
    assert.equal(microtypo('проза `код - тут` конец', mdRender), 'проза `код - тут` конец');
  });
});
