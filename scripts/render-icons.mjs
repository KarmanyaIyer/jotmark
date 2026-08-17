// Renders extension/icons/icon.svg to the PNG sizes Chrome needs.
// Usage: node scripts/render-icons.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { EXTENSION_DIR, findChrome, ROOT } from './lib/browser.mjs';

const SIZES = [16, 32, 48, 128];
const master = readFileSync(path.join(EXTENSION_DIR, 'icons', 'icon.svg'), 'utf8');

// At 16 and 32 px the master artwork lands between pixel rows and the bars blur,
// so those sizes use hand tuned geometry: bars that are a whole number of pixels
// tall on whole pixel rows, and no folded corner at 16 px where it cannot be seen.
const SMALL = {
  16: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
  <rect x="0" y="0" width="16" height="16" rx="4" fill="#FFE34D"/>
  <rect x="3" y="4" width="9" height="2" rx="1" fill="#111111"/>
  <rect x="3" y="7" width="7" height="2" rx="1" fill="#111111"/>
  <rect x="3" y="10" width="5" height="2" rx="1" fill="#111111"/>
</svg>`,
  32: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <path d="M7 1h18a6 6 0 0 1 6 6v16l-8 8H7a6 6 0 0 1-6-6V7a6 6 0 0 1 6-6z" fill="#FFE34D"/>
  <path d="M31 23l-8 8v-6a2 2 0 0 1 2-2z" fill="#D9B93A"/>
  <rect x="7" y="8" width="17" height="3" rx="1.5" fill="#111111"/>
  <rect x="7" y="14" width="13" height="3" rx="1.5" fill="#111111"/>
  <rect x="7" y="20" width="9" height="3" rx="1.5" fill="#111111"/>
</svg>`,
};

function svgFor(size) {
  return SMALL[size] || master;
}

const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true });
try {
  const page = await browser.newPage();
  for (const size of SIZES) {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    const html = `<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style></head><body>${svgFor(size)}</body></html>`;
    await page.setContent(html, { waitUntil: 'load' });
    const out = path.join(EXTENSION_DIR, 'icons', `icon${size}.png`);
    await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    console.log('wrote', path.relative(ROOT, out));
  }
  // Store listing icon: the store asks for 96px of artwork centred on a
  // transparent 128px canvas.
  await page.setViewport({ width: 128, height: 128, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;background:transparent}body{display:grid;place-items:center;width:128px;height:128px}svg{display:block;width:96px;height:96px}</style></head><body>${master}</body></html>`);
  const storeIcon = path.join(ROOT, 'store', 'icon-128.png');
  await page.screenshot({ path: storeIcon, omitBackground: true, clip: { x: 0, y: 0, width: 128, height: 128 } });
  console.log('wrote', path.relative(ROOT, storeIcon));
} finally {
  await browser.close();
}
