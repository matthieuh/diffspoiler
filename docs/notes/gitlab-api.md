# GitLab GraphQL stats: live check (2026-10-20)

Anonymous POST to `https://gitlab.com/api/graphql`, public project `gitlab-org/gitlab`.
Queries are the ones in `apps/extension/src/lib/sources/gitlab.ts`. Timings are `curl %{time_total}` from one machine, single run.

| MR | summary fileCount / additions / deletions | `diffStats` length / sum additions / sum deletions | head query | files query |
|---|---|---|---|---|
| !263303 (normal) | 34 / 12 / 1514 | 34 / 12 / 1514 (match) | 0.39 s | 0.49 s (3 KB) |
| !258451 ("Squash database migrations", 3000+ files) | **3000** / 9966 / 49876 | **3285** / 9966 / **75478** | 0.30 s | **3.49 s** (340 KB) |

## Findings

- `diffStatsSummary` is **capped at 3000 files**. On !258451 the REST API reports `changes_count: "3000+"`, the summary says `fileCount: 3000`, but `diffStats` returns 3285 unique paths.
- The summary deletions (49876) are lower than the sum over `diffStats` (75478): the summary counts only the first 3000 files. Additions happen to match.
- `diffStats` itself looks complete (3285 distinct paths, no duplicates); no truncation seen.
- Normal MRs: summary and `diffStats` agree exactly and both calls are well under 1 s.
- On the 3,285-file MR the files query took 3.5 s, over the 1 s budget.
- The `fileCount − files.length` rule for "not counted" breaks above 3000 files: it goes negative (3000 − 3285). The extension trusts `files.length` and the `diffStats` sums instead, and treats the summary only as the page's own (capped) counter, showing a footnote when they differ.
- Only one MR above 1,000 files was found in the 4,000 most recently updated merged MRs of gitlab-org/gitlab; no 1,000-2,999 file MR to check the range below the cap.
