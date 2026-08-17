import { createStore, MAX_NOTE_LENGTH } from '../shared/storage.js';
import { loadSettings, applyAppearance, onSettingsChange } from '../shared/settings.js';
import { describeUrl } from '../shared/url.js';
import { pluralize } from '../shared/format.js';
import { h, clear } from '../shared/dom.js';
import { noteTextNodes, timeElement, editedBadge, sortNotes, createToast } from '../shared/note-view.js';

const store = createStore();
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const els = {
  host: document.getElementById('site-host'),
  path: document.getElementById('site-path'),
  siteView: document.getElementById('site-view'),
  unsupportedView: document.getElementById('unsupported-view'),
  unsupportedReason: document.getElementById('unsupported-reason'),
  scopeDomain: document.getElementById('scope-domain'),
  scopePage: document.getElementById('scope-page'),
  countDomain: document.getElementById('count-domain'),
  countPage: document.getElementById('count-page'),
  composer: document.getElementById('composer'),
  input: document.getElementById('note-input'),
  hint: document.getElementById('hint'),
  addBtn: document.getElementById('btn-add'),
  notes: document.getElementById('notes'),
  list: document.getElementById('note-list'),
  empty: document.getElementById('empty'),
  toast: document.getElementById('toast'),
};

const state = {
  settings: null,
  site: null,
  scope: 'domain',
  notes: { domain: [], page: [] },
  editingId: null,
  confirmingId: null,
};

const toast = createToast(els.toast);
let lastDeleted = null;

init().catch((error) => {
  console.error('Jotmark popup failed to start', error);
  showUnsupported('Something went wrong while opening Jotmark. Try closing and reopening the popup.');
  markReady();
});

async function init() {
  state.settings = await loadSettings();
  applyAppearance(state.settings);
  updateHint();

  const tab = await getActiveTab();
  state.site = describeUrl(tab && tab.url, state.settings);

  wireNavigation();

  if (!state.site.supported) {
    showUnsupported(reasonMessage(state.site));
    markReady();
    return;
  }

  state.scope = await initialScope();
  state.notes = await store.getNotesForSite(state.site.domainKey, state.site.pageKey);
  renderHeader();
  renderScope();
  renderNotes();
  markReady();
  els.input.focus();

  wireEvents();
  onSettingsChange(async (next) => {
    state.settings = next;
    applyAppearance(next);
    updateHint();
    renderHeader();
    renderNotes();
  });
  chrome.storage.onChanged.addListener(handleExternalChange);
}

async function getActiveTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs && tabs[0];
  } catch (error) {
    console.warn('Could not read the active tab', error);
    return null;
  }
}

function reasonMessage(site) {
  if (site.reason === 'protocol') {
    if (site.protocol === 'file:') return 'Jotmark works on web pages (http and https). Local files are not supported.';
    return 'Jotmark works on web pages (http and https). This tab is a browser page.';
  }
  return 'Jotmark could not read the address of this tab. Try reloading the page and opening Jotmark again.';
}

async function initialScope() {
  const { settings, site } = state;
  if (settings.rememberScope) {
    const remembered = await store.getRememberedScope(site.domainKey);
    if (remembered) return remembered;
  }
  return settings.defaultScope;
}

function markReady() {
  document.documentElement.dataset.ready = 'true';
}

function showUnsupported(message) {
  els.siteView.hidden = true;
  els.unsupportedView.hidden = false;
  if (message) els.unsupportedReason.textContent = message;
  els.host.textContent = 'Jotmark';
  els.path.hidden = true;
}

function currentKey() {
  return state.scope === 'domain' ? state.site.domainKey : state.site.pageKey;
}

function currentNotes() {
  return state.notes[state.scope];
}

// Rendering

function renderHeader() {
  const { site, settings, scope } = state;
  els.host.textContent = site.host;
  els.host.title = site.host;
  const showPath = settings.showPath && scope === 'page';
  els.path.hidden = !showPath;
  if (showPath) {
    clear(els.path);
    els.path.append(h('span', {}, site.displayPath));
    els.path.title = site.displayPath;
  }
  els.input.placeholder = scope === 'domain' ? `Write a note for ${site.host}` : 'Write a note for this page';
}

function renderScope() {
  els.scopeDomain.checked = state.scope === 'domain';
  els.scopePage.checked = state.scope === 'page';
  els.countDomain.textContent = String(state.notes.domain.length);
  els.countPage.textContent = String(state.notes.page.length);
}

function renderNotes() {
  renderScope();
  clear(els.list);
  const list = sortNotes(currentNotes(), state.settings.sortOrder);
  if (list.length === 0) {
    els.empty.hidden = false;
    renderEmpty();
    return;
  }
  els.empty.hidden = true;
  const now = Date.now();
  for (const note of list) els.list.append(renderNote(note, now));
}

