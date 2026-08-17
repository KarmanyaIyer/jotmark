// Renders the Chrome Web Store screenshots (1280x800) and promo tiles
// (440x280 and 1400x560) into store/. Uses the real extension in headless
// Chrome for the UI captures, then composes each frame from HTML.
// Usage: node scripts/screenshots.mjs

import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { launchWithExtension, openPopupFor, openOptions, sleep, ROOT, EXTENSION_DIR } from './lib/browser.mjs';

const OUT = path.join(ROOT, 'store');
const SHOTS = path.join(OUT, 'screenshots');
mkdirSync(SHOTS, { recursive: true });

const iconSvg = readFileSync(path.join(EXTENSION_DIR, 'icons', 'icon.svg'), 'utf8');
const iconData = `data:image/svg+xml;utf8,${encodeURIComponent(iconSvg)}`;
// Inverted mark for use on the yellow backgrounds of the store frames.
const iconDarkSvg = iconSvg
  .replace(/(<rect[^>]*?)fill="#111111"/g, '$1fill="#FFE34D"')
  .replace('fill="#FFE34D"/>', 'fill="#111111"/>')
  .replace('fill="#D9B93A"', 'fill="#3a3a3a"');
const iconDarkData = `data:image/svg+xml;utf8,${encodeURIComponent(iconDarkSvg)}`;
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

// Demo content. Nothing personal, nothing real.
function seedNotes(now) {
  return [
    ['domain', 'github.com', 'Rate limit is 60 requests an hour without a token. Docs live under /rest.', now - 2 * HOUR],
    ['domain', 'github.com', 'Ask about the invoice before renewing the org plan.', now - 26 * HOUR],
    ['domain', 'github.com', 'Release checklist:\n[x] tag the release\n[ ] update the changelog\n[ ] announcement post', now - 4 * DAY],
    ['page', 'https://github.com/settings/keys', 'Rotate the deploy key in September. The old one expires on the 30th.', now - 3 * DAY],
    ['page', 'https://github.com/settings/keys', 'Read only key is fine for the docs site.', now - 9 * DAY],
    ['domain', 'developer.mozilla.org', 'Prefer the "Syntax" section over the examples for edge cases.', now - 5 * DAY],
    ['page', 'https://developer.mozilla.org/en-US/docs/Web/API/URL', 'searchParams keeps insertion order. Sort before comparing.', now - 6 * DAY],
    ['domain', 'news.ycombinator.com', 'Good thread on SQLite WAL tuning, saved for the migration.', now - 12 * DAY],
    ['domain', 'stripe.com', 'Test cards: 4242 for success, 0002 for a decline.', now - 20 * DAY],
    ['page', 'https://stripe.com/docs/webhooks', 'Verify signatures with the raw body, not the parsed JSON.', now - 21 * DAY],
  ];
}

