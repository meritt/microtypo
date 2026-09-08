import { execFileSync } from 'node:child_process';

import { isSafePattern } from 'redos-detector';

import { EMAIL_REGEX, IPV6_REGEX, URL_REGEX, UUID_REGEX } from '../../src/lib/url-email-regex.js';
import { ATTR_ALT_SOURCE } from '../../src/protect/blocks.js';
import { TAG_RE } from '../../src/protect/tags.js';
import { abbrGroup } from '../../src/rules/abbr.js';
import { dashGroup } from '../../src/rules/dash.js';
import { dateGroup } from '../../src/rules/date.js';
import { etcGroup } from '../../src/rules/etc.js';
import { nobrGroup } from '../../src/rules/nobr.js';
import { numberGroup } from '../../src/rules/number.js';
import { optAlignGroup } from '../../src/rules/opt-align.js';
import { punctmarkGroup } from '../../src/rules/punctmark.js';
import { quoteGroup } from '../../src/rules/quote.js';
import { spaceGroup } from '../../src/rules/space.js';
import { symbolGroup } from '../../src/rules/symbol.js';
import { textGroup } from '../../src/rules/text.js';

// redos-detector leaks memory across repeated `isSafePattern` calls in one isolate: RSS grows
// unbounded and the process OOMs after about fifteen. Each pattern is analyzed in its own
// short-lived child process instead, which is what this file's `--check` re-invocation is for.
if (process.argv[2] === '--check') {
  const { pattern, unicode, caseInsensitive, dotAll, multiLine } = JSON.parse(process.argv[3]);
  const result = isSafePattern(pattern, {
    unicode,
    caseInsensitive,
    dotAll,
    multiLine,
    timeout: 5000 // bounds worst-case analysis time; a hit still counts as unsafe (can't prove safety)
  });

  process.stdout.write(JSON.stringify({ safe: result.safe, error: result.error }));
  process.exit(result.safe ? 0 : 1);
}

const GROUPS = [
  quoteGroup,
  dashGroup,
  symbolGroup,
  punctmarkGroup,
  numberGroup,
  spaceGroup,
  abbrGroup,
  nobrGroup,
  dateGroup,
  optAlignGroup,
  etcGroup,
  textGroup
];

// The protect layer runs before any rule group, over raw and possibly hostile markup, so its
// patterns belong under this gate too. `addTag()` builds its opener per call from a tag name
// spliced around `ATTR_ALT_SOURCE`; `x` stands in for any validated name, which `TAG_NAME_RE`
// already restricts to `[a-zA-Z][a-zA-Z0-9-]*`, so the name adds no ambiguity of its own and this
// reproduces the alternation shape `addTag()` interpolates.
const BLOCKS_OPEN_RE = new RegExp(`<x(?:\\s(?:${ATTR_ALT_SOURCE})*)?>`, 'gi');

const regexes = [
  ['url', URL_REGEX],
  ['email', EMAIL_REGEX],
  ['ipv6', IPV6_REGEX],
  ['uuid', UUID_REGEX],
  ['protect/tags.js TAG_RE', TAG_RE],
  ['protect/blocks.js addTag opener', BLOCKS_OPEN_RE]
];

// redos-detector flags these because it downgrades unanchored patterns and treats any
// prefix-overlapping alternation as unbounded ambiguity, neither of which implies real exponential
// backtracking. Every entry was verified with an adversarial timing probe — a ~30,000-character
// worst case and a doubling-size check for superlinear growth — and each stays linear well under
// 50 ms. Adding one requires the same check; this is not a rubber stamp.
const ALLOWLIST = new Map([
  [
    'url',
    'hardened linear body (no nested quantifier); passing adversarial test/security/redos.test.js'
  ],
  [
    'email',
    'bounded lookahead + flat local-part class (no backtrack-prone grouping); ~23ms at 30k-char worst case'
  ],
  [
    'Кавычки/around_link[0]',
    'lazy scan between literal delimiters — textbook-safe shape; <1ms at 30k chars'
  ],
  [
    'Дефисы и тире/indefinite_pronoun[0]',
    'flat 10-way pronoun alternation, no repeated group around it; linear to 30k chars'
  ],
  [
    'Дефисы и тире/hyphenated_particle[0]',
    'fixed 19-way pronoun/adverb alternation (prefix overlap but no repetition), no nested ' +
      'quantifier; linear to 30k chars (empirically verified <1ms at adversarial worst-case shapes)'
  ],
  [
    'Неразрывные конструкции/nbsp_after_particle[0]',
    'leading boundary anchor limits match starts to word boundaries; greedy [а-яё]+ word scan, ' +
      'no nested quantifier, fixed 5-way particle alternation; linear (0.4ms at 30k-я run, vs the ' +
      'unanchored form which was O(n^2) and the perf suite caught)'
  ],
  [
    'Числа, дроби, математические знаки/times[0]',
    'bounded x/х alternation, no nested quantifier; linear to 30k chars'
  ],
  [
    'Сокращения/nbsp_data_unit[0]',
    'large but fixed data-unit alternation (prefix overlap, not repetition); linear to 30k chars'
  ],
  [
    'Сокращения/nbsp_frequency_unit[0]',
    'fixed SI-prefix alternation (к/М/Г/Т); linear to 30k chars'
  ],
  [
    'Сокращения/nbsp_css_unit[0]',
    'large but fixed CSS-unit alternation (v/s/l/d-prefix overlap, not repetition); linear to 30k chars'
  ],
  [
    'Сокращения/nbsp_money_magnitude[0]',
    'three independent optional groups, no nested quantifier; linear to 30k chars'
  ],
  [
    'Даты и дни/nowrap_day_range[0]',
    'disabled by default; fixed 12-month alternation, no repetition; linear to 30k chars'
  ],
  [
    'Даты и дни/month_range[0]',
    'redos-detector hits its own step budget analyzing the added negative lookbehind/' +
      'lookahead word-boundary guards combined with the prefix-overlapping month alternation ' +
      'and reports "unsafe" inconclusively (hitMaxSteps), not a proven exponential blowup — ' +
      'both lookarounds are fixed-width single-character checks, which add no backtracking ' +
      'ambiguity. Re-verified empirically post-fix across four adversarial shapes (repeated ' +
      'ambiguous month-hyphen runs, near-miss gerunds, long non-matching cyrillic runs, dense ' +
      'hyphen chains) at up to 132k chars and a 30k-char mixed worst case: all linear, ~1ms ' +
      'at 30k chars'
  ],
  [
    'protect/tags.js TAG_RE',
    'redos-detector hits its own step budget analyzing the lookahead + three-way content ' +
      'alternation and reports "unsafe" inconclusively (hitMaxSteps), not a proven exponential ' +
      'blowup — the TAG_RE fix removed the one ambiguous branch (bare `["\']` fallback) that ' +
      'caused real backtracking. Re-verified empirically post-fix at 30k chars across three ' +
      'adversarial shapes (stray-quote run, alternating quotes, many quoted attributes): all ' +
      'linear, <7ms worst case; see test/perf/redos-rules.perf.js'
  ]
]);

