// Rendering pieces shared by the popup and the all notes page.

import { h } from './dom.js';
import { MAX_NOTE_LENGTH } from './storage.js';
import { formatTimestamp, formatAbsolute, splitLinks, splitMatches } from './format.js';

function highlighted(text, query) {
  if (!query) return [text];
  return splitMatches(text, query).map((part) => (part.type === 'match' ? h('mark', {}, part.value) : part.value));
}

// Note body as DOM nodes: URLs become links when enabled, and search matches
// are wrapped in <mark>. User text only ever goes through textContent.
export function noteTextNodes(text, settings, query = '') {
  if (!settings.linkify) return highlighted(text, query);
  const nodes = [];
  for (const part of splitLinks(text)) {
    if (part.type === 'link') {
      nodes.push(h('a', { href: part.value, target: '_blank', rel: 'noopener noreferrer' }, ...highlighted(part.value, query)));
    } else {
      nodes.push(...highlighted(part.value, query));
    }
  }
  return nodes;
}

export function timeElement(note, settings, now = Date.now()) {
  let iso = '';
  try {
    iso = new Date(note.createdAt).toISOString();
  } catch {
    iso = '';
  }
  return h('time', {
    class: 'note-time',
    datetime: iso,
    title: formatAbsolute(note.createdAt, settings.clock),
  }, formatTimestamp(note.createdAt, settings, now));
}

export function editedBadge(note, settings) {
  if (note.updatedAt - note.createdAt <= 1000) return null;
  return h('span', { class: 'note-edited', title: `Edited ${formatAbsolute(note.updatedAt, settings.clock)}` }, 'edited');
}

export function sortNotes(notes, sortOrder) {
  const list = [...notes];
  list.sort((a, b) => (sortOrder === 'oldest' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt));
  return list;
}

// Copy, Edit, Delete for a note row.
export function actionButtons() {
  return h('span', { class: 'note-actions' },
    h('button', { type: 'button', class: 'link-btn', 'data-action': 'copy' }, 'Copy'),
    h('button', { type: 'button', class: 'link-btn', 'data-action': 'edit' }, 'Edit'),
    h('button', { type: 'button', class: 'link-btn is-danger', 'data-action': 'delete' }, 'Delete'),
  );
}

// Inline "Delete this note?" prompt shown in place of the action buttons.
export function confirmButtons() {
  return h('span', { class: 'note-confirm' },
    'Delete this note?',
    h('button', { type: 'button', class: 'btn btn-danger btn-sm', 'data-action': 'confirm-delete' }, 'Delete'),
    h('button', { type: 'button', class: 'btn btn-sm', 'data-action': 'cancel' }, 'Cancel'),
  );
}

// Returns a predicate that tells whether a keydown should submit, honouring
// the "add a note with" setting: Enter alone, or Ctrl/Cmd + Enter.
export function submitKeyMatcher(settings) {
  return (event) => {
    if (event.key !== 'Enter' || event.isComposing) return false;
    if (settings.submitKey === 'enter') return !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
    return event.metaKey || event.ctrlKey;
  };
}

export function autogrow(textarea, maxPx) {
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.min(textarea.scrollHeight + 2, maxPx)}px`;
}

// Inline editor for a note. The caller keeps the draft (so re-renders do not
// lose typed text) and decides what Save and Cancel do.
export function editorElement({ value, onInput, onSave, onCancel, isSubmitKey, maxPx = 200 }) {
  const textarea = h('textarea', { class: 'field', rows: '3', maxlength: String(MAX_NOTE_LENGTH), 'aria-label': 'Edit note' });
  textarea.value = value;
  textarea.addEventListener('input', () => {
    autogrow(textarea, maxPx);
    onInput(textarea.value);
  });
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    } else if (isSubmitKey(event)) {
      event.preventDefault();
      onSave(textarea.value);
    }
  });
  queueMicrotask(() => {
    autogrow(textarea, maxPx);
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  });
  const save = h('button', { type: 'button', class: 'btn btn-primary btn-sm', 'data-action': 'save' }, 'Save');
  const cancel = h('button', { type: 'button', class: 'btn btn-sm', 'data-action': 'cancel' }, 'Cancel');
  return h('div', { class: 'note-editor' }, textarea, h('div', { class: 'note-editor-row' }, cancel, save));
}

// Small transient status message. Returns { show, hide }.
// A message with an action (Undo) stays for longer, and a plain message that
// arrives while it is showing keeps the action attached instead of dropping it.
export function createToast(element) {
  let timer = null;
  let current = null; // { action, expiresAt }
  function hide() {
    clearTimeout(timer);
    current = null;
    element.classList.remove('is-visible');
    element.style.pointerEvents = 'none';
  }
  function show(message, action) {
    if (!action && current && current.action && Date.now() < current.expiresAt) {
      action = current.action;
    }
    while (element.firstChild) element.removeChild(element.firstChild);
    element.append(message);
    if (action) {
      const btn = h('button', { type: 'button', class: 'toast-action' }, action.label);
      btn.addEventListener('click', () => action.onClick());
      element.append(' ', btn);
    }
    element.classList.add('is-visible');
    element.style.pointerEvents = action ? 'auto' : 'none';
    clearTimeout(timer);
    const duration = action ? 5000 : 1600;
    current = { action: action || null, expiresAt: Date.now() + duration };
    timer = setTimeout(hide, duration);
  }
  return { show, hide };
}
