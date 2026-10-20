import type { BucketId } from './types.ts';

export const BUCKET_ORDER: readonly BucketId[] = ['runtime', 'tests', 'evals', 'other'];

export const BUCKETS: Record<BucketId, { label: string; description: string; color: string }> = {
  runtime: {
    label: 'Runtime',
    description: "Production code: everything that isn't a test, an eval or a supporting file.",
    color: '#4493f8',
  },
  tests: {
    label: 'Tests',
    description: 'Tests: *.spec.*, *.test.*, *.e2e-spec.*, __tests__/, test(s)/, e2e/, *_test.go, test_*.py, *_spec.rb.',
    color: '#a371f7',
  },
  evals: {
    label: 'Evals',
    description: 'Evals: eval suites, datasets and fixtures under evals/ or eval/, and *.eval.* files.',
    color: '#d29922',
  },
  other: {
    label: 'Other',
    description: 'Supporting files: lockfiles, migrations, generated or vendored code, snapshots, translations and docs.',
    color: '#6e7681',
  },
};

// Bump whenever the classification rules change: it invalidates cached results.
export const RULES_VERSION = 2;
