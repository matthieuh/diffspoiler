import { describe, expect, it } from 'vitest';
import { classifyPath } from '../src/classify.ts';

describe('classifyPath', () => {
  it.each([
    'src/a.spec.ts', 'src/a.test.tsx', 'src/__tests__/a.ts', 'test/a.ts', 'tests/a.py', 'e2e/login.ts',
    'pkg/a_test.go', 'app/test_models.py', 'spec/a_spec.rb', 'Tests/A.cs', 'src/__tests__/__snapshots__/a.snap',
    'src/__snapshots__/a.test.ts.snap',
  ])('%s -> tests', (path) => {
    expect(classifyPath(path)).toBe('tests');
  });

  it.each(['evals/qa.jsonl', 'packages/x/eval/fixtures/a.json', 'src/rank.eval.ts'])('%s -> evals', (path) => {
    expect(classifyPath(path)).toBe('evals');
  });

  it.each([
    'pnpm-lock.yaml', 'web/package-lock.json', 'yarn.lock', 'Cargo.lock', 'poetry.lock', 'go.sum', 'uv.lock',
    'src/migration/1700-add.ts', 'db/migrate/2024_x.rb', 'dist/a.js', 'vendor/lib.go', 'src/api.generated.ts',
    'public/app.min.js', 'src/__generated__/schema.ts', 'src/__snapshots__/a.snap', 'ui/a.snap',
    'locales/fr.json', 'src/i18n/en.yaml', 'README.md', 'docs/setup.txt', 'guide.mdx',
  ])('%s -> other', (path) => {
    expect(classifyPath(path)).toBe('other');
  });

  it.each([
    'src/index.ts', 'src/latest.ts', 'src/contest/score.ts', 'packages/testing/factory.ts',
    'src/evaluate.ts', 'src/locales.ts', 'src/build/run.ts',
  ])('%s -> runtime', (path) => {
    expect(classifyPath(path)).toBe('runtime');
  });
});
