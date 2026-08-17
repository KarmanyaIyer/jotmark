// Note storage for Jotmark, backed by chrome.storage.local.
//
// Layout (one storage entry per site or page, so opening the popup on a site
// reads exactly two keys):
//   "d:<domain key>"  -> Note[]   notes for a whole domain
//   "p:<page key>"    -> Note[]   notes for one page
//   "settings"        -> object   user preferences (see settings.js)
//   "scopeMemory"     -> object   last used scope per domain
//
// Note = { id, text, createdAt, updatedAt }  timestamps are epoch milliseconds.
//
// The storage area is injected so tests can pass an in-memory fake.

export const SCOPES = Object.freeze(['domain', 'page']);
const PREFIX = { domain: 'd:', page: 'p:' };
const SCOPE_MEMORY_KEY = 'scopeMemory';
const SCOPE_MEMORY_LIMIT = 300;
export const EXPORT_SCHEMA = 1;
export const MAX_NOTE_LENGTH = 20000;

export function storageKey(scope, key) {
  if (!PREFIX[scope]) throw new Error(`Unknown scope: ${scope}`);
  return PREFIX[scope] + key;
}

export function parseStorageKey(storageKeyName) {
  if (storageKeyName.startsWith(PREFIX.domain)) {
    return { scope: 'domain', key: storageKeyName.slice(PREFIX.domain.length) };
  }
  if (storageKeyName.startsWith(PREFIX.page)) {
    return { scope: 'page', key: storageKeyName.slice(PREFIX.page.length) };
  }
  return null;
}

function newId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'n_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

function cleanText(text) {
  const value = String(text ?? '').replace(/\r\n?/g, '\n');
  return value.length > MAX_NOTE_LENGTH ? value.slice(0, MAX_NOTE_LENGTH) : value;
}

// Largest value Date can represent. Anything outside this range would throw
// in toISOString and Intl formatting, so such notes are treated as invalid.
const MAX_TIMESTAMP = 8.64e15;

function isValidTimestamp(value) {
  return Number.isFinite(value) && value > 0 && value <= MAX_TIMESTAMP;
}

function isValidNote(note) {
  return (
    note &&
    typeof note === 'object' &&
    typeof note.id === 'string' &&
    typeof note.text === 'string' &&
    isValidTimestamp(note.createdAt) &&
    isValidTimestamp(note.updatedAt)
  );
}

export class ImportError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ImportError';
    this.code = code; // "invalid" (bad file) or "write" (storage failed)
  }
}

