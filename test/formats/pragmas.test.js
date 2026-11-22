import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MicroTypoConfigError } from '../../src/errors/index.js';
import { MicroTypo, microtypo } from '../../src/index.js';

const START = '<!-- microtypo-ignore-start -->';
const END = '<!-- microtypo-ignore-end -->';
const FILE = '<!-- microtypo-ignore-file -->';
const config = (format, pragmas = 'microtypo') => ({ html: false, input: { format, pragmas } });

for (const format of ['text', 'html', 'markdown', 'frontmatter']) {
  test(`${format} keeps pragma regions and the comments byte-exactly`, () => {
    const input = `Корвин - принц\n${START}\nКод - "текст"\n${END}\nЭрик - король`;
    const expected = `Корвин\u{00A0}— принц\n${START}\nКод - "текст"\n${END}\nЭрик\u{00A0}— король`;
    assert.equal(microtypo(input, config(format)), expected);
  });
  test(`${format} an unclosed pragma protects to EOF`, () => {
    const input = `Корвин - принц\n${START}\nКод - "текст"\r\n\r\n`;
    assert.equal(
      microtypo(input, config(format)),
      input.replace('Корвин - принц', 'Корвин\u{00A0}— принц')
    );
  });
  test(`${format} ignore-file returns every byte of the document`, () => {
    const input = `\nКорвин - принц\r\n${FILE}\nКод - "текст"\r\n`;
    assert.equal(microtypo(input, config(format)), input);
  });
}

test('frontmatter ignore-file includes the header in the untouched document', () => {
  const input = `---\ntitle: "Корвин - принц"\n---\n\n${FILE}\nКод - "текст"\n`;
  assert.equal(microtypo(input, config('frontmatter')), input);
});

test('frontmatter metadata does not activate a pragma', () => {
  const input = `---\ntitle: '${FILE}'\n---\nКорвин - принц`;
  assert.equal(
    microtypo(input, config('frontmatter')),
    input.replace('Корвин - принц', 'Корвин\u{00A0}— принц')
  );
});

for (const format of ['text', 'html', 'markdown', 'frontmatter']) {
  for (const block of ['raw', 'comment']) {
    test(`${format} ignores a pragma inside a Liquid ${block} body`, () => {
      const options = { html: false, input: { format, template: 'liquid', pragmas: 'microtypo' } };
      const prefix = format === 'frontmatter' ? '---\ntitle: "Амбер - город"\n---\n\n' : '';
      const body = `{% ${block} %}\n${FILE}\nКод - "текст"`;
      for (const close of ['', `\n{% end${block} %}`]) {
        const source = `${prefix}Корвин - принц\n\n${body}${close}`;
        assert.ok(microtypo(source, options).includes(`Корвин\u{00A0}— принц\n\n${body}${close}`));
      }
      const source = `${prefix}Корвин - принц\n\n{% ${block} %}Код - "текст"{% end${block} %}\n\n${FILE}`;
      assert.equal(microtypo(source, options), source);
      const before = `${prefix}${FILE}\n\nКорвин - принц\n\n${body}`;
      assert.equal(microtypo(before, options), before);
    });
  }
}

test('pragmas are off by default', () => {
  const input = `${FILE}\nКорвин - принц`;
  assert.equal(microtypo(input, config('html', 'off')), microtypo(input, { input: 'html' }));
  assert.ok(microtypo(input, { input: 'html' }).includes('Корвин\u{00A0}— принц'));
});

test('a stray end pragma and an unknown directive do not protect prose', () => {
  const source = `${END}\n<!-- microtypo-ignore-unknown -->\nКорвин - принц`;
  assert.equal(
    microtypo(source, config('html')),
    source.replace('Корвин - принц', 'Корвин\u{00A0}— принц')
  );
});

test('a directive in a structured value is ordinary protected comment text', () => {
  const source = JSON.stringify({ title: `${FILE} Корвин - принц` });
  assert.equal(
    microtypo(source, config('json')),
    JSON.stringify({ title: `${FILE} Корвин\u{00A0}— принц` })
  );
});

test('ignore-file does not leak into the next document on the same instance', () => {
  const typo = new MicroTypo(config('html'));
  const source = `${FILE}\nКорвин - принц`;
  assert.equal(typo.process(source), source);
  assert.equal(typo.process('Корвин - принц'), 'Корвин\u{00A0}— принц');
});

test('XML comments do not activate pragmas', () => {
  const source = `<doc>${FILE}Корвин - принц</doc>`;
  assert.equal(microtypo(source, config('xml')), `<doc>${FILE}Корвин\u{00A0}— принц</doc>`);
});

