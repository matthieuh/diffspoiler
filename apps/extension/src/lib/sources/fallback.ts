import { AuthRequiredError, type StatsSource } from './types';

// Switches to the fallback for good once the primary asks for auth, so head and files come from the same source.
export function withAuthFallback(primary: StatsSource, createFallback: () => StatsSource): StatsSource {
  let fallback: StatsSource | null = null;

  async function run<T>(call: (source: StatsSource) => Promise<T>): Promise<T> {
    if (fallback) return call(fallback);
    try {
      return await call(primary);
    } catch (error) {
      if (!(error instanceof AuthRequiredError)) throw error;
      fallback ??= createFallback();
      return call(fallback);
    }
  }

  return {
    fetchHead: () => run((source) => source.fetchHead()),
    fetchFiles: (signal) => run((source) => source.fetchFiles(signal)),
  };
}
