import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, createMemoryArea, storageKey, parseStorageKey } from '../extension/shared/storage.js';
import { loadSettings, saveSettings, sanitizeSettings, DEFAULT_SETTINGS } from '../extension/shared/settings.js';

test('storage keys round trip', () => {
  assert.equal(storageKey('domain', 'github.com'), 'd:github.com');
  assert.equal(storageKey('page', 'https://a.com/x'), 'p:https://a.com/x');
  assert.deepEqual(parseStorageKey('d:github.com'), { scope: 'domain', key: 'github.com' });
  assert.deepEqual(parseStorageKey('p:https://a.com/x'), { scope: 'page', key: 'https://a.com/x' });
  assert.equal(parseStorageKey('settings'), null);
  assert.throws(() => storageKey('nope', 'x'));
});

test('add, read, update and delete notes', async () => {
  const store = createStore(createMemoryArea());
  const note = await store.addNote('domain', 'github.com', '  first note  ');
  assert.equal(note.text, '  first note  ');
  assert.ok(note.id);
  assert.ok(note.createdAt > 0);

  const list = await store.getNotes('domain', 'github.com');
  assert.equal(list.length, 1);
  assert.equal(list[0].id, note.id);

  const updated = await store.updateNote('domain', 'github.com', note.id, 'edited');
  assert.equal(updated.text, 'edited');
  assert.ok(updated.updatedAt >= note.updatedAt);
  assert.equal(await store.updateNote('domain', 'github.com', 'missing', 'x'), null);

  assert.equal(await store.deleteNote('domain', 'github.com', note.id), true);
  assert.equal(await store.deleteNote('domain', 'github.com', note.id), false);
  assert.deepEqual(await store.getNotes('domain', 'github.com'), []);
});

test('empty notes are rejected and line endings are normalised', async () => {
  const store = createStore(createMemoryArea());
  await assert.rejects(store.addNote('domain', 'a.com', '   \n '));
  const note = await store.addNote('page', 'https://a.com/x', 'a\r\nb');
  assert.equal(note.text, 'a\nb');
});

test('getNotesForSite reads both scopes and ignores garbage', async () => {
  const area = createMemoryArea({ 'd:a.com': [{ id: '1', text: 'x', createdAt: 1, updatedAt: 1 }, 'junk'] });
  const store = createStore(area);
  await store.addNote('page', 'https://a.com/p', 'page note');
  const both = await store.getNotesForSite('a.com', 'https://a.com/p');
  assert.equal(both.domain.length, 1);
  assert.equal(both.page.length, 1);
});

test('export and import merge and replace', async () => {
  const area = createMemoryArea();
  const store = createStore(area);
  await store.addNote('domain', 'a.com', 'one');
  await store.addNote('page', 'https://a.com/x', 'two');
  const dump = await store.exportData();
  assert.equal(dump.app, 'jotmark');
  assert.equal(dump.notes.length, 2);
  assert.equal(await store.countAll(), 2);

  // Merge into a store that already has one of the notes: it is skipped.
  const other = createStore(createMemoryArea());
  await other.importData({ app: 'jotmark', notes: [dump.notes[0]] });
  const result = await other.importData(dump, 'merge');
  assert.equal(result.added, 1);
  assert.equal(result.skipped, 1);
  assert.equal(await other.countAll(), 2);

  // Replace wipes first.
  await other.addNote('domain', 'b.com', 'extra');
  const replaced = await other.importData(dump, 'replace');
  assert.equal(replaced.added, 2);
  assert.equal(await other.countAll(), 2);

  // Bad payloads are rejected, bad rows are skipped.
  await assert.rejects(other.importData({ nope: true }));
  await assert.rejects(other.importData({ notes: [] }), /Jotmark export/);
  const bad = await other.importData({ app: 'jotmark', notes: [{ scope: 'zzz', key: 'a', text: 'x' }, { scope: 'domain', key: '', text: 'x' }, { scope: 'domain', key: 'c.com', text: '   ' }] });
  assert.equal(bad.added, 0);
  assert.equal(bad.skipped, 3);
});

test('merge import takes the newer copy of an edited note', async () => {
  const store = createStore(createMemoryArea());
  const note = await store.addNote('domain', 'a.com', 'original');
  const newer = { scope: 'domain', key: 'a.com', ...note, text: 'edited elsewhere', updatedAt: note.updatedAt + 5000 };
  const older = { scope: 'domain', key: 'a.com', ...note, text: 'stale', updatedAt: note.updatedAt - 5000 };
  const result = await store.importData({ app: 'jotmark', notes: [newer, older] }, 'merge');
  assert.equal(result.updated, 1);
  assert.equal(result.skipped, 1);
  assert.equal((await store.getNotes('domain', 'a.com'))[0].text, 'edited elsewhere');
});

