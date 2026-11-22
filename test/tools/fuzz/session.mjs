// Everything one thread does with a seed: build case k, check it, shrink a violation and find the
// rules to blame, count the rules a case exercises. The main thread and every worker build their own
// session, so a case and what is found in it depend on the seed and the index alone.
import { createCoverage } from './coverage.mjs';
import { createDocuments, FORMATS } from './documents.mjs';
import { loadEngine } from './engine.mjs';
import { createChecker, NAMES } from './invariants.mjs';
import { loadLexicon } from './lexicon.mjs';
import { caseSeed, dice, rng } from './random.mjs';
import { culprits, shrink } from './shrink.mjs';
import { createTransparent, TRANSPARENT_FORMATS } from './transparent.mjs';

// The prose cases of the transparency invariant draw from streams of their own, so adding them moved
// none of the documents.
const TRANSPARENT_SALT = 0x7a3e51c9;

const editOf = (fingerprint) => /\[.*→.*\]/u.exec(fingerprint ?? '')?.[0] ?? fingerprint;

export function groupOf(violation, blame) {
  return [
    NAMES[violation.invariant],
    violation.kind ?? (violation.invariant === 'idempotence' ? '' : violation.key),
    blame.join(' + ') || 'не определён'
  ].join(' | ');
}

// `onCase(index)` is told of every case begun, with its index in a scan and -1 otherwise.
export async function createSession({ seed, format = null, coverage = false, onCase = () => {} }) {
  const lexicon = loadLexicon();
  const { MicroTypo, restart } = await loadEngine();
  const checker = createChecker(MicroTypo, restart);
  const cover = coverage ? createCoverage(MicroTypo, restart) : null;

  const caseAt = (index) => {
    const d = dice(rng(caseSeed(seed, index)));

    return createDocuments(lexicon, d)(format ?? d.pick(FORMATS));
  };

  // Case k of the transparency invariant, or null when the run is limited to a format it skips.
  const proseAt = (index) => {
    if (format !== null && !TRANSPARENT_FORMATS.includes(format)) {
      return null;
    }

    const d = dice(rng(caseSeed((seed ^ TRANSPARENT_SALT) >>> 0, index)));

    return createTransparent(
      lexicon,
      d,
      checker.typesetPlain
    )(format ?? d.pick(TRANSPARENT_FORMATS));
  };

  // The case a violation was found in: the document, or the prose case its invariant is about.
  const caseOf = (index, violation) =>
    violation.invariant === 'transparent' || violation.prose ? proseAt(index) : caseAt(index);

  const check = (kase, only = null) => {
    onCase(-1);
    return checker(kase, only);
  };

  // The same defect: same invariant and key and, for idempotence, the same edit by the second pass.
  const same = (violation) => (kase) =>
    check(kase, violation.invariant).violations.some(
      (v) =>
        v.invariant === violation.invariant &&
        v.key === violation.key &&
        editOf(v.fingerprint) === editOf(violation.fingerprint)
    );

  return {
    caseAt,
    proseAt,
    caseOf,
    check,

    // The violations of cases `from` to `to`, only for the cases that have any.
    scan(from, to) {
      const found = [];

      for (let index = from; index < to; index++) {
        onCase(index);

        const { violations } = checker(caseAt(index));
        const prose = proseAt(index);

        if (prose !== null) {
          for (const violation of checker(prose).violations) {
            violations.push({ ...violation, prose: true });
          }
        }

        if (violations.length > 0) {
          found.push({ index, violations });
        }
      }

      return found;
    },

    // Whether the engine answers on a case is asked of a worker under a time limit.
    probe(kase) {
      check(kase);
      return null;
    },

    // The rules to blame are looked for in the shrunk case: in the generated document, rules that
    // only shaped the incidental text around the defect would be blamed with it. `fails` tells
    // whether a smaller case still breaks the invariant the same way.
    async examine(index, violation, fails = same(violation)) {
      const small = await shrink(caseOf(index, violation), fails);
      const blame = await culprits(small, fails);

      return {
        group: groupOf(violation, blame),
        finding: { violation, kase: small, index, blame }
      };
    },

    cover(from, to) {
      const counts = {};
      let counted = 0;

      for (let index = from; index < to; index++) {
        onCase(index);

        const hits = cover(caseAt(index));

        if (hits !== null) {
          counted += 1;

          for (const rule of hits) {
            counts[rule] = (counts[rule] ?? 0) + 1;
          }
        }
      }

      return { counts, counted };
    }
  };
}
