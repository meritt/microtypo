import { G } from '../lib/glyphs.js';
import { count } from '../lib/strings.js';
import { OPEN, CLOSE } from '../protect/placeholders.js';
import { OPEN_LEFT, SEPARATOR, isDigit, paragraphSeparator, processQuotes } from './quote-state.js';

const ANCHOR_OPEN_RE_STR = `<${OPEN}A\\d+${CLOSE}>`;
const ANCHOR_CLOSE_RE_STR = `<\\/${OPEN}A\\d+${CLOSE}>`;

const QUOTES_OUTSIDE_A_RE = new RegExp(
  `(${ANCHOR_OPEN_RE_STR})"([\\s\\S]+?)"(${ANCHOR_CLOSE_RE_STR})`,
  'g'
);

const FIRS_OPEN = G.LAQUO;
const FIRS_CLOSE = G.RAQUO;
const WORD_END_RE = new RegExp(`[a-zа-яё0-9${G.HELLIP}]$`, 'iu');

function repeatChar(s, char) {
  return char.repeat(count(s, '"'));
}

function closesBeforeParen(p1, next, offset, source) {
  return next.startsWith('(') && /^\s$/u.test(p1) && WORD_END_RE.test(source.slice(0, offset));
}

// A strong neighbour cannot end content, so any non-separating follower opens.
const OPEN_AFTER_STRONG_RE = new RegExp(`(^|[${OPEN_LEFT}])((?:"|\\\\")+)([^${SEPARATOR}])`, 'giu');

// A weak neighbour reads both ways: `**"Амбер"**` opens, but the closing quote of `"это *важно*".`
// sits on the same `*`. The follower decides — sentence punctuation after the quote means it closes.
const OPEN_AFTER_WEAK_RE = new RegExp(
  `([,;:*_~\`${CLOSE}])((?:"|\\\\")+)([^\\s.,;:!?)${G.RAQUO}${G.HELLIP}])`,
  'giu'
);

// The gap is a horizontal run, not a single character: an author who separated the quote from its
// word rarely counts the spaces. Newlines stay out of it — paragraphs are still plain blank lines at
// this point in the pipeline, and swallowing one would join two paragraphs into one.
const OPEN_BEFORE_SPACE_RE = new RegExp(
  `(^|\\(|\\s|[${G.LAQUO}${G.MDASH}${G.NDASH}])("|\\\\")([ \\t]+)(\\S+)`,
  'giu'
);

function openBeforeWord(full, p1, p2, p3, offset, source) {
  if (closesBeforeParen(p1, p3, offset, source)) {
    return full;
  }

  return `${p1}${repeatChar(p2, FIRS_OPEN)}${p3}`;
}

// Whether this pass can open a quotation at this quote at all — the shape `OPEN_BEFORE_SPACE_RE`
// looks for, minus the one the walk rejects anyway: a `«` in front is one the opening patterns
// minted a step ago, and what follows it is that quotation's closer. A quote failing this goes to
// the closing rules whatever stands around it, so it is not undecided and is not counted as one.
const SPACED_OPEN_LEFT_RE = new RegExp(`[(\\s${G.MDASH}${G.NDASH}]`, 'u');

// Where the quote at `at` begins. A quote written `\"` is one token and the backslash belongs to it,
// so every question about what stands beside a quote is asked from here — the plan and the walk that
// applies it must not answer it two ways.
function tokenStart(text, at) {
  return text[at - 1] === '\\' ? at - 1 : at;
}

function couldOpen(text, at) {
  const left = tokenStart(text, at) - 1;

  if (left >= 0 && !SPACED_OPEN_LEFT_RE.test(text[left])) {
    return false;
  }

  let i = at + 1;

  while (text[i] === ' ' || text[i] === '\t') {
    i += 1;
  }

  return i > at + 1 && i < text.length && !/\s/u.test(text[i]);
}

