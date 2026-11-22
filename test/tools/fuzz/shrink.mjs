import { DEFAULT_GROUPS } from '../../../src/rules/registry.js';

// Every case a shrink step tries costs a run of the engine; past this many the case is reported as
// small as it got.
const MAX_TRIES = 4000;

const omit = (object, key) => Object.fromEntries(Object.entries(object).filter(([k]) => k !== key));

function configVariants(config, format) {
  const variants = [];

  for (const [key, value] of Object.entries(config)) {
    if (key === 'input') {
      if (typeof value === 'object') {
        for (const inner of Object.keys(value).filter((k) => k !== 'format')) {
          variants.push({ ...config, input: omit(value, inner) });
        }

        if (Object.keys(value).length === 1) {
          variants.push({ ...config, input: value.format });
        }
      }

      if (format === 'text') {
        variants.push(omit(config, key));
      }

      continue;
    }

    variants.push(omit(config, key));

    if ((key === 'rules' || key === 'render') && value !== null && typeof value === 'object') {
      for (const inner of Object.keys(value)) {
        variants.push({ ...config, [key]: omit(value, inner) });
      }
    }
  }

  return variants;
}

// ddmin: drop ever smaller runs of units while the case still fails the same way.
async function ddmin(units, test) {
  let current = units;
  let n = 2;

  while (current.length >= 2) {
    const size = Math.ceil(current.length / n);
    let reduced = false;

    for (let start = 0; start < current.length; start += size) {
      const candidate = [...current.slice(0, start), ...current.slice(start + size)];

      if (await test(candidate)) {
        current = candidate;
        n = Math.max(n - 1, 2);
        reduced = true;
        break;
      }
    }

    if (!reduced) {
      if (n >= current.length) {
        break;
      }

      n = Math.min(current.length, n * 2);
    }
  }

  return current;
}

const GRANULARITIES = [
  (text) => text.split(/(?<=\n)/u),
  (text) => text.split(/(?<=\s)(?=\S)|(?<=\S)(?=\s)/u),
  (text) => [...text]
];

// `fails` may answer with a promise: a hang is asked about on another thread.
export async function shrink(kase, fails) {
  let tries = 0;
  const test = async (candidate) => {
    if (tries >= MAX_TRIES) {
      return false;
    }

    tries += 1;
    return fails(candidate);
  };

  let current = kase;

  const shrinkConfig = async () => {
    let changed = true;

    while (changed) {
      changed = false;

      for (const config of configVariants(current.config, current.format)) {
        const candidate = { ...current, config };

        if (await test(candidate)) {
          current = candidate;
          changed = true;
          break;
        }
      }
    }
  };

  await shrinkConfig();

  for (const split of GRANULARITIES) {
    const units = await ddmin(split(current.text), (candidate) =>
      test({ ...current, text: candidate.join('') })
    );

    current = { ...current, text: units.join('') };
  }

  await shrinkConfig();

  return current;
}

export function withRuleOff(config, selector) {
  const rules = { ...config.rules };

  delete rules[selector];
  rules[selector] = false;

  return { ...config, rules };
}

const ALL_RULES = DEFAULT_GROUPS.flatMap(([group, def]) =>
  def.rules.map((rule) => `${group}.${rule.id}`)
);

// The rules a violation goes away without. Halving the catalogue finds each in a handful of runs
// rather than one per rule: switching a set off clears the violation exactly when the set holds a
// rule the violation needs. Empty when switching every rule off does not clear it.
export async function culprits(kase, fails) {
  const clearedWithout = async (selectors) =>
    !(await fails({
      ...kase,
      config: selectors.reduce((config, selector) => withRuleOff(config, selector), kase.config)
    }));
  const found = [];
  const search = async (selectors) => {
    if (!(await clearedWithout(selectors))) {
      return;
    }

    if (selectors.length === 1) {
      found.push(selectors[0]);
      return;
    }

    const half = Math.ceil(selectors.length / 2);

    await search(selectors.slice(0, half));
    await search(selectors.slice(half));
  };

  await search(ALL_RULES);

  return found;
}
