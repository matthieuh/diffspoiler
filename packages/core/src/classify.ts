import type { BucketId } from './types.ts';

const TEST_DIRS = new Set(['__tests__', 'test', 'tests', 'e2e']);
const TEST_FILES = [/\.(spec|test)\.[^.]+(\.[^.]+)?$/, /_test\.go$/, /^test_.+\.py$/, /_spec\.rb$/];

const EVAL_DIRS = new Set(['evals', 'eval']);
const EVAL_FILES = [/\.eval\.[^.]+$/];

const LOCKFILES = new Set([
  'pnpm-lock.yaml',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'cargo.lock',
  'poetry.lock',
  'pipfile.lock',
  'gemfile.lock',
  'composer.lock',
  'go.sum',
  'uv.lock',
  'flake.lock',
  'podfile.lock',
]);
const OTHER_DIRS = new Set(['migration', 'migrations', 'migrate', 'dist', 'vendor', '__generated__', '__snapshots__', 'docs']);
const OTHER_FILES = [/\.generated\.[^.]+$/, /\.min\.(js|css)$/, /\.snap$/, /\.(md|mdx)$/];
const I18N_DIRS = new Set(['locales', 'i18n']);
const I18N_EXTENSIONS = new Set(['json', 'yaml', 'yml', 'po']);

export function classifyPath(path: string): BucketId {
  const segments = path.toLowerCase().split('/');
  const basename = segments.pop() ?? '';
  const inDir = (dirs: Set<string>) => segments.some((segment) => dirs.has(segment));
  const matches = (patterns: RegExp[]) => patterns.some((pattern) => pattern.test(basename));

  if (inDir(TEST_DIRS) || matches(TEST_FILES)) return 'tests';
  if (inDir(EVAL_DIRS) || matches(EVAL_FILES)) return 'evals';

  const extension = basename.includes('.') ? basename.slice(basename.lastIndexOf('.') + 1) : '';
  if (
    LOCKFILES.has(basename) ||
    inDir(OTHER_DIRS) ||
    matches(OTHER_FILES) ||
    (inDir(I18N_DIRS) && I18N_EXTENSIONS.has(extension))
  ) {
    return 'other';
  }
  return 'runtime';
}