// What a quote glyph is here, and the single answer both the depth walk and the pairing below read.
// `«` was minted by the opening patterns a step ago or written by the author, `»` is the author's,
// and a straight quote glued to a word end closes. A straight quote still spaced on both sides is
// none of those: it is undecided, and which quotation it belongs to cannot be read off that quote —
// what settles it is not the next quote but how many are left.
const OPENS = 1;
const UNDECIDED = 0;
const CLOSES = -1;

function quoteRole(text, at) {
  const c = text[at];

  if (c === FIRS_OPEN) {
    return OPENS;
  }

  if (c === FIRS_CLOSE) {
    return CLOSES;
  }

  return couldOpen(text, at) ? UNDECIDED : CLOSES;
}

// The shape the walk below writes as one empty quotation: a straight quote whose next non-space
// character is another straight quote. Both halves belong to that pair and to nothing around it.
function emptyPairAt(text, at, j, end) {
  if (j + 1 >= end || text[at[j]] !== '"' || text[at[j + 1]] !== '"') {
    return false;
  }

  const from = at[j] + 1;
  const to = tokenStart(text, at[j + 1]);

  if (to <= from) {
    return false;
  }

  for (let i = from; i < to; i += 1) {
    if (text[i] !== ' ' && text[i] !== '\t') {
      return false;
    }
  }

  return true;
}

// Every quote's part, decided for the whole paragraph at once, so the walk below only applies what
// was assigned: the part of a quote is not a local question, but depends on how many quotations
// stand open around it and on how many closers the rest of the text still has. One pass over the
// quotes, because scanning ahead per quote is quadratic in a rule that polls no budget.
function assignParagraphRoles(text, from, stop, at, roles, depths, pairs) {
  const base = at.length;
  let opens = 0;
  let closes = 0;
  let undecided = 0;
  for (let i = from; i < stop; i += 1) {
    const c = text[i];

    if (c !== FIRS_OPEN && c !== FIRS_CLOSE && c !== '"') {
      continue;
    }

    const role = quoteRole(text, i);

    // A straight quote glued to a digit closes nothing where no quotation stands open: it is a
    // measurement, the one `tryConvertInches` turns into a prime later. What decides is the balance
    // here rather than how many quotes have been seen, since a quotation that opened and closed
    // leaves nothing open.
    if (
      role === CLOSES &&
      opens - closes <= 0 &&
      undecided === 0 &&
      c === '"' &&
      isDigit(text[tokenStart(text, i) - 1])
    ) {
      continue;
    }

    at.push(i);
    roles.push(role);

    if (role === OPENS) {
      opens += 1;
    } else if (role === CLOSES) {
      closes += 1;
    } else {
      undecided += 1;
    }
  }

  // How many of the undecided must open follows from the count: a balanced stretch has as many
  // openings as closings. Which ones is then the ordinary reading — a quote closes the quotation it
  // stands in — spending that allowance until it runs out, after which a quote with nothing open to
  // close opens one. An odd total cannot balance at all; the floor spends the odd one on closing,
  // which is this rule's default everywhere else.
  //
  // `depths` is how many quotations stand open where each quote is: the one number the walk below
  // asks for, taken from this assignment rather than from a second reading of the text.
  let closings = undecided - clamp(Math.floor((closes + undecided - opens) / 2), 0, undecided);
  const end = at.length;
  let depth = 0;

  // How deep the quotes still ahead need it to be here. A closer already settled has to have a
  // quotation open in front of it, so an undecided quote that closes one the suffix is going to need
  // leaves that closer with nothing to close, and everything after it lands on the wrong side.
  const need = new Int32Array(end - base + 1);

  for (let j = end - 1; j >= base; j -= 1) {
    const k = j - base;

    need[k] = roles[j] === CLOSES ? need[k + 1] + 1 : Math.max(0, need[k + 1] - 1);
  }

  let laterUndecided = undecided;

  for (let j = base; j < end; j += 1) {
    if (roles[j] === UNDECIDED) {
      laterUndecided -= 1;

      // A quote whose word is the next quote is an empty quotation, and the walk below writes both
      // halves in one step, so the plan spends them as a pair too. A quotation already standing open
      // changes what the pair is written as, never whether it is one.
      if (emptyPairAt(text, at, j, end)) {
        laterUndecided -= roles[j + 1] === UNDECIDED ? 1 : 0;
        closings -= closings > 0 ? 1 : 0;
        roles[j] = OPENS;
        roles[j + 1] = CLOSES;
        depths.push(depth, depth + 1);
        pairs.push(true, false);
        j += 1;
        continue;
      }

      // The count says how many undecided quotes close, never which ones, so a quote hands its turn
      // to a later one where a closer already settled would be left with nothing to close — but only
      // while a later one is still there to take it, since the count is what balances the paragraph
      // and deferring past the last undecided quote leaves the allowance unusable.
      const starves = depth - 1 < need[j - base + 1] && closings <= laterUndecided;
      const shuts = depth > 0 && closings > 0 && !starves;

      roles[j] = shuts ? CLOSES : OPENS;
      closings -= shuts ? 1 : 0;
    }

    depths.push(depth);
    pairs.push(false);
    depth = Math.max(0, depth + roles[j]);
  }
}