function renderEmpty() {
  const { scope, notes, site } = state;
  clear(els.empty);
  const other = scope === 'domain' ? notes.page.length : notes.domain.length;
  if (scope === 'domain') {
    els.empty.append('No notes for ', h('strong', {}, site.host), ' yet.');
  } else {
    els.empty.append('No notes for this page yet.');
  }
  if (other > 0) {
    const otherLabel = scope === 'domain' ? 'this page' : 'the domain';
    els.empty.append(h('br'), `${pluralize(other, 'note')} on ${otherLabel}.`);
  }
}

function renderNote(note, now) {
  const li = h('li', { class: 'note', 'data-id': note.id });
  if (state.editingId === note.id) {
    li.classList.add('is-busy');
    li.append(renderEditor(note));
    return li;
  }

  const text = h('div', { class: 'note-text' }, ...noteTextNodes(note.text, state.settings));
  const meta = h('div', { class: 'note-meta' }, timeElement(note, state.settings, now), editedBadge(note, state.settings));

  if (state.confirmingId === note.id) {
    li.classList.add('is-busy');
    meta.append(
      h('span', { class: 'note-confirm' },
        'Delete this note?',
        h('button', { type: 'button', class: 'btn btn-danger btn-sm', 'data-action': 'confirm-delete' }, 'Delete'),
        h('button', { type: 'button', class: 'btn btn-sm', 'data-action': 'cancel' }, 'Cancel'),
      ),
    );
  } else {
    meta.append(
      h('span', { class: 'note-actions' },
        h('button', { type: 'button', class: 'link-btn', 'data-action': 'copy' }, 'Copy'),
        h('button', { type: 'button', class: 'link-btn', 'data-action': 'edit' }, 'Edit'),
        h('button', { type: 'button', class: 'link-btn is-danger', 'data-action': 'delete' }, 'Delete'),
      ),
    );
  }

  li.append(text, meta);
  return li;
}

function renderEditor(note) {
  const textarea = h('textarea', { class: 'field', rows: '3', maxlength: String(MAX_NOTE_LENGTH), 'aria-label': 'Edit note' });
  textarea.value = note.text;
  const save = h('button', { type: 'button', class: 'btn btn-primary btn-sm', 'data-action': 'save' }, 'Save');
  const cancel = h('button', { type: 'button', class: 'btn btn-sm', 'data-action': 'cancel' }, 'Cancel');
  const wrap = h('div', { class: 'note-editor' }, textarea, h('div', { class: 'note-editor-row' }, cancel, save));

  textarea.addEventListener('input', () => autogrow(textarea, 200));
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelEdit();
    } else if (isSubmitKey(event)) {
      event.preventDefault();
      saveEdit(note.id, textarea.value);
    }
  });
  queueMicrotask(() => {
    autogrow(textarea, 200);
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  });
  return wrap;
}

// Events

function wireEvents() {
  document.querySelector('.scope').addEventListener('change', async (event) => {
    if (event.target.name !== 'scope') return;
    await setScope(event.target.value);
  });

  els.composer.addEventListener('submit', (event) => {
    event.preventDefault();
    addNote();
  });

  els.input.addEventListener('input', () => autogrow(els.input, 170));
  els.input.addEventListener('keydown', (event) => {
    if (isSubmitKey(event)) {
      event.preventDefault();
      addNote();
    }
  });

  els.list.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const li = button.closest('.note');
    if (!li) return;
    const id = li.dataset.id;
    const note = currentNotes().find((n) => n.id === id);
    if (!note) return;
    switch (button.dataset.action) {
      case 'copy': copyNote(note); break;
      case 'edit': startEdit(id); break;
      case 'delete': requestDelete(note, event.detail === 0); break;
      case 'confirm-delete': deleteNote(note); break;
      case 'save': saveEdit(id, li.querySelector('textarea').value); break;
      case 'cancel': cancelEdit(); break;
      default: break;
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && (state.editingId || state.confirmingId)) {
      event.preventDefault();
      cancelEdit();
    }
  });
}

function wireNavigation() {
  for (const id of ['btn-all', 'btn-all-2']) {
    document.getElementById(id).addEventListener('click', () => openExtensionPage('options/options.html#notes'));
  }
  for (const id of ['btn-settings', 'btn-settings-2']) {
    document.getElementById(id).addEventListener('click', () => openExtensionPage('options/options.html#settings'));
  }
}

function isSubmitKey(event) {
  if (event.key !== 'Enter' || event.isComposing) return false;
  if (state.settings.submitKey === 'enter') return !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
  return event.metaKey || event.ctrlKey;
}

function updateHint() {
  const mod = isMac ? '⌘' : 'Ctrl';
  clear(els.hint);
  if (state.settings.submitKey === 'enter') {
    els.hint.append(h('kbd', {}, 'Enter'), ' to add, ', h('kbd', {}, 'Shift'), ' ', h('kbd', {}, 'Enter'), ' for a new line');
  } else {
    els.hint.append(h('kbd', {}, mod), ' ', h('kbd', {}, 'Enter'), ' to add');
  }
}

