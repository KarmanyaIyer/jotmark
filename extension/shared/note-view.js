// Rendering pieces shared by the popup and the all notes page.

import { h } from './dom.js';
import { MAX_NOTE_LENGTH } from './storage.js';
import { formatTimestamp, formatAbsolute, splitLinks, splitMatches } from './format.js';
import { parseChecklistLine, hasChecklist, checklistProgress, continueChecklist, applyEdit, isNewlineKey } from './checklist.js';

function highlighted(text, query) {
  if (!query) return [text];
  return splitMatches(text, query).map((part) => (part.type === 'match' ? h('mark', {}, part.value) : part.value));
}

// Inline nodes for a run of text: URLs become links when enabled, and search
// matches are wrapped in <mark>. User text only ever goes through textContent.
function inlineNodes(text, settings, query) {
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

function checkIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M2.5 6.5 5 9l4.5-6');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.8');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

// Notes that contain checklist items render one block per line, with a
// checkbox button in front of each item. The button carries data-line so the
// click handler knows which line to flip.
function checklistNodes(text, settings, query) {
  return text.split('\n').map((line, index) => {
    const item = parseChecklistLine(line);
    if (!item) return h('div', { class: 'line' }, ...inlineNodes(line, settings, query));
    const label = item.body.trim() || 'Empty item';
    const box = h('button', {
      type: 'button',
      class: 'task-box',
      role: 'checkbox',
      'aria-checked': item.checked ? 'true' : 'false',
      'aria-label': label,
      title: item.checked ? 'Mark as not done' : 'Mark as done',
      'data-action': 'toggle-task',
      'data-line': String(index),
    }, checkIcon());
    const body = h('span', { class: 'task-text' }, ...inlineNodes(item.body, settings, query));
    return h('div', { class: item.checked ? 'line task is-done' : 'line task' }, box, body);
  });
}

// Note body as DOM nodes.
export function noteTextNodes(text, settings, query = '') {
  if (settings.checklists && hasChecklist(text)) return checklistNodes(text, settings, query);
  return inlineNodes(text, settings, query);
}

// "1 of 3 done" for notes with at least two checklist items, otherwise null.
export function progressBadge(text, settings) {
  if (!settings.checklists) return null;
  const { done, total } = checklistProgress(text);
  if (total < 2) return null;
  return h('span', { class: 'note-progress' }, `${done} of ${total} done`);
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

// Continues a checklist when a plain newline is typed on an item line.
// Returns true when it handled the key.
export function handleChecklistKey(textarea, event, isSubmitKey, enabled) {
  if (!enabled || !isNewlineKey(event, isSubmitKey)) return false;
  if (textarea.selectionStart !== textarea.selectionEnd) return false;
  const edit = continueChecklist(textarea.value, textarea.selectionStart);
  if (!edit) return false;
  event.preventDefault();
  applyEdit(textarea, edit);
  return true;
}

// Inline editor for a note. The caller keeps the draft (so re-renders do not
// lose typed text) and decides what Save and Cancel do.
export function editorElement({ value, onInput, onSave, onCancel, isSubmitKey, checklists = false, maxPx = 200 }) {
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
    } else {
      handleChecklistKey(textarea, event, isSubmitKey, checklists);
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
