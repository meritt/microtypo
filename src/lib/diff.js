// How many equal characters past a mismatch count as the texts being back in step, longest first.
// A stretch between two such points that is still too long for Myers is walked again with the next.
const ANCHORS = [4, 2, 1];
// Mismatches this short are resolved by trying every split; longer ones by a k-gram index.
const SHORT_SEARCH = 32;
const WINDOW_GROWTH = 4;
// Myers costs the stretch length times the edits in it, so it only ever sees stretches this short.
const MYERS_SPAN = 128;

// Where `after` differs from `before`, as sorted, non-overlapping `[start, end)` ranges over `after`.
// A deletion that leaves nothing behind is the empty range at the point where it happened.
//
// Typesetting changes a text in short, scattered places, and a diff over the whole of it pays for
// every one of them at once: Myers on 30K characters of HTML with entities takes a second, and one
// change every two characters takes it far longer. So the texts are walked in step, at each
// mismatch the nearest point where they agree again is found, and only the short stretch in between
// goes through Myers, which makes it exact. The cost stays linear in the length of both texts.
//
// `checkBudget` is called every so many mismatches, so a caller's time budget covers the diff too.
export function changedRanges(before, after, checkBudget) {
  const ranges = [];
  const steps = { seen: 0, checkBudget };

  walk(before, 0, before.length, after, 0, after.length, 0, ranges, steps);

  return mergeTouching(ranges);
}

function walk(a, aStart, aEnd, b, bStart, bEnd, level, out, steps) {
  const anchor = ANCHORS[level];
  let i = aStart;
  let j = bStart;

  for (;;) {
    if ((steps.seen++ & 0x3f) === 0) {
      steps.checkBudget?.('changes');
    }

    while (i < aEnd && j < bEnd && a[i] === b[j]) {
      i++;
      j++;
    }

    if (i === aEnd || j === bEnd) {
      if (i !== aEnd || j !== bEnd) {
        out.push([j, bEnd]);
      }

      return;
    }

    const [i2, j2] = resync(a, i, aEnd, b, j, bEnd, anchor);

    if (i2 - i + (j2 - j) <= MYERS_SPAN) {
      diffInto(a, i, i2, b, j, j2, out);
    } else if (level + 1 < ANCHORS.length) {
      walk(a, i, i2, b, j, j2, level + 1, out, steps);
    } else {
      out.push([j, j2]);
    }

    i = i2;
    j = j2;
  }
}

// The nearest `[i2, j2]` past a mismatch at `[i, j]` where both texts read the same `anchor`
// characters, or both end — nearest by the number of characters skipped on the two sides together.
function resync(a, i, aEnd, b, j, bEnd, anchor) {
  for (let skipped = 1; skipped <= SHORT_SEARCH; skipped++) {
    for (let di = 0; di <= skipped; di++) {
      if (anchored(a, i + di, aEnd, b, j + skipped - di, bEnd, anchor)) {
        return [i + di, j + skipped - di];
      }
    }
  }

  for (let width = SHORT_SEARCH * 2; ; width *= WINDOW_GROWTH) {
    const found = nearestCommonGram(a, i, aEnd, b, j, bEnd, anchor, width);

    if (found !== null) {
      return found;
    }
  }
}

// A tail shorter than the anchor agrees only if it is the whole rest of both stretches.
function anchored(a, p, aEnd, b, q, bEnd, anchor) {
  if (p > aEnd || q > bEnd) {
    return false;
  }

  const length = Math.min(anchor, aEnd - p, bEnd - q);

  if (length < anchor && aEnd - p !== bEnd - q) {
    return false;
  }

  for (let k = 0; k < length; k++) {
    if (a[p + k] !== b[q + k]) {
      return false;
    }
  }

  return true;
}

// `null` only while the window has not yet reached the end of both stretches.
function nearestCommonGram(a, i, aEnd, b, j, bEnd, anchor, width) {
  const aStop = Math.min(aEnd, i + width);
  const bStop = Math.min(bEnd, j + width);
  const first = new Map();

  for (let p = i; p + anchor <= aStop; p++) {
    const gram = gramHash(a, p, anchor);

    if (!first.has(gram)) {
      first.set(gram, p);
    }
  }

  let best = aStop === aEnd && bStop === bEnd ? [aEnd, bEnd] : null;
  let bestSkipped = best === null ? Infinity : aEnd - i + (bEnd - j);

  for (let q = j; q + anchor <= bStop && q - j < bestSkipped; q++) {
    const p = first.get(gramHash(b, q, anchor));

    // A hash collision can only hide a candidate, never invent one: each is checked before use.
    if (
      p !== undefined &&
      p - i + (q - j) < bestSkipped &&
      anchored(a, p, aEnd, b, q, bEnd, anchor)
    ) {
      best = [p, q];
      bestSkipped = p - i + (q - j);
    }
  }

  return best;
}

