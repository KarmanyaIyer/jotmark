import { createStore, MAX_NOTE_LENGTH } from '../shared/storage.js';
import { loadSettings, saveSettings, resetSettings, applyAppearance, onSettingsChange, DEFAULT_SETTINGS } from '../shared/settings.js';
import { formatBytes, formatRelative, formatAbsolute, pluralize } from '../shared/format.js';
import { labelForKey } from '../shared/url.js';
import { h, clear } from '../shared/dom.js';
import { noteTextNodes, timeElement, editedBadge, sortNotes, createToast } from '../shared/note-view.js';

const store = createStore();
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const VIEWS = ['notes', 'settings', 'about'];

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
  deleteAllControls: document.getElementById('delete-all-controls'),
  deleteAllDesc: document.getElementById('delete-all-desc'),
  toast: document.getElementById('toast'),
};

const toast = createToast(els.toast);

const state = {
  settings: { ...DEFAULT_SETTINGS },
  groups: [],
  query: '',
  editing: null,     // { scope, key, id }
  confirming: null,  // { scope, key, id }
  view: 'notes',
};

init().catch((error) => {
  console.error('Jotmark settings failed to start', error);
  document.documentElement.dataset.ready = 'true';
});

async function init() {
  const manifest = chrome.runtime.getManifest();
  els.version.textContent = `v${manifest.version}`;
  els.aboutVersion.textContent = manifest.version;

  state.settings = await loadSettings();
  applyAppearance(state.settings);
  bindSettingsControls();
  fillSettingsControls();
  updatePreview();

  await refreshNotes();
  await refreshStorageSummary();

  wireNotesView();
  wireDataActions();

  window.addEventListener('hashchange', route);
  route();
  document.documentElement.dataset.ready = 'true';

  onSettingsChange((next) => {
    state.settings = next;
    applyAppearance(next);
    fillSettingsControls();
    updatePreview();
    renderGroups();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const touchedNotes = Object.keys(changes).some((k) => k.startsWith('d:') || k.startsWith('p:'));
    if (touchedNotes) {
      refreshNotes();
      refreshStorageSummary();
    }
  });
}

// Routing

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
  if (view === 'notes') els.search.focus({ preventScroll: true });
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
      state.settings = await saveSettings({ [key]: value });
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
  const b = now - 26 * 60 * 60 * 1000;
  const { timeFormat, clock } = state.settings;
  t1.textContent = timeFormat === 'absolute' ? formatAbsolute(a, clock) : formatRelative(a, now, clock);
  t2.textContent = timeFormat === 'absolute' ? formatAbsolute(b, clock) : formatRelative(b, now, clock);
}

// All notes view

async function refreshNotes() {
  const groups = await store.getAllGroups();
  state.groups = groupBySite(groups);
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

  const where = h('div', { class: 'note-where' }, h('span', { class: 'scope-tag' }, scope));
  if (scope === 'page') {
    where.append(h('a', { class: 'path', href: key, target: '_blank', rel: 'noopener noreferrer', title: key }, ...noteTextNodes(labelForKey(scope, key), { linkify: false }, query)));
  }
  li.append(where);

  if (isSame(state.editing, entry)) {
    li.classList.add('is-busy');
    li.append(renderEditor(entry));
    return li;
  }

  const text = h('div', { class: 'note-text' }, ...noteTextNodes(note.text, state.settings, query));
  const meta = h('div', { class: 'note-meta' }, timeElement(note, state.settings, now), editedBadge(note, state.settings));

  if (isSame(state.confirming, entry)) {
    li.classList.add('is-busy');
    meta.append(h('span', { class: 'note-confirm' },
      'Delete this note?',
      h('button', { type: 'button', class: 'btn btn-danger btn-sm', 'data-action': 'confirm-delete' }, 'Delete'),
      h('button', { type: 'button', class: 'btn btn-sm', 'data-action': 'cancel' }, 'Cancel'),
    ));
  } else {
    meta.append(h('span', { class: 'note-actions' },
      h('button', { type: 'button', class: 'link-btn', 'data-action': 'copy' }, 'Copy'),
      h('button', { type: 'button', class: 'link-btn', 'data-action': 'edit' }, 'Edit'),
      h('button', { type: 'button', class: 'link-btn is-danger', 'data-action': 'delete' }, 'Delete'),
    ));
  }
  li.append(text, meta);
  return li;
}

