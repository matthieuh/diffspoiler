# GitHub without a token (spike, 2026-10-20)

Question: can the content script get exact per-file line counts for a private PR from the logged-in github.com
session alone (same-origin requests, no diff-text parsing)?

Answer: yes, through the `page_data` JSON endpoints the new React PR UI reads. Implemented as a fallback source.

## Method

Headless Chromium, logged out, public PRs only (no access to a real session; `api.github.com` not used, anonymous
quota exhausted). Network capture of the PR tabs, in-page `fetch` probes, and a read of the public JS bundles
(`github.githubassets.com`) to find the endpoint names and the headers the UI sends. PRs: DefinitelyTyped #75475
(3 files), #75596 (8 files), and a huge public PR (6,369 files, +458,000).

## Candidates

| Candidate | Per-file data | Completeness | Timing (6,369 files) | Verdict |
|---|---|---|---|---|
| `GET /{repo}/pull/{n}/page_data/file_tree` (JSON) | `diffs[]`: `path`, `linesAdded`, `linesDeleted`, `linesChanged`, `changeType`, `pathDigest`; zero counts omitted | first 3,000 files (same cap as REST); 3,000 unique paths, sum +353,303 = REST | 1 request, 746 KB, 3.8 s cold / 1.0 s warm | **chosen** |
| `page_data/base_comparison_info` (JSON) | `diffSummaries[]` with the same counts | `pageLimits.filesLimit` = 300; also ships `diffContents` (diff lines) | 54 KB for 3 files | rejected: 300-file cap, heavy |
| `page_data/diff_entries?paths=...` | diff hunks per path | needs the path list | n/a | rejected: diff text |
| Route payload `/pull/{n}/changes` (`pullRequestsChangesRoute`, has `diffSummaries`) | same as above | unknown | n/a | unverifiable: logged-out is redirected to `/files` |
| Classic `/pull/{n}/show_toc` (HTML "Jump to" menu) | `+A −D` per file, path truncated in the label | 3,000 | 4.5 MB HTML, 1.1 s | rejected: HTML scraping, paths need a join with `partials/file_tree` (8 MB) by `#diff-<sha256>` |
| Classic `/files` HTML, `diffs?start_entry=` fragments | `aria-label="N changes: A additions & D deletions"` | progressive, 467 files after 12 s on the huge PR | 14 MB+ | rejected: downloads the whole rendered diff |
| Web UI GraphQL (`/_graphql`) | not used by the PR tabs observed | n/a | n/a | no candidate |

Head data comes from three small JSON endpoints of the same family, fetched in parallel (~0.5-0.9 s):
`page_data/header` (`pullRequest.headSha`), `page_data/diffstat` (`diffstat.linesAdded/linesDeleted`, PR totals) and
`page_data/tab_counts` (`filesChangedCount`, the real count: 6,369 on the huge PR, so "not counted: 3,369 files" stays
honest).

Live run of `createGitHubSessionSource` in a github.com page: #75475 head +22 −1 / 3 files, files sum +22 −1, 590 ms;
#75596 +52 −0 / 8 files, 732 ms; the huge PR head 6,369 files, 3,000 listed, sum +353,303, 1.04 s; unknown repo:
`AuthRequiredError`.

## Required request shape

`Accept: application/json`, `GitHub-Verified-Fetch: true`, `X-Requested-With: XMLHttpRequest`; without the last two
the server answers 406. No CSRF token or nonce needed for GETs. Not found / no access answers
`404 {"error":"Not Found"}`.

## Decision

`createGitHubSessionSource` (`apps/extension/src/lib/sources/github-session.ts`) reads `header` + `diffstat` +
`tab_counts` for the head and `file_tree` for the files. `content.ts` wraps the REST source with `withFallback` only
when no token is set: REST first; on `AuthRequiredError` (private PR) or `RateLimitedError` (anonymous quota spent) it
switches to the session source for both calls. With a token, behaviour is unchanged. Logged out of github.com, the
session source also gets 404, so the widget still shows `auth-required`.

## Risks

- Unverified on a real private PR (no session available to the spike). The endpoints are what the PR UI itself
  calls with the session cookie, so they should behave the same; to check with manual checklist item 3b.
- Internal, unversioned endpoints (`page_data/*`, a JS enum in the PR bundle). Drift makes the source throw and the
  widget hide, never show wrong numbers: diffstat and file count must be integers; each `file_tree` entry must satisfy
  `linesChanged = linesAdded + linesDeleted` (omitted = 0); a non-empty list with no count key at all is rejected; when
  every file is listed, the file sums must equal the diffstat totals.
- Side effect of that guard: a non-empty PR whose files all have zero line changes (pure renames, binaries only)
  hides the widget.
- `file_tree` stops at 3,000 files, like REST; the rest is reported as "not counted". If `tab_counts` flags its own
  count as capped (`filesChangedCountLimitExceeded: true`, not seen even at 6,369 files) the source throws rather than
  under-report.
- A token-less private PR still costs two REST 404s against the anonymous 60/h quota before falling back.
