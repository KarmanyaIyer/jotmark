// Rendering pieces shared by the popup and the all notes page.

import { h } from './dom.js';
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
  return h('time', {
    class: 'note-time',
    datetime: new Date(note.createdAt).toISOString(),
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

// Small transient status message. Returns { show, hide }.
export function createToast(element) {
  let timer = null;
  function hide() {
    clearTimeout(timer);
    element.classList.remove('is-visible');
    element.style.pointerEvents = 'none';
  }
  function show(message, action) {
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
    timer = setTimeout(hide, action ? 5000 : 1600);
  }
  return { show, hide };
}
