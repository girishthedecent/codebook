// Runs `fn` over items with at most `limit` in flight. The first failure stops new work
// from starting and is rethrown once the in-flight calls settle.
export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
) {
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const item = items[next++]!;
      try {
        await fn(item);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  const settled = await Promise.allSettled(Array.from({ length: limit }, worker));
  const rejection = settled.find((result) => result.status === 'rejected');
  if (rejection) throw rejection.reason;
}