test('nested regions close only at their matching end', () => {
  const input = `${START}A - B ${START}C - D${END} E - F${END}\nКорвин - принц`;
  assert.equal(
    microtypo(input, config('html')),
    input.replace('Корвин - принц', 'Корвин\u{00A0}— принц')
  );
});

for (const [name, protectedText] of [
  ['attribute', `<span title="${FILE}">x</span>`],
  ['code span', `\`${FILE}\``],
  ['code fence', `\`\`\`\n${FILE}\n\`\`\``],
  ['safe element', `<pre>${FILE}</pre>`]
]) {
  test(`a pragma inside ${name} does not ignore the Markdown file`, () => {
    const source = `${protectedText}\nКорвин - принц`;
    assert.equal(microtypo(source, config('markdown')), `${protectedText}\nКорвин\u{00A0}— принц`);
  });
}

test('unknown pragma mode is a typed config error', () => {
  for (const pragmas of [true, [], 'on', 'unknown']) {
    assert.throws(() => microtypo('Текст', config('html', pragmas)), MicroTypoConfigError);
  }
});

for (const format of ['text', 'html', 'markdown', 'frontmatter']) {
  for (const html of [false, true]) {
    for (const paragraphs of [false, true]) {
      test(`${format} unclosed pragma stays outside generated paragraphs (${html}, ${paragraphs})`, () => {
        const typo = new MicroTypo({
          html,
          input: { format, pragmas: 'microtypo' },
          render: { paragraphs, breakline: true }
        });
        const tail = `${START}\nКод - "текст"\n`;
        const source = `Корвин - принц\n${tail}`;
        const output = typo.process(source);
        assert.ok(output.endsWith(tail));
        assert.ok(output.includes('Корвин\u{00A0}— принц'));
        assert.equal(typo.process(output), output);
      });
    }
  }
}

test('a closed pragma still permits paragraphs after its matching end', () => {
  const typo = new MicroTypo({
    html: true,
    input: { format: 'html', pragmas: 'microtypo' },
    render: { paragraphs: true, breakline: true }
  });
  const protectedPart = `${START}\nКод - "текст"\n${END}`;
  const output = typo.process(`${protectedPart}\n\nКорвин - принц`);
  assert.ok(output.includes(protectedPart));
  assert.ok(output.endsWith('<p>Корвин\u{00A0}— принц</p>'));
  assert.equal(typo.process(output), output);
});

for (const format of ['markdown', 'frontmatter']) {
  test(`${format} a stray < glued to a pragma opens no tag that would swallow it`, () => {
    const region = `${START}\nКод - "текст"\n${END}`;
    for (const stray of ['<е', '<e', '<a b=1 ']) {
      const input = `${stray}${region}\nЭрик - король`;
      const expected = `${stray}${region}\nЭрик\u{00A0}— король`;
      assert.equal(microtypo(input, config(format)), expected);
      assert.equal(microtypo(expected, config(format)), expected);
    }
    for (const quote of ['"', "'"]) {
      const input = `Корвин - принц <a title=${quote}${START}${quote}>x</a> Эрик - король`;
      const expected = `Корвин\u{00A0}— принц <a title=${quote}${START}${quote}>x</a>\u{00A0}Эрик\u{00A0}— король`;
      assert.equal(microtypo(input, config(format)), expected);
    }
  });
}

test('a vaulted blockquote prefix does not hide a later pragma behind a malformed tag', () => {
  const input = `a <<a я\n\n> X\n\n~~~\ncode\n~~~\n${START}\nКод - "текст"\n${END}`;
  const typo = new MicroTypo(config('markdown'));
  assert.equal(typo.process(input), input);
  assert.equal(typo.process(typo.process(input)), input);
});

for (const format of ['text', 'html']) {
  test(`${format} a pragma on its own line holds behind a < left open in the text before it`, () => {
    const region = `${START}\nКод - "текст"\n${END}`;
    for (const stray of ['при x <y всё хорошо', 'a <b c', 'x <y z=1']) {
      const input = `${stray}\n${region}`;
      assert.equal(microtypo(input, config(format)), input);
    }
  });

  test(`${format} a pragma inside a quoted attribute value is still no pragma`, () => {
    const input = `<a title="\n${START}">Код - "текст"</a>\n${END}`;
    assert.equal(
      microtypo(input, config(format)),
      `<a title="\n${START}">Код\u{00A0}— «текст»</a>\n${END}`
    );
  });
}
