# Releasing

1. Bump `version` in `apps/extension/package.json`.
2. Run `pnpm zip`. The package is `apps/extension/.output/diffspoiler-<version>-chrome.zip`.
3. Upload that zip in the Chrome Web Store developer dashboard with visibility **Unlisted**. This needs a one-time $5 developer registration, done manually by the maintainer.
4. Attach the same zip to a GitHub Release (`gh release create v<version> apps/extension/.output/*.zip --notes "..."`).
