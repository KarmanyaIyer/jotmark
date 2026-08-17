# Jotmark

Notes for every website. A Chrome extension that keeps timestamped notes attached to the site you are on, either for the whole domain or for the exact page. Everything is stored locally in your browser.

## What it does

- Click the toolbar icon on any site and write a note. It is saved with a timestamp and shown again the next time you open Jotmark on that site.
- Switch between domain notes (everything on `github.com`) and page notes (only `github.com/settings/keys`).
- Edit, copy, and delete notes in place.
- Search across every note you have written, grouped by site.
- Export and import your notes as JSON.

## What it does not do

- It never injects scripts or styles into pages, and it never reads page content. The only thing it looks at is the URL of the tab you clicked it on.
- It has no server. Notes live in `chrome.storage.local` on your machine and nowhere else.
- It does not run in the background. Nothing happens until you open the popup.

## Permissions

| Permission | Why |
| --- | --- |
| `activeTab` | Read the URL of the current tab when you click the icon, so notes can be filed under the right domain or page. |
| `storage` | Save notes and settings locally. |

There are no host permissions and no content scripts.

## Install from source

1. Clone this repository.
2. Open `chrome://extensions`, turn on Developer mode.
3. Click "Load unpacked" and pick the `extension` folder.

## Development

The extension is plain HTML, CSS, and JavaScript with no build step. `extension/` is the unpacked extension. `tests/` holds unit tests for the pure modules and runs with `pnpm test`.

## License

MIT