export function createStore(area = globalThis.chrome?.storage?.local) {
  if (!area) throw new Error('No storage area available');

  function cleanList(value) {
    return Array.isArray(value) ? value.filter(isValidNote) : [];
  }

  async function readList(scope, key) {
    const sk = storageKey(scope, key);
    const result = await area.get(sk);
    return cleanList(result[sk]);
  }

  async function writeList(scope, key, list) {
    const sk = storageKey(scope, key);
    if (list.length === 0) {
      await area.remove(sk);
    } else {
      await area.set({ [sk]: list });
    }
  }

  return {
    async getNotes(scope, key) {
      return readList(scope, key);
    },

    // Reads both scopes for the current tab in one round trip.
    async getNotesForSite(domainKey, pageKey) {
      const dk = storageKey('domain', domainKey);
      const pk = storageKey('page', pageKey);
      const result = await area.get([dk, pk]);
      return { domain: cleanList(result[dk]), page: cleanList(result[pk]) };
    },

    async addNote(scope, key, text) {
      const body = cleanText(text);
      if (!body.trim()) throw new Error('Note is empty');
      const now = Date.now();
      const note = { id: newId(), text: body, createdAt: now, updatedAt: now };
      const list = await readList(scope, key);
      list.push(note);
      await writeList(scope, key, list);
      return note;
    },

    async updateNote(scope, key, id, text) {
      const body = cleanText(text);
      if (!body.trim()) throw new Error('Note is empty');
      const list = await readList(scope, key);
      const index = list.findIndex((n) => n.id === id);
      if (index === -1) return null;
      const updated = { ...list[index], text: body, updatedAt: Date.now() };
      list[index] = updated;
      await writeList(scope, key, list);
      return updated;
    },

    async deleteNote(scope, key, id) {
      const list = await readList(scope, key);
      const next = list.filter((n) => n.id !== id);
      if (next.length === list.length) return false;
      await writeList(scope, key, next);
      return true;
    },

    // Puts a previously deleted note back with its original id and timestamps.
    async restoreNote(scope, key, note) {
      if (!isValidNote(note)) throw new Error('Not a note');
      const list = await readList(scope, key);
      if (list.some((n) => n.id === note.id)) return list;
      list.push({ id: note.id, text: note.text, createdAt: note.createdAt, updatedAt: note.updatedAt });
      list.sort((a, b) => a.createdAt - b.createdAt);
      await writeList(scope, key, list);
      return list;
    },

    // Every note in storage, grouped by the key it is filed under.
    async getAllGroups() {
      const everything = await area.get(null);
      const groups = [];
      for (const [name, value] of Object.entries(everything)) {
        const parsed = parseStorageKey(name);
        if (!parsed || !Array.isArray(value)) continue;
        const notes = value.filter(isValidNote);
        if (notes.length) groups.push({ ...parsed, notes });
      }
      return groups;
    },

    async countAll() {
      const groups = await this.getAllGroups();
      return groups.reduce((sum, g) => sum + g.notes.length, 0);
    },

    async exportData() {
      const groups = await this.getAllGroups();
      const notes = [];
      for (const group of groups) {
        for (const note of group.notes) {
          notes.push({ scope: group.scope, key: group.key, ...note });
        }
      }
      notes.sort((a, b) => a.createdAt - b.createdAt);
      return { app: 'jotmark', schema: EXPORT_SCHEMA, exportedAt: Date.now(), notes };
    },

    // mode "merge" keeps existing notes, adds unknown ones, and takes the
    // imported copy of a note when it was updated more recently.
    // mode "replace" removes every note that is not in the file.
    // Nothing is written until the whole file has been validated, so a bad
    // file cannot destroy existing notes.
    async importData(payload, mode = 'merge') {
      if (!payload || typeof payload !== 'object' || payload.app !== 'jotmark' || !Array.isArray(payload.notes)) {
        throw new ImportError('Not a Jotmark export file', 'invalid');
      }

      const byKey = new Map();
      let skipped = 0;
      for (const raw of payload.notes) {
        if (!raw || !SCOPES.includes(raw.scope) || typeof raw.key !== 'string' || !raw.key) {
          skipped += 1;
          continue;
        }
        const text = cleanText(raw.text);
        if (!text.trim()) {
          skipped += 1;
          continue;
        }
        const createdAt = isValidTimestamp(raw.createdAt) ? raw.createdAt : Date.now();
        const note = {
          id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
          text,
          createdAt,
          updatedAt: isValidTimestamp(raw.updatedAt) ? raw.updatedAt : createdAt,
        };
        const sk = storageKey(raw.scope, raw.key);
        if (!byKey.has(sk)) byKey.set(sk, []);
        byKey.get(sk).push(note);
      }

      if (mode === 'replace' && byKey.size === 0) {
        throw new ImportError('The file contains no notes, so nothing was replaced', 'invalid');
      }

      const existing = mode === 'replace' ? {} : await area.get([...byKey.keys()]);
      const writes = {};
      let added = 0;
      let updated = 0;
      for (const [sk, incoming] of byKey) {
        const current = cleanList(existing[sk]);
        const merged = new Map(current.map((n) => [n.id, n]));
        for (const note of incoming) {
          const known = merged.get(note.id);
          if (!known) {
            merged.set(note.id, note);
            added += 1;
          } else if (note.updatedAt > known.updatedAt) {
            merged.set(note.id, note);
            updated += 1;
          } else {
            skipped += 1;
          }
        }
        writes[sk] = [...merged.values()].sort((a, b) => a.createdAt - b.createdAt);
      }

      try {
        if (Object.keys(writes).length) await area.set(writes);
        if (mode === 'replace') {
          const everything = await area.get(null);
          const stale = Object.keys(everything).filter((k) => parseStorageKey(k) && !(k in writes));
          if (stale.length) await area.remove(stale);
        }
      } catch (error) {
        throw new ImportError(`Could not write to storage: ${error.message}`, 'write');
      }
      return { added, updated, skipped };
    },

    async clearNotes() {
      const everything = await area.get(null);
      const keys = Object.keys(everything).filter((k) => parseStorageKey(k));
      if (keys.length) await area.remove(keys);
      return keys.length;
    },

    async getBytesInUse() {
      if (typeof area.getBytesInUse === 'function') {
        return area.getBytesInUse(null);
      }
      const everything = await area.get(null);
      return new TextEncoder().encode(JSON.stringify(everything)).length;
    },

    async getRememberedScope(domainKey) {
      const result = await area.get(SCOPE_MEMORY_KEY);
      const memory = result[SCOPE_MEMORY_KEY];
      const scope = memory && memory[domainKey];
      return SCOPES.includes(scope) ? scope : null;
    },

    async rememberScope(domainKey, scope) {
      if (!SCOPES.includes(scope)) return;
      const result = await area.get(SCOPE_MEMORY_KEY);
      const memory = { ...(result[SCOPE_MEMORY_KEY] || {}) };
      delete memory[domainKey];
      memory[domainKey] = scope;
      const keys = Object.keys(memory);
      if (keys.length > SCOPE_MEMORY_LIMIT) {
        for (const stale of keys.slice(0, keys.length - SCOPE_MEMORY_LIMIT)) delete memory[stale];
      }
      await area.set({ [SCOPE_MEMORY_KEY]: memory });
    },
  };
}

// In-memory storage area with the same shape as chrome.storage.local.
// Used by the unit tests.
export function createMemoryArea(initial = {}) {
  const data = structuredClone(initial);
  return {
    async get(keys) {
      if (keys === null || keys === undefined) return structuredClone(data);
      const list = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of list) if (k in data) out[k] = structuredClone(data[k]);
      return out;
    },
    async set(items) {
      for (const [k, v] of Object.entries(items)) data[k] = structuredClone(v);
    },
    async remove(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
    },
    async clear() {
      for (const k of Object.keys(data)) delete data[k];
    },
    async getBytesInUse() {
      return new TextEncoder().encode(JSON.stringify(data)).length;
    },
    _dump() {
      return structuredClone(data);
    },
  };
}
