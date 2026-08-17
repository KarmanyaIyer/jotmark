# Privacy policy

Last updated: 2026-08-17

Jotmark is a Chrome extension for keeping notes about the websites you visit. This page explains what it does with data. The short version: everything stays on your computer.

## What Jotmark stores

- The notes you write, together with the time you wrote them and the domain or page address they belong to.
- Your settings (theme, font size, and similar preferences).
- Which scope (domain or page) you last used on a site, if that setting is on.

All of this is kept in Chrome's local extension storage (`chrome.storage.local`) on the device where you use the extension. Nothing is sent anywhere.

## What Jotmark reads

When you open the popup, Jotmark reads the address of the tab you opened it on so it can show and save notes for that domain or page. That is the only information it reads about your browsing. It does not read page content, form fields, cookies, history, or anything else, and it does not run any code inside web pages.

## What Jotmark does not do

- It has no server and makes no network requests.
- It does not collect analytics, crash reports, or usage statistics.
- It does not use cookies, tracking, or advertising identifiers.
- It does not sell, share, or transfer your data to anyone.

## Export and deletion

You can export all notes as a JSON file from the settings page, and you can delete individual notes or everything at once. Removing the extension from Chrome deletes its local storage.

## Permissions

| Permission | Why it is needed |
| --- | --- |
| `activeTab` | To read the address of the current tab at the moment you click the icon, so notes can be filed under the right site. This grants access to that tab only, and only until it navigates somewhere else or closes. |
| `storage` | To keep notes and settings in local storage. |

## Changes

If this policy changes, the new version will be published at the same address with an updated date.

## Contact

Questions can be raised on the project's issue tracker on GitHub.
