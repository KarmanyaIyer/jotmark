// Checklists inside notes. A line that starts with "[ ]" (or "[]", "[x]",
// optionally after a "- " or "* " bullet) is a checklist item. The state lives
// in the text itself, so nothing about storage, export or import changes and
// notes written in other tools with the same convention just work.
// Pure functions, unit tested in node.

// leading whitespace, optional bullet, the box, then a space or end of line.
const ITEM_PATTERN = /^(\s*(?:[-*]\s+)?)\[( |x|X|)\](?=\s|$)/;

// Describes one line. Returns null when the line is not a checklist item.
export function parseChecklistLine(line) {
  const match = ITEM_PATTERN.exec(line);
  if (!match) return null;
  const prefix = match[1];
  const checked = match[2].toLowerCase() === 'x';
  const markerEnd = match[0].length;
  // The body starts after the marker and one separating space, when present.
  const bodyStart = line[markerEnd] === ' ' ? markerEnd + 1 : markerEnd;
  return { prefix, checked, body: line.slice(bodyStart), markerEnd };
}

export function hasChecklist(text) {
  return text.split('\n').some((line) => parseChecklistLine(line) !== null);
}

// Flips the item on the given line between open and done. Returns the new
// text, or null when that line is not an item any more (for example after an
// external change). "[]" and "[X]" are normalized to "[ ]" and "[x]".
export function toggleChecklistItem(text, lineIndex) {
  const lines = text.split('\n');
  if (lineIndex < 0 || lineIndex >= lines.length) return null;
  const item = parseChecklistLine(lines[lineIndex]);
  if (!item) return null;
  const marker = item.checked ? '[ ]' : '[x]';
  lines[lineIndex] = item.prefix + marker + lines[lineIndex].slice(item.markerEnd);
  return lines.join('\n');
}

export function checklistProgress(text) {
  let done = 0;
  let total = 0;
  for (const line of text.split('\n')) {
    const item = parseChecklistLine(line);
    if (!item) continue;
    total += 1;
    if (item.checked) done += 1;
  }
  return { done, total };
}

function lineBoundsAt(value, caret) {
  const start = value.lastIndexOf('\n', caret - 1) + 1;
  const endIndex = value.indexOf('\n', caret);
  const end = endIndex === -1 ? value.length : endIndex;
  return { start, end };
}

// What pressing "new line" should do while the caret sits on a checklist item:
// continue the list with a fresh open box, or, on an empty item, remove the
// marker instead so the list ends. Returns { start, end, insert, caret } for a
// text replacement, or null when the caret is not on an item.
export function continueChecklist(value, caret) {
  const { start, end } = lineBoundsAt(value, caret);
  const line = value.slice(start, end);
  const item = parseChecklistLine(line);
  if (!item) return null;
  if (item.body.trim() === '') {
    // Empty item: drop the marker and stay on the (now plain) line.
    return { start, end, insert: item.prefix, caret: start + item.prefix.length };
  }
  const insert = `\n${item.prefix}[ ] `;
  return { start: caret, end: caret, insert, caret: caret + insert.length };
}

// Toggles a "[ ] " marker at the start of the caret's line (after any leading
// whitespace). Returns { start, end, insert, caret } for a text replacement.
export function toggleMarkerAtCaret(value, caret) {
  const { start, end } = lineBoundsAt(value, caret);
  const line = value.slice(start, end);
  const item = parseChecklistLine(line);
  if (item) {
    // Remove marker (and the single space after it) but keep the bullet prefix.
    const removeEnd = start + item.markerEnd + (line[item.markerEnd] === ' ' ? 1 : 0);
    return { start: start + item.prefix.length, end: removeEnd, insert: '', caret: Math.max(start + item.prefix.length, caret - (removeEnd - start - item.prefix.length)) };
  }
  const leading = /^\s*/.exec(line)[0].length;
  const at = start + leading;
  return { start: at, end: at, insert: '[ ] ', caret: caret >= at ? caret + 4 : at + 4 };
}

// Applies a replacement from continueChecklist or toggleMarkerAtCaret to a
// textarea, keeping undo history where the browser supports it.
export function applyEdit(textarea, edit) {
  textarea.focus();
  textarea.setSelectionRange(edit.start, edit.end);
  let done = false;
  try {
    done = edit.insert === '' && edit.start !== edit.end
      ? document.execCommand('delete', false)
      : document.execCommand('insertText', false, edit.insert);
  } catch {
    done = false;
  }
  if (!done) {
    const value = textarea.value;
    textarea.value = value.slice(0, edit.start) + edit.insert + value.slice(edit.end);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }
  textarea.setSelectionRange(edit.caret, edit.caret);
}

// True when this keydown would insert a plain newline in a composer that
// submits with the given predicate (Enter alone in mod-enter mode, Shift+Enter
// in enter mode). Used to continue checklists.
export function isNewlineKey(event, isSubmitKey) {
  if (event.key !== 'Enter' || event.isComposing || isSubmitKey(event)) return false;
  return !event.metaKey && !event.ctrlKey && !event.altKey;
}