function renderEditor(entry) {
  const textarea = h('textarea', { class: 'field', rows: '3', maxlength: String(MAX_NOTE_LENGTH), 'aria-label': 'Edit note' });
  textarea.value = entry.note.text;
  const save = h('button', { type: 'button', class: 'btn btn-primary btn-sm', 'data-action': 'save' }, 'Save');
  const cancel = h('button', { type: 'button', class: 'btn btn-sm', 'data-action': 'cancel' }, 'Cancel');
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelBusy();
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      saveEdit(entry, textarea.value);
    }
  });
  textarea.addEventListener('input', () => autogrow(textarea));
  queueMicrotask(() => {
    autogrow(textarea);
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  });
  return h('div', { class: 'note-editor' }, textarea, h('div', { class: 'note-editor-row' }, cancel, save));
}

function isSame(a, entry) {
  return Boolean(a) && a.scope === entry.scope && a.key === entry.key && a.id === entry.note.id;
}

function findEntry(li) {
  const { scope, key, id } = li.dataset;
  for (const site of state.groups) {
    const found = site.entries.find((e) => e.scope === scope && e.key === key && e.note.id === id);
    if (found) return found;
  }
  return null;
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
        state.editing = { scope: entry.scope, key: entry.key, id: entry.note.id };
        renderGroups();
        break;
      case 'delete':
        if (state.settings.confirmDelete) {
          state.editing = null;
          state.confirming = { scope: entry.scope, key: entry.key, id: entry.note.id };
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
        cancelBusy();
        break;
      default:
        break;
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && (state.editing || state.confirming)) cancelBusy();
  });
}

function cancelBusy() {
  state.editing = null;
  state.confirming = null;
  renderGroups();
}

async function saveEdit(entry, text) {
  if (!text.trim()) {
    toast.show('A note cannot be empty');
    return;
  }
  if (text !== entry.note.text) {
    await store.updateNote(entry.scope, entry.key, entry.note.id, text);
  }
  state.editing = null;
  await refreshNotes();
}

let lastDeleted = null;

async function deleteEntry(entry) {
  await store.deleteNote(entry.scope, entry.key, entry.note.id);
  state.confirming = null;
  lastDeleted = entry;
  await refreshNotes();
  await refreshStorageSummary();
  toast.show('Note deleted', {
    label: 'Undo',
    onClick: async () => {
      if (!lastDeleted) return;
      const { scope, key, note } = lastDeleted;
      lastDeleted = null;
      toast.hide();
      await store.restoreNote(scope, key, note);
      await refreshNotes();
    },
  });
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
      const ok = window.confirm('Replace will delete every existing note before importing. Continue?');
      if (!ok) return;
    }
    try {
      const payload = JSON.parse(await file.text());
      const result = await store.importData(payload, mode);
      await refreshNotes();
      await refreshStorageSummary();
      toast.show(`Imported ${pluralize(result.added, 'note')}${result.skipped ? `, skipped ${result.skipped}` : ''}`);
    } catch (error) {
      console.warn(error);
      toast.show('That file is not a Jotmark export');
    }
  });

  document.getElementById('btn-reset-settings').addEventListener('click', async () => {
    state.settings = await resetSettings();
    applyAppearance(state.settings);
    fillSettingsControls();
    updatePreview();
    renderGroups();
    toast.show('Settings reset');
  });

  document.getElementById('btn-delete-all').addEventListener('click', showDeleteAllConfirm);
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

function autogrow(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.min(textarea.scrollHeight + 2, 320)}px`;
}
