const OPEN = '{';
const CLOSE = '}';
const COMPLEX_TYPES = new Set(['plural', 'selectordinal', 'select']);
const ARGUMENT = /[\p{L}\p{N}_]+/uy;
const NUMBER = /[+-]?(?:\d+(?:\.\d*)?|\.\d+)/y;
const PRINTF_FLAGS = new Set(['-', '+', ' ', '#', '0', "'"]);
const PRINTF_TYPES = new Set('diuoxXfFeEgGaAcspn@');

const whitespace = (ch) => ch !== undefined && /\s/u.test(ch);
const digit = (ch) => ch >= '0' && ch <= '9';

function spaces(text, at, end) {
  let next = at;
  while (next < end && whitespace(text[next])) {
    next += 1;
  }
  return next;
}

function quotedEnd(text, start, limit, checkBudget) {
  if (text[start + 1] === "'") {
    return start + 2;
  }
  let at = start + 1;

  while (at < limit) {
    if ((at & 0x3fff) === 0) {
      checkBudget?.('localization');
    }
    if (text[at] === "'") {
      if (text[at + 1] !== "'") {
        return at + 1;
      }
      at += 1;
    }
    at += 1;
  }

  return limit;
}

function bracePairs(text, checkBudget) {
  const paired = new Int32Array(text.length).fill(-1);
  const stack = [];
  let nextCheck = 0;
  for (let at = 0; at < text.length; at += 1) {
    if (at >= nextCheck) {
      checkBudget?.('localization');
      nextCheck = at + 0x4000;
    }
    const outer = stack.at(-1);
    const next = text[at + 1];
    if (
      text[at] === "'" &&
      (next === "'" || next === OPEN || next === CLOSE || (outer?.plural && next === '#'))
    ) {
      at = quotedEnd(text, at, text.length, checkBudget) - 1;
    } else if (text[at] === OPEN) {
      const head = outer?.complex ? null : argumentHead(text, at, text.length);
      stack.push({
        at,
        complex: head !== null && COMPLEX_TYPES.has(head.type),
        plural: outer?.complex ? outer.type !== 'select' : false,
        type: head?.type
      });
    } else if (text[at] === CLOSE && stack.length > 0) {
      paired[stack.pop().at] = at;
    }
  }
  return paired;
}

function argumentHead(text, start, end) {
  let at = spaces(text, start + 1, end);
  ARGUMENT.lastIndex = at;
  const name = ARGUMENT.exec(text);
  if (name === null) {
    return null;
  }
  at = spaces(text, ARGUMENT.lastIndex, end);
  if (at === end) {
    return { type: null, at };
  }
  if (text[at] !== ',') {
    return null;
  }
  at = spaces(text, at + 1, end);
  ARGUMENT.lastIndex = at;
  const type = ARGUMENT.exec(text);
  if (type === null) {
    return null;
  }
  at = spaces(text, ARGUMENT.lastIndex, end);
  if (at !== end && text[at] !== ',') {
    return null;
  }
  return { type: type[0], at: at === end ? at : at + 1 };
}

function branches(text, start, end, paired, type) {
  let at = spaces(text, start, end);
  if (type !== 'select' && text.startsWith('offset:', at)) {
    at = spaces(text, at + 7, end);
    NUMBER.lastIndex = at;
    if (NUMBER.exec(text) === null) {
      return null;
    }
    at = spaces(text, NUMBER.lastIndex, end);
  }
  const result = [];
  while (at < end) {
    const selector = at;
    while (at < end && !whitespace(text[at]) && text[at] !== OPEN && text[at] !== CLOSE) {
      at += 1;
    }
    if (at === selector) {
      return null;
    }
    at = spaces(text, at, end);
    if (text[at] !== OPEN || paired[at] < at || paired[at] >= end) {
      return null;
    }
    const close = paired[at];
    result.push({ start: at + 1, end: close, plural: type !== 'select' });
    at = spaces(text, close + 1, end);
  }
  return result.length === 0 ? null : result;
}

