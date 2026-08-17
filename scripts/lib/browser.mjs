// Shared helpers for scripts that drive the extension in a real Chrome.
// Uses puppeteer-core with a locally installed Chrome. No downloads.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const EXTENSION_DIR = path.join(ROOT, 'extension');

// Chrome computes the id of an unpacked extension from the absolute path:
// sha256(path) -> first 32 hex chars -> each hex digit mapped onto a..p.
export function unpackedExtensionId(dir = EXTENSION_DIR) {
  const hex = createHash('sha256').update(path.resolve(dir)).digest('hex').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode('a'.charCodeAt(0) + parseInt(c, 16))).join('');
}

export function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const candidates = [];
  const cacheDir = path.join(homedir(), '.cache', 'puppeteer', 'chrome');
  if (existsSync(cacheDir)) {
    for (const build of readdirSync(cacheDir).sort().reverse()) {
      candidates.push(path.join(cacheDir, build, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'));
      candidates.push(path.join(cacheDir, build, 'chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'));
      candidates.push(path.join(cacheDir, build, 'chrome-linux64', 'chrome'));
    }
  }
  candidates.push(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  );
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('No Chrome found. Set CHROME_PATH to a Chrome or Chromium binary.');
  return found;
}

export async function launchWithExtension({ headless = true, extraArgs = [] } = {}) {
  const executablePath = findChrome();
  const browser = await puppeteer.launch({
    executablePath,
    headless,
    defaultViewport: null,
    enableExtensions: true,
    args: ['--no-first-run', '--no-default-browser-check', '--hide-scrollbars', ...extraArgs],
  });
  // Puppeteer installs the unpacked extension over the devtools protocol and
  // hands back the id Chrome assigned, which matches unpackedExtensionId().
  const extensionId = await browser.installExtension(EXTENSION_DIR);
  return { browser, extensionId, executablePath };
}

// Opens popup.html in a normal tab and makes chrome.tabs.query report a fake
// active tab, so popup behaviour can be tested for any URL without a real site.
export async function openPopupFor(browser, extensionId, url, { width = 380, height = 600, colorScheme } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 2 });
  if (colorScheme) await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: colorScheme }]);
  await page.evaluateOnNewDocument((fakeUrl) => {
    const original = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = async (info) => {
      if (info && info.active) return [{ id: 1, url: fakeUrl, title: 'Test page', active: true }];
      return original(info);
    };
  }, url);
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: 'load' });
  await page.waitForSelector('html[data-ready]');
  return page;
}

export async function openOptions(browser, extensionId, hash = '', { width = 1100, height = 800, colorScheme } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 2 });
  if (colorScheme) await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: colorScheme }]);
  await page.goto(`chrome-extension://${extensionId}/options/options.html${hash}`, { waitUntil: 'load' });
  await page.waitForSelector('html[data-ready]');
  return page;
}

export async function clearStorage(page) {
  await page.evaluate(() => chrome.storage.local.clear());
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
