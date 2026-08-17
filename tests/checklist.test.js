import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseChecklistLine, hasChecklist, toggleChecklistItem, checklistProgress, continueChecklist, toggleMarkerAtCaret, isNewlineKey,
} from '../extension/shared/checklist.js';
import { sanitizeSettings, DEFAULT_SETTINGS } from '../extension/shared/settings.js';

test('parseChecklistLine recognises open and done items with optional bullets', () => {
  assert.deepEqual(parseChecklistLine('[ ] milk'), { prefix: '', checked: false, body: 'milk', markerEnd: 3 });
  assert.deepEqual(parseChecklistLine('[] milk'), { prefix: '', checked: false, body: 'milk', markerEnd: 2 });
  assert.equal(parseChecklistLine('[x] milk').checked, true);
  assert.equal(parseChecklistLine('[X] milk').checked, true);
  assert.deepEqual(parseChecklistLine('- [ ] milk'), { prefix: '- ', checked: false, body: 'milk', markerEnd: 5 });
  assert.deepEqual(parseChecklistLine('  * [x] milk'), { prefix: '  * ', checked: true, body: 'milk', markerEnd: 7 });
  assert.equal(parseChecklistLine('[ ]').body, '');
});

test('parseChecklistLine ignores markers that are not at the start or not separated', () => {
  assert.equal(parseChecklistLine('a [ ] b'), null);
  assert.equal(parseChecklistLine('[ ]a'), null);
  assert.equal(parseChecklistLine('[y] a'), null);
  assert.equal(parseChecklistLine('plain text'), null);
});

test('hasChecklist and checklistProgress', () => {
  const text = 'Before renewing:\n[x] ask about invoice\n[ ] check seats\n- [ ] confirm plan';
  assert.equal(hasChecklist(text), true);
  assert.equal(hasChecklist('nothing here'), false);
  assert.deepEqual(checklistProgress(text), { done: 1, total: 3 });
  assert.deepEqual(checklistProgress('plain'), { done: 0, total: 0 });
});

test('toggleChecklistItem flips only the given line and keeps prefixes', () => {
  const text = 'title\n- [ ] one\n[X] two\n[] three';
  assert.equal(toggleChecklistItem(text, 1), 'title\n- [x] one\n[X] two\n[] three');
  assert.equal(toggleChecklistItem(text, 2), 'title\n- [ ] one\n[ ] two\n[] three');
  assert.equal(toggleChecklistItem(text, 3), 'title\n- [ ] one\n[X] two\n[x] three');
  assert.equal(toggleChecklistItem(text, 0), null);
  assert.equal(toggleChecklistItem(text, 9), null);
  assert.equal(toggleChecklistItem(text, -1), null);
});

test('continueChecklist adds a new item, ends the list on an empty item, and ignores plain lines', () => {
  const value = '- [ ] milk';
  assert.deepEqual(continueChecklist(value, value.length), { start: value.length, end: value.length, insert: '\n- [ ] ', caret: value.length + 7 });
  // Caret in the middle: the tail moves to the new item.
  const mid = continueChecklist('[ ] milk and eggs', 8);
  assert.deepEqual(mid, { start: 8, end: 8, insert: '\n[ ] ', caret: 13 });
  // Empty item ends the list and keeps the bullet.
  assert.deepEqual(continueChecklist('- [ ] ', 6), { start: 0, end: 6, insert: '- ', caret: 2 });
  assert.equal(continueChecklist('plain\nline', 8), null);
});

test('toggleMarkerAtCaret adds and removes the marker on the caret line', () => {
  assert.deepEqual(toggleMarkerAtCaret('', 0), { start: 0, end: 0, insert: '[ ] ', caret: 4 });
  assert.deepEqual(toggleMarkerAtCaret('  hello', 4), { start: 2, end: 2, insert: '[ ] ', caret: 8 });
  assert.deepEqual(toggleMarkerAtCaret('[ ] hello', 6), { start: 0, end: 4, insert: '', caret: 2 });
  assert.deepEqual(toggleMarkerAtCaret('- [x] hello', 8), { start: 2, end: 6, insert: '', caret: 4 });
  const two = toggleMarkerAtCaret('one\ntwo', 5);
  assert.deepEqual(two, { start: 4, end: 4, insert: '[ ] ', caret: 9 });
});

test('isNewlineKey only matches a plain newline for the active submit setting', () => {
  const modEnter = (e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey);
  const enter = (e) => e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey;
  const key = (extra) => ({ key: 'Enter', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, isComposing: false, ...extra });
  assert.equal(isNewlineKey(key({}), modEnter), true);
  assert.equal(isNewlineKey(key({ shiftKey: true }), modEnter), true);
  assert.equal(isNewlineKey(key({ metaKey: true }), modEnter), false);
  assert.equal(isNewlineKey(key({}), enter), false);
  assert.equal(isNewlineKey(key({ shiftKey: true }), enter), true);
  assert.equal(isNewlineKey(key({ altKey: true }), enter), false);
  assert.equal(isNewlineKey({ key: 'a' }, enter), false);
});

test('checklists setting defaults on and only accepts booleans', () => {
  assert.equal(DEFAULT_SETTINGS.checklists, true);
  assert.equal(sanitizeSettings({ checklists: false }).checklists, false);
  assert.equal(sanitizeSettings({ checklists: 'no' }).checklists, true);
});
