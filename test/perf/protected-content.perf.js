import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MicroTypo } from '../../src/index.js';
import { materialize, realign } from '../../src/inline-lift.js';

test('trimming a lifted suffix keeps markup at the same visible boundary', () => {
  for (const tail of [' ', '\t', '\r\n', '\u{00A0}', '\u{2009}', '\u{FEFF}', ' \t\n\u{00A0}']) {
    for (const closeAt of [5, 5 + tail.length]) {
      const state = {
        visible: `Амбер${tail}`,
        pos: [0, closeAt],
        toks: { str: ['*', '*'], flag: [0, 1], partner: [1, 0] }
      };
      const cx = { near: null, mints: null, engineTags: new Set() };
      const result = realign(state, 'Амбер', cx);
      assert.equal(materialize(result), '*Амбер*');
      assert.deepEqual(result.pos, [0, 5]);
    }
  }
});

const SCENES = [
  ['reference labels', { input: 'markdown' }, (n) => '[a][b] '.repeat(n).trim()],
  [
    'adjacent reference and destination links',
    { input: 'markdown' },
    (n) => '[в доме](/x)[у моря][берег] '.repeat(n)
  ],
  [
    'simple links followed by a nested scope',
    { input: 'markdown' },
    (n) => `${'[a][b] '.repeat(n)}[[в доме][b]][c]`
  ],
  [
    'escaped brackets and image references',
    { input: 'markdown' },
    (n) => '\\[слово][метка] ![в доме][берег] '.repeat(n)
  ],
  [
    'references with emphasis elsewhere',
    { input: 'markdown' },
    (n) => `${'[a][b] '.repeat(n)}*в доме*`
  ],
  [
    'nested link scopes without inner emphasis',
    { input: 'markdown' },
    (n) => `${'[a '.repeat(n)}слово${'][b]'.repeat(n)} *в доме*`
  ],
  [
    'protected addresses',
    {},
    (n) =>
      Array.from({ length: n }, (_, i) => `Корвин в Амбере https://amber.example/${i}`).join('\n')
  ],
  [
    'reserved PUA in text',
    {},
    (n) => 'Текст \u{E000}\u{E001}\u{E100}\u{E101} без изменений. '.repeat(n)
  ],
  [
    'reserved PUA in HTML',
    { input: 'html' },
    (n) => 'Текст \u{E000}\u{E001}\u{E100}\u{E101} без изменений. '.repeat(n)
  ]
];

for (const [name, config, build] of SCENES) {
  test(`${name} grows linearly`, (t) => {
    const typo = new MicroTypo({ ...config, maxInputLength: 1_000_000, maxProcessingMs: 0 });
    const time = (count) => {
      const text = build(count);
      let best = Infinity;
      for (let sample = 0; sample < 3; sample += 1) {
        const started = performance.now();
        for (let repeat = 0; repeat < 5; repeat += 1) {
          typo.process(text);
        }
        best = Math.min(best, performance.now() - started);
      }
      return best;
    };

    time(250);
    const [one, two, four] = [time(250), time(500), time(1_000)];
    const detail = `${name}: N ${one.toFixed(2)}ms, 2N ${two.toFixed(2)}ms, 4N ${four.toFixed(2)}ms (${(four / one).toFixed(2)}x)`;
    t.diagnostic(detail);
    assert.ok(four / one < 8, detail);
  });
}
