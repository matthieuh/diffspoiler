# diffspoiler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Chrome MV3 extension that shows a Runtime / Tests / Evals / Other breakdown of lines changed (mini bar + hover popover) on every tab of GitHub PRs and GitLab MRs.

**Architecture:** A pnpm workspace with two packages. `packages/core` is pure TypeScript with zero runtime deps: path classification plus breakdown math. `apps/extension` is a WXT-built MV3 extension whose content script parses the URL, fetches per-file stats from the platform API (GitLab GraphQL over the page session; GitHub REST with an optional token), caches the breakdown by head SHA, and renders a Shadow-DOM widget next to a page anchor.

**Tech Stack:** Node 22, pnpm 9 (corepack), TypeScript 5 (strict), WXT 0.20.x, Vitest 3 + happy-dom, `wxt/testing` (`WxtVitest`, `fakeBrowser`). No UI framework.

**Spec:** `docs/superpowers/specs/2026-10-20-diffspoiler-design.md`

## Global Constraints

- Targets: `github.com` and `gitlab.com` only. Chromium browsers only (Chrome, Arc, Brave, Edge).
- Buckets and order: **Runtime, Tests, Evals, Other**, plus Total.
- Exact counts are counts of every changed line. Total = sum of what we counted. Uncounted files show as a "not counted: N files" row. A capped or different page counter shows as a footnote. Never show a number that's silently wrong.
- Fast: instant on typical MRs, about 1s on 1,000+ file MRs, no freeze, **zero layout shift** in the header.
- No setup: no config file. No token on GitLab. On GitHub the token is optional (needed only where tokenless access fails).
- Use the platform's per-file line counts, never diff text.
- Cache key: repo + PR/MR + head commit SHA.
- Shown on **every tab** of the PR/MR, in the title/meta line, next to the +/− counter when one exists.
- Mini bar about 56px wide. Segment size = additions + deletions. Colors: Runtime `#4493f8`, Tests `#a371f7`, Evals `#d29922`, Other `#6e7681`.
- Content script: no UI framework, tens of KB. Only a URL check on non-PR/MR pages.
- If the DOM or API changes: fail silently and never break the page.
- Repo: private `matthieuh/diffspoiler`. Commits carry no Claude co-author trailer.

## Review Focus

1. **Navigating PR A → PR B without a reload (SPA):** B must never show A's numbers, even when A's request resolves last. Owned by Task 8.
2. **False-positive test paths:** `src/latest.ts`, `src/contest/score.ts` and `packages/testing/factory.ts` are Runtime. Only exact directory segments and file patterns count. Owned by Task 1.
3. **Renamed and binary files:** classify by the new path. Binary files count toward file counts with 0 lines. An all-zero PR renders an empty bar without NaN. Owned by Tasks 2 and 7.
4. **URL variants:** GitLab subgroups, `/-/merge_requests/12/diffs?commit_id=…#…`, and GitHub `/pull/12/files#diff-…` must all parse. `/pulls` lists and `/-/merge_requests/new` must not. Owned by Task 3.
5. **Anchor missing (markup changed):** no widget, no thrown error, no console noise beyond a single `debug`. Owned by Task 8.

---

