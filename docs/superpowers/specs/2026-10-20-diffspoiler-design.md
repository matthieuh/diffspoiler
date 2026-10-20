# diffspoiler — design

> "Spoiler: this +2,000 PR is 80% tests."

## Intent

The `+1,200 −300` counter on a GitHub PR or GitLab MR doesn't say what kind of change it is. When reviewing, the question is: **how much of this is real code, how much is tests, and how much is everything else** (evals, lockfiles, migrations, generated files…)?

diffspoiler answers that right on the PR/MR page, before you start reading the diff. It was inspired by a tweet showing a hover breakdown of lines changed (Runtime / Tests / Evals / Total).

## Goals

1. On a GitHub PR page and a GitLab MR page, show a breakdown of added/removed lines per bucket: **Runtime, Tests, Evals, Other**, plus Total.
2. **Exact counts: every changed line.** The source of truth is every changed line in the PR/MR, not the number the page displays, because platforms cap their own counters on huge MRs (GitLab shows "1000+" and collapses big diffs). Total is the sum of what we actually counted. If files can't be counted (e.g. GitHub's 3,000-file API cap), a "not counted: N files" row says so. If the page's counter is capped or disagrees, a footnote explains why. Never show a number that's silently wrong.
3. **Fast, including big MRs.** It appears instantly on typical MRs and in about a second on a 1,000+ file MR, and never freezes or slows the page.
4. **No setup.** Install it and it works. No config file and no token, at least on GitLab (see GitHub auth below).
5. **Easy install.** Unlisted Chrome Web Store listing: one-click install and auto-updates. The team installs from the link.

## Non-goals (for now)

- Firefox, Safari, or a native macOS / menu-bar app. A menu-bar app can't draw on the page, and Safari needs an Xcode-wrapped app plus a paid Apple developer account.
- Self-hosted GitLab or GitHub Enterprise. Targets are `github.com` and `gitlab.com` only.
- Per-repo config files or user-defined buckets. Built-in defaults only.
- Views other than the PR/MR page (MR lists, dashboards, CLI, CI comments). These are possible later integrations, which is why the counting logic is a separate package.
- Making the repo public. It lives in a **private repo** on the author's personal GitHub (`matthieuh`).

## Anti-goals (a failure even if it "works")

- **Slow loading.** Visible lag, layout shift, or slowing down GitHub/GitLab.
- **Wrong counts on big MRs.** Totals that don't match the platform counter, or truncated data shown as complete.

## UI (decided)

Validated mockup: a tiny bar plus a hover popover, identical on GitHub and GitLab.

- **Where.** On **every tab** of the PR/MR (Overview/Conversation, Commits, Changes/Files changed), in the title/meta line. It sits next to the platform's +/− counter where one exists. Where there's none (GitLab's Overview tab), it gets its own anchor in the title/meta line. Data loads with the page and is cached, so switching tabs doesn't refetch.
- **Mini bar.** A ~56px proportion bar. One colored segment per bucket, proportional to lines changed (additions + deletions). It shows the shape of the change without hovering.
- **Popover.** Hovering the bar or the counter opens a small table:

  | | | + | − |
  |---|---|---|---|
  | ■ | Runtime ⓘ | +55 | −7 |
  | ■ | Tests ⓘ | +77 | −1 |
  | ■ | Evals ⓘ | +503 | −36 |
  | ■ | Other ⓘ | +12 | −0 |
  | | **Total** | **+647** | **−44** |

- **Tooltips.** Each row's ⓘ explains what the bucket counts in plain words and how many files it covers (e.g. "Eval datasets, fixtures and prompt snapshots: files under `evals/`, `*.eval.ts`. 14 files.").
- **Loading state.** The bar shows a neutral placeholder right away, then fills in. It never pushes other header elements around.
- **Partial data.** If files couldn't be counted, the popover adds a "not counted: N files" row above Total. If the page's own counter is capped or differs (e.g. GitLab "1000+"), a footnote under the table says so.
- Follows the platform's light/dark theme. Green/red for +/−, and bucket colors that read in both themes.

## Classification (default rules, builder's call to refine)

Path-based, first match wins in this order:

1. **Tests:** `*.spec.*`, `*.test.*`, `__tests__/`, `test/`, `tests/`, `e2e/`, `*_test.go`, `test_*.py`, `*_spec.rb`
2. **Evals:** `evals/`, `eval/`, `*.eval.*`, eval datasets and fixtures under eval folders
3. **Other:** lockfiles (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `Cargo.lock`, `poetry.lock`, …), migrations, generated/vendored files (`dist/`, `vendor/`, `*.generated.*`, `*.min.*`), snapshots (`__snapshots__/`, `*.snap`), translation JSON (`locales/`, `i18n/`), docs (`*.md`, `docs/`)
4. **Runtime:** everything else

Order matters: a snapshot under `__tests__/` counts as Tests, not Other. *(My call; the author only asked for Runtime / Tests / Evals / other things, with tooltips.)*

## Architecture

Two parts, so later integrations can reuse the logic:

- **`core`**: a pure TypeScript package with no browser APIs. Input is a list of `{ path, additions, deletions }`; output is the per-bucket breakdown and file lists. Unit tested.
- **`extension`**: Chrome Manifest V3 extension. Detects PR/MR pages (including SPA navigation on both sites), fetches per-file stats, calls `core`, and renders the bar and popover.

### Data sources (constraints; exact endpoints left to the builder)

- **Use per-file line counts the platform already computes**, not diff text. That's what keeps big MRs exact and fast.
- **GitLab.** Use the logged-in session from the page (same origin), so no token is needed. GitLab exposes per-file diff stats server-side (GraphQL `diffStats` / `diffStatsSummary` on merge requests); the builder should confirm these cover huge and collapsed files and match the header counter.
- **GitHub.** The API doesn't accept the browser session. Preferred approach: get per-file counts through what the logged-in page can reach, without a token. If that isn't reliable for private repos, fall back to an **optional** fine-grained token entered once in the extension options. The builder decides after a spike and documents the trade-off. Watch for the REST cap of 3,000 files per PR: anything beyond it is reported as "not counted", never ignored.
- **Caching.** Key results by repo + PR/MR + head commit SHA, so revisiting costs nothing and a new push recomputes.
- **Batching.** Fetch pages in parallel where the API allows. Paint as soon as the data is complete. Don't render partial totals as if they were final.

### Performance budget (my call)

- No heavy UI framework in the content script. Keep it small (tens of KB).
- No work on non-PR/MR pages beyond a cheap URL check.
- Zero layout shift in the header.

## Distribution

- **Repo:** private, on personal GitHub `matthieuh`, named `diffspoiler`. Local folder: `~/Workspace/perso/diffspoiler`.
- **Release:** unlisted Chrome Web Store listing (one-time $5 developer registration), covering Chrome, Arc, Brave and Edge. Before the store listing exists, a zip on GitHub Releases can be loaded unpacked.
- Name checked on 2026-10-20: free on npm, no GitHub repos.

## Left to the builder

- Tooling and stack within the constraints above (package manager, bundler or extension framework, test runner).
- The exact GitHub/GitLab endpoints and DOM anchors, and resilience when the platforms change their markup (fail silently, never break the page).
- Bucket colors, icon, and store listing assets.
- Fine-tuning the default classification patterns.
