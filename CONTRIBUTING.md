# Contributing

Bug reports and pull requests are welcome.

## Reporting a bug

Open an issue with:

- the PR or MR URL, if it's public,
- your browser, whether you were logged in, and whether a GitHub token was saved,
- what the bar showed, and what you expected (for example the page's own +/− counter).

Security issues go through [SECURITY.md](SECURITY.md), not public issues.

## Setup

Node 22 (`.nvmrc`) and pnpm 10.33 (pinned in `package.json`; `corepack enable` picks it up).

```bash
pnpm install
pnpm dev         # extension in dev mode with reload
pnpm test
pnpm typecheck
```

To try a production build in your own browser, run `pnpm build`, open `chrome://extensions`, enable Developer mode, click "Load unpacked" and select `apps/extension/.output/chrome-mv3`.

## Where things live

- `packages/core`: classification rules and breakdown math. Pure TypeScript, no browser APIs.
- `apps/extension/src/lib/sources`: one data source per platform (GitHub REST API, GitHub session fallback, GitLab GraphQL).
- `apps/extension/src/lib/ui`: the bar, the popover and where they attach on the page.
- `docs/notes`: how the GitHub and GitLab endpoints were chosen, and the real-page QA results.

## Ground rules

- Never show a wrong number. When a response doesn't have the expected shape, throw: the bar hides instead of guessing.
- Use the per-file line counts GitHub and GitLab already compute. Don't parse diff text.
- Keep the content script small: no UI framework, and no new runtime dependency without a good reason.
- When you change a classification rule, update `packages/core/test/classify.test.ts`, the bucket description in `packages/core/src/rules.ts` (it's the tooltip text) and the table in the README, and bump `RULES_VERSION` so cached results are recomputed.
- Test fixtures come from public pages, captured while logged out. Replace anything tied to a session (the GitLab fixtures use `fixture-csrf-token`), and never commit a page from a private repo.

## Pull requests

- Run `pnpm test` and `pnpm typecheck` before pushing. CI runs both, plus `pnpm build`.
- If the change affects what the bar shows, say which PR or MR page you checked it on.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/), scoped by package: `feat(core): …`, `fix(extension): …`, `docs: …`.