// `regexes` is how a handler rule stays under this gate: the runner never reads the field, so a rule
// that scans on its own declares what it scans with and cannot quietly leave the check behind. The
// declaration is required rather than offered, because opt-in metadata protects only the rules that
// remember it. A handler that genuinely scans with no regex says so with an empty array.
const undeclared = [];

for (const group of GROUPS) {
  for (const rule of group.rules) {
    if (rule.handler && rule.regexes === undefined) {
      undeclared.push(`${group.title}/${rule.id}`);
      continue;
    }

    const declared = rule.pattern ?? rule.regexes;

    if (!declared) {
      continue;
    }

    const patterns = Array.isArray(declared) ? declared : [declared];

    for (const [i, re] of patterns.entries()) {
      regexes.push([`${group.title}/${rule.id}[${i}]`, re]);
    }
  }
}

if (undeclared.length > 0) {
  console.error(
    `redos-check: handler rules with no \`regexes\` declaration:\n  ${undeclared.join('\n  ')}\n` +
      'Declare every regex the handler scans with, or `regexes: []` when it scans with none.'
  );
  process.exit(1);
}

let unexpected = 0;
let allowlisted = 0;
const seenAllowlisted = new Set();

// None of these patterns are start-anchored: they run through `String.replace` at every offset.
// redos-detector's default downgrade for an unanchored pattern prepends an unbounded `[^]*?` scan
// prefix to model that, which floods every pattern here with scan-position ambiguity rather than
// real backtracking risk and blows past its resource limits. Scan-position scaling is this engine's
// own concern and `maxInputLength` bounds it, so anchoring with `^(?:…)` isolates what this gate
// should catch — catastrophic backtracking within a single match attempt. `(a+)+b` still reports
// unsafe anchored.
//
// redos-detector also rejects caseInsensitive+unicode together (full Unicode case folding is
// out of scope for it — see mathiasbynens.be/notes/es6-unicode-regex). Every rule regex here
// is `giu`; dropping `i` when `u` is set still catches catastrophic backtracking, which comes
// from quantifier/alternation structure, not case folding — and these char classes already
// spell out both a-z and а-я explicitly, so `i` adds no extra paths.
for (const [name, re] of regexes) {
  const unicode = re.unicode || re.unicodeSets;
  const spec = {
    pattern: `^(?:${re.source})`,
    unicode,
    caseInsensitive: re.ignoreCase && !unicode,
    dotAll: re.dotAll,
    multiLine: re.multiline
  };

  let stdout = '{}';

  try {
    stdout = execFileSync(
      process.execPath,
      [import.meta.filename, '--check', JSON.stringify(spec)],
      {
        encoding: 'utf8',
        timeout: 10_000
      }
    );
  } catch (err) {
    stdout = err.stdout || stdout;
  }

  const result = JSON.parse(stdout);

  if (result.safe) {
    continue;
  }

  if (ALLOWLIST.has(name)) {
    allowlisted++;
    seenAllowlisted.add(name);
    continue;
  }

  unexpected++;
  console.error(`UNSAFE  ${name}: ${re.source} (${result.error ?? 'vulnerable'})`);
}

const stale = ALLOWLIST.keys()
  .filter((name) => !seenAllowlisted.has(name))
  .toArray();

if (stale.length > 0) {
  console.error(
    `\nStale allowlist entries (no longer flagged — safe to remove): ${stale.join(', ')}`
  );
}

if (unexpected > 0) {
  console.error(`\n${unexpected} unexpected vulnerable regex(es) found (not in allowlist).`);
  process.exit(1);
}

console.log(
  `redos-check: ${regexes.length} scanned, ${allowlisted} allowlisted-safe, ${unexpected} unexpected.`
);
