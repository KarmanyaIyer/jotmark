import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatRelative, formatBytes, splitLinks, splitMatches, pluralize } from '../extension/shared/format.js';

test('formatRelative buckets', () => {
  const now = new Date(2026, 7, 17, 15, 0, 0).getTime();
  assert.equal(formatRelative(now - 10 * 1000, now), 'just now');
  assert.equal(formatRelative(now - 5 * 60 * 1000, now), '5 min ago');
  assert.equal(formatRelative(now - 60 * 60 * 1000, now), '1 hour ago');
  assert.equal(formatRelative(now - 3 * 60 * 60 * 1000, now), '3 hours ago');
  assert.match(formatRelative(now - 13 * 60 * 60 * 1000, now), /^today, /);
  assert.match(formatRelative(now - 26 * 60 * 60 * 1000, now), /^yesterday, /);
  assert.equal(formatRelative(now - 3 * 24 * 60 * 60 * 1000, now), '3 days ago');
  // 26 hours before 01:00 is two calendar days back but still one day old: never "1 days ago".
  const oneAm = new Date(2026, 7, 17, 1, 0, 0).getTime();
  assert.equal(formatRelative(oneAm - 26 * 60 * 60 * 1000, oneAm), 'yesterday');
  assert.match(formatRelative(now - 40 * 24 * 60 * 60 * 1000, now), /Jul/);
  assert.match(formatRelative(new Date(2024, 0, 5).getTime(), now), /2024/);
});

test('formatBytes', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(3 * 1024 * 1024), '3.00 MB');
});

test('splitLinks finds urls and leaves punctuation out', () => {
  assert.deepEqual(splitLinks('see https://a.com/x. ok'), [
    { type: 'text', value: 'see ' },
    { type: 'link', value: 'https://a.com/x' },
    { type: 'text', value: '. ok' },
  ]);
  assert.deepEqual(splitLinks('(https://a.com/x_(y))'), [
    { type: 'text', value: '(' },
    { type: 'link', value: 'https://a.com/x_(y)' },
    { type: 'text', value: ')' },
  ]);
  assert.deepEqual(splitLinks('no links'), [{ type: 'text', value: 'no links' }]);
});

test('splitMatches is case insensitive', () => {
  assert.deepEqual(splitMatches('Rate limit is 60', 'LIMIT'), [
    { type: 'text', value: 'Rate ' },
    { type: 'match', value: 'limit' },
    { type: 'text', value: ' is 60' },
  ]);
  assert.deepEqual(splitMatches('abc', ''), [{ type: 'text', value: 'abc' }]);
});

test('pluralize', () => {
  assert.equal(pluralize(1, 'note'), '1 note');
  assert.equal(pluralize(2, 'note'), '2 notes');
});
