# Contributing

Thanks for taking a look. Jotmark is small on purpose, so the bar for changes is: does it make note taking on websites better without adding permissions, network calls, or a build step?

## Setup

```bash
pnpm install
```

The only dependency is `puppeteer-core`, used by the scripts. It does not download a browser; the scripts look for Chrome for Testing in the puppeteer cache and fall back to an installed Chrome. Set `CHROME_PATH` to point at a specific binary.

Load `extension/` as an unpacked extension in `chrome://extensions` (Developer mode on) to try changes. Reload the extension after editing.

## Checks

```bash
pnpm test            # unit tests for shared modules (node:test)
pnpm run qa          # end to end run against the real extension in headless Chrome
pnpm run icons       # regenerate PNG icons from extension/icons/icon.svg
pnpm run screenshots # render store screenshots and promo tiles into store/
pnpm run package     # build dist/jotmark-<version>.zip (uses the zip and unzip commands)
```

`pnpm run qa` opens the popup as a tab with `chrome.tabs.query` stubbed to a chosen URL, so it can exercise the popup for any site without a real page. Add a check there for any behavior change that a user could notice.

## Ground rules

- Keep the permission list at `activeTab` and `storage`. No host permissions, no content scripts, no background worker unless a feature truly needs one, and then explain why in the pull request.
- No frameworks or bundlers. Plain HTML, CSS, and ES modules.
- User text goes through `textContent`, never `innerHTML`.
- Match the existing style: two space indent, single quotes, semicolons, sentence case in the UI.
- Update `CHANGELOG.md` under Unreleased.

## Reporting problems

Open an issue with Chrome version, what you did, what you expected, and what happened. Screenshots of the popup help.