const { browser, extensionId } = await launchWithExtension({ headless: true });
try {
  // Seed storage through the popup page context.
  const seedPage = await openPopupFor(browser, extensionId, 'https://github.com/settings/keys');
  await seedPage.evaluate(async (rows) => {
    await chrome.storage.local.clear();
    const { createStore } = await import(chrome.runtime.getURL('shared/storage.js'));
    const store = createStore();
    await store.importData({ app: 'jotmark', notes: rows.map(([scope, key, text, t], i) => ({ scope, key, id: `demo${i}`, text, createdAt: t, updatedAt: t })) });
  }, seedNotes(Date.now()));
  await seedPage.close();

  const captures = {};

  // Popup, domain scope, light
  let popup = await openPopupFor(browser, extensionId, 'https://github.com/settings/keys');
  await sleep(150);
  captures.popupDomain = await shotElement(popup, '#app');
  // Popup, page scope
  await popup.evaluate(() => document.getElementById('scope-page').click());
  await sleep(150);
  captures.popupPage = await shotElement(popup, '#app');
  await popup.close();

  // Popup, dark, pink accent, serif
  popup = await openPopupFor(browser, extensionId, 'https://github.com/settings/keys', { colorScheme: 'dark' });
  await popup.evaluate(async () => {
    const { saveSettings } = await import(chrome.runtime.getURL('shared/settings.js'));
    await saveSettings({ theme: 'dark', accent: 'pink', noteFont: 'serif' });
  });
  await sleep(200);
  captures.popupDark = await shotElement(popup, '#app');
  await popup.evaluate(async () => {
    const { resetSettings } = await import(chrome.runtime.getURL('shared/settings.js'));
    await resetSettings();
  });
  await popup.close();

  // Options: all notes with a search
  const options = await openOptions(browser, extensionId, '#notes', { width: 1180, height: 760 });
  await options.type('#search', 'key');
  await sleep(250);
  captures.allNotesSearch = await options.screenshot({ encoding: 'base64' });
  await options.close();

  // Compose the frames.
  const composer = await browser.newPage();
  await composer.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });

  const frames = [
    {
      file: '01-popup.png',
      title: 'Notes that stay with the site',
      body: 'Open Jotmark on any website and pick up where you left off. Every note is timestamped, and [ ] lines become checklists.',
      html: browserMock({ url: 'github.com/settings/keys', popup: captures.popupDomain }),
    },
    {
      file: '02-scopes.png',
      title: 'The whole domain, or just this page',
      body: 'Switch scopes with one click. The counts show where you have already written something.',
      html: browserMock({ url: 'github.com/settings/keys', popup: captures.popupPage }),
    },
    {
      file: '03-all-notes.png',
      title: 'Everything you wrote, in one place',
      body: 'Search across notes and sites, edit or delete from the list, and jump back to the page.',
      html: browserMock({ url: 'All notes', page: captures.allNotesSearch, wide: true }),
      wide: true,
    },
    {
      file: '04-appearance.png',
      title: 'Light, dark, and five marker colors',
      body: 'Font size, note font, density, keyboard behavior, and how page addresses are matched.',
      html: browserMock({ url: 'github.com/settings/keys', popup: captures.popupDark, dark: true }),
    },
    {
      file: '05-private.png',
      title: 'Local only',
      body: 'No account, no server, no tracking. Two permissions: activeTab and storage. Export as JSON any time.',
      html: privacyPanel(),
      stageTop: 214,
    },
  ];

  for (const frame of frames) {
    await composer.setContent(frameHtml(frame), { waitUntil: 'load' });
    await sleep(80);
    const file = path.join(SHOTS, frame.file);
    await composer.screenshot({ path: file, clip: { x: 0, y: 0, width: 1280, height: 800 } });
    console.log('wrote', path.relative(ROOT, file));
  }

  // Promo tiles
  await composer.setViewport({ width: 440, height: 280, deviceScaleFactor: 1 });
  await composer.setContent(promoHtml(440, 280, captures.popupDomain), { waitUntil: 'load' });
  await sleep(80);
  await composer.screenshot({ path: path.join(OUT, 'promo-small-440x280.png'), clip: { x: 0, y: 0, width: 440, height: 280 } });
  console.log('wrote store/promo-small-440x280.png');

  await composer.setViewport({ width: 1400, height: 560, deviceScaleFactor: 1 });
  await composer.setContent(promoHtml(1400, 560, captures.popupDomain), { waitUntil: 'load' });
  await sleep(80);
  await composer.screenshot({ path: path.join(OUT, 'promo-marquee-1400x560.png'), clip: { x: 0, y: 0, width: 1400, height: 560 } });
  console.log('wrote store/promo-marquee-1400x560.png');

} finally {
  await browser.close();
}

async function shotElement(page, selector) {
  const el = await page.$(selector);
  return el.screenshot({ encoding: 'base64' });
}

