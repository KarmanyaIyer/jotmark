# Changelog

All notable changes to Jotmark are listed here. The format follows Keep a Changelog and the project uses semantic versioning.

## Unreleased

## 0.1.0 (2026-08-17)

First release.

- Popup with domain and page scopes, timestamped notes, inline edit, copy, delete with confirmation and undo.
- Checklists: a line starting with `[ ]` renders as a checkbox that can be ticked in the popup and on the All notes page; Enter continues a list; notes show "n of m done".
- Composer drafts are kept in session storage until the note is added.
- Options page with all notes view, search, appearance settings (theme, marker color, font size, note font, density), behavior settings, page matching settings, export, import, reset, and delete all.
- Notes stored in chrome.storage.local. No content scripts, no host permissions, no background worker.
