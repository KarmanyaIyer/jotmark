// Timestamp and text formatting helpers. Pure functions.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function timeString(date, clock) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: clock === '12h',
  }).format(date);
}

function dateString(date, now) {
  const options = { month: 'short', day: 'numeric' };
  if (date.getFullYear() !== now.getFullYear()) options.year = 'numeric';
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

// Short label shown under each note. Relative for recent notes, then a date.
export function formatRelative(timestamp, now = Date.now(), clock = '12h') {
  const diff = now - timestamp;
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) {
    const m = Math.floor(diff / MINUTE);
    return `${m} min ago`;
  }
  if (diff < 12 * HOUR) {
    const h = Math.floor(diff / HOUR);
    return `${h} ${h === 1 ? 'hour' : 'hours'} ago`;
  }
  const date = new Date(timestamp);
  const nowDate = new Date(now);
  if (sameDay(date, nowDate)) return `today, ${timeString(date, clock)}`;
  const yesterday = new Date(now - DAY);
  if (sameDay(date, yesterday)) return `yesterday, ${timeString(date, clock)}`;
  if (diff < 7 * DAY) {
    const d = Math.floor(diff / DAY);
    return d <= 1 ? 'yesterday' : `${d} days ago`;
  }
  return dateString(date, nowDate);
}

// Full label, e.g. "Aug 14, 2026, 9:12 AM".
export function formatAbsolute(timestamp, clock = '12h') {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: clock === '12h',
  }).format(new Date(timestamp));
}

export function formatTimestamp(timestamp, settings, now = Date.now()) {
  return settings.timeFormat === 'absolute'
    ? formatAbsolute(timestamp, settings.clock)
    : formatRelative(timestamp, now, settings.clock);
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/g;

// Split text into plain and link segments. Trailing punctuation is left out of the link.
export function splitLinks(text) {
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    let url = match[0];
    let end = match.index + url.length;
    // Do not swallow closing punctuation that is almost never part of a URL.
    while (/[.,;:!?)\]}]$/.test(url)) {
      if (url.endsWith(')') && (url.match(/\(/g) || []).length >= (url.match(/\)/g) || []).length) break;
      url = url.slice(0, -1);
      end -= 1;
    }
    if (match.index > last) parts.push({ type: 'text', value: text.slice(last, match.index) });
    parts.push({ type: 'link', value: url });
    last = end;
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
  return parts;
}

// Case-insensitive split into matching and non-matching runs for search highlighting.
export function splitMatches(text, query) {
  const q = query.trim().toLowerCase();
  if (!q) return [{ type: 'text', value: text }];
  const parts = [];
  const lower = text.toLowerCase();
  let index = 0;
  while (index < text.length) {
    const found = lower.indexOf(q, index);
    if (found === -1) {
      parts.push({ type: 'text', value: text.slice(index) });
      break;
    }
    if (found > index) parts.push({ type: 'text', value: text.slice(index, found) });
    parts.push({ type: 'match', value: text.slice(found, found + q.length) });
    index = found + q.length;
  }
  return parts;
}

export function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}
