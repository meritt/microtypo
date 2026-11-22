import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MicroTypo } from '../../src/index.js';
import { tagSpans } from '../../src/protect/tag-spans.js';

test('raw and RCDATA HTML bodies own tag-looking text and leave following markup outside', () => {
  for (const input of ['text', 'html']) {
    const typo = new MicroTypo({ input });
    for (const tag of ['xmp', 'noembed', 'title']) {
      assert.equal(
        typo.process(`<${tag}>Корвин - "принц"</${tag}>Амбер - город`),
        `<${tag}>Корвин - "принц"</${tag}>Амбер\u{00A0}— город`
      );
      const body = '<svg><x title=" Корвин - принц';
      const source = `<${tag}>${body}</${tag}><script/>"код" - да</script>Амбер - город`;
      assert.equal(
        typo.process(source),
        `<${tag}>${body}</${tag}><script/>"код" - да</script>Амбер\u{00A0}— город`
      );
      const unclosed = `<${tag}>${body}`;
      assert.equal(typo.process(unclosed), unclosed);
    }
    assert.equal(typo.process('<div>Корвин - принц</div>'), '<div>Корвин\u{00A0}— принц</div>');
  }
});

test('PHP declarations stay whole and own apparent markup inside quotes', () => {
  const source = '<?php echo "<svg>"; ?><script/>"код" - да</script>Корвин - принц';
  assert.equal(
    new MicroTypo().process(source),
    '<?php echo "<svg>"; ?><script/>"код" - да</script>Корвин\u{00A0}— принц'
  );
  assert.deepEqual(
    tagSpans('<?php echo "<b>"; ?><em>текст</em>').map(([s, e]) =>
      '<?php echo "<b>"; ?><em>текст</em>'.slice(s, e + 1)
    ),
    ['<?php echo "<b>"; ?>', '<em>', '</em>']
  );
});

test('a declaration owns an unquoted apparent foreign-content opener', () => {
  const source = '<!x <svg><script/>код - "да"</script>Корвин - принц';
  assert.equal(
    new MicroTypo().process(source),
    '<!x <svg><script/>код - "да"</script>Корвин\u{00A0}— принц'
  );
});

test('a literal Markdown comment opener does not own markup in later paragraphs', () => {
  const typo = new MicroTypo({ input: 'markdown' });
  assert.equal(
    typo.process('Проза <!--\n\n<pre>\nкод - "да"\n</pre>\n--> Корвин - принц'),
    'Проза <!--\n\n<pre>\nкод - "да"\n</pre>\n--> Корвин\u{00A0}— принц'
  );
  assert.equal(
    typo.process('<!-- код - "да" --> Корвин - принц'),
    '<!-- код - "да" --> Корвин\u{00A0}— принц'
  );
  assert.equal(
    typo.process('Проза <!--\n\nКорвин - принц\n-->'),
    'Проза <!--\n\nКорвин\u{00A0}— принц\n-->'
  );
});

test('a malformed Markdown tag cannot hide an author paragraph in the next block', () => {
  for (const format of ['markdown', 'frontmatter']) {
    const typo = new MicroTypo({
      html: true,
      input: format,
      render: { paragraphs: true, hanging: 'class', nowrap: 'nobr' }
    });
    for (const body of ['$$\na - b = «c»\n$$', 'Первая\nВторая']) {
      const source = `> На <<n".\n\n<p>${body}</p>\n\n<div class="x">\nКорвин - принц\n</div>`;
      const expected = source.replace('Корвин - принц', 'Корвин\u{00A0}— принц');
      assert.equal(typo.process(source), expected);
      assert.equal(typo.process(expected), expected);
    }
    const quoted = '<span title="\n\n<p>\nПервая\nВторая\n</p>\n">Амбер</span>';
    const source = `> ${quoted}\n\nКорвин - принц`;
    const expected = `> ${quoted}\n\n<p>Корвин\u{00A0}— принц</p>`;
    assert.equal(typo.process(source), expected);
    assert.equal(typo.process(expected), expected);
    for (const declaration of ['<?php echo "<p>"; ?>', '<!x <p>>']) {
      const output = typo.process(`${declaration}\n\nКорвин - принц`);
      assert.ok(output.includes(declaration));
      assert.ok(output.endsWith('<p>Корвин\u{00A0}— принц</p>'));
      assert.equal(typo.process(output), output);
    }
  }
});

test('HTML end tags with attributes or a slash close protected elements', () => {
  const typo = new MicroTypo();
  for (const tag of ['script', 'style', 'textarea', 'pre', 'code']) {
    for (const suffix of ['/', ' x', ' data-x="a>b"', '\f/']) {
      const source = `<${tag}>код - "да"</${tag}${suffix}>Корвин - принц`;
      assert.equal(
        typo.process(source),
        `<${tag}>код - "да"</${tag}${suffix}>Корвин\u{00A0}— принц`
      );
    }
    const source = `<${tag}>код - "да"</${tag}x>Корвин - принц`;
    assert.equal(typo.process(source), source);
  }
});
