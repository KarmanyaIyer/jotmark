// User settings: defaults, load and save, and applying appearance to a document.

export const SETTINGS_KEY = 'settings';

export const DEFAULT_SETTINGS = Object.freeze({
  // Appearance
  theme: 'system',            // system | light | dark
  accent: 'yellow',           // yellow | pink | green | blue | orange
  fontSize: 'medium',         // small | medium | large | xlarge
  noteFont: 'system',         // system | serif | mono
  density: 'comfortable',     // comfortable | compact
  // Behavior
  defaultScope: 'domain',     // domain | page
  rememberScope: true,        // reopen a site in the scope you last used there
  submitKey: 'mod-enter',     // mod-enter | enter
  sortOrder: 'newest',        // newest | oldest
  timeFormat: 'relative',     // relative | absolute
  clock: '12h',               // 12h | 24h
  confirmDelete: true,
  showPath: true,             // show the page path under the host in the popup header
  linkify: true,              // turn URLs inside notes into links
  checklists: true,           // "[ ]" at the start of a line becomes a checkbox
  // URL handling
  ignoreQuery: false,         // treat ?a=1 and ?a=2 as the same page
  keepFragment: false,        // treat #section-1 and #section-2 as different pages
  groupSubdomains: false,     // file docs.example.com under example.com
});

export const OPTION_VALUES = Object.freeze({
  theme: ['system', 'light', 'dark'],
  accent: ['yellow', 'pink', 'green', 'blue', 'orange'],
  fontSize: ['small', 'medium', 'large', 'xlarge'],
  noteFont: ['system', 'serif', 'mono'],
  density: ['comfortable', 'compact'],
  defaultScope: ['domain', 'page'],
  submitKey: ['mod-enter', 'enter'],
  sortOrder: ['newest', 'oldest'],
  timeFormat: ['relative', 'absolute'],
  clock: ['12h', '24h'],
});

// Drop unknown keys and invalid values so a bad import cannot break the UI.
export function sanitizeSettings(raw) {
  const out = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return out;
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (!(key in raw)) continue;
    const value = raw[key];
    if (key in OPTION_VALUES) {
      if (OPTION_VALUES[key].includes(value)) out[key] = value;
    } else if (typeof DEFAULT_SETTINGS[key] === 'boolean') {
      if (typeof value === 'boolean') out[key] = value;
    }
  }
  return out;
}

export async function loadSettings(area = globalThis.chrome?.storage?.local) {
  const result = await area.get(SETTINGS_KEY);
  return sanitizeSettings(result[SETTINGS_KEY]);
}

// Pass the caller's current settings as base to avoid a read before the write;
// otherwise the stored value is read first.
export async function saveSettings(patch, area = globalThis.chrome?.storage?.local, base = null) {
  const current = base || (await loadSettings(area));
  const next = sanitizeSettings({ ...current, ...patch });
  await area.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function resetSettings(area = globalThis.chrome?.storage?.local) {
  await area.remove(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS };
}

// Appearance is driven by data attributes on <html> so the CSS stays declarative.
export function applyAppearance(settings, doc = globalThis.document) {
  if (!doc) return;
  const root = doc.documentElement;
  root.dataset.theme = settings.theme;
  root.dataset.accent = settings.accent;
  root.dataset.fontSize = settings.fontSize;
  root.dataset.noteFont = settings.noteFont;
  root.dataset.density = settings.density;
}

// Watch for settings changes made in another extension page (popup vs options).
export function onSettingsChange(callback, storage = globalThis.chrome?.storage) {
  if (!storage || !storage.onChanged) return () => {};
  const handler = (changes, areaName) => {
    if (areaName !== 'local' || !changes[SETTINGS_KEY]) return;
    callback(sanitizeSettings(changes[SETTINGS_KEY].newValue));
  };
  storage.onChanged.addListener(handler);
  return () => storage.onChanged.removeListener(handler);
}
