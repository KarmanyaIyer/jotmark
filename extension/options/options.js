import { createStore, ImportError } from '../shared/storage.js';
import { loadSettings, saveSettings, resetSettings, applyAppearance, onSettingsChange, DEFAULT_SETTINGS } from '../shared/settings.js';
import { formatBytes, formatRelative, formatAbsolute, pluralize } from '../shared/format.js';
import { labelForKey } from '../shared/url.js';
import { h, clear } from '../shared/dom.js';
import {
  noteTextNodes, timeElement, editedBadge, sortNotes, actionButtons, confirmButtons,
  submitKeyMatcher, editorElement, createToast,
} from '../shared/note-view.js';

const store = createStore();
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const VIEWS = ['notes', 'settings', 'about'];
const EDITOR_MAX_PX = 320;

const els = {
  version: document.getElementById('version'),
  aboutVersion: document.getElementById('about-version'),
  nav: document.querySelector('.sidenav'),
  search: document.getElementById('search'),
  groups: document.getElementById('groups'),
  notesEmpty: document.getElementById('notes-empty'),
  notesSummary: document.getElementById('notes-summary'),
  storageSummary: document.getElementById('storage-summary'),
  importFile: document.getElementById('import-file'),
  importMode: document.getElementById('import-mode'),
  importControls: document.getElementById('import-controls'),
  deleteAllControls: document.getElementById('delete-all-controls'),
  toast: document.getElementById('toast'),
};

const toast = createToast(els.toast);

const state = {
  settings: { ...DEFAULT_SETTINGS },
  isSubmitKey: () => false,
  groups: [],
  query: '',
  editing: null,      // { scope, key, id }
  editingDraft: '',
  confirming: null,   // { scope, key, id }
  busy: false,
  view: 'notes',
};

let lastDeleted = null;

init().catch((error) => {
  console.error('Jotmark settings failed to start', error);
  document.documentElement.dataset.ready = 'true';
});

async function init() {
  const manifest = chrome.runtime.getManifest();
  els.version.textContent = `v${manifest.version}`;
  els.aboutVersion.textContent = manifest.version;

  state.settings = await loadSettings();
  state.isSubmitKey = submitKeyMatcher(state.settings);
  applyAppearance(state.settings);
  bindSettingsControls();
  fillSettingsControls();
  updatePreview();
  wireNotesView();
  wireDataActions();

  // Route and reveal the page before loading notes, so a problem with one
  // stored note can never leave the whole page blank.
  window.addEventListener('hashchange', route);
  await applyRequestedView();
  route();
  document.documentElement.dataset.ready = 'true';
  if (state.view === 'notes') els.search.focus({ preventScroll: true });

  await refreshNotes();
  await refreshStorageSummary();

  onSettingsChange((next) => {
    state.settings = next;
    state.isSubmitKey = submitKeyMatcher(next);
    applyAppearance(next);
    fillSettingsControls();
    updatePreview();
    renderGroups();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes.openView && changes.openView.newValue) {
      applyRequestedView();
      return;
    }
    if (area !== 'local') return;
    const touchedNotes = Object.keys(changes).some((k) => k.startsWith('d:') || k.startsWith('p:'));
    if (touchedNotes) {
      refreshNotes();
      refreshStorageSummary();
    }
  });
}

// Routing

// The popup asks for a view through session storage (runtime.openOptionsPage
// cannot pass a hash). Consume the request and jump there.
async function applyRequestedView() {
  if (!chrome.storage.session) return;
  try {
    const { openView } = await chrome.storage.session.get('openView');
    if (!openView) return;
    await chrome.storage.session.remove('openView');
    if (VIEWS.includes(openView)) {
      // replaceState rather than assigning location.hash: a hash assignment made
      // while the page is still loading can be discarded by the initial navigation.
      history.replaceState(null, '', `#${openView}`);
      route();
    }
  } catch (error) {
    console.warn('Could not read the requested view', error);
  }
}

