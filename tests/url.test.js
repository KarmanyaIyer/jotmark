import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeUrl, domainKey, pageKey, registrableDomain, labelForKey } from '../extension/shared/url.js';

test('domainKey strips www and lowercases', () => {
  assert.equal(domainKey('www.GitHub.com'), 'github.com');
  assert.equal(domainKey('www2.example.org'), 'example.org');
  assert.equal(domainKey('docs.example.com'), 'docs.example.com');
});

test('domainKey groups subdomains when asked', () => {
  const opts = { ignoreQuery: false, keepFragment: false, groupSubdomains: true };
  assert.equal(domainKey('docs.example.com', opts), 'example.com');
  assert.equal(domainKey('a.b.example.co.uk', opts), 'example.co.uk');
  assert.equal(domainKey('alice.github.io', opts), 'alice.github.io');
  assert.equal(domainKey('localhost', opts), 'localhost');
  assert.equal(domainKey('127.0.0.1', opts), '127.0.0.1');
});

test('registrableDomain handles common suffixes', () => {
  assert.equal(registrableDomain('news.bbc.co.uk'), 'bbc.co.uk');
  assert.equal(registrableDomain('shop.example.com.au'), 'example.com.au');
  assert.equal(registrableDomain('example.com'), 'example.com');
});

test('pageKey normalizes trailing slash, hash, tracking params and param order', () => {
  assert.equal(pageKey('https://Example.com/docs/'), 'https://example.com/docs');
  assert.equal(pageKey('https://example.com/'), 'https://example.com/');
  assert.equal(pageKey('https://example.com/a#section'), 'https://example.com/a');
  assert.equal(
    pageKey('https://example.com/a?utm_source=x&b=2&a=1&fbclid=abc'),
    'https://example.com/a?a=1&b=2',
  );
  assert.equal(pageKey('https://www.example.com/a?b=2&a=1'), pageKey('https://example.com/a?a=1&b=2'));
});

test('pageKey respects ignoreQuery and keepFragment', () => {
  const ignore = { ignoreQuery: true, keepFragment: false, groupSubdomains: false };
  assert.equal(pageKey('https://example.com/a?x=1', ignore), 'https://example.com/a');
  const keep = { ignoreQuery: false, keepFragment: true, groupSubdomains: false };
  assert.equal(pageKey('https://example.com/a#top', keep), 'https://example.com/a#top');
});

test('pageKey sorts repeated params by value too', () => {
  assert.equal(pageKey('https://example.com/a?x=2&x=1'), pageKey('https://example.com/a?x=1&x=2'));
});

test('describeUrl shows the fragment only when it is part of the key', () => {
  const keep = { ignoreQuery: false, keepFragment: true, groupSubdomains: false };
  const info = describeUrl('https://x.com/app#/inbox?c=2', keep);
  assert.equal(info.pageKey, 'https://x.com/app#/inbox?c=2');
  assert.equal(info.displayPath, '/app#/inbox?c=2');
  const drop = describeUrl('https://x.com/app#/inbox?c=2');
  assert.equal(drop.displayPath, '/app');
});

test('pageKey keeps ports and non tracking params', () => {
  assert.equal(pageKey('http://localhost:3000/app?tab=2'), 'http://localhost:3000/app?tab=2');
  assert.equal(pageKey('https://youtube.com/watch?v=abc'), 'https://youtube.com/watch?v=abc');
});

test('describeUrl rejects unsupported urls', () => {
  assert.equal(describeUrl('').supported, false);
  assert.equal(describeUrl('chrome://extensions').supported, false);
  assert.equal(describeUrl('chrome://extensions').reason, 'protocol');
  assert.equal(describeUrl('file:///tmp/a.html').supported, false);
  assert.equal(describeUrl('about:blank').supported, false);
  assert.equal(describeUrl('not a url').supported, false);
});

test('describeUrl returns keys and a readable path', () => {
  const info = describeUrl('https://www.github.com/settings/keys?tab=ssh#x');
  assert.equal(info.supported, true);
  assert.equal(info.host, 'github.com');
  assert.equal(info.domainKey, 'github.com');
  assert.equal(info.pageKey, 'https://github.com/settings/keys?tab=ssh');
  assert.equal(info.displayPath, '/settings/keys?tab=ssh');
  const root = describeUrl('https://example.com');
  assert.equal(root.displayPath, '/');
  const encoded = describeUrl('https://en.wikipedia.org/wiki/Caf%C3%A9');
  assert.equal(encoded.displayPath, '/wiki/Café');
});

test('labelForKey hides protocol for pages', () => {
  assert.equal(labelForKey('domain', 'github.com'), 'github.com');
  assert.equal(labelForKey('page', 'https://github.com/a'), 'github.com/a');
});