// A number rather than a sliced string, so indexing a window allocates nothing per position.
function gramHash(text, start, length) {
  let hash = 0;

  for (let k = 0; k < length; k++) {
    hash = (Math.imul(hash, 65_599) + text.codePointAt(start + k)) | 0;
  }

  return hash;
}

function diffInto(a, aStart, aEnd, b, bStart, bEnd, out) {
  let a0 = aStart;
  let a1 = aEnd;
  let b0 = bStart;
  let b1 = bEnd;

  while (a0 < a1 && b0 < b1 && a[a0] === b[b0]) {
    a0++;
    b0++;
  }

  while (a0 < a1 && b0 < b1 && a[a1 - 1] === b[b1 - 1]) {
    a1--;
    b1--;
  }

  if (a0 === a1 || b0 === b1) {
    if (a0 !== a1 || b0 !== b1) {
      out.push([b0, b1]);
    }

    return;
  }

  const split = middleSnake(a, a0, a1, b, b0, b1);

  if (split === null) {
    out.push([b0, b1]);

    return;
  }

  diffInto(a, a0, split[0], b, b0, split[1], out);
  diffInto(a, split[0], a1, b, split[1], b1, out);
}

// The point where a shortest edit path crosses its middle, found by running Myers' search from both
// ends at once; `null` when the two stretches share nothing.
function middleSnake(a, a0, a1, b, b0, b1) {
  const n = a1 - a0;
  const m = b1 - b0;
  const maxD = Math.ceil((n + m) / 2);
  const offset = maxD;
  const size = 2 * maxD + 2;
  const forward = new Int32Array(size).fill(-1);
  const backward = new Int32Array(size).fill(-1);
  const delta = n - m;
  // Odd delta: the paths can only meet while the forward search moves; even: while the backward does.
  const meetForward = delta % 2 !== 0;
  let k1start = 0;
  let k1end = 0;
  let k2start = 0;
  let k2end = 0;

  forward[offset + 1] = 0;
  backward[offset + 1] = 0;

  for (let d = 0; d < maxD; d++) {
    for (let k1 = -d + k1start; k1 <= d - k1end; k1 += 2) {
      const i = offset + k1;
      let x1 =
        k1 === -d || (k1 !== d && forward[i - 1] < forward[i + 1])
          ? forward[i + 1]
          : forward[i - 1] + 1;
      let y1 = x1 - k1;

      while (x1 < n && y1 < m && a[a0 + x1] === b[b0 + y1]) {
        x1++;
        y1++;
      }

      forward[i] = x1;

      if (x1 > n) {
        k1end += 2;
      } else if (y1 > m) {
        k1start += 2;
      } else if (meetForward) {
        const j = offset + delta - k1;

        if (j >= 0 && j < size && backward[j] !== -1 && x1 >= n - backward[j]) {
          return [a0 + x1, b0 + y1];
        }
      }
    }

    for (let k2 = -d + k2start; k2 <= d - k2end; k2 += 2) {
      const j = offset + k2;
      let x2 =
        k2 === -d || (k2 !== d && backward[j - 1] < backward[j + 1])
          ? backward[j + 1]
          : backward[j - 1] + 1;
      let y2 = x2 - k2;

      while (x2 < n && y2 < m && a[a1 - x2 - 1] === b[b1 - y2 - 1]) {
        x2++;
        y2++;
      }

      backward[j] = x2;

      if (x2 > n) {
        k2end += 2;
      } else if (y2 > m) {
        k2start += 2;
      } else if (!meetForward) {
        const i = offset + delta - k2;

        if (i >= 0 && i < size && forward[i] !== -1) {
          const x1 = forward[i];

          if (x1 >= n - x2) {
            return [a0 + x1, b0 + x1 - (i - offset)];
          }
        }
      }
    }
  }

  return null;
}

function mergeTouching(ranges) {
  const merged = [];

  for (const range of ranges) {
    const last = merged.at(-1);

    if (last !== undefined && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push(range);
    }
  }

  return merged;
}