function route() {
  const hash = location.hash.replace('#', '');
  const view = VIEWS.includes(hash) ? hash : (hash ? 'settings' : 'notes');
  state.view = view;
  for (const name of VIEWS) {
    document.getElementById(`view-${name}`).hidden = name !== view;
  }
  for (const link of els.nav.querySelectorAll('a')) {
    link.classList.toggle('is-active', link.dataset.view === view);
    if (link.dataset.view === view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  document.title = view === 'notes' ? 'Jotmark notes' : view === 'settings' ? 'Jotmark settings' : 'About Jotmark';
  if (view === 'settings' && hash !== 'settings') {
    const target = document.getElementById(hash);
    if (target) target.scrollIntoView({ block: 'start' });
  }
  if (view === 'notes' && document.documentElement.dataset.ready) els.search.focus({ preventScroll: true });
}

// Settings controls

function settingControls() {
  return [...document.querySelectorAll('[data-setting]')];
}

function bindSettingsControls() {
  for (const control of settingControls()) {
    control.addEventListener('change', async () => {
      const key = control.dataset.setting;
      let value;
      if (control.type === 'checkbox') value = control.checked;
      else if (control.type === 'radio') {
        if (!control.checked) return;
        value = control.value;
      } else value = control.value;
      state.settings = await saveSettings({ [key]: value }, undefined, state.settings);
      state.isSubmitKey = submitKeyMatcher(state.settings);
      applyAppearance(state.settings);
      updatePreview();
      renderGroups();
    });
  }
  // Show the right modifier name for this platform.
  const modOption = document.querySelector('#s-submitKey option[value="mod-enter"]');
  if (modOption) modOption.textContent = isMac ? modOption.dataset.mac : modOption.dataset.other;
}

function fillSettingsControls() {
  for (const control of settingControls()) {
    const value = state.settings[control.dataset.setting];
    if (control.type === 'checkbox') control.checked = Boolean(value);
    else if (control.type === 'radio') control.checked = control.value === value;
    else control.value = value;
  }
}

function updatePreview() {
  const now = Date.now();
  const t1 = document.getElementById('preview-time');
  const t2 = document.getElementById('preview-time-2');
  const a = now - 2 * 60 * 60 * 1000;
  const b = now - 30 * 60 * 60 * 1000;
  const { timeFormat, clock } = state.settings;
  t1.textContent = timeFormat === 'absolute' ? formatAbsolute(a, clock) : formatRelative(a, now, clock);
  t2.textContent = timeFormat === 'absolute' ? formatAbsolute(b, clock) : formatRelative(b, now, clock);
}

// All notes view

async function refreshNotes() {
  try {
    const groups = await store.getAllGroups();
    state.groups = groupBySite(groups);
  } catch (error) {
    console.error('Could not read notes', error);
    state.groups = [];
  }
  renderGroups();
}

// Turns storage groups (one per key) into display groups (one per host).
function groupBySite(storageGroups) {
  const sites = new Map();
  for (const group of storageGroups) {
    const host = group.scope === 'domain' ? group.key : hostOf(group.key);
    if (!sites.has(host)) sites.set(host, { host, entries: [], latest: 0, count: 0 });
    const site = sites.get(host);
    for (const note of group.notes) {
      site.entries.push({ scope: group.scope, key: group.key, note });
      site.count += 1;
      if (note.createdAt > site.latest) site.latest = note.createdAt;
    }
  }
  const list = [...sites.values()];
  list.sort((a, b) => b.latest - a.latest);
  return list;
}

function hostOf(pageKey) {
  try {
    return new URL(pageKey).hostname;
  } catch {
    return pageKey;
  }
}

function matches(entry, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  return entry.note.text.toLowerCase().includes(q) || labelForKey(entry.scope, entry.key).toLowerCase().includes(q);
}

function renderGroups() {
  clear(els.groups);
  const query = state.query.trim();
  const now = Date.now();
  let shownNotes = 0;
  let shownSites = 0;
  const totalNotes = state.groups.reduce((sum, g) => sum + g.count, 0);

  for (const site of state.groups) {
    const entries = site.entries.filter((e) => matches(e, query));
    if (entries.length === 0) continue;
    shownSites += 1;
    shownNotes += entries.length;
    els.groups.append(renderGroup(site, entries, query, now));
  }

  if (totalNotes === 0) {
    els.notesEmpty.hidden = false;
    clear(els.notesEmpty);
    els.notesEmpty.append('No notes yet. Open Jotmark on any site and write one.');
    els.notesSummary.textContent = '';
  } else if (shownNotes === 0) {
    els.notesEmpty.hidden = false;
    clear(els.notesEmpty);
    els.notesEmpty.append('Nothing matches ', h('strong', {}, query), '.');
    els.notesSummary.textContent = `${pluralize(totalNotes, 'note')} across ${pluralize(state.groups.length, 'site')}`;
  } else {
    els.notesEmpty.hidden = true;
    els.notesSummary.textContent = query
      ? `${pluralize(shownNotes, 'match', 'matches')} on ${pluralize(shownSites, 'site')}`
      : `${pluralize(totalNotes, 'note')} across ${pluralize(state.groups.length, 'site')}`;
  }
}

function renderGroup(site, entries, query, now) {
  const head = h('div', { class: 'group-head' },
    h('span', { class: 'group-host', title: site.host }, ...noteTextNodes(site.host, { linkify: false }, query)),
    h('span', { class: 'group-count' }, pluralize(entries.length, 'note')),
    h('a', { class: 'link-btn group-open', href: `https://${site.host}/`, target: '_blank', rel: 'noopener noreferrer' }, 'Open site'),
  );
  const list = h('ul', { class: 'note-list' });
  const sorted = sortNotes(entries.map((e) => ({ ...e.note, _entry: e })), state.settings.sortOrder);
  for (const note of sorted) list.append(renderEntry(note._entry, query, now));
  return h('section', { class: 'group', 'aria-label': site.host }, head, h('div', { class: 'group-body' }, list));
}

function renderEntry(entry, query, now) {
  const { scope, key, note } = entry;
  const li = h('li', { class: 'note', dataset: { scope, key, id: note.id } });

  // Domain notes are the common case and need no label; page notes show
  // which page they belong to.
  if (scope === 'page') {
    li.append(h('div', { class: 'note-where' },
      h('span', { class: 'scope-tag' }, 'page'),
      h('a', { class: 'path', href: key, target: '_blank', rel: 'noopener noreferrer', title: key }, ...noteTextNodes(labelForKey(scope, key), { linkify: false }, query)),
    ));
  }

  if (isSame(state.editing, entry)) {
    li.classList.add('is-busy');
    li.append(editorElement({
      value: state.editingDraft,
      onInput: (value) => { state.editingDraft = value; },
      onSave: (value) => saveEdit(entry, value),
      onCancel: () => cancelBusy(entry),
      isSubmitKey: state.isSubmitKey,
      maxPx: EDITOR_MAX_PX,
    }));
    return li;
  }

  const text = h('div', { class: 'note-text' }, ...noteTextNodes(note.text, state.settings, query));
  const meta = h('div', { class: 'note-meta' }, timeElement(note, state.settings, now), editedBadge(note, state.settings));
  if (isSame(state.confirming, entry)) {
    li.classList.add('is-busy');
    meta.append(confirmButtons());
  } else {
    meta.append(actionButtons());
  }
  li.append(text, meta);
  return li;
}

function isSame(a, entry) {
  return Boolean(a) && a.scope === entry.scope && a.key === entry.key && a.id === entry.note.id;
}

function refOf(entry) {
  return { scope: entry.scope, key: entry.key, id: entry.note.id };
}

function findEntry(li) {
  const { scope, key, id } = li.dataset;
  for (const site of state.groups) {
    const found = site.entries.find((e) => e.scope === scope && e.key === key && e.note.id === id);
    if (found) return found;
  }
  return null;
}

function focusEntryAction(entry) {
  const button = entry && els.groups.querySelector(`[data-id="${CSS.escape(entry.note.id)}"] [data-action="edit"]`);
  if (button) button.focus();
}

function wireNotesView() {
  let searchTimer = null;
  els.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = els.search.value;
      renderGroups();
    }, 80);
  });
  els.search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && els.search.value) {
      els.search.value = '';
      state.query = '';
      renderGroups();
    }
  });

  els.groups.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const li = button.closest('.note');
    const entry = li && findEntry(li);
    if (!entry) return;
    switch (button.dataset.action) {
      case 'copy':
        try {
          await navigator.clipboard.writeText(entry.note.text);
          toast.show('Copied');
        } catch {
          toast.show('Could not copy');
        }
        break;
      case 'edit':
        state.confirming = null;
        state.editing = refOf(entry);
        state.editingDraft = entry.note.text;
        renderGroups();
        break;
      case 'delete':
        if (state.settings.confirmDelete) {
          state.editing = null;
          state.editingDraft = '';
          state.confirming = refOf(entry);
          renderGroups();
          if (event.detail === 0) {
            const btn = els.groups.querySelector(`[data-id="${CSS.escape(entry.note.id)}"] [data-action="confirm-delete"]`);
            if (btn) btn.focus();
          }
        } else {
          await deleteEntry(entry);
        }
        break;
      case 'confirm-delete':
        await deleteEntry(entry);
        break;
      case 'save':
        await saveEdit(entry, li.querySelector('textarea').value);
        break;
      case 'cancel':
        cancelBusy(entry);
        break;
      default:
        break;
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && (state.editing || state.confirming)) {
      const ref = state.editing || state.confirming;
      cancelBusy(findRef(ref));
    }
  });
}

