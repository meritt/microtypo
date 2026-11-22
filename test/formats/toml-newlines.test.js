import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MicroTypoInputError } from '../../src/errors/index.js';
import { MicroTypo } from '../../src/index.js';

test('TOML rejects a bare CR with a clear typed newline error', () => {
  for (const input of ['toml', 'frontmatter']) {
    const typo = new MicroTypo({ input });
    const header = 'a = "Корвин - принц"\rb = "Амбер - город"\r';
    const source = input === 'toml' ? header : `+++\r${header}+++\rТекст`;
    assert.throws(
      () => typo.process(source),
      (error) =>
        error instanceof MicroTypoInputError &&
        error.details?.reason === 'toml-bare-cr' &&
        /LF.*CRLF/.test(error.message)
    );
    for (const ending of ['\n', '\r\n']) {
      const valid = header.replaceAll('\r', ending);
      const body = input === 'toml' ? valid : `+++${ending}${valid}+++${ending}Текст`;
      const expected = body
        .replace('Корвин - принц', 'Корвин\u{00A0}— принц')
        .replace('Амбер - город', 'Амбер\u{00A0}— город');
      assert.equal(typo.process(body), expected);
    }
  }
});

test('a TOML escape spelling a carriage return stays valid', () => {
  const source = 'a = "Корвин\\r - принц"\n';
  assert.equal(new MicroTypo({ input: 'toml' }).process(source), source);
});
