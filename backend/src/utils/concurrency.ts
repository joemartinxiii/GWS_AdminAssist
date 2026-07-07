/**
 * Map over items with a bounded concurrency limit, preserving input order in
 * the result. Used to parallelize per-item Google API calls (e.g. per-group
 * member scans, per-user delegation scans) without issuing thousands of
 * simultaneous requests that would trip rate limits or exhaust sockets.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const size = Math.max(1, Math.min(limit, items.length || 1));

  async function runner(): Promise<void> {
    let current = nextIndex++;
    while (current < items.length) {
      results[current] = await worker(items[current], current);
      current = nextIndex++;
    }
  }

  await Promise.all(Array.from({ length: size }, () => runner()));
  return results;
}