function findRef(ref) {
  for (const site of state.groups) {
    const found = site.entries.find((e) => e.scope === ref.scope && e.key === ref.key && e.note.id === ref.id);
    if (found) return found;
  }
  return null;
}

function cancelBusy(entry) {
  state.editing = null;
  state.editingDraft = '';
  state.confirming = null;
  renderGroups();
  focusEntryAction(entry);
}

async function saveEdit(entry, text) {
  if (state.busy) return;
  if (!text.trim()) {
    toast.show('A note cannot be empty');
    return;
  }
  state.busy = true;
  try {
    if (text !== entry.note.text) {
      await store.updateNote(entry.scope, entry.key, entry.note.id, text);
    }
    state.editing = null;
    state.editingDraft = '';
    await refreshNotes();
    focusEntryAction(entry);
  } catch (error) {
    console.error(error);
    toast.show('Could not save the change');
  } finally {
    state.busy = false;
  }
}

async function deleteEntry(entry) {
  if (state.busy) return;
  state.busy = true;
  try {
    await store.deleteNote(entry.scope, entry.key, entry.note.id);
    state.confirming = null;
    lastDeleted = entry;
    await refreshNotes();
    await refreshStorageSummary();
    toast.show('Note deleted', { label: 'Undo', onClick: undoDelete });
  } catch (error) {
    console.error(error);
    toast.show('Could not delete the note');
  } finally {
    state.busy = false;
  }
}