async function setScope(scope) {
  if (scope === state.scope) return;
  state.scope = scope;
  state.editingId = null;
  state.confirmingId = null;
  renderHeader();
  renderNotes();
  els.input.focus();
  if (state.settings.rememberScope) {
    await store.rememberScope(state.site.domainKey, scope);
  }
}

// Actions

async function addNote() {
  const text = els.input.value;
  if (!text.trim()) {
    els.input.focus();
    return;
  }
  els.addBtn.disabled = true;
  try {
    const note = await store.addNote(state.scope, currentKey(), text);
    currentNotes().push(note);
    els.input.value = '';
    autogrow(els.input, 170);
    renderNotes();
    if (state.settings.sortOrder === 'newest') els.notes.scrollTop = 0;
    else els.notes.scrollTop = els.notes.scrollHeight;
  } catch (error) {
    console.error(error);
    toast.show('Could not save the note');
  } finally {
    els.addBtn.disabled = false;
    els.input.focus();
  }
}

function startEdit(id) {
  state.confirmingId = null;
  state.editingId = id;
  renderNotes();
}

function cancelEdit() {
  const hadEditor = Boolean(state.editingId);
  state.editingId = null;
  state.confirmingId = null;
  renderNotes();
  if (hadEditor) els.input.focus();
}

async function saveEdit(id, text) {
  if (!text.trim()) {
    toast.show('A note cannot be empty');
    return;
  }
  const list = currentNotes();
  const index = list.findIndex((n) => n.id === id);
  if (index === -1) return cancelEdit();
  if (list[index].text === text) return cancelEdit();
  try {
    const updated = await store.updateNote(state.scope, currentKey(), id, text);
    if (updated) list[index] = updated;
    state.editingId = null;
    renderNotes();
    els.input.focus();
  } catch (error) {
    console.error(error);
    toast.show('Could not save the change');
  }
}

// viaKeyboard: move focus to the confirm button only when the request came from
// the keyboard, so mouse users never see a stray focus ring.
function requestDelete(note, viaKeyboard = false) {
  if (state.settings.confirmDelete) {
    state.editingId = null;
    state.confirmingId = note.id;
    renderNotes();
    if (viaKeyboard) {
      const btn = els.list.querySelector(`[data-id="${CSS.escape(note.id)}"] [data-action="confirm-delete"]`);
      if (btn) btn.focus();
    }
    return;
  }
  deleteNote(note);
}

async function deleteNote(note) {
  const scope = state.scope;
  const key = currentKey();
  try {
    await store.deleteNote(scope, key, note.id);
    state.notes[scope] = state.notes[scope].filter((n) => n.id !== note.id);
    state.confirmingId = null;
    renderNotes();
    lastDeleted = { scope, key, note };
    toast.show('Note deleted', { label: 'Undo', onClick: undoDelete });
    els.input.focus();
  } catch (error) {
    console.error(error);
    toast.show('Could not delete the note');
  }
}

async function undoDelete() {
  if (!lastDeleted) return;
  const { scope, key, note } = lastDeleted;
  lastDeleted = null;
  toast.hide();
  try {
    const list = await store.restoreNote(scope, key, note);
    const siteKey = scope === 'domain' ? state.site.domainKey : state.site.pageKey;
    if (key === siteKey) {
      state.notes[scope] = list;
      renderNotes();
    }
  } catch (error) {
    console.error(error);
    toast.show('Could not restore the note');
  }
}

async function copyNote(note) {
  try {
    await navigator.clipboard.writeText(note.text);
    toast.show('Copied');
  } catch {
    toast.show('Could not copy');
  }
}

function openExtensionPage(path) {
  chrome.tabs.create({ url: chrome.runtime.getURL(path) });
  window.close();
}

// Storage changes made from another extension page while the popup is open.
async function handleExternalChange(changes, areaName) {
  if (areaName !== 'local' || !state.site || !state.site.supported) return;
  const dk = `d:${state.site.domainKey}`;
  const pk = `p:${state.site.pageKey}`;
  if (!(dk in changes) && !(pk in changes)) return;
  state.notes = await store.getNotesForSite(state.site.domainKey, state.site.pageKey);
  if (state.editingId && !currentNotes().some((n) => n.id === state.editingId)) state.editingId = null;
  if (state.confirmingId && !currentNotes().some((n) => n.id === state.confirmingId)) state.confirmingId = null;
  renderNotes();
}

// Utilities

function autogrow(textarea, maxPx) {
  textarea.style.height = 'auto';
  const next = Math.min(textarea.scrollHeight + 2, maxPx);
  textarea.style.height = `${next}px`;
}
