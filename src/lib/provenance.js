import { replacementEdits } from './diff.js';

export class SourceMap {
  constructor(text, offset = 0, checkBudget) {
    this.text = text;
    this.checkBudget = checkBudget;
    this.start = new Uint32Array(text.length);
    this.end = new Uint32Array(text.length);
    this.offset = offset;
    for (let i = 0; i < text.length; i++) {
      if ((i & 0x3fff) === 0) {
        checkBudget?.('trace');
      }
      const paired = text.codePointAt(i) > 0xffff;
      this.start[i] = offset + i;
      this.end[i] = offset + i + (paired ? 2 : 1);
      if (paired) {
        this.start[i + 1] = offset + i;
        this.end[i + 1] = offset + i + 2;
        i++;
      }
    }
  }

  range(start, end) {
    if (start === end) {
      const at = this.start[start] ?? this.end[start - 1] ?? this.offset;
      return [at, at];
    }
    let from = Infinity;
    let to = 0;
    for (let i = start; i < end; i++) {
      if ((i & 0x3fff) === 0) {
        this.checkBudget?.('trace');
      }
      from = Math.min(from, this.start[i]);
      to = Math.max(to, this.end[i]);
    }
    return [from, to];
  }

  slice(start, end = this.text.length) {
    const map = new SourceMap('', this.range(start, start)[0], this.checkBudget);
    map.text = this.text.slice(start, end);
    map.start = this.start.slice(start, end);
    map.end = this.end.slice(start, end);
    return map;
  }

  fork(text) {
    if (text === this.text) {
      return this;
    }
    return this.edited(text, replacementEdits(this.text, text, this.checkBudget));
  }

  edited(text, edits) {
    if (edits.length === 0) {
      return this;
    }
    const next = new SourceMap('', this.offset, this.checkBudget);
    next.text = text;
    next.start = new Uint32Array(text.length);
    next.end = new Uint32Array(text.length);
    let a = 0;
    let b = 0;
    for (const edit of edits) {
      const count = edit.start - a;
      next.start.set(this.start.subarray(a, edit.start), b);
      next.end.set(this.end.subarray(a, edit.start), b);
      b += count;
      if (edit.sourceMap !== undefined) {
        next.start.set(edit.sourceMap.start, b);
        next.end.set(edit.sourceMap.end, b);
      } else {
        const [from, to] = this.range(edit.start, edit.end);
        next.start.fill(from, b, b + edit.text.length);
        next.end.fill(to, b, b + edit.text.length);
      }
      b += edit.text.length;
      a = edit.end;
    }
    next.start.set(this.start.subarray(a), b);
    next.end.set(this.end.subarray(a), b);
    return next;
  }
}

export class RestoreMap {
  constructor() {
    this.stages = [];
  }

  replace(text, pattern, replacement) {
    const edits = [];
    const result = text.replace(pattern, (...args) => {
      const value = replacement(...args);
      if (value !== args[0]) {
        const start = typeof args.at(-1) === 'object' ? args.at(-3) : args.at(-2);
        edits.push({ start, end: start + args[0].length, text: value });
      }
      return value;
    });
    this.record(text, result, edits);
    return result;
  }

  record(before, after, edits) {
    if (edits.length > 0) {
      this.stages.push({ before, after, edits });
    }
  }

  forward(map) {
    let result = map;
    for (const { after, edits } of this.stages) {
      result = result.edited(after, edits);
    }
    return result;
  }

  backward(map) {
    let result = map;
    for (let i = this.stages.length - 1; i >= 0; i--) {
      const { before, edits } = this.stages[i];
      const inverse = [];
      let delta = 0;
      for (const edit of edits) {
        const start = edit.start + delta;
        if (edit.retain) {
          edit.sourceMap = result.slice(start, start + edit.text.length);
        }
        inverse.push({
          start,
          end: start + edit.text.length,
          text: before.slice(edit.start, edit.end)
        });
        delta += edit.text.length - (edit.end - edit.start);
      }
      result = result.edited(before, inverse);
    }
    return result;
  }
}

export function representedMap(map, text, render, sourceProjection, targetProjection) {
  if (map.text === text && sourceProjection === targetProjection) {
    return map;
  }
  const source = new RestoreMap();
  render(sourceProjection?.render(source) ?? map.text, source);
  const target = new RestoreMap();
  const rendered = render(targetProjection?.render(target) ?? text, target);
  return target.backward(source.forward(map).fork(rendered));
}

export function jsonSourceMap(raw, offset, decoded, checkBudget) {
  const map = new SourceMap(decoded, offset + 1, checkBudget);
  let at = 0;
  for (let i = 1; i < raw.length - 1;) {
    if (raw.codePointAt(i) > 0xffff) {
      map.start.fill(offset + i, at, at + 2);
      map.end.fill(offset + i + 2, at, at + 2);
      i += 2;
      at += 2;
      continue;
    }
    const length = raw[i] === '\\' ? (raw[i + 1] === 'u' ? 6 : 2) : 1;
    map.start[at] = offset + i;
    map.end[at++] = offset + i + length;
    i += length;
  }
  return map;
}