function frameHtml({ title, body, html, wide, stageTop = 90 }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; }
    body { width: 1280px; height: 800px; overflow: hidden; background: #ffe34d; font-family: ${FONT}; color: #111; -webkit-font-smoothing: antialiased; }
    .canvas { position: relative; width: 1280px; height: 800px; }
    .brand { position: absolute; left: 72px; top: 56px; display: flex; align-items: center; gap: 12px; font-weight: 700; font-size: 22px; letter-spacing: -0.01em; }
    .brand img { width: 30px; height: 30px; }
    .copy { position: absolute; left: 72px; top: ${wide ? 130 : 250}px; width: ${wide ? 1136 : 440}px; }
    .copy h1 { margin: 0 0 16px; font-size: ${wide ? 40 : 46}px; line-height: 1.08; font-weight: 700; letter-spacing: -0.025em; }
    .copy p { margin: 0; font-size: 20px; line-height: 1.45; color: rgba(17, 17, 17, 0.78); max-width: ${wide ? 760 : 420}px; }
    .stage { position: absolute; ${wide ? 'left: 72px; top: 268px;' : `left: 560px; top: ${stageTop}px;`} }
  </style></head><body><div class="canvas">
    <div class="brand"><img src="${iconDarkData}" alt=""><span>Jotmark</span></div>
    <div class="copy"><h1>${title}</h1><p>${body}</p></div>
    <div class="stage">${html}</div>
  </div></body></html>`;
}

// A neutral browser window with the extension icon active in the toolbar and
// the popup hanging under it. The "page" is a plain placeholder so no real
// site content appears.
function browserMock({ url, popup, page, dark = false, wide = false }) {
  const w = wide ? 1136 : 660;
  const h = wide ? 600 : 640;
  const chromeBg = dark ? '#202124' : '#f1f3f4';
  const barBg = dark ? '#35363a' : '#ffffff';
  const text = dark ? '#e8eaed' : '#3c4043';
  const pageBg = dark ? '#1c1d21' : '#ffffff';
  const placeholder = dark ? '#2a2c31' : '#eceff1';
  const popupImg = popup ? `<img class="popup" src="data:image/png;base64,${popup}" alt="">` : '';
  const pageImg = page ? `<img class="pageimg" src="data:image/png;base64,${page}" alt="">` : `
      <div class="ph" style="width:46%;height:22px;margin:34px 0 0 40px"></div>
      <div class="ph" style="width:70%;height:12px;margin:18px 0 0 40px"></div>
      <div class="ph" style="width:64%;height:12px;margin:10px 0 0 40px"></div>
      <div class="ph" style="width:52%;height:12px;margin:10px 0 0 40px"></div>
      <div class="ph" style="width:38%;height:120px;margin:28px 0 0 40px;border-radius:8px"></div>
      <div class="ph" style="width:66%;height:12px;margin:28px 0 0 40px"></div>
      <div class="ph" style="width:58%;height:12px;margin:10px 0 0 40px"></div>`;
  return `<style>
    .win { position: relative; width: ${w}px; height: ${h}px; background: ${pageBg}; border-radius: 12px; overflow: hidden; box-shadow: 0 30px 60px rgba(0,0,0,0.22), 0 2px 6px rgba(0,0,0,0.12); font-family: ${FONT}; }
    .tabs { height: 40px; background: ${chromeBg}; display: flex; align-items: flex-end; padding: 0 12px; }
    .dots { display: flex; gap: 8px; margin: 0 14px 13px 4px; }
    .dots i { width: 12px; height: 12px; border-radius: 50%; display: block; }
    .tab { height: 30px; padding: 0 16px; background: ${barBg}; border-radius: 8px 8px 0 0; display: flex; align-items: center; gap: 8px; font-size: 12px; color: ${text}; }
    .tab img { width: 14px; height: 14px; }
    .bar { height: 44px; background: ${barBg}; display: flex; align-items: center; gap: 12px; padding: 0 12px; border-bottom: 1px solid ${dark ? '#3c4043' : '#dadce0'}; }
    .nav { display: flex; gap: 10px; color: ${dark ? '#9aa0a6' : '#5f6368'}; font-size: 16px; }
    .omni { flex: 1; height: 30px; border-radius: 15px; background: ${chromeBg}; display: flex; align-items: center; padding: 0 14px; font-size: 13px; color: ${text}; }
    .ext { width: 30px; height: 30px; border-radius: 6px; display: grid; place-items: center; background: ${dark ? '#3c4043' : '#e8eaed'}; }
    .ext img { width: 18px; height: 18px; }
    .avatar { width: 26px; height: 26px; border-radius: 50%; background: ${dark ? '#5f6368' : '#c7c9cc'}; }
    .page { position: absolute; top: 84px; left: 0; right: 0; bottom: 0; }
    .ph { background: ${placeholder}; border-radius: 4px; }
    .pageimg { display: block; width: ${w}px; }
    .popup { position: absolute; top: 88px; right: 52px; width: 380px; border-radius: 6px; box-shadow: 0 12px 30px rgba(0,0,0,0.35), 0 0 0 1px ${dark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.08)'}; }
  </style>
  <div class="win">
    <div class="tabs"><div class="dots"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div><div class="tab">${page ? `<img src="${iconData}" alt="">` : ''}<span>${url}</span></div></div>
    <div class="bar"><div class="nav"><span>&#8592;</span><span>&#8594;</span><span>&#8635;</span></div><div class="omni">${page ? `chrome-extension://.../options.html` : `https://${url}`}</div><div class="ext"><img src="${iconData}" alt=""></div><div class="avatar"></div></div>
    <div class="page">${pageImg}</div>
    ${popupImg}
  </div>`;
}

function privacyPanel() {
  const rows = [
    ['activeTab', 'Read the address of the tab you clicked on. Nothing else.'],
    ['storage', 'Keep notes and settings in chrome.storage.local.'],
  ];
  const nots = ['No content scripts', 'No host permissions', 'No background worker', 'No network requests', 'No analytics'];
  return `<style>
    .panel { width: 600px; background: #fff; border-radius: 12px; box-shadow: 0 30px 60px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.10); padding: 34px 38px; font-family: ${FONT}; color: #111; }
    .panel h2 { margin: 0 0 18px; font-size: 15px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: #6b6b6b; }
    .perm { display: flex; gap: 18px; align-items: flex-start; padding: 16px 0; border-top: 1px solid #e4e4e4; }
    .perm:first-of-type { border-top: 0; padding-top: 0; }
    .perm code { flex: 0 0 130px; font-family: ui-monospace, Menlo, monospace; font-size: 15px; background: #ffe34d; padding: 3px 8px; border-radius: 4px; }
    .perm p { margin: 0; font-size: 17px; line-height: 1.4; }
    .nots { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 26px; }
    .nots span { border: 1px solid #111; border-radius: 4px; padding: 6px 12px; font-size: 15px; font-weight: 500; }
    .manifest { margin-top: 26px; font-family: ui-monospace, Menlo, monospace; font-size: 14px; background: #f6f6f6; border-radius: 6px; padding: 14px 16px; color: #333; white-space: pre; }
  </style>
  <div class="panel">
    <h2>Permissions</h2>
    ${rows.map(([name, why]) => `<div class="perm"><code>${name}</code><p>${why}</p></div>`).join('')}
    <div class="nots">${nots.map((n) => `<span>${n}</span>`).join('')}</div>
    <div class="manifest">"permissions": ["activeTab", "storage"]</div>
  </div>`;
}

function promoHtml(width, height, popup) {
  const small = width < 800;
  const scale = small ? 0.62 : 1;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; }
    body { width: ${width}px; height: ${height}px; overflow: hidden; background: #ffe34d; font-family: ${FONT}; color: #111; -webkit-font-smoothing: antialiased; position: relative; }
    .brand { position: absolute; left: ${small ? 28 : 90}px; top: ${small ? 34 : 120}px; display: flex; align-items: center; gap: ${small ? 12 : 22}px; }
    .brand img { width: ${small ? 52 : 110}px; height: ${small ? 52 : 110}px; }
    .brand span { font-size: ${small ? 40 : 84}px; font-weight: 700; letter-spacing: -0.03em; }
    .tag { position: absolute; left: ${small ? 28 : 90}px; top: ${small ? 104 : 262}px; font-size: ${small ? 18 : 34}px; font-weight: 500; color: rgba(17,17,17,0.8); }
    .popup { position: absolute; right: ${small ? -60 : 110}px; top: ${small ? 150 : 60}px; width: 380px; transform: scale(${scale}); transform-origin: top left; border-radius: 6px; box-shadow: 0 16px 40px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.08); }
  </style></head><body>
    <div class="brand"><img src="${iconDarkData}" alt=""><span>Jotmark</span></div>
    <div class="tag">Notes for every website</div>
    <img class="popup" src="data:image/png;base64,${popup}" alt="">
  </body></html>`;
}
