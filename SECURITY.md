# Security

## Reporting a vulnerability

Please don't open a public issue. Report it privately through [GitHub's vulnerability reporting](https://github.com/matthieuh/diffspoiler/security/advisories/new), with the steps to reproduce and the impact you see.

Only the latest release gets fixes.

## What the extension handles

- **An optional GitHub token**, stored in the extension's local storage and sent only to `api.github.com`, as an `Authorization` header.
- **Your logged-in sessions.** On `github.com` and `gitlab.com` the content script reads PR and MR data with same-origin requests, so they carry your cookies. On GitLab it also sends the page's CSRF token to `gitlab.com/api/graphql`.

The extension talks to no other host. Anything that leaks the token, sends requests elsewhere, or lets page content inject markup or script through the widget is worth reporting.
