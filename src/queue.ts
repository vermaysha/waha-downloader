/**
 * Creates a bounded FIFO concurrency queue that limits how many async tasks run at once.
 */
export function createConcurrencyQueue(limit: number) {
  const maxConcurrent = Math.max(1, limit);
  let active = 0;
  const waiting: Array<() => void> = [];

  return async function enqueue<T>(task: () => Promise<T>): Promise<T> {
    if (active >= maxConcurrent) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    } else {
      active += 1;
    }
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) {
        next();
      } else {
        active -= 1;
      }
    }
  };
}
