// Summary statistics of latencies in milliseconds.

export interface Summary {
  count: number;
  median: number;
  p95: number;
  max: number;
}

export function summarize(values: readonly number[]): Summary | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const round = (x: number) => Math.round(x * 100) / 100;
  return { count: sorted.length, median: round(at(0.5)), p95: round(at(0.95)), max: round(sorted[sorted.length - 1]) };
}

/** The smallest step of performance.now() seen, in ms: the clock's resolution. */
export function clockResolution(): number {
  let smallest = Infinity;
  let last = performance.now();
  for (let i = 0; i < 200_000 && smallest > 0.001; i++) {
    const t = performance.now();
    if (t > last) {
      smallest = Math.min(smallest, t - last);
      last = t;
    }
  }
  return Math.round(smallest * 1000) / 1000;
}
