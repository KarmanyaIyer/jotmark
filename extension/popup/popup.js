import { createStore, storageKey } from '../shared/storage.js';
import { loadSettings, applyAppearance, onSettingsChange } from '../shared/settings.js';
import { describeUrl } from '../shared/url.js';
import { pluralize } from '../shared/format.js';
import { h, clear } from '../shared/dom.js';
import {
  noteTextNodes, timeElement, editedBadge, sortNotes, actionButtons, confirmButtons,
  submitKeyMatcher, editorElement, autogrow, createToast,
} from '../shared/note-view.js';

const store = createStore();
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const COMPOSER_MAX_PX = 170;
const EDITOR_MAX_PX = 200;
// Hosts longer than this get a generic placeholder so it never wraps out of view.
const PLACEHOLDER_HOST_LIMIT = 32;
// Paths longer than this are shortened in the middle for the header.
const PATH_DISPLAY_LIMIT = 52;

const els = {
  host: document.getElementById('site-host'),
  path: document.getElementById('site-path'),
  siteActions: document.querySelector('.site-actions'),
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
  tabUrl: null,
  site: null,
  scope: 'domain',
  notes: { domain: [], page: [] },
  editingId: null,
  editingDraft: '',
  confirmingId: null,
  busy: false,       // a storage write is in flight
  isSubmitKey: () => false,
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
  state.isSubmitKey = submitKeyMatcher(state.settings);
  applyAppearance(state.settings);
  updateHint();

  const tab = await getActiveTab();
  state.tabUrl = tab && tab.url;
  state.site = describeUrl(state.tabUrl, state.settings);

  wireNavigation();

  if (!state.site.supported) {
    showUnsupported(reasonMessage(state.site));
    markReady();
    return;
  }

  state.scope = await initialScope();
  state.notes = await store.getNotesForSite(state.site.domainKey, state.site.pageKey);
  renderHeader();
  renderNotes();
  markReady();
  els.input.focus();

  wireEvents();
  onSettingsChange(handleSettingsChange);
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
  els.siteActions.hidden = true;
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

// The name shown for the current scope. With "group subdomains" on, domain
// notes are filed under the registrable domain, so that is what we name.
function siteLabel() {
  return state.scope === 'domain' ? state.site.domainKey : state.site.host;
}

// Rendering

function renderHeader() {
  const { site, settings, scope } = state;
  const label = siteLabel();
  els.host.textContent = label;
  els.host.title = label;
  const showPath = settings.showPath && scope === 'page';
  els.path.hidden = !showPath;
  if (showPath) {
    els.path.textContent = shortenMiddle(site.displayPath, PATH_DISPLAY_LIMIT);
    els.path.title = site.displayPath;
  }
  if (scope === 'domain') {
    els.input.placeholder = label.length > PLACEHOLDER_HOST_LIMIT ? 'Write a note for this domain' : `Write a note for ${label}`;
  } else {
    els.input.placeholder = 'Write a note for this page';
  }
}

function shortenMiddle(text, limit) {
  if (text.length <= limit) return text;
  const head = Math.ceil((limit - 1) / 2);
  const tail = Math.floor((limit - 1) / 2);
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
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
  const { scope, notes } = state;
  clear(els.empty);
  const other = scope === 'domain' ? notes.page.length : notes.domain.length;
  if (scope === 'domain') {
    els.empty.append('No notes for ', h('strong', {}, siteLabel()), ' yet.');
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
    li.append(editorElement({
      value: state.editingDraft,
      onInput: (value) => { state.editingDraft = value; },
      onSave: (value) => saveEdit(note.id, value),
      onCancel: () => cancelEdit(note.id),
      isSubmitKey: state.isSubmitKey,
      maxPx: EDITOR_MAX_PX,
    }));
    return li;
  }

  const text = h('div', { class: 'note-text' }, ...noteTextNodes(note.text, state.settings));
  const meta = h('div', { class: 'note-meta' }, timeElement(note, state.settings, now), editedBadge(note, state.settings));
  if (state.confirmingId === note.id) {
    li.classList.add('is-busy');
    meta.append(confirmButtons());
  } else {
    meta.append(actionButtons());
  }
  li.append(text, meta);
  return li;
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

  els.input.addEventListener('input', () => autogrow(els.input, COMPOSER_MAX_PX));
  els.input.addEventListener('keydown', (event) => {
    if (state.isSubmitKey(event)) {
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
    const viaKeyboard = event.detail === 0;
    switch (button.dataset.action) {
      case 'copy': copyNote(note); break;
      case 'edit': startEdit(id); break;
      case 'delete': requestDelete(note, viaKeyboard); break;
      case 'confirm-delete': deleteNote(note); break;
      case 'save': saveEdit(id, li.querySelector('textarea').value); break;
      case 'cancel': cancelEdit(id); break;
      default: break;
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && (state.editingId || state.confirmingId)) {
      event.preventDefault();
      cancelEdit(state.editingId || state.confirmingId);
      return;
    }
    // Ctrl/Cmd + Z restores the last deleted note when focus is not in a text
    // field, so keyboard users can undo without reaching the toast button.
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'z' && lastDeleted) {
      const target = event.target;
      const inTextField = target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT');
      if (!inTextField || (target.value === '' && target.id === 'note-input')) {
        event.preventDefault();
        undoDelete();
      }
    }
  });
}

function wireNavigation() {
  for (const id of ['btn-all', 'btn-all-2']) {
    document.getElementById(id).addEventListener('click', () => openOptions('notes'));
  }
  for (const id of ['btn-settings', 'btn-settings-2']) {
    document.getElementById(id).addEventListener('click', () => openOptions('settings'));
  }
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
  state.editingDraft = '';
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
  if (state.busy) return;
  const text = els.input.value;
  if (!text.trim()) {
    els.input.focus();
    return;
  }
  state.busy = true;
  els.addBtn.disabled = true;
  try {
    const note = await store.addNote(state.scope, currentKey(), text);
    currentNotes().push(note);
    els.input.value = '';
    autogrow(els.input, COMPOSER_MAX_PX);
    renderNotes();
    if (state.settings.sortOrder === 'newest') els.notes.scrollTop = 0;
    else els.notes.scrollTop = els.notes.scrollHeight;
  } catch (error) {
    console.error(error);
    toast.show('Could not save the note');
  } finally {
    state.busy = false;
    els.addBtn.disabled = false;
    els.input.focus();
  }
}

function startEdit(id) {
  const note = currentNotes().find((n) => n.id === id);
  if (!note) return;
  state.confirmingId = null;
  state.editingId = id;
  state.editingDraft = note.text;
  renderNotes();
}

// Leaves edit or confirm mode and puts focus back on that note's Edit button
// (or the composer if the note is gone) so keyboard users keep their place.
function cancelEdit(id) {
  state.editingId = null;
  state.editingDraft = '';
  state.confirmingId = null;
  renderNotes();
  focusNoteAction(id);
}

function focusNoteAction(id) {
  const button = id && els.list.querySelector(`[data-id="${CSS.escape(id)}"] [data-action="edit"]`);
  if (button) button.focus();
  else els.input.focus();
}

async function saveEdit(id, text) {
  if (state.busy) return;
  if (!text.trim()) {
    toast.show('A note cannot be empty');
    return;
  }
  const list = currentNotes();
  const index = list.findIndex((n) => n.id === id);
  if (index === -1) return cancelEdit();
  if (list[index].text === text) return cancelEdit(id);
  state.busy = true;
  try {
    const updated = await store.updateNote(state.scope, currentKey(), id, text);
    if (updated) list[index] = updated;
    state.editingId = null;
    state.editingDraft = '';
    renderNotes();
    focusNoteAction(id);
  } catch (error) {
    console.error(error);
    toast.show('Could not save the change');
  } finally {
    state.busy = false;
  }
}

// viaKeyboard: move focus to the confirm button only when the request came from
// the keyboard, so mouse users never see a stray focus ring.
function requestDelete(note, viaKeyboard = false) {
  if (state.settings.confirmDelete) {
    state.editingId = null;
    state.editingDraft = '';
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
  if (state.busy) return;
  const scope = state.scope;
  const key = currentKey();
  state.busy = true;
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

// Opens the options page on the requested view, reusing the tab if it is
// already open. The view name travels through session storage because
// runtime.openOptionsPage cannot carry a hash.
async function openOptions(view) {
  try {
    if (chrome.storage.session) await chrome.storage.session.set({ openView: view });
    await chrome.runtime.openOptionsPage();
  } catch (error) {
    console.warn('openOptionsPage failed, opening a tab instead', error);
    chrome.tabs.create({ url: chrome.runtime.getURL(`options/options.html#${view}`) });
  }
  window.close();
}

// Settings changed from the options page while the popup is open. URL
// handling settings can move notes to a different key, so the site is
// described again and notes are reloaded.
async function handleSettingsChange(next) {
  state.settings = next;
  state.isSubmitKey = submitKeyMatcher(next);
  applyAppearance(next);
  updateHint();
  if (!state.site || !state.site.supported) return;
  const site = describeUrl(state.tabUrl, next);
  if (site.supported && (site.domainKey !== state.site.domainKey || site.pageKey !== state.site.pageKey)) {
    state.site = site;
    state.notes = await store.getNotesForSite(site.domainKey, site.pageKey);
    state.editingId = null;
    state.editingDraft = '';
    state.confirmingId = null;
  }
  renderHeader();
  renderNotes();
}

// Storage changes made from another extension page while the popup is open.
async function handleExternalChange(changes, areaName) {
  if (areaName !== 'local' || !state.site || !state.site.supported) return;
  const dk = storageKey('domain', state.site.domainKey);
  const pk = storageKey('page', state.site.pageKey);
  if (!(dk in changes) && !(pk in changes)) return;
  state.notes = await store.getNotesForSite(state.site.domainKey, state.site.pageKey);
  if (state.editingId && !currentNotes().some((n) => n.id === state.editingId)) {
    state.editingId = null;
    state.editingDraft = '';
  }
  if (state.confirmingId && !currentNotes().some((n) => n.id === state.confirmingId)) state.confirmingId = null;
  renderNotes();
}