function markIcu(text, mask, checkBudget) {
  const paired = bracePairs(text, checkBudget);
  const queue = [{ start: 0, end: text.length, plural: false }];
  for (let task = 0; task < queue.length; task += 1) {
    const range = queue[task];
    let at = range.start;
    let nextCheck = at;
    while (at < range.end) {
      if (at >= nextCheck) {
        checkBudget?.('localization');
        nextCheck = at + 0x4000;
      }
      if (mask[at]) {
        at += 1;
        continue;
      }
      const next = text[at + 1];
      if (
        text[at] === "'" &&
        (next === "'" || next === OPEN || next === CLOSE || (range.plural && next === '#'))
      ) {
        const end = quotedEnd(text, at, range.end, checkBudget);
        mask.fill(1, at, end);
        at = end;
        continue;
      }
      if (range.plural && text[at] === '#') {
        mask[at] = 1;
      }
      const end = paired[at];
      if (text[at] !== OPEN || end < at || end >= range.end) {
        at += 1;
        continue;
      }
      const head = argumentHead(text, at, end);
      if (head === null) {
        at += 1;
        continue;
      }
      const inner = COMPLEX_TYPES.has(head.type)
        ? branches(text, head.at, end, paired, head.type)
        : null;
      if (inner === null) {
        mask.fill(1, at, end + 1);
      } else {
        let from = at;
        for (const branch of inner) {
          mask.fill(1, from, branch.start);
          queue.push(branch);
          from = branch.end;
        }
        mask.fill(1, from, end + 1);
      }
      at = end + 1;
    }
  }
}

function digits(text, at) {
  let next = at;
  while (digit(text[next])) {
    next += 1;
  }
  return next;
}

function star(text, at) {
  if (text[at] !== '*') {
    return digits(text, at);
  }
  const next = digits(text, at + 1);
  return text[next] === '$' ? next + 1 : at + 1;
}

function printfEnd(text, start) {
  let at = start + 1;
  if (text[at] === '%') {
    return at + 1;
  }
  const numbered = digits(text, at);
  if (text[numbered] === '$') {
    at = numbered + 1;
  }
  while (PRINTF_FLAGS.has(text[at])) {
    at += 1;
  }
  at = star(text, at);
  if (text[at] === '.') {
    at = star(text, at + 1);
  }
  if (text.startsWith('hh', at) || text.startsWith('ll', at)) {
    at += 2;
  } else if (text[at] !== undefined && 'hljztL'.includes(text[at])) {
    at += 1;
  }
  return PRINTF_TYPES.has(text[at]) ? at + 1 : -1;
}

function markPrintf(text, mask, checkBudget) {
  let count = 0;
  for (let at = text.indexOf('%'); at !== -1;) {
    if ((count++ & 0x3ff) === 0) {
      checkBudget?.('localization');
    }
    const end = printfEnd(text, at);
    if (end !== -1) {
      mask.fill(1, at, end);
    }
    at = text.indexOf('%', end === -1 ? at + 1 : end);
  }
}

function markInterpolation(text, mask, checkBudget) {
  const expression = /\$\{[^{}]*\}/g;
  let count = 0;
  for (let found; (found = expression.exec(text)) !== null;) {
    if ((count++ & 0x3ff) === 0) {
      checkBudget?.('localization');
    }
    mask.fill(1, found.index, found.index + found[0].length);
  }
}

export function localizationScanner(mode) {
  if (mode === 'off') {
    return null;
  }
  return (text, checkBudget) => {
    const mask = new Uint8Array(text.length);
    if (mode === 'all' || mode === 'interpolation') {
      markInterpolation(text, mask, checkBudget);
    }
    if (mode === 'all' || mode === 'printf') {
      markPrintf(text, mask, checkBudget);
    }
    if (mode === 'all' || mode === 'icu') {
      markIcu(text, mask, checkBudget);
    }
    const spans = [];
    for (let at = 0; at < mask.length; at += 1) {
      if ((at & 0x3fff) === 0) {
        checkBudget?.('localization');
      }
      if (mask[at] === 0) {
        continue;
      }
      const start = at;
      while (at < mask.length && mask[at] !== 0) {
        at += 1;
      }
      spans.push([start, at]);
    }
    return spans;
  };
}
