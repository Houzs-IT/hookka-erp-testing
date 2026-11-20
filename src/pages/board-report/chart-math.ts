// Board Report chart arithmetic kept out of charts.tsx (a component-only file).

/** Each step's from / to level (a total resets the running level). */
export function waterfallBars<T extends { value: number; total?: boolean }>(steps: T[]): (T & { from: number; to: number })[] {
  const out: (T & { from: number; to: number })[] = [];
  for (const s of steps) {
    const level = out.length ? out[out.length - 1].to : 0;
    out.push(s.total ? { ...s, from: 0, to: s.value } : { ...s, from: level, to: level + s.value });
  }
  return out;
}

