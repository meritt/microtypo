// mulberry32: small, fast and the same generator `test/conformance/build.mjs` uses.
export function rng(seed) {
  let a = seed >>> 0;

  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Each case draws from a stream of its own, so a case is reproduced from the run seed and its index
// alone, without generating the cases in front of it.
export function caseSeed(seed, index) {
  let h = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export function dice(random) {
  const int = (min, max) => min + Math.floor(random() * (max - min + 1));
  const pick = (items) => items[Math.floor(random() * items.length)];
  const chance = (p) => random() < p;
  const weighted = (entries) => {
    const total = entries.reduce((sum, [weight]) => sum + weight, 0);
    let roll = random() * total;

    for (const [weight, value] of entries) {
      roll -= weight;

      if (roll < 0) {
        return value;
      }
    }

    return entries.at(-1)[1];
  };

  return { random, int, pick, chance, weighted };
}
