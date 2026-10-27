import assert from 'node:assert/strict';
import { test } from 'node:test';

import { changedRanges } from '../../src/lib/diff.js';

// What every answer must satisfy: the characters of `after` outside the ranges, read in order, are
// a subsequence of `before` — so no change escapes the ranges.
function assertCovers(before, after, ranges) {
  let kept = '';
  let cursor = 0;

  for (const [start, end] of ranges) {
    assert.ok(start >= cursor && end >= start && end <= after.length, `bad range ${start}-${end}`);
    kept += after.slice(cursor, start);
    cursor = end;
  }

  kept += after.slice(cursor);

  let i = 0;

  for (const ch of before) {
    if (i < kept.length && kept[i] === ch) {
      i++;
    }
  }

  assert.equal(i, kept.length, `unchanged text is not a subsequence of the input`);
}

test('identical strings have no changes', () => {
  assert.deepEqual(changedRanges('Корвин', 'Корвин'), []);
  assert.deepEqual(changedRanges('', ''), []);
});

test('a substituted character is one range over it', () => {
  assert.deepEqual(changedRanges('a - b', 'a — b'), [[2, 3]]);
});

test('a deletion is an empty range where it happened', () => {
  assert.deepEqual(changedRanges('a  b', 'a b'), [[2, 2]]);
  assert.deepEqual(changedRanges('ab', ''), [[0, 0]]);
});

test('insertions are covered and touching ranges are merged', () => {
  const after = 'x<b>y</b>';
  const ranges = changedRanges('x y', after);

  assertCovers('x y', after, ranges);
  assert.deepEqual(ranges, [
    [1, 4],
    [5, 9]
  ]);
  assert.deepEqual(changedRanges('', 'abc'), [[0, 3]]);
});

test('typeset quotes and nbsp land on their own characters', () => {
  const before = 'Он сказал: "Привет" - и ушёл';
  const after = 'Он сказал: «Привет» — и ушёл';

  assert.deepEqual(changedRanges(before, after), [
    [11, 12],
    [18, 21]
  ]);
});

test('a change on every other character is still resolved character by character', () => {
  const before = '"a" '.repeat(2000);
  const after = '«a» '.repeat(2000);
  const ranges = changedRanges(before, after);

  assert.equal(ranges.length, 4000);
  assert.deepEqual(ranges.slice(0, 2), [
    [0, 1],
    [2, 3]
  ]);
});

test('stretches with no shared characters are covered whole', () => {
  assert.deepEqual(changedRanges('ab'.repeat(200), 'xy'.repeat(300)), [[0, 600]]);
  assertCovers(
    'ab'.repeat(200),
    `${'xy'.repeat(300)}ab`,
    changedRanges('ab'.repeat(200), `${'xy'.repeat(300)}ab`)
  );
});

test('random edits are always covered', () => {
  let seed = 7;
  const random = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;

    return seed / 2_147_483_648;
  };
  const alphabet = 'ab -"«» ';

  for (let round = 0; round < 300; round++) {
    let before = '';

    for (let i = Math.floor(random() * 40); i > 0; i--) {
      before += alphabet[Math.floor(random() * alphabet.length)];
    }

    let after = '';

    for (const ch of before) {
      const roll = random();

      if (roll < 0.1) {
        continue;
      }

      if (roll < 0.2) {
        after += alphabet[Math.floor(random() * alphabet.length)];
      }

      after += roll < 0.3 ? alphabet[Math.floor(random() * alphabet.length)] : ch;
    }

    assertCovers(before, after, changedRanges(before, after));
  }
});

test('a budget check runs while the texts disagree, and its error stops the diff', () => {
  const before = 'а - б - '.repeat(2000);
  const after = 'а — б — '.repeat(2000);
  const where = [];

  changedRanges(before, after, (at) => where.push(at));
  assert.ok(where.length > 1, `checked ${where.length} times`);
  assert.ok(where.every((at) => at === 'changes'));

  assert.throws(
    () =>
      changedRanges(before, after, () => {
        throw new RangeError('over budget');
      }),
    RangeError
  );
});
