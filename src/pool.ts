// Esecuzione in parallelo con un limite.

/** Esegue fn su ogni elemento, al massimo `limit` alla volta; onDone nell'ordine di fine. */
export async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  onDone: (item: T, result: PromiseSettledResult<R>) => void,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      try {
        onDone(item, { status: "fulfilled", value: await fn(item) });
      } catch (reason) {
        onDone(item, { status: "rejected", reason });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
