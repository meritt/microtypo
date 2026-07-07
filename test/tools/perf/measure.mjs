export function nowNs() {
  return process.hrtime.bigint();
}

export function elapsedMs(startNs) {
  return Number(nowNs() - startNs) / 1_000_000;
}

export function median(values) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function percentile(values, p) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = values.toSorted((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));

  return sorted[idx];
}

export function stats(samples) {
  const total = samples.reduce((sum, value) => sum + value, 0);

  return {
    minMs: samples.length === 0 ? 0 : Math.min(...samples),
    maxMs: samples.length === 0 ? 0 : Math.max(...samples),
    meanMs: samples.length === 0 ? 0 : total / samples.length,
    medianMs: median(samples),
    p95Ms: percentile(samples, 95)
  };
}

export function measure({ fn, warmup = 5, iterations = 50, samples = 9 }) {
  for (let i = 0; i < warmup; i += 1) {
    fn();
  }

  const timings = [];

  for (let sample = 0; sample < samples; sample += 1) {
    const start = nowNs();

    for (let i = 0; i < iterations; i += 1) {
      fn();
    }

    timings.push(elapsedMs(start) / iterations);
  }

  return {
    iterations,
    samples,
    ...stats(timings)
  };
}

export function round(value) {
  return Number(value.toFixed(4));
}

export function compactStats(result) {
  return {
    iterations: result.iterations,
    samples: result.samples,
    minMs: round(result.minMs),
    meanMs: round(result.meanMs),
    medianMs: round(result.medianMs),
    p95Ms: round(result.p95Ms),
    maxMs: round(result.maxMs)
  };
}
