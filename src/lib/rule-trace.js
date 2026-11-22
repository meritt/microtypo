import { replacementEdits } from './diff.js';
import { representedMap } from './provenance.js';
import { sessionMap } from './session-maps.js';

const TRACES = sessionMap();

export function bindRuleTrace(ctx, trace) {
  TRACES.set(ctx, trace);
}

export function unbindRuleTrace(ctx) {
  TRACES.delete(ctx);
}

export function ruleTraceOf(ctx) {
  return TRACES.get(ctx);
}

export class RuleTrace {
  constructor(frame, entries) {
    this.frame = frame;
    this.entries = entries;
    this.pending = null;
    this.accepted = [];
  }

  begin(rule, text) {
    this.rule = `${rule.groupName}.${rule.id}`;
    this.kind = rule.kind ?? 'handler';
    this.accepted = [];
    this.pending = null;
    const frame = this.frame();
    frame.map = representedMap(frame.map, text, frame.render);
  }

  inputMap(text, projection) {
    const frame = this.frame();
    const previous = this.accepted.at(-1);
    return representedMap(
      previous?.map ?? frame.map,
      text,
      frame.render,
      previous?.projection,
      projection
    );
  }

  execute(text, apply, handler = false, projection) {
    const map = this.retryMap ?? this.inputMap(text, projection);
    this.retryMap = undefined;
    this.pending = {
      map,
      inputMap: map,
      projection: projection ?? this.retryProjection,
      count: 0,
      ranges: []
    };
    this.retryProjection = undefined;
    return handler ? this.handler(text, apply) : apply();
  }

  handler(text, apply) {
    const { pending } = this;
    const map = pending.map.fork(text);
    const output = apply();
    if (output !== text) {
      const edits = replacementEdits(text, output, map.checkBudget);
      pending.count++;
      for (const { start, end } of edits) {
        pending.ranges.push(map.range(start, end));
      }
      pending.map = map.edited(output, edits);
    }
    return output;
  }

  replace(text, re, replacement) {
    const { pending } = this;
    const map = pending.map.text === text ? pending.map : pending.map.fork(text);
    const edits = [];
    const output = text.replace(re, (...args) => {
      const result = `${replacement(args)}`;
      if (result !== args[0]) {
        const offset =
          args.at(-1) !== null && typeof args.at(-1) === 'object' ? args.at(-3) : args.at(-2);
        pending.count++;
        pending.ranges.push(map.range(offset, offset + args[0].length));
        edits.push({ start: offset, end: offset + args[0].length, text: result });
      }
      return result;
    });
    pending.map = map.edited(output, edits);
    return output;
  }

  accept(projection) {
    if (this.pending !== null) {
      if (projection !== undefined) {
        const previous = this.pending.projection;
        if (previous?.tokens === projection.tokens) {
          for (let i = 0; i < projection.edits.length; i++) {
            projection.edits[i].sourceMap = previous.edits[i].sourceMap;
          }
        }
        if (this.pending.map.text !== projection.text) {
          this.pending.map = representedMap(
            this.pending.map,
            projection.text,
            this.frame().render,
            undefined,
            projection
          );
        }
      }
      this.pending.projection = projection;
      this.accepted.push(this.pending);
      this.pending = null;
    }
  }

  discard() {
    this.pending = null;
    this.retryMap = undefined;
    this.retryProjection = undefined;
  }

  seal(text, edits) {
    this.retryMap = this.pending.inputMap.edited(text, edits);
    this.retryProjection = this.pending.projection;
  }

  unseal(text, edits) {
    this.pending.map = this.pending.map.edited(text, edits);
  }

  finish(text) {
    const frame = this.frame();
    const count = this.accepted.reduce((n, event) => n + event.count, 0);
    if (count > 0) {
      let entry = this.entries.find((item) => item.rule === this.rule && item.kind === this.kind);
      if (entry === undefined) {
        entry = { rule: this.rule, kind: this.kind, count: 0, ranges: [] };
        this.entries.push(entry);
      }
      entry.count += count;
      for (const event of this.accepted) {
        for (const range of event.ranges) {
          entry.ranges.push(range);
        }
      }
    }
    const previous = this.accepted.at(-1);
    frame.map = representedMap(
      previous?.map ?? frame.map,
      text,
      frame.render,
      previous?.projection
    );
    this.pending = null;
  }
}

export function stringReplacement(template, args) {
  const groups = typeof args.at(-1) === 'object' ? args.at(-1) : undefined;
  const offset = groups === undefined ? args.at(-2) : args.at(-3);
  const source = groups === undefined ? args.at(-1) : args.at(-2);
  const captures = args.slice(1, groups === undefined ? -2 : -3);
  return template.replace(/\$(\$|&|`|'|[0-9]{1,2}|<[^>]*>)/g, (match, key) => {
    if (key === '$') {
      return '$';
    }
    if (key === '&') {
      return args[0];
    }
    if (key === '`') {
      return source.slice(0, offset);
    }
    if (key === "'") {
      return source.slice(offset + args[0].length);
    }
    if (key.startsWith('<')) {
      return groups === undefined ? match : (groups[key.slice(1, -1)] ?? '');
    }
    const n = Number(key);
    if (n > 0 && n <= captures.length) {
      return captures[n - 1] ?? '';
    }
    const first = Number(key[0]);
    return key.length === 2 && first > 0 && first <= captures.length
      ? (captures[first - 1] ?? '') + key[1]
      : match;
  });
}