### Task 1: Workspace + path classification

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.nvmrc` (`22`)
- Create: `packages/core/package.json` (name `@diffspoiler/core`, `"exports": { "./*": "./src/*.ts" }`, no barrel file), `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`
- Create: `packages/core/src/types.ts`, `packages/core/src/rules.ts`, `packages/core/src/classify.ts`
- Test: `packages/core/test/classify.test.ts`

**Interfaces:**
- Produces:
  - `type BucketId = 'runtime' | 'tests' | 'evals' | 'other'`
  - `interface FileStat { path: string; additions: number; deletions: number }`
  - `const BUCKET_ORDER: readonly BucketId[] = ['runtime', 'tests', 'evals', 'other']`
  - `const BUCKETS: Record<BucketId, { label: string; description: string; color: string }>`
  - `const RULES_VERSION: number` (starts at `1`; bump whenever the rules change, because it invalidates the cache)
  - `classifyPath(path: string): BucketId`

- [ ] **Step 1: Scaffold the workspace.** Root scripts: `test` → `pnpm -r test`, `typecheck` → `pnpm -r typecheck`, `build` → `pnpm --filter extension build`. `pnpm-workspace.yaml` lists `packages/*` and `apps/*`. Run `pnpm install`. Expected: exits 0.

- [ ] **Step 2: Write the failing test** `packages/core/test/classify.test.ts`, with one `it.each` table per bucket:

```ts
// tests (first match wins: tests > evals > other > runtime)
['src/a.spec.ts','src/a.test.tsx','src/__tests__/a.ts','test/a.ts','tests/a.py','e2e/login.ts',
 'pkg/a_test.go','app/test_models.py','spec/a_spec.rb','Tests/A.cs','src/__tests__/__snapshots__/a.snap',
 'src/__snapshots__/a.test.ts.snap'] → 'tests'
// evals
['evals/qa.jsonl','packages/x/eval/fixtures/a.json','src/rank.eval.ts'] → 'evals'
// other
['pnpm-lock.yaml','web/package-lock.json','yarn.lock','Cargo.lock','poetry.lock','go.sum','uv.lock',
 'src/migration/1700-add.ts','db/migrate/2024_x.rb','dist/a.js','vendor/lib.go','src/api.generated.ts',
 'public/app.min.js','src/__generated__/schema.ts','src/__snapshots__/a.snap','ui/a.snap',
 'locales/fr.json','src/i18n/en.yaml','README.md','docs/setup.txt','guide.mdx'] → 'other'
// runtime (false positives included)
['src/index.ts','src/latest.ts','src/contest/score.ts','packages/testing/factory.ts',
 'src/evaluate.ts','src/locales.ts','src/build/run.ts'] → 'runtime'
```

- [ ] **Step 3: Run the test.** `pnpm --filter @diffspoiler/core test`. Expected: FAIL (module not found).

- [ ] **Step 4: Implement `classifyPath`** in `classify.ts`. Matching is case-insensitive. Directory rules match **whole path segments** (all segments except the basename). Rules:
  - tests: segment ∈ {`__tests__`,`test`,`tests`,`e2e`}, or basename matches `/\.(spec|test)\.[^.]+(\.[^.]+)?$/`, `/_test\.go$/`, `/^test_.+\.py$/` or `/_spec\.rb$/`.
  - evals: segment ∈ {`evals`,`eval`}, or basename matches `/\.eval\.[^.]+$/`.
  - other: the basename is in the lockfile set {`pnpm-lock.yaml`,`package-lock.json`,`npm-shrinkwrap.json`,`yarn.lock`,`bun.lock`,`bun.lockb`,`cargo.lock`,`poetry.lock`,`pipfile.lock`,`gemfile.lock`,`composer.lock`,`go.sum`,`uv.lock`,`flake.lock`,`podfile.lock`}; or a segment ∈ {`migration`,`migrations`,`migrate`,`dist`,`vendor`,`__generated__`,`__snapshots__`,`docs`}; or the basename matches `/\.generated\.[^.]+$/`, `/\.min\.(js|css)$/`, `/\.snap$/` or `/\.(md|mdx)$/`; or a segment ∈ {`locales`,`i18n`} and the extension ∈ {json,yaml,yml,po}.
  - runtime: everything else.

  In `rules.ts`, `BUCKETS` uses this copy verbatim:
  - Runtime: "Production code: everything that isn't a test, an eval or a supporting file."
  - Tests: "Tests: *.spec.*, *.test.*, __tests__/, test(s)/, e2e/, *_test.go, test_*.py, *_spec.rb."
  - Evals: "Evals: eval suites, datasets and fixtures under evals/ or eval/, and *.eval.* files."
  - Other: "Supporting files: lockfiles, migrations, generated or vendored code, snapshots, translations and docs."

  Colors come from Global Constraints.

- [ ] **Step 5: Run the test.** Same command as Step 3. Expected: PASS. Then `pnpm typecheck`. Expected: 0 errors.

- [ ] **Step 6: Commit.** `git add -A && git commit -m "feat(core): classify changed paths into buckets"`

### Task 2: Breakdown math

**Files:**
- Create: `packages/core/src/breakdown.ts`
- Modify: `packages/core/src/types.ts` (add types)
- Test: `packages/core/test/breakdown.test.ts`

**Interfaces:**
- Consumes: `classifyPath`, `BUCKET_ORDER`, `FileStat`
- Produces:
  - `interface BucketSummary { id: BucketId; additions: number; deletions: number; fileCount: number }`
  - `interface Breakdown { buckets: BucketSummary[]; total: { additions: number; deletions: number; fileCount: number }; uncountedFiles: number }`. `buckets` always has 4 entries, in `BUCKET_ORDER`.
  - `computeBreakdown(files: FileStat[], uncountedFiles?: number): Breakdown` (default `0`; negative values are clamped to 0)

- [ ] **Step 1: Write the failing tests:**
  - `sums lines and files per bucket`. Input: `src/a.ts` +10 −2, `src/a.test.ts` +5 −1, `evals/x.json` +100 −0, `pnpm-lock.yaml` +40 −40. Expect runtime `{10,2,1}`, tests `{5,1,1}`, evals `{100,0,1}`, other `{40,40,1}`, total `{155,43,4}`.
  - `total equals the sum of buckets`. Property check over a generated list of 500 random paths and counts: `total.additions === Σ buckets.additions`, and likewise for deletions and fileCount.
  - `keeps empty buckets in fixed order`. `computeBreakdown([])` returns 4 zeroed buckets in `BUCKET_ORDER` and total `{0,0,0}`.
  - `binary file counts as a file with 0 lines`. `{path:'img/logo.png', additions:0, deletions:0}` gives runtime fileCount 1 and 0 lines.
  - `passes uncountedFiles through, clamped`. `computeBreakdown([], 3).uncountedFiles === 3`, and `computeBreakdown([], -2).uncountedFiles === 0`.

- [ ] **Step 2: Run the tests.** `pnpm --filter @diffspoiler/core test`. Expected: FAIL.
- [ ] **Step 3: Implement `computeBreakdown`** in `breakdown.ts`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -am "feat(core): compute per-bucket breakdown"`

### Task 3: Extension scaffold + PR/MR URL parsing

**Files:**
- Create: `apps/extension/package.json` (name `extension`; scripts `dev`, `build` → `wxt build`, `zip` → `wxt zip`, `test` → `vitest run`, `typecheck` → `tsc --noEmit`; depends on `@diffspoiler/core: workspace:*`)
- Create: `apps/extension/wxt.config.ts`, `apps/extension/tsconfig.json`, `apps/extension/vitest.config.ts` (uses `WxtVitest()`, environment `happy-dom`)
- Create: `apps/extension/src/entrypoints/content.ts` (stub that only parses the URL), `apps/extension/src/lib/pr-ref.ts`
- Test: `apps/extension/test/pr-ref.test.ts`

**Interfaces:**
- Produces:
  - `type PrRef = { host: 'github'; repo: string; number: number } | { host: 'gitlab'; projectPath: string; iid: number }`
  - `parsePrUrl(url: string): PrRef | null`
  - `prKey(ref: PrRef): string`. Examples: `github:owner/repo#12`, `gitlab:group/sub/proj!34`.

- [ ] **Step 1: Configure the manifest in `wxt.config.ts`:**
  - `name: 'diffspoiler'`
  - `permissions: ['storage']`
  - `host_permissions: ['https://github.com/*', 'https://api.github.com/*', 'https://gitlab.com/*']`
  - content script `matches: ['https://github.com/*', 'https://gitlab.com/*']`, `runAt: 'document_idle'`
- [ ] **Step 2: Write the failing tests:**
  - `https://github.com/o/r/pull/12` → `{host:'github', repo:'o/r', number:12}`. The same result for `/pull/12/files#diff-abc`, `/pull/12/commits` and `/pull/12/checks?x=1`.
  - `https://gitlab.com/g/sub/proj/-/merge_requests/34` → `{host:'gitlab', projectPath:'g/sub/proj', iid:34}`. The same result for `/-/merge_requests/34/diffs?commit_id=a#b` and `/-/merge_requests/34/pipelines`.
  - These return `null`: `https://github.com/o/r/pulls`, `https://github.com/o/r`, `https://gitlab.com/g/p/-/merge_requests`, `https://gitlab.com/g/p/-/merge_requests/new`, `https://example.com/o/r/pull/1`.
  - `prKey` gives the two formats above.
- [ ] **Step 3: Run the tests.** `pnpm --filter extension test`. Expected: FAIL.
- [ ] **Step 4: Implement `parsePrUrl` and `prKey`.** Use `new URL()` and match on the pathname only.
- [ ] **Step 5: Verify.** `pnpm --filter extension test` → PASS. `pnpm --filter extension build` → produces `.output/chrome-mv3/manifest.json` with the permissions above.
- [ ] **Step 6: Commit.** `git add -A && git commit -m "feat(extension): scaffold MV3 extension and parse PR/MR URLs"`

### Task 4: GitLab source

**Files:**
- Create: `apps/extension/src/lib/sources/types.ts`, `apps/extension/src/lib/sources/gitlab.ts`
- Test: `apps/extension/test/sources/gitlab.test.ts`

**Interfaces:**
- Consumes: `PrRef` (gitlab variant), `FileStat`
- Produces:
  - `interface PrHead { headSha: string; additions: number; deletions: number; fileCount: number }`
  - `interface StatsSource { fetchHead(): Promise<PrHead>; fetchFiles(): Promise<FileStat[]> }`
  - `class AuthRequiredError extends Error {}`
  - `createGitLabSource(ref: Extract<PrRef, {host:'gitlab'}>, deps: { fetchFn: typeof fetch; csrfToken: string | null }): StatsSource`

- [ ] **Step 1: Write the failing tests,** with a fake `fetchFn` that records requests:
  - `fetchHead`:
    - POSTs to `https://gitlab.com/api/graphql` with `credentials: 'include'` and header `X-CSRF-Token` (when the token isn't null).
    - The query requests `project(fullPath:$path){ mergeRequest(iid:$iid){ diffHeadSha diffStatsSummary{ additions deletions fileCount } } }`, with variables `{path:'g/sub/proj', iid:'34'}`.
    - It maps the result to `PrHead`.
  - `fetchFiles`: queries `mergeRequest(iid){ diffStats { path additions deletions } }` and returns `FileStat[]` unchanged.
  - When `mergeRequest` is `null` or the response is 401/403, both functions throw `AuthRequiredError`.
  - Any other failure (non-2xx, or a GraphQL `errors` array) throws a plain `Error`.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement `createGitLabSource`.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Live check** (logged into gitlab.com in Chrome; use the claude-in-chrome tools or DevTools):
  - Pick a public MR with more than 1,000 changed files (search `gitlab-org/gitlab` merge requests), plus a normal MR.
  - Run both queries from the MR page console (copy them from `gitlab.ts`).
  - Expected:
    - `diffStats.length === diffStatsSummary.fileCount`.
    - The sums of `diffStats` additions and deletions equal `diffStatsSummary`.
    - Both requests take under 1s.
  - Write the observed numbers and timings in `docs/notes/gitlab-api.md`. If `diffStats` is truncated, write down where it truncates, and STOP: report the mismatch before continuing. Uncounted files must still come out right in Task 6 via `fileCount − files.length`.
- [ ] **Step 6: Commit.** `git add -A && git commit -m "feat(extension): fetch GitLab MR diff stats over the page session"`

### Task 5: GitHub source + token options page

**Files:**
- Create: `apps/extension/src/lib/sources/github.ts`, `apps/extension/src/lib/settings.ts`
- Create: `apps/extension/src/entrypoints/options/index.html`, `apps/extension/src/entrypoints/options/main.ts`
- Create: `apps/extension/src/entrypoints/background.ts` (only handles the `{type:'open-options'}` message → `browser.runtime.openOptionsPage()`)
- Test: `apps/extension/test/sources/github.test.ts`, `apps/extension/test/settings.test.ts`

**Interfaces:**
- Consumes: `StatsSource`, `PrHead`, `AuthRequiredError`
- Produces:
  - `createGitHubSource(ref: Extract<PrRef, {host:'github'}>, deps: { fetchFn: typeof fetch; token: string | null; concurrency?: number }): StatsSource` (`concurrency` defaults to 6)
  - `getGitHubToken(): Promise<string | null>` and `setGitHubToken(token: string | null): Promise<void>` (key `github.token` in `browser.storage.local`)

- [ ] **Step 1: Write the failing tests:**
  - `fetchHead`: calls `GET https://api.github.com/repos/o/r/pulls/12` with `Accept: application/vnd.github+json`, plus `Authorization: Bearer <token>` only when a token is set. It maps `head.sha`, `additions`, `deletions` and `changed_files` to `PrHead`.
  - `fetchFiles` paginates `/pulls/12/files?per_page=100&page=N`:
    - It computes `ceil(min(changed_files, 3000) / 100)` pages up front and fetches them in parallel, at most `concurrency` at once. Assert that the peak number of in-flight requests is ≤ 6 for 30 pages.
    - It maps `filename` → `path`, so a renamed file uses its new path.
    - A 3,500-file PR yields 3,000 `FileStat`s.
  - A 404 or 401 without a token throws `AuthRequiredError`. A 404 or 401 with a token also throws `AuthRequiredError`, because the token may lack access to that repo. A 403 with `x-ratelimit-remaining: 0` throws `Error('rate-limited')`.
  - Settings: a set/get round-trip works through `fakeBrowser`, and `setGitHubToken(null)` removes the key.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement the source and settings.** The options page has one password input, labeled "GitHub token (optional, only for private repos)". Show helper text verbatim: "Create a fine-grained token with read-only 'Pull requests' access to the repos you review." Add Save and Clear buttons.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(extension): fetch GitHub PR file stats with optional token"`

### Task 6: Cache + load orchestration

**Files:**
- Create: `apps/extension/src/lib/cache.ts`, `apps/extension/src/lib/load-breakdown.ts`
- Test: `apps/extension/test/cache.test.ts`, `apps/extension/test/load-breakdown.test.ts`

**Interfaces:**
- Consumes: `StatsSource`, `PrHead`, `computeBreakdown`, `RULES_VERSION`, `prKey`
- Produces:
  - `interface BreakdownCache { get(key: string, headSha: string): Promise<Breakdown | null>; set(key: string, headSha: string, b: Breakdown): Promise<void> }`
  - `createBreakdownCache(opts?: { max?: number }): BreakdownCache` (`max` defaults to 200)
    - Storage key: `cache:${RULES_VERSION}:${key}`. The stored value includes `headSha` and `at`.
    - LRU eviction is by `at`, so stale versions never get served.
  - `interface Loaded { breakdown: Breakdown; head: PrHead }`
  - `loadBreakdown(ref: PrRef, source: StatsSource, cache: BreakdownCache): Promise<Loaded>`

- [ ] **Step 1: Write the failing tests:**
  - Cache:
    - A miss when the SHA differs, a hit when it's the same.
    - Entry 201 evicts the oldest.
    - A different `RULES_VERSION` key is never read.
  - `loadBreakdown`:
    - On a cache hit, `fetchFiles` is never called.
    - On a miss, it computes the breakdown with `uncountedFiles = max(0, head.fileCount − files.length)` and stores it.
    - When the head has `fileCount` 3500 and there are 3,000 files, `uncountedFiles` is 500.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement both.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(extension): cache breakdowns by head SHA"`

### Task 7: Widget (mini bar + popover)

**Files:**
- Create: `apps/extension/src/lib/ui/widget.ts`, `apps/extension/src/lib/ui/widget.css` (imported as a string with `?inline` and injected into the shadow root), `apps/extension/src/lib/ui/page-counter.ts`
- Test: `apps/extension/test/ui/widget.test.ts`, `apps/extension/test/ui/page-counter.test.ts`

**Interfaces:**
- Consumes: `Breakdown`, `BUCKETS`, `BUCKET_ORDER`
- Produces:
  - `interface PageCounter { additions: number | null; deletions: number | null; capped: boolean }`
  - `parsePageCounter(text: string): PageCounter`
  - `footnote(b: Breakdown, page: PageCounter | null): string | null`
  - `type WidgetState = { kind: 'loading' } | { kind: 'ready'; breakdown: Breakdown; page: PageCounter | null } | { kind: 'auth-required' } | { kind: 'hidden' }`
  - `createWidget(doc: Document): { host: HTMLElement; setState(s: WidgetState): void }`. `host` is a `<diffspoiler-badge>` element with an open shadow root.

- [ ] **Step 1: Write the failing tests:**
  - `parsePageCounter`:
    - `'+1,234 −56'` → `{1234, 56, false}`
    - `'+1 234 -56'` (narrow no-break space) → `{1234, 56, false}`
    - `'1000+'` → `{null, null, true}`
    - `''` → `{null, null, false}`
  - `footnote`:
    - Returns `null` when the page counter matches the total, or there's no page counter.
    - When capped: `"The page shows a capped count; diffspoiler counted every changed file."`
    - When the numbers differ: `"The page shows +X −Y; diffspoiler counted +A −B across all files."`
  - Widget:
    - The host has fixed CSS `width: 56px` (plus margin) in every state, so it never changes size and there's no layout shift. Assert that the inline-size style is identical across `loading`, `ready` and `auth-required`.
    - `ready`:
      - One bar segment per bucket with lines > 0, with `flex-grow` = additions + deletions.
      - When everything is zero, there are no segments and no `NaN` in any style.
    - Popover:
      - Rows in `BUCKET_ORDER` showing `+N` and `−N` with thousands separators (`toLocaleString('en-US')`), then a Total row.
      - A "not counted: 500 files" row before Total when `uncountedFiles > 0`.
      - The footnote, when `footnote()` returns one.
    - Each ⓘ has a `title` set to `${description} ${fileCount} file(s).`
    - `auth-required`:
      - A dashed outline on the bar, and popover text: "Private repo: add a GitHub token in diffspoiler options."
      - A button that sends `{type:'open-options'}` via `browser.runtime.sendMessage`.
    - `hidden`: `display: none`.
    - The popover opens on `mouseenter` and `focusin` of the host and closes on `mouseleave` and `focusout`. The host has `tabindex="0"`.
    - Theme: dark when the luminance of `getComputedStyle(doc.body).backgroundColor` is < 0.5. Expose this as `data-theme` on the host.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The popover is absolutely positioned inside the shadow root, so it never affects page layout.
  - Use green `#3fb950` and red `#f85149` for +/− (dark theme), and `#1a7f37` / `#cf222e` (light theme).
  - The widget CSS stays under 4 KB.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(extension): render breakdown bar and popover"`

### Task 8: Anchors + mount controller (SPA-safe)

**Files:**
- Create: `apps/extension/src/lib/ui/anchors.ts`, `apps/extension/src/lib/mount.ts`
- Modify: `apps/extension/src/entrypoints/content.ts` (wire everything)
- Create fixtures: `apps/extension/test/fixtures/{github,gitlab}-{overview,commits,files}.html`
- Test: `apps/extension/test/ui/anchors.test.ts`, `apps/extension/test/mount.test.ts`

**Interfaces:**
- Consumes: everything above
- Produces:
  - `findAnchor(host: 'github' | 'gitlab', doc: Document): { anchor: Element; counter: Element | null } | null`. The widget is inserted after `counter` when present, otherwise appended to `anchor`.
  - `startMount(deps: { win: Window; doc: Document; getSource: (ref: PrRef) => Promise<StatsSource>; cache: BreakdownCache }): { stop(): void }`

- [ ] **Step 1: Capture fixtures.**
  - Logged in, open in Chrome:
    - a PR on github.com: Conversation, Commits and Files changed tabs;
    - an MR on gitlab.com: Overview, Commits and Changes tabs.
  - Save `document.documentElement.outerHTML` of each page into the fixture files. Strip `<script>` contents and any tokens.
- [ ] **Step 2: Choose the selectors from the fixtures.**
  - `anchors.ts` holds, per host, an **ordered list of candidate selectors** for the title/meta line and for the +/− counter.
  - Where a tab has no counter (GitLab Overview), the anchor is the title/meta line.
  - Prefer stable hooks (ids, `data-*`, `aria-*`) over utility classes.
- [ ] **Step 3: Write the failing tests:**
  - Anchors:
    - Each of the 6 fixtures resolves an anchor.
    - `counter` is non-null where the fixture shows a +/− counter.
    - A document with no matching markup returns `null` and doesn't throw.
  - Mount, with a fake source whose promises the test resolves by hand:
    - **Race:** navigate to PR A, then to B before A resolves; resolve B, then A. The widget shows B's breakdown and A's result is discarded.
    - **Tab switch:** going from `/pull/12` to `/pull/12/files` reuses the in-memory result. `fetchHead` is called once.
    - **Lost anchor:** if the page re-renders and removes the widget host, the controller re-inserts it on the next animation frame. It uses a `MutationObserver` on `body`, created only while on a PR/MR page and disconnected otherwise.
    - **Non-PR page:** no observer is created and no fetch happens.
    - **Missing anchor:** no widget, nothing thrown, at most one `console.debug('diffspoiler: no anchor')` per URL.
    - `AuthRequiredError` → the widget enters `auth-required`. Any other error → `hidden`.
- [ ] **Step 4: Run the tests.** Expected: FAIL.
- [ ] **Step 5: Implement `startMount`.**
  - Navigation is detected with WXT's `wxt:locationchange` event on `ctx`. Re-run `parsePrUrl` on each change.
  - Track a `currentKey`, and drop results whose key no longer matches it.
  - Keep an in-memory `Map<prKey, Loaded>`.
  - Paint `loading` immediately on mount.
  - Read the page counter text with `parsePageCounter(counter.textContent)`.
- [ ] **Step 6: Wire `content.ts`.** `getSource` picks GitLab or GitHub from the ref.
  - GitLab: `csrfToken` comes from `meta[name="csrf-token"]`.
  - GitHub: the token comes from `getGitHubToken()`.
  - `fetchFn` is `globalThis.fetch`.
- [ ] **Step 7: Run the tests.** Expected: PASS. Then run `pnpm test && pnpm typecheck`. Expected: all green.
- [ ] **Step 8: Commit.** `git add -A && git commit -m "feat(extension): mount widget on every PR/MR tab, SPA-safe"`

### Task 9: Real-page QA + performance check

**Files:**
- Create: `docs/notes/qa-2026-10.md`

- [ ] **Step 1: Load the extension.** Run `pnpm build`. Check that `apps/extension/.output/chrome-mv3/content-scripts/content.js` is < 50 KB. Then load `apps/extension/.output/chrome-mv3` unpacked in Chrome.
- [ ] **Step 2: GitLab (logged in, no token).**
  - Pages: one normal MR, and the more-than-1,000-file MR from Task 4.
  - Check on every tab that:
    - the bar appears;
    - the popover rows sum to Total;
    - the footnote shows when the page counter is capped;
    - nothing in the header moves when the widget fills in (use DevTools Performance with the "Layout Shift" track and expect CLS 0 attributable to `diffspoiler-badge`).
- [ ] **Step 3: GitHub.**
  - Public PR without a token: the bar appears and Total equals the header counter.
  - Private PR without a token: `auth-required`, and the options button opens the options page.
  - Private PR with a fine-grained token: the bar appears.
  - A public PR with 3,000+ files (search `is:pr` on a large repo, e.g. a mass-rename PR): the "not counted" row appears.
- [ ] **Step 4: Timing.** In DevTools Network, time from the first API request to the widget being painted:
  - normal MR: < 300 ms on warm cache-miss;
  - 1,000+ file MR: < 1.5 s;
  - revisit (same SHA): 0 file requests.
- [ ] **Step 5: Navigation.** Click from PR A to PR B within the site. B's numbers appear, and A's never flash.
- [ ] **Step 6: Record and fix.** Write results (numbers, screenshots) in `docs/notes/qa-2026-10.md`. Fix any failure through a test-first change in the owning task's files, then commit: `git commit -am "test: real-page QA notes"`

### Task 10: Spike, tokenless GitHub private repos

**Files:**
- Create: `docs/notes/github-auth.md`
- Maybe create: `apps/extension/src/lib/sources/github-session.ts` + `apps/extension/test/sources/github-session.test.ts`

- [ ] **Step 1: Investigate.** Time-box this to 2 hours. Look for a way to get exact per-file line counts for a private PR using only the logged-in github.com session, with no diff-text parsing:
  - data embedded in the PR page or the files page;
  - same-origin JSON endpoints the PR UI calls;
  - the GraphQL used by the web UI.
  - For each candidate, write down:
    - whether it's complete for 3,000+ files;
    - how stable it looks;
    - its timing.
- [ ] **Step 2: Decide and record it in `docs/notes/github-auth.md`.**
  - **Viable:** implement `createGitHubSessionSource(ref, deps): StatsSource` with tests in the Task 5 style, using fixture JSON captured from the real endpoint. `getSource` uses it when no token is set. Token users stay on REST.
  - **Not viable:** document why. The optional token stays the path for private repos.
- [ ] **Step 3: Verify.** If implemented, `pnpm test` passes, and re-running Task 9 Step 3 on a private PR without a token shows the bar.
- [ ] **Step 4: Commit.** `git add -A && git commit -m "docs: GitHub tokenless auth spike"` (use `feat(extension): …` if it was implemented).

### Task 11: Package + private repo

**Files:**
- Create: `README.md` (what it is, a screenshot from Task 9, install from the store link or unpacked zip, the optional GitHub token, the bucket rules table), `RELEASING.md`

- [ ] **Step 1: Write `RELEASING.md`.** Steps:
  - bump `version` in `apps/extension/package.json`;
  - `pnpm zip`;
  - upload `apps/extension/.output/diffspoiler-<v>-chrome.zip` to the Chrome Web Store dashboard with visibility **Unlisted**. This needs a one-time $5 developer registration, done by Matthieu manually;
  - attach the same zip to a GitHub Release.
- [ ] **Step 2: Build the zip.** Run `pnpm zip`. Expected: the zip exists and is < 100 KB.
- [ ] **Step 3: Check the GitHub account.** Run `gh auth status`. Expected: the active account is `matthieuh`. If it isn't, stop and ask Matthieu to switch with `gh auth switch`.
- [ ] **Step 4: Create the repo.** `gh repo create matthieuh/diffspoiler --private --source . --push`. Expected: the repo exists and is **private**. Check with `gh repo view matthieuh/diffspoiler --json visibility` → `PRIVATE`.
- [ ] **Step 5: Release.** `git commit` the docs, run `git push`, then `gh release create v0.1.0 apps/extension/.output/*.zip --notes "First release"`.
