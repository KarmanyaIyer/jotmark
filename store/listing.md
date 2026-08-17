# Chrome Web Store listing

Everything that goes into the developer dashboard, ready to paste. Character limits are noted where the store enforces them.

## Package

Upload `dist/jotmark-<version>.zip`, built with `pnpm run package`. The manifest name and description become the listing title and summary.

## Store listing tab

**Title** (from manifest `name`, 45 characters shown in the store)

```
Jotmark - Notes for every website
```

**Summary** (from manifest `description`, 132 characters max)

```
Keep timestamped notes for any website, per domain or per page. Stored locally in your browser. Never touches the pages you visit.
```

**Detailed description**

```
Jotmark keeps notes attached to the websites you visit. Click the icon on any site, write a note, and it is there the next time you come back.

DOMAIN OR PAGE
Switch between notes for the whole domain (everything on github.com) and notes for the exact page (github.com/settings/keys). The counts on the switch tell you at a glance where you have written something. Jotmark can also remember which scope you used last on each site.

TIMESTAMPED, EDITABLE, SEARCHABLE
Every note is stamped with the time it was written. Edit, copy, or delete notes in place, with an undo if you change your mind. The All notes page shows everything you have written, grouped by site, with search across notes and site names.

CHECKLISTS
Start a line with [ ] and it becomes a checkbox you can tick right in the popup. Enter continues the list, and notes with several items show how many are done. Handy for "cancel the trial", "reply to the seller", "rotate this key".

STAYS OUT OF THE WAY
Jotmark does nothing until you open it. It never injects scripts or styles into pages, never reads page content, and never runs in the background. The only thing it looks at is the address of the tab you clicked it on.

LOCAL AND PRIVATE
Notes live in Chrome's local extension storage on your computer. There is no account, no server, and no analytics. Export everything as JSON any time and import it on another machine.

MADE TO FIT
Light, dark, or system theme. Five highlighter colors. Font size, note font, and density settings. Add notes with Enter or with Ctrl/Cmd Enter. Choose how page addresses are matched: ignore query strings, treat #fragments as separate pages, or group subdomains under one domain.

Permissions: activeTab (read the address of the current tab when you click the icon) and storage (save notes and settings locally). No host permissions, no content scripts.

Open source under the MIT license: https://github.com/KarmanyaIyer/jotmark
```

**Category**: Workflow & Planning

**Language**: English (United States)

**Store icon**: `store/icon-128.png` (128x128 PNG, transparent background)

**Screenshots** (1280x800 PNG, up to 5): `store/screenshots/01-popup.png` through `05-private.png`

**Small promo tile** (440x280 PNG, required): `store/promo-small-440x280.png`

**Marquee promo tile** (1400x560 PNG, optional): `store/promo-marquee-1400x560.png`

**Official URL**: leave empty (no verified site)

**Homepage URL**: https://github.com/KarmanyaIyer/jotmark

**Support URL**: https://github.com/KarmanyaIyer/jotmark/issues

**Mature content**: No

## Privacy practices tab

**Single purpose description**

```
Jotmark lets the user write, view, edit, and delete timestamped notes attached to the website they are currently on, either for the whole domain or for the specific page. All notes are stored locally in the browser.
```

**Permission justification: activeTab**

```
When the user clicks the Jotmark icon (or presses its keyboard shortcut), the popup needs the URL of the current tab so it can show and save notes filed under that tab's domain or page. activeTab grants exactly that, only for the tab the user invoked it on, and only until that tab navigates elsewhere or closes. Jotmark does not inject any script into the tab and does not read page content; it reads the tab URL and nothing else.
```

**Permission justification: storage**

```
Notes, timestamps, and user preferences (theme, font size, and similar) are saved in chrome.storage.local so they persist between browser sessions. Nothing is synced or sent to a server.
```

**Host permissions justification**: not applicable, the extension declares none.

**Remote code**: No, I am not using remote code. (All HTML, CSS, and JavaScript ship inside the package. There are no external scripts, no eval, and no network requests.)

**Data usage**

Check nothing in the "what user data do you plan to collect" list. Jotmark does not collect or transmit any of the listed categories (personally identifiable information, health, financial, authentication, personal communications, location, web history, user activity, website content). Notes stay on the user's device.

Then certify all three statements:

- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL**

```
https://github.com/KarmanyaIyer/jotmark/blob/main/PRIVACY.md
```

## Distribution tab

- Visibility: Public (or Unlisted for a soft launch)
- Regions: all
- Pricing: free

## Before submitting

- Bump `version` in `extension/manifest.json` and add a CHANGELOG entry.
- Run `pnpm test`, `pnpm run qa`, then `pnpm run package`.
- Load the built zip as an unpacked folder once and click through the popup and settings.
