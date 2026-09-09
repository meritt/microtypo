const join = (base, segment) => (base === '' ? String(segment) : `${base}.${segment}`);

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
export function chainAppend(base, ...positions) {
  let chain = base;

  for (const position of positions) {
    chain = { chain, position };
  }

  return chain;
}

// The chain runs innermost-first, so the walk collects and then flips.
function materialize(chain) {
  const segments = [];

  for (let node = chain; node !== null; node = node.chain) {
    segments.push(node.position);
  }

  return segments.toReversed();
}

// Lazy: nothing reads a path unless the caller passed fields/exclude, and half the spans are keys
// that selectValueSpans discards first. The segment array is carried beside the path because the
// path string is lossy — a literal '.' or a numeric key collides with nesting.
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
    this.#path ??= this.segments.reduce(join, '');

    return this.#path;
  }
}