// Quote state does not cross a paragraph, and this is the same boundary `processQuotes` splits on
// one pass later.
function assignQuoteRoles(text) {
  const separator = paragraphSeparator(text);
  const at = [];
  const roles = [];
  const depths = [];
  const pairs = [];
  let from = 0;

  for (;;) {
    const found = text.indexOf(separator, from);

    assignParagraphRoles(text, from, found === -1 ? text.length : found, at, roles, depths, pairs);

    if (found === -1) {
      return { at, roles, depths, pairs };
    }

    from = found + separator.length;
  }
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

// A quote parted from its word by a space. The heuristic — that the author meant it to open the next
// word — holds only while no quotation is open; inside one the same quote closes. A pattern
// replacement cannot tell the difference, because `String.replace` hands every callback the original
// text and never the substitutions made beside it, so the assignment above settles both questions
// for the whole stretch and this walk applies them.
function openSpacedQuotes(text) {
  if (!text.includes('"')) {
    return text;
  }

  // The walk drives `lastIndex` itself and resets it here; `lint:redos` reads the pattern's source
  // and flags without ever running it, so the declaration and the walk share one object.
  const re = OPEN_BEFORE_SPACE_RE;
  const parts = [];
  let m;

  // Built on the first candidate that needs it, and only walked forward: the questions come in
  // ascending order, so one cursor answers all of them.
  let assigned = null;
  let seen = 0;

  const quoteAt = (at) => {
    assigned ??= assignQuoteRoles(text);

    while (seen < assigned.at.length && assigned.at[seen] < at) {
      seen += 1;
    }

    if (seen >= assigned.at.length || assigned.at[seen] !== at) {
      return { role: UNDECIDED, depth: 0, pairEnd: -1 };
    }

    return {
      role: assigned.roles[seen],
      depth: assigned.depths[seen],
      // Where the pair this quote opens ends, so the walk consumes both halves the plan spent rather
      // than re-deciding the second one from the following word.
      pairEnd: assigned.pairs[seen] ? assigned.at[seen + 1] + 1 : -1
    };
  };

  let cursor = 0;

  re.lastIndex = 0;

  while ((m = re.exec(text)) !== null) {
    const [full, p1, p2, , p4] = m;
    const afterLeft = m.index + p1.length;
    const { role, depth, pairEnd } = quoteAt(afterLeft + p2.length - 1);

    // The word this quote supposedly lost is another quote: that is an empty quotation, not an opener
    // looking for something to bind to, and both halves are settled in this pass.
    if (pairEnd !== -1) {
      parts.push(text.slice(cursor, m.index), p1, FIRS_OPEN, FIRS_CLOSE);
      cursor = pairEnd;
      re.lastIndex = cursor;
      continue;
    }

    // Inside an open quotation a spaced quote usually closes it, but not when a matching quote stands
    // further on, still inside that quotation: the pair then opens and closes a quotation of its own,
    // nested in the one already running. The word it binds to cannot answer this — `" Новый Амбер"`
    // carries its closing quote two words along — so the part this quote plays was settled for the
    // whole stretch at once and here it is only read.
    //
    // A `«` directly in front is one the opening patterns minted a step ago out of the author's own
    // straight quote, so what follows it is that quotation's closer, not a nested one opening.
    const opensNested = depth > 0 && p1 !== FIRS_OPEN && role === OPENS;

    if (!opensNested && (depth > 0 || closesBeforeParen(p1, p4, m.index, text))) {
      // Leave the quote for the closing rules, but step past it: it has been accounted for here.
      const afterQuote = afterLeft + p2.length;

      parts.push(text.slice(cursor, afterQuote));
      cursor = afterQuote;
      re.lastIndex = afterQuote;
      continue;
    }

    parts.push(text.slice(cursor, m.index), p1, FIRS_OPEN, p4);
    // The word this quote binds to is `\S+`, so it carries its own closing quote along with it —
    // `" Корвин"` is one match, not two, and the next candidate resumes past both.
    cursor = m.index + full.length;
    re.lastIndex = cursor;
  }

  parts.push(text.slice(cursor));

  return parts.join('');
}

function applyInnerQuotes(ctx) {
  const settings = ctx.group?.settings ?? {};
  ctx.text = processQuotes(ctx.text, {
    allowNested: settings.allowNested !== false,
    convertInches: settings.convertInches !== false,
    checkBudget: ctx.checkBudget
  });
}

export const quoteGroup = {
  title: 'Кавычки',
  rules: [
    {
      id: 'around_link',
      description: 'Кавычки вынесены за тег <a>',
      pattern: QUOTES_OUTSIDE_A_RE,
      replacement: '"$1$2$3"'
    },
    {
      id: 'open',
      description: 'Открывающая кавычка',
      // A handler rather than three patterns: the last step needs to know whether a quotation is open
      // where it stands, and a pattern replacement cannot see the substitutions made beside it.
      // The runner ignores `regexes`; it is what keeps these three under `lint:redos`, which walks
      // declared rule patterns and would otherwise stop seeing a rule that scans on its own.
      regexes: [OPEN_AFTER_STRONG_RE, OPEN_AFTER_WEAK_RE, OPEN_BEFORE_SPACE_RE],
      handler: (ctx) => {
        // All three steps need a straight quote to do anything, and a value that has none is the
        // ordinary case in a structured document — where this runs once per value.
        if (!ctx.text.includes('"')) {
          return;
        }

        const stepped = ctx.text
          .replace(OPEN_AFTER_STRONG_RE, openBeforeWord)
          .replace(OPEN_AFTER_WEAK_RE, openBeforeWord);

        ctx.text = openSpacedQuotes(stepped);
      }
    },
    {
      id: 'open_cyrillic',
      description: 'Приклеенная кавычка у кириллицы → « с пробелом',
      pattern: /([a-zа-яё0-9])"([а-яё])/giu,
      replacement: `$1 ${FIRS_OPEN}$2`
    },
    {
      id: 'close',
      description: 'Закрывающая кавычка',
      pattern: [
        // `\"` is defused as a path close only behind a backslash-ASCII run, so ordinary `\"escaped\"`
        // prose is untouched.
        /(?<=\\[\w:]*)\\"(?=$|\s|[.,;:!?)]|<)/u,
        // The follower may be an opening quote: what stands in front of this one is a word end, and a
        // quote glued to a word end closes whatever the next quotation does.
        /([a-zа-яё0-9]|\.|…|!|\?|>|\)|:|\+|%|@|#|\$|\*)((?:"|\\")+)(?![a-zа-яё0-9])/giu,
        /([a-zа-яё0-9]|\.|…|!|\?|>|\)|:|\+|%|@|#|\$|\*)((?:"|\\"|«)+)(<[^>]+>)(\.|…|;|:|\?|!|,|\)|<\/|$| )/giu,
        /([a-zа-яё0-9]|\.|…|!|\?|>|\)|:|\+|%|@|#|\$|\*)(\s+)((?:"|\\")+)(\s+)(\.|…|;|:|\?|!|,|\)|\(|<\/|$| )/giu,
        // A quote still spaced on both sides after the opening rules have run is a closer that lost
        // its word: an opener in that position was already claimed there, and only a quotation that is
        // open leaves one behind. The space before it goes, the one after stays.
        /([a-zа-яё0-9…!?%)])(\s+)((?:"|\\")+)(?=\s)/giu,
        // The quotation an opening quote marks may hold no words at all, and `« "` is that empty one.
        // Its gap is horizontal and nothing else: the rule above spans line breaks, where a blank line
        // between the two quotes is a paragraph boundary rather than a gap.
        new RegExp(`(${G.LAQUO})([ \\t]+)((?:"|\\\\")+)(?=\\s)`, 'gu'),
        />«\.($|\s|<)/gu,
        />«,($|\s|<|\S)/gu,
        />«:($|\s|<|\S)/gu,
        />«;($|\s|<|\S)/gu,
        />«\)($|\s|<|\S)/gu,
        /((?:"|\\")+)$/giu,
        new RegExp(
          `([^${SEPARATOR}])((?:"|\\\\")+)(\\.|${G.HELLIP}|;|:|\\?|!|,|\\s|\\)|<\\/|<|$)`,
          'giu'
        )
      ],
      replacement: [
        () => `\\${FIRS_CLOSE}`,
        (m) => {
          const [, p1, p2] = m;

          return `${p1}${repeatChar(p2, FIRS_CLOSE)}`;
        },
        (m) => {
          const [, p1, p2, p4, p5] = m;
          const dq = count(p2, '"');
          const lq = count(p2, G.LAQUO);

          return `${p1}${FIRS_CLOSE.repeat(dq + lq)}${p4}${p5}`;
        },
        (m) => {
          const [, p1, p2, p3, p5, p6] = m;
          const dq = count(p3, '"');
          const lq = count(p3, G.LAQUO);

          return `${p1}${p2}${FIRS_CLOSE.repeat(dq + lq)}${p5}${p6}`;
        },
        (m) => {
          const [, p1, , p3] = m;

          return `${p1}${repeatChar(p3, FIRS_CLOSE)}`;
        },
        (m) => {
          const [, p1, , p3] = m;

          return `${p1}${repeatChar(p3, FIRS_CLOSE)}`;
        },
        `>${FIRS_CLOSE}.$1`,
        `>${FIRS_CLOSE},$1`,
        `>${FIRS_CLOSE}:$1`,
        `>${FIRS_CLOSE};$1`,
        `>${FIRS_CLOSE})$1`,
        (m) => FIRS_CLOSE.repeat(count(m[1], '"')),
        (m) => {
          const [, p1, p2, p4] = m;

          return `${p1}${FIRS_CLOSE.repeat(count(p2, '"'))}${p4}`;
        }
      ]
    },
    {
      id: 'fix_orphan_open',
      description: 'Открывающая «, приклеенная к концу слова перед пробелом/концом → закрывающая »',
      pattern: /([a-zа-яё0-9])«(?=\s|$)/giu,
      replacement: `$1${FIRS_CLOSE}`
    },
    {
      id: 'nested',
      description: 'Внутренние кавычки-лапки и дюймы',
      // processQuotes is a character-by-character state machine and runs no regex at all.
      regexes: [],
      handler: applyInnerQuotes
    }
  ]
};