async function undoDelete() {
  if (!lastDeleted) return;
  const { scope, key, note } = lastDeleted;
  lastDeleted = null;
  toast.hide();
  try {
    await store.restoreNote(scope, key, note);
    await refreshNotes();
    await refreshStorageSummary();
  } catch (error) {
    console.error(error);
    toast.show('Could not restore the note');
  }
}

// Data section

async function refreshStorageSummary() {
  try {
    const [bytes, groups] = await Promise.all([store.getBytesInUse(), store.getAllGroups()]);
    const notes = groups.reduce((sum, g) => sum + g.notes.length, 0);
    const sites = groupBySite(groups).length;
    els.storageSummary.textContent = `${pluralize(notes, 'note')} on ${pluralize(sites, 'site')}, using ${formatBytes(bytes)} of local storage.`;
  } catch (error) {
    console.warn(error);
    els.storageSummary.textContent = 'Storage details are not available.';
  }
}

function wireDataActions() {
  document.getElementById('btn-export').addEventListener('click', async () => {
    const data = await store.exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 10);
    const a = h('a', { href: url, download: `jotmark-notes-${stamp}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast.show(`Exported ${pluralize(data.notes.length, 'note')}`);
  });

  document.getElementById('btn-import').addEventListener('click', () => els.importFile.click());
  els.importFile.addEventListener('change', async () => {
    const file = els.importFile.files && els.importFile.files[0];
    els.importFile.value = '';
    if (!file) return;
    const mode = els.importMode.value;
    if (mode === 'replace') {
      showReplaceConfirm(file);
      return;
    }
    await runImport(file, 'merge');
  });

  document.getElementById('btn-reset-settings').addEventListener('click', async () => {
    state.settings = await resetSettings();
    state.isSubmitKey = submitKeyMatcher(state.settings);
    applyAppearance(state.settings);
    fillSettingsControls();
    updatePreview();
    renderGroups();
    toast.show('Settings reset');
  });

  document.getElementById('btn-delete-all').addEventListener('click', showDeleteAllConfirm);
}

// Replacing everything deserves an explicit inline confirmation, in the same
// style as "delete all notes", rather than a browser dialog.
function showReplaceConfirm(file) {
  const controls = els.importControls;
  const original = [...controls.children];
  clear(controls);
  const label = h('span', { class: 'confirm-text' }, `Replace every note with ${file.name}?`);
  const yes = h('button', { type: 'button', class: 'btn btn-danger' }, 'Replace');
  const no = h('button', { type: 'button', class: 'btn' }, 'Cancel');
  const restore = () => {
    clear(controls);
    controls.append(...original);
  };
  yes.addEventListener('click', async () => {
    restore();
    await runImport(file, 'replace');
  });
  no.addEventListener('click', restore);
  controls.append(label, no, yes);
  no.focus();
}

async function runImport(file, mode) {
  let payload;
  try {
    payload = JSON.parse(await file.text());
  } catch {
    toast.show('That file is not a Jotmark export');
    return;
  }
  try {
    const result = await store.importData(payload, mode);
    await refreshNotes();
    await refreshStorageSummary();
    const parts = [`Imported ${pluralize(result.added, 'note')}`];
    if (result.updated) parts.push(`updated ${result.updated}`);
    if (result.skipped) parts.push(`skipped ${result.skipped}`);
    toast.show(parts.join(', '));
  } catch (error) {
    console.warn(error);
    if (error instanceof ImportError && error.code === 'write') toast.show('Could not write to storage. Nothing was changed.');
    else if (error instanceof ImportError) toast.show(error.message);
    else toast.show('That file is not a Jotmark export');
  }
}

async function showDeleteAllConfirm() {
  const count = await store.countAll();
  if (count === 0) {
    toast.show('There are no notes to delete');
    return;
  }
  clear(els.deleteAllControls);
  const yes = h('button', { type: 'button', class: 'btn btn-danger' }, `Delete ${pluralize(count, 'note')}`);
  const no = h('button', { type: 'button', class: 'btn' }, 'Cancel');
  yes.addEventListener('click', async () => {
    await store.clearNotes();
    await refreshNotes();
    await refreshStorageSummary();
    restoreDeleteAllButton();
    toast.show('All notes deleted');
  });
  no.addEventListener('click', restoreDeleteAllButton);
  els.deleteAllControls.append(no, yes);
  no.focus();
}

function restoreDeleteAllButton() {
  clear(els.deleteAllControls);
  const btn = h('button', { type: 'button', class: 'btn btn-danger', id: 'btn-delete-all' }, 'Delete all notes');
  btn.addEventListener('click', showDeleteAllConfirm);
  els.deleteAllControls.append(btn);
}
