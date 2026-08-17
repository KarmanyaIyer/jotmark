// End to end checks against the real extension in headless Chrome.
// Usage: node scripts/qa.mjs            (or pnpm run qa)
//        node scripts/qa.mjs --headed   to watch it run
//
// The popup is opened as a tab with chrome.tabs.query stubbed to report a
// chosen URL, which exercises everything except the browser action itself.

import { launchWithExtension, openPopupFor, openOptions, sleep } from './lib/browser.mjs';

const headed = process.argv.includes('--headed');
const results = [];
let currentGroup = '';

function group(name) {
  currentGroup = name;
  console.log(`\n${name}`);
}

async function check(name, fn) {
  try {
    await fn();
    results.push({ group: currentGroup, name, ok: true });
    console.log(`  ok   ${name}`);
  } catch (error) {
    results.push({ group: currentGroup, name, ok: false, error });
    console.log(`  FAIL ${name}\n       ${error.message.split('\n')[0]}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

function equal(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message || 'not equal'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const text = (page, selector) => page.$eval(selector, (el) => el.textContent.trim());
const count = (page, selector) => page.$$eval(selector, (els) => els.length);
const isMac = process.platform === 'darwin';
const mod = isMac ? 'Meta' : 'Control';

async function pressModEnter(page) {
  await page.keyboard.down(mod);
  await page.keyboard.press('Enter');
  await page.keyboard.up(mod);
}

// WCAG contrast ratio between two "rgb(r, g, b)" strings.
function contrast(a, b) {
  const lum = (css) => {
    const [r, g, b2] = css.match(/\d+/g).map(Number).map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b2;
  };
  const l1 = lum(a);
  const l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

async function clickReal(page, selector) {
  // A real mouse click through CDP, so :focus-visible heuristics behave as in
  // normal use (unlike element.click() from script).
  const el = await page.$(selector);
  assert(el, `missing element ${selector}`);
  await el.click();
}

const { browser, extensionId } = await launchWithExtension({ headless: !headed });
const pageErrors = [];

try {
  const site = 'https://github.com/settings/keys?tab=ssh';
  let popup = await openPopupFor(browser, extensionId, site);
  popup.on('pageerror', (e) => pageErrors.push(`popup: ${e.message}`));
  await popup.evaluate(() => chrome.storage.local.clear());
  await popup.reload({ waitUntil: 'load' });
  await popup.waitForSelector('html[data-ready]');

  group('Popup: first open');
  await check('shows the host in the header', async () => equal(await text(popup, '#site-host'), 'github.com'));
  await check('starts in domain scope by default', async () => {
    equal(await popup.$eval('#scope-domain', (el) => el.checked), true);
  });
  await check('shows an empty state naming the site', async () => {
    assert((await text(popup, '#empty')).includes('github.com'), 'empty state text');
  });
  await check('focuses the composer', async () => {
    equal(await popup.evaluate(() => document.activeElement.id), 'note-input');
  });
  await check('does not overflow horizontally', async () => {
    const overflow = await popup.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    equal(overflow, false, 'horizontal overflow');
  });

  group('Popup: adding notes');
  await check('adds a note with the button and clears the composer', async () => {
    await popup.type('#note-input', 'First domain note with a link https://example.com/docs.');
    await clickReal(popup, '#btn-add');
    await sleep(120);
    equal(await count(popup, '.note'), 1);
    equal(await popup.$eval('#note-input', (el) => el.value), '');
    equal(await text(popup, '#count-domain'), '1');
  });
  await check('turns URLs into links', async () => {
    equal(await popup.$eval('.note-text a', (a) => a.getAttribute('href')), 'https://example.com/docs');
    equal(await popup.$eval('.note-text a', (a) => a.getAttribute('rel')), 'noopener noreferrer');
  });
  await check('adds a note with the modifier + Enter shortcut', async () => {
    await popup.focus('#note-input');
    await popup.type('#note-input', 'Second note');
    await pressModEnter(popup);
    await sleep(120);
    equal(await count(popup, '.note'), 2);
    equal(await text(popup, '#count-domain'), '2');
  });
  await check('newest note is listed first', async () => {
    equal(await text(popup, '.note:first-child .note-text'), 'Second note');
  });
  await check('plain Enter inserts a newline instead of submitting', async () => {
    await popup.focus('#note-input');
    await popup.type('#note-input', 'line one');
    await popup.keyboard.press('Enter');
    await popup.type('#note-input', 'line two');
    equal(await count(popup, '.note'), 2);
    equal(await popup.$eval('#note-input', (el) => el.value), 'line one\nline two');
    await popup.$eval('#note-input', (el) => { el.value = ''; });
  });
  await check('ignores whitespace only notes', async () => {
    await popup.type('#note-input', '   ');
    await clickReal(popup, '#btn-add');
    await sleep(80);
    equal(await count(popup, '.note'), 2);
    await popup.$eval('#note-input', (el) => { el.value = ''; });
  });
  await check('the add button does not keep a focus ring after a mouse click', async () => {
    const ring = await popup.evaluate(() => document.getElementById('btn-add').matches(':focus-visible'));
    equal(ring, false, 'focus ring on button');
  });

  group('Popup: scopes');
  await check('switching to page scope shows the path and separate notes', async () => {
    await clickReal(popup, 'label:has(#scope-page)');
    await sleep(80);
    equal(await popup.$eval('#scope-page', (el) => el.checked), true);
    equal(await popup.$eval('#site-path', (el) => el.hidden), false);
    equal(await text(popup, '#site-path'), '/settings/keys?tab=ssh');
    equal(await count(popup, '.note'), 0);
    assert((await text(popup, '#empty')).includes('2 notes on the domain'), 'mentions domain notes');
  });
  await check('adds a page note that does not leak into domain scope', async () => {
    await popup.type('#note-input', 'Page only note');
    await clickReal(popup, '#btn-add');
    await sleep(120);
    equal(await text(popup, '#count-page'), '1');
    await clickReal(popup, 'label:has(#scope-domain)');
    await sleep(80);
    equal(await count(popup, '.note'), 2);
    equal(await popup.$eval('#site-path', (el) => el.hidden), true);
  });
  await check('remembers the last used scope for the site', async () => {
    await clickReal(popup, 'label:has(#scope-page)');
    await sleep(120);
    await popup.close();
    popup = await openPopupFor(browser, extensionId, site);
    popup.on('pageerror', (e) => pageErrors.push(`popup: ${e.message}`));
    equal(await popup.$eval('#scope-page', (el) => el.checked), true);
    equal(await count(popup, '.note'), 1);
  });
  await check('www, trailing slash and tracking params map to the same page', async () => {
    await popup.close();
    popup = await openPopupFor(browser, extensionId, 'https://www.github.com/settings/keys/?utm_source=news&tab=ssh#top');
    popup.on('pageerror', (e) => pageErrors.push(`popup: ${e.message}`));
    equal(await text(popup, '#site-host'), 'github.com');
    equal(await text(popup, '#count-page'), '1');
    equal(await text(popup, '#count-domain'), '2');
  });

  group('Popup: edit, delete, undo');
  await check('edits a note inline and marks it edited', async () => {
    await clickReal(popup, 'label:has(#scope-domain)');
    await sleep(80);
    await popup.hover('.note:first-child');
    await clickReal(popup, '.note:first-child [data-action="edit"]');
    await popup.waitForSelector('.note-editor textarea');
    await popup.evaluate(() => {
      const el = document.querySelector('.note-editor textarea');
      el.value = 'Second note, edited';
    });
    // updatedAt has to be more than a second after createdAt to show the badge
    await sleep(1100);
    await clickReal(popup, '.note-editor [data-action="save"]');
    await sleep(120);
    equal(await text(popup, '.note:first-child .note-text'), 'Second note, edited');
    equal(await count(popup, '.note:first-child .note-edited'), 1);
  });
  await check('escape cancels an edit without saving', async () => {
    await popup.hover('.note:first-child');
    await clickReal(popup, '.note:first-child [data-action="edit"]');
    await popup.waitForSelector('.note-editor textarea');
    await popup.type('.note-editor textarea', ' more');
    await popup.keyboard.press('Escape');
    await sleep(80);
    equal(await count(popup, '.note-editor'), 0);
    equal(await text(popup, '.note:first-child .note-text'), 'Second note, edited');
  });
  await check('delete asks for confirmation, then removes and offers undo', async () => {
    await popup.hover('.note:first-child');
    await clickReal(popup, '.note:first-child [data-action="delete"]');
    await popup.waitForSelector('[data-action="confirm-delete"]');
    equal(await count(popup, '.note'), 2, 'still two notes before confirming');
    await clickReal(popup, '[data-action="confirm-delete"]');
    await sleep(120);
    equal(await count(popup, '.note'), 1);
    equal(await text(popup, '#count-domain'), '1');
    assert(await popup.$('.toast.is-visible .toast-action'), 'undo action offered');
    await clickReal(popup, '.toast-action');
    await sleep(150);
    equal(await count(popup, '.note'), 2, 'undo restores the note');
    equal(await text(popup, '.note:first-child .note-text'), 'Second note, edited', 'restored note keeps its place');
  });
  await check('cancel keeps the note', async () => {
    await popup.hover('.note:first-child');
    await clickReal(popup, '.note:first-child [data-action="delete"]');
    await popup.waitForSelector('[data-action="cancel"]');
    await clickReal(popup, '[data-action="cancel"]');
    await sleep(80);
    equal(await count(popup, '.note'), 2);
  });

  group('Popup: settings take effect');
  await check('appearance settings are applied to the popup', async () => {
    await popup.evaluate(async () => {
      const { saveSettings } = await import(chrome.runtime.getURL('shared/settings.js'));
      await saveSettings({ theme: 'dark', fontSize: 'large', accent: 'pink', density: 'compact', noteFont: 'mono' });
    });
    await sleep(120);
    const attrs = await popup.evaluate(() => ({ ...document.documentElement.dataset }));
    equal(attrs.theme, 'dark');
    equal(attrs.fontSize, 'large');
    equal(attrs.accent, 'pink');
    equal(attrs.density, 'compact');
    equal(attrs.noteFont, 'mono');
    const bg = await popup.evaluate(() => getComputedStyle(document.body).backgroundColor);
    equal(bg, 'rgb(14, 14, 14)', 'dark background');
  });
  await check('enter to submit and oldest first work when chosen', async () => {
    await popup.evaluate(async () => {
      const { saveSettings } = await import(chrome.runtime.getURL('shared/settings.js'));
      await saveSettings({ submitKey: 'enter', sortOrder: 'oldest', confirmDelete: false });
    });
    await sleep(120);
    equal(await text(popup, '.note:first-child .note-text'), 'First domain note with a link https://example.com/docs.');
    await popup.focus('#note-input');
    await popup.type('#note-input', 'Third');
    await popup.keyboard.press('Enter');
    await sleep(120);
    equal(await count(popup, '.note'), 3);
    equal(await text(popup, '.note:last-child .note-text'), 'Third');
  });
  await check('delete without confirmation removes straight away with undo', async () => {
    await popup.hover('.note:last-child');
    await clickReal(popup, '.note:last-child [data-action="delete"]');
    await sleep(120);
    equal(await count(popup, '.note'), 2);
    assert(await popup.$('.toast.is-visible .toast-action'), 'undo offered');
  });
  await check('confirm row stays inside the popup at xlarge with absolute times', async () => {
    await popup.evaluate(async () => {
      const { saveSettings } = await import(chrome.runtime.getURL('shared/settings.js'));
      await saveSettings({ fontSize: 'xlarge', timeFormat: 'absolute', confirmDelete: true, submitKey: 'mod-enter', sortOrder: 'newest' });
    });
    await sleep(150);
    await popup.hover('.note:first-child');
    await clickReal(popup, '.note:first-child [data-action="delete"]');
    await popup.waitForSelector('[data-action="confirm-delete"]');
    const widths = await popup.evaluate(() => ({ scroll: document.getElementById('notes').scrollWidth, client: document.getElementById('notes').clientWidth }));
    assert(widths.scroll <= widths.client, `notes overflow horizontally: ${widths.scroll} > ${widths.client}`);
    await popup.keyboard.press('Escape');
    await sleep(80);
  });
  await check('escape on a delete prompt returns focus to that note', async () => {
    await popup.hover('.note:first-child');
    await clickReal(popup, '.note:first-child [data-action="delete"]');
    await popup.waitForSelector('[data-action="confirm-delete"]');
    await popup.keyboard.press('Escape');
    await sleep(80);
    const focused = await popup.evaluate(() => document.activeElement.dataset.action);
    equal(focused, 'edit');
  });
  await check('an edit draft survives an external storage change', async () => {
    await popup.hover('.note:first-child');
    await clickReal(popup, '.note:first-child [data-action="edit"]');
    await popup.waitForSelector('.note-editor textarea');
    await popup.type('.note-editor textarea', ' DRAFT');
    await popup.evaluate(async () => {
      const { createStore } = await import(chrome.runtime.getURL('shared/storage.js'));
      await createStore().addNote('page', 'https://github.com/settings/keys?tab=ssh', 'added elsewhere');
    });
    await sleep(200);
    const value = await popup.$eval('.note-editor textarea', (el) => el.value);
    assert(value.endsWith(' DRAFT'), `draft lost: ${value}`);
    await popup.keyboard.press('Escape');
    await sleep(80);
    await popup.evaluate(async () => {
      const { createStore } = await import(chrome.runtime.getURL('shared/storage.js'));
      const store = createStore();
      const list = await store.getNotes('page', 'https://github.com/settings/keys?tab=ssh');
      for (const n of list.filter((x) => x.text === 'added elsewhere')) await store.deleteNote('page', 'https://github.com/settings/keys?tab=ssh', n.id);
    });
    await sleep(100);
  });
  await check('undo toast stays readable in dark mode', async () => {
    await popup.evaluate(async () => {
      const { saveSettings } = await import(chrome.runtime.getURL('shared/settings.js'));
      await saveSettings({ theme: 'dark', confirmDelete: false });
    });
    await sleep(150);
    await popup.hover('.note:last-child');
    await clickReal(popup, '.note:last-child [data-action="delete"]');
    await popup.waitForSelector('.toast.is-visible .toast-action');
    const colors = await popup.evaluate(() => {
      const toast = document.getElementById('toast');
      return { bg: getComputedStyle(toast).backgroundColor, action: getComputedStyle(toast.querySelector('.toast-action')).color, text: getComputedStyle(toast).color };
    });
    assert(contrast(colors.action, colors.bg) >= 4.5, `undo contrast ${contrast(colors.action, colors.bg).toFixed(2)}`);
    assert(contrast(colors.text, colors.bg) >= 4.5, `toast text contrast ${contrast(colors.text, colors.bg).toFixed(2)}`);
    await clickReal(popup, '.toast-action');
    await sleep(150);
  });
  await popup.evaluate(async () => {
    const { resetSettings } = await import(chrome.runtime.getURL('shared/settings.js'));
    await resetSettings();
  });
  await popup.close();

  group('Popup: long lists');
  await check('a long list scrolls inside the popup instead of being clipped', async () => {
    const p = await openPopupFor(browser, extensionId, 'https://many.example.com/');
    p.on('pageerror', (e) => pageErrors.push(`popup: ${e.message}`));
    await p.evaluate(async () => {
      const { createStore } = await import(chrome.runtime.getURL('shared/storage.js'));
      const store = createStore();
      for (let i = 1; i <= 40; i += 1) await store.addNote('domain', 'many.example.com', `Note number ${i}`);
    });
    await p.reload({ waitUntil: 'load' });
    await p.waitForSelector('html[data-ready]');
    const metrics = await p.evaluate(() => {
      const notes = document.getElementById('notes');
      return { scroll: notes.scrollHeight, client: notes.clientHeight, page: document.documentElement.scrollHeight };
    });
    assert(metrics.scroll > metrics.client, 'notes container should scroll');
    assert(metrics.page <= 600, `popup taller than the 600px cap: ${metrics.page}`);
    const reachable = await p.evaluate(() => {
      const notes = document.getElementById('notes');
      notes.scrollTop = notes.scrollHeight;
      const last = notes.querySelector('.note:last-child').getBoundingClientRect();
      return last.bottom <= window.innerHeight + 1;
    });
    assert(reachable, 'last note cannot be scrolled into view');
    await p.evaluate(() => chrome.storage.local.remove('d:many.example.com'));
    await p.close();
  });
  await check('a bad timestamp in storage does not break the popup or the options page', async () => {
    await (await browser.newPage()).close();
    const p = await openPopupFor(browser, extensionId, 'https://bad.example.com/');
    await p.evaluate(() => chrome.storage.local.set({ 'd:bad.example.com': [{ id: 'bad', text: 'x', createdAt: 1e20, updatedAt: 1e20 }] }));
    await p.reload({ waitUntil: 'load' });
    await p.waitForSelector('html[data-ready]');
    equal(await p.$eval('#site-view', (el) => el.hidden), false);
    await p.close();
    const o = await openOptions(browser, extensionId, '#notes');
    equal(await o.$eval('#view-notes', (el) => el.hidden), false);
    await o.evaluate(() => chrome.storage.local.remove('d:bad.example.com'));
    await o.close();
  });

  group('Popup: unsupported pages');
  for (const [url, label] of [['chrome://extensions', 'chrome://'], ['about:blank', 'about:blank'], ['file:///tmp/a.html', 'file://'], ['', 'empty url']]) {
    await check(`shows the unsupported view for ${label}`, async () => {
      const p = await openPopupFor(browser, extensionId, url);
      p.on('pageerror', (e) => pageErrors.push(`popup: ${e.message}`));
      equal(await p.$eval('#unsupported-view', (el) => el.hidden), false);
      equal(await p.$eval('#site-view', (el) => el.hidden), true);
      equal(await p.$eval('.site-actions', (el) => el.hidden), true, 'header icons hidden');
      await p.close();
    });
  }

  group('Options: all notes');
  let options = await openOptions(browser, extensionId, '#notes');
  options.on('pageerror', (e) => pageErrors.push(`options: ${e.message}`));
  await check('lists notes grouped by site with scope tags', async () => {
    equal(await count(options, '.group'), 1);
    equal(await text(options, '.group-host'), 'github.com');
    equal(await count(options, '#groups .note'), 3);
    equal(await count(options, '#groups .scope-tag'), 1, 'only page notes carry a tag');
    assert((await text(options, '#notes-summary')).startsWith('3 notes across 1 site'), 'summary');
  });
  await check('search filters and highlights matches', async () => {
    await options.type('#search', 'page only');
    await sleep(200);
    equal(await count(options, '#groups .note'), 1);
    equal(await count(options, '#groups mark'), 1);
    assert((await text(options, '#notes-summary')).includes('1 match'), 'match summary');
    await options.$eval('#search', (el) => { el.value = ''; el.dispatchEvent(new Event('input')); });
    await sleep(200);
    equal(await count(options, '#groups .note'), 3);
  });
  await check('search with no result explains itself', async () => {
    await options.type('#search', 'zzzz');
    await sleep(200);
    equal(await count(options, '#groups .note'), 0);
    equal(await options.$eval('#notes-empty', (el) => el.hidden), false);
    await options.$eval('#search', (el) => { el.value = ''; el.dispatchEvent(new Event('input')); });
    await sleep(200);
  });
  await check('edits a note from the all notes page', async () => {
    await options.hover('#groups .note');
    await clickReal(options, '#groups .note [data-action="edit"]');
    await options.waitForSelector('.note-editor textarea');
    await options.evaluate(() => { document.querySelector('.note-editor textarea').value = 'Edited from options'; });
    await clickReal(options, '.note-editor [data-action="save"]');
    await sleep(150);
    const texts = await options.$$eval('#groups .note-text', (els) => els.map((e) => e.textContent));
    assert(texts.includes('Edited from options'), 'edited text present');
  });
  await check('an edit draft survives typing in the search box', async () => {
    await options.hover('#groups .note');
    await clickReal(options, '#groups .note [data-action="edit"]');
    await options.waitForSelector('.note-editor textarea');
    await options.type('.note-editor textarea', ' DRAFT');
    await options.type('#search', 'e');
    await sleep(200);
    const value = await options.$eval('.note-editor textarea', (el) => el.value);
    assert(value.endsWith(' DRAFT'), `draft lost: ${value}`);
    await options.keyboard.press('Escape');
    await options.$eval('#search', (el) => { el.value = ''; el.dispatchEvent(new Event('input')); });
    await sleep(200);
  });
  await check('deletes a note from the all notes page', async () => {
    await options.hover('#groups .note');
    await clickReal(options, '#groups .note [data-action="delete"]');
    await options.waitForSelector('[data-action="confirm-delete"]');
    await clickReal(options, '[data-action="confirm-delete"]');
    await sleep(150);
    equal(await count(options, '#groups .note'), 2);
  });

  group('Options: settings controls');
  await check('every settings control has an accessible label', async () => {
    const missing = await options.$$eval('[data-setting]', (els) => els.filter((el) => {
      if (el.closest('label')) return false;
      if (el.id && document.querySelector(`label[for="${el.id}"]`)) return false;
      return !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby');
    }).map((el) => el.dataset.setting));
    equal(missing.length, 0, `unlabelled: ${missing.join(', ')}`);
  });
  await check('clicking a row title toggles its switch', async () => {
    await options.goto(`chrome-extension://${extensionId}/options/options.html#settings`, { waitUntil: 'load' });
    await options.waitForSelector('html[data-ready]');
    const before = await options.$eval('#s-confirmDelete', (el) => el.checked);
    await clickReal(options, 'label[for="s-confirmDelete"]');
    await sleep(120);
    const after = await options.$eval('#s-confirmDelete', (el) => el.checked);
    equal(after, !before, 'toggled');
    const stored = await options.evaluate(async () => (await chrome.storage.local.get('settings')).settings.confirmDelete);
    equal(stored, after, 'persisted');
    await clickReal(options, 'label[for="s-confirmDelete"]');
    await sleep(80);
  });
  await check('clicking a description does not toggle anything', async () => {
    const before = await options.$eval('#s-ignoreQuery', (el) => el.checked);
    await clickReal(options, 'label[for="s-ignoreQuery"] + .row-desc');
    await sleep(80);
    equal(await options.$eval('#s-ignoreQuery', (el) => el.checked), before);
  });
  await check('theme segmented control applies immediately', async () => {
    await clickReal(options, 'label:has(input[name="theme"][value="dark"])');
    await sleep(120);
    equal(await options.evaluate(() => document.documentElement.dataset.theme), 'dark');
    await clickReal(options, 'label:has(input[name="theme"][value="system"])');
    await sleep(80);
  });
  await check('marker color swatches apply immediately', async () => {
    await clickReal(options, 'label.swatch[data-accent="green"]');
    await sleep(120);
    equal(await options.evaluate(() => document.documentElement.dataset.accent), 'green');
    await clickReal(options, 'label.swatch[data-accent="yellow"]');
    await sleep(80);
  });
  await check('reset settings restores defaults', async () => {
    await clickReal(options, 'label:has(input[name="fontSize"][value="xlarge"])');
    await sleep(80);
    await clickReal(options, '#btn-reset-settings');
    await sleep(150);
    equal(await options.evaluate(() => document.documentElement.dataset.fontSize), 'medium');
  });

  group('Options: data');
  await check('export contains every note with scope and key', async () => {
    const data = await options.evaluate(async () => {
      const { createStore } = await import(chrome.runtime.getURL('shared/storage.js'));
      return createStore().exportData();
    });
    equal(data.app, 'jotmark');
    equal(data.notes.length, 2);
    assert(data.notes.every((n) => n.scope && n.key && n.text && n.createdAt), 'note shape');
  });
  await check('import merge skips duplicates and adds new notes', async () => {
    const result = await options.evaluate(async () => {
      const { createStore } = await import(chrome.runtime.getURL('shared/storage.js'));
      const store = createStore();
      const dump = await store.exportData();
      dump.notes.push({ scope: 'domain', key: 'example.org', id: 'imp1', text: 'Imported', createdAt: 1700000000000, updatedAt: 1700000000000 });
      return store.importData(dump, 'merge');
    });
    equal(result.added, 1);
    equal(result.skipped, 2);
    await sleep(200);
    await options.goto(`chrome-extension://${extensionId}/options/options.html#notes`, { waitUntil: 'load' });
    await options.waitForSelector('html[data-ready]');
    equal(await count(options, '.group'), 2);
  });
  await check('replace import refuses a file with nothing usable and keeps notes', async () => {
    const outcome = await options.evaluate(async () => {
      const { createStore } = await import(chrome.runtime.getURL('shared/storage.js'));
      const store = createStore();
      const before = await store.countAll();
      let error = null;
      try {
        await store.importData({ notes: ['a', 'b', { foo: 1 }] }, 'replace');
      } catch (e) {
        error = e.message;
      }
      return { before, after: await store.countAll(), error };
    });
    assert(outcome.error, 'import should throw');
    equal(outcome.after, outcome.before, 'notes must be untouched');
  });
  await check('an open options page switches view when the popup asks through session storage', async () => {
    await options.goto(`chrome-extension://${extensionId}/options/options.html#notes`, { waitUntil: 'load' });
    await options.waitForSelector('html[data-ready]');
    await options.evaluate(() => chrome.storage.session.set({ openView: 'settings' }));
    await sleep(150);
    equal(await options.$eval('#view-settings', (el) => el.hidden), false);
    equal(await options.evaluate(() => location.hash), '#settings');
    const left = await options.evaluate(() => chrome.storage.session.get('openView'));
    equal(left.openView, undefined, 'request consumed');
  });
  await check('a freshly opened options page starts on the requested view', async () => {
    await options.close();
    const p = await openPopupFor(browser, extensionId, 'https://github.com/');
    await p.evaluate(() => chrome.storage.session.set({ openView: 'about' }));
    await p.close();
    options = await browser.newPage();
    options.on('pageerror', (e) => pageErrors.push(`options: ${e.message}`));
    await options.goto(`chrome-extension://${extensionId}/options/options.html`, { waitUntil: 'load' });
    await options.waitForSelector('html[data-ready]');
    await sleep(100);
    equal(await options.$eval('#view-about', (el) => el.hidden), false);
    equal(await options.evaluate(() => location.hash), '#about');
  });
  await check('delete all asks first, then clears everything', async () => {
    await options.goto(`chrome-extension://${extensionId}/options/options.html#settings`, { waitUntil: 'load' });
    await options.waitForSelector('html[data-ready]');
    await clickReal(options, '#btn-delete-all');
    await sleep(80);
    equal(await count(options, '#delete-all-controls button'), 2, 'confirm and cancel shown');
    await clickReal(options, '#delete-all-controls .btn-danger');
    await sleep(200);
    const remaining = await options.evaluate(async () => {
      const { createStore } = await import(chrome.runtime.getURL('shared/storage.js'));
      return createStore().countAll();
    });
    equal(remaining, 0);
    const settings = await options.evaluate(async () => (await chrome.storage.local.get('settings')).settings);
    assert(settings === undefined || typeof settings === 'object', 'settings untouched');
  });
  await options.close();

  group('Extension');
  await check('no page errors were logged', async () => {
    equal(pageErrors.length, 0, pageErrors.join(' | '));
  });
  await check('manifest requests only activeTab and storage', async () => {
    const p = await browser.newPage();
    await p.goto(`chrome-extension://${extensionId}/manifest.json`);
    const manifest = JSON.parse(await p.evaluate(() => document.body.textContent));
    equal(JSON.stringify(manifest.permissions), JSON.stringify(['activeTab', 'storage']));
    assert(!manifest.host_permissions, 'no host permissions');
    assert(!manifest.content_scripts, 'no content scripts');
    assert(!manifest.background, 'no background worker');
    await p.close();
  });
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
if (failed.length) {
  for (const f of failed) console.log(`- [${f.group}] ${f.name}: ${f.error.message}`);
  process.exit(1);
}
