import { AuthRequiredError, RateLimitedError, type StatsSource } from './types';

// Switches to the fallback for good once the primary needs auth or is rate-limited, so head and files come from the
// same source.
export function withFallback(primary: StatsSource, createFallback: () => StatsSource): StatsSource {
  let fallback: StatsSource | null = null;

  async function run<T>(call: (source: StatsSource) => Promise<T>): Promise<T> {
    if (fallback) return call(fallback);
    try {
      return await call(primary);
    } catch (error) {
      if (!(error instanceof AuthRequiredError || error instanceof RateLimitedError)) throw error;
      fallback ??= createFallback();
      return call(fallback);
    }
  }

  return {
    fetchHead: () => run((source) => source.fetchHead()),
    fetchFiles: (signal) => run((source) => source.fetchFiles(signal)),
  };
}