test('replace import never wipes notes for a file with nothing usable', async () => {
  const store = createStore(createMemoryArea());
  await store.addNote('domain', 'a.com', 'keep me');
  await assert.rejects(store.importData({ app: 'jotmark', notes: ['junk', { foo: 1 }] }, 'replace'), /no notes/);
  await assert.rejects(store.importData({ notes: [{ scope: 'domain', key: 'b.com', text: 'x' }] }, 'replace'));
  assert.equal(await store.countAll(), 1);
});

test('replace import leaves nothing behind when storage fails', async () => {
  const area = createMemoryArea();
  const store = createStore(area);
  await store.addNote('domain', 'a.com', 'keep me');
  area.set = async () => { throw new Error('quota'); };
  await assert.rejects(store.importData({ app: 'jotmark', notes: [{ scope: 'domain', key: 'b.com', text: 'x' }] }, 'replace'), (e) => e.code === 'write');
  assert.equal(await store.countAll(), 1);
});

test('out of range timestamps are rejected or repaired', async () => {
  const area = createMemoryArea({ 'd:a.com': [{ id: 'x', text: 'bad', createdAt: 1e20, updatedAt: 1e20 }] });
  const store = createStore(area);
  assert.deepEqual(await store.getNotes('domain', 'a.com'), []);
  const before = Date.now();
  const result = await store.importData({ app: 'jotmark', notes: [{ scope: 'domain', key: 'b.com', text: 'ok', createdAt: 1e20, updatedAt: -5 }] });
  assert.equal(result.added, 1);
  const [note] = await store.getNotes('domain', 'b.com');
  assert.ok(note.createdAt >= before && note.createdAt <= 8.64e15);
  assert.equal(note.updatedAt, note.createdAt);
});

test('restoreNote puts a deleted note back in place once', async () => {
  const store = createStore(createMemoryArea());
  const a = await store.addNote('domain', 'a.com', 'first');
  await new Promise((resolve) => setTimeout(resolve, 3));
  const b = await store.addNote('domain', 'a.com', 'second');
  await store.deleteNote('domain', 'a.com', a.id);
  const list = await store.restoreNote('domain', 'a.com', a);
  assert.deepEqual(list.map((n) => n.id), [a.id, b.id]);
  const again = await store.restoreNote('domain', 'a.com', a);
  assert.equal(again.length, 2);
});

test('clearNotes leaves settings alone', async () => {
  const area = createMemoryArea();
  const store = createStore(area);
  await saveSettings({ theme: 'dark' }, area);
  await store.addNote('domain', 'a.com', 'x');
  const removed = await store.clearNotes();
  assert.equal(removed, 1);
  assert.equal(await store.countAll(), 0);
  assert.equal((await loadSettings(area)).theme, 'dark');
});

test('scope memory remembers per domain and is capped', async () => {
  const store = createStore(createMemoryArea());
  assert.equal(await store.getRememberedScope('a.com'), null);
  await store.rememberScope('a.com', 'page');
  assert.equal(await store.getRememberedScope('a.com'), 'page');
  await store.rememberScope('a.com', 'bogus');
  assert.equal(await store.getRememberedScope('a.com'), 'page');
  for (let i = 0; i < 320; i += 1) await store.rememberScope(`site${i}.com`, 'domain');
  assert.equal(await store.getRememberedScope('a.com'), null);
  assert.equal(await store.getRememberedScope('site319.com'), 'domain');
});

test('settings sanitise unknown values and keep known ones', () => {
  const s = sanitizeSettings({ theme: 'dark', accent: 'neon', confirmDelete: 'yes', extra: 1 });
  assert.equal(s.theme, 'dark');
  assert.equal(s.accent, DEFAULT_SETTINGS.accent);
  assert.equal(s.confirmDelete, DEFAULT_SETTINGS.confirmDelete);
  assert.equal('extra' in s, false);
});

test('settings save merges patches', async () => {
  const area = createMemoryArea();
  await saveSettings({ theme: 'light' }, area);
  const next = await saveSettings({ fontSize: 'large' }, area);
  assert.equal(next.theme, 'light');
  assert.equal(next.fontSize, 'large');
});
