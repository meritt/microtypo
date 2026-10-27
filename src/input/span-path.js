// Every span a reader hands out as `[start, end, after]`, walked from the front. `after` is where
// the next construct may begin, which is not `end` wherever a construct is reported by its content
// and closed by a delimiter behind it.
export function collectSpans(next) {
  const spans = [];
  let from = 0;
  let span;

  while ((span = next(from)) !== null) {
    spans.push([span[0], span[1]]);
    from = span[2];
  }

  return spans;
}

// Ancestry is a shared immutable chain, never an array copied into every frame: a frame's key or
// index cannot advance while its child container is open, so the position is fixed the moment the
// child is pushed and the chain extends in constant time. Copying makes nesting quadratic, inside a
// scanner the processing budget never reaches.
//
// A node also carries its depth, which a pointer would otherwise walk to the root for.
export function chainAppend(base, ...positions) {
  let chain = base;

  for (const position of positions) {
    chain = { chain, position, depth: (chain?.depth ?? 0) + 1, pieces: null };
  }

  return chain;
}

// Split once per node: siblings share their ancestors, and a long key above many values would
// otherwise be split again for each of them.
function piecesOf(node) {
  node.pieces ??= String(node.position).split('.');

  return node.pieces;
}

// The chain runs innermost-first, so the walk collects and then flips.
function materialize(chain) {
  const segments = [];

  for (let node = chain; node !== null; node = node.chain) {
    segments.push(node.position);
  }

  return segments.toReversed();
}

// Lazy: selection reads the chain, never these, so `segments` and `path` are built only when asked
// for. The segment array is carried beside the path because the path string is lossy — a literal '.'
// or a numeric key collides with nesting.
export class LocatedSpan {
  #chain;
  #segments = null;
  #path = null;

  // `delim` is the wrapper the splice must strip and put back. It is one character everywhere except
  // a TOML multi-line string, where it is three and a single stray quote inside is legal, and a YAML
  // block or plain scalar, which has none. `guard` is the after-the-run check a span with no wrapper
  // needs instead: what ends a plain scalar is a token inside the value.
  constructor(start, end, isKey, chain, eligible = true, delim = null, guard = null) {
    this.start = start;
    this.end = end;
    this.isKey = isKey;
    this.eligible = eligible;
    this.delim = delim;
    this.guard = guard;
    // Set by a reader whose span lies under a key it cannot name: no selector reaches it either way.
    this.unaddressed = false;
    this.#chain = chain;
  }

  get segments() {
    this.#segments ??= materialize(this.#chain);

    return this.#segments;
  }

  // The chain runs innermost-first, so its own position is the last segment — the same value
  // `segments.at(-1)` gives, without walking the ancestry to build an array that is then thrown
  // away. An indexed selector bucket asks this of every span to reject most of them.
  get tail() {
    return String(this.#chain === null ? '' : this.#chain.position);
  }

  get path() {
    this.#path ??= this.segments.map(String).join('.');

    return this.#path;
  }

  // Selectors read the chain from the head and stop after as many segments as they name, so a run
  // of k nested values costs each selector O(k) in all rather than k(k+1)/2. This one is the last
  // piece of `path` — the same string `path.split('.').at(-1)` gives.
  get dottedTail() {
    return this.#chain === null ? '' : piecesOf(this.#chain).at(-1);
  }

  // `wanted` against the real segments, outermost first, `*` standing for any one of them.
  segmentsMatch(wanted) {
    let node = this.#chain;

    if ((node?.depth ?? 0) !== wanted.length) {
      return false;
    }

    for (let i = wanted.length - 1; i >= 0; i -= 1, node = node.chain) {
      if (wanted[i] !== '*' && wanted[i] !== String(node.position)) {
        return false;
      }
    }

    return true;
  }

  // `wanted` against `path.split('.')`, read backwards through the pieces of each segment.
  dottedMatch(wanted) {
    let i = wanted.length;

    for (let node = this.#chain; node !== null; node = node.chain) {
      const pieces = piecesOf(node);

      for (let p = pieces.length - 1; p >= 0; p -= 1) {
        i -= 1;

        if (i < 0 || (wanted[i] !== '*' && wanted[i] !== pieces[p])) {
          return false;
        }
      }
    }

    // A root value has the empty path, which still splits into one empty piece.
    if (i === wanted.length) {
      return i === 1 && (wanted[0] === '*' || wanted[0] === '');
    }

    return i === 0;
  }
}
