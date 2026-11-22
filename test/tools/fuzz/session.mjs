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

const editOf = (fingerprint) => /\[.*→.*\]/u.exec(fingerprint ?? '')?.[0] ?? fingerprint;

export function groupOf(violation, blame) {
  return [
    NAMES[violation.invariant],
    violation.kind ?? (violation.invariant === 'idempotence' ? '' : violation.key),
    blame.join(' + ') || 'не определён'
  ].join(' | ');
}

export async function createSession({ seed, format = null, coverage = false }) {
  const lexicon = loadLexicon();
  const { MicroTypo, restart } = await loadEngine();
  const check = createChecker(MicroTypo, restart);
  const cover = coverage ? createCoverage(MicroTypo, restart) : null;

  const caseAt = (index) => {
    const d = dice(rng(caseSeed(seed, index)));

    return createDocuments(lexicon, d)(format ?? d.pick(FORMATS));
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
    check,

    // The violations of cases `from` to `to`, only for the cases that have any.
    scan(from, to) {
      const found = [];

      for (let index = from; index < to; index++) {
        const { violations } = check(caseAt(index));

        if (violations.length > 0) {
          found.push({ index, violations });
        }
      }

      return found;
    },

    // The rules to blame are looked for in the shrunk case: in the generated document, rules that
    // only shaped the incidental text around the defect would be blamed with it.
    examine(index, violation) {
      const fails = same(violation);
      const small = shrink(caseAt(index), fails);
      const blame = culprits(small, fails);

      return {
        group: groupOf(violation, blame),
        finding: { violation, kase: small, index, blame }
      };
    },

    cover(from, to) {
      const counts = {};
      let counted = 0;

      for (let index = from; index < to; index++) {
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
