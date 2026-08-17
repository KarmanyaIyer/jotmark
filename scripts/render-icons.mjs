// Renders extension/icons/icon.svg to the PNG sizes Chrome needs.
// Usage: node scripts/render-icons.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { EXTENSION_DIR, findChrome, ROOT } from './lib/browser.mjs';

const SIZES = [16, 32, 48, 128];
const svg = readFileSync(path.join(EXTENSION_DIR, 'icons', 'icon.svg'), 'utf8');

const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true });
try {
  const page = await browser.newPage();
  for (const size of SIZES) {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    const html = `<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style></head><body>${svg}</body></html>`;
    await page.setContent(html, { waitUntil: 'load' });
    const out = path.join(EXTENSION_DIR, 'icons', `icon${size}.png`);
    await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    console.log('wrote', path.relative(ROOT, out));
  }
  // Store listing icon (128x128 is what the Chrome Web Store asks for).
  await page.setViewport({ width: 128, height: 128, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block;width:128px;height:128px}</style></head><body>${svg}</body></html>`);
  const storeIcon = path.join(ROOT, 'store', 'icon-128.png');
  await page.screenshot({ path: storeIcon, omitBackground: true, clip: { x: 0, y: 0, width: 128, height: 128 } });
  console.log('wrote', path.relative(ROOT, storeIcon));
} finally {
  await browser.close();
}
