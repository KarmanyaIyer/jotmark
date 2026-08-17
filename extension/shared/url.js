// URL handling for Jotmark.
// Turns a tab URL into the two keys notes are filed under:
//   domain key  "github.com"
//   page key    "https://github.com/settings/keys?tab=ssh"
// Pure functions, no browser APIs, so they can be unit tested in node.

// Query parameters that only exist for ad and campaign tracking. They are
// dropped from page keys so the same article opened from two newsletters
// still maps to one set of notes.
const TRACKING_PARAM_PREFIXES = ['utm_', 'mc_', 'pk_', 'piwik_', 'hsa_', 'vero_'];
const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid',
  'twclid', 'ttclid', 'igshid', 'igsh', 'li_fat_id', 'mkt_tok', '_hsenc', '_hsmi',
  's_kwcid', 'ef_id', 'srsltid', 'oly_anon_id', 'oly_enc_id', '_openstat',
  'wickedid', 'rb_clickid', 'sc_cid', 'trk', 'ncid', 'ref_src', 'ref_url', 'cmpid',
]);

// Multi-label public suffixes. Used only when the "group subdomains" setting is
// on, to work out that "docs.example.co.uk" belongs to "example.co.uk" and that
// "alice.github.io" is its own site rather than part of "github.io".
// This is a pragmatic subset of the public suffix list, not the full thing.
const MULTI_LABEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'sch.uk', 'nhs.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'id.au',
  'co.nz', 'org.nz', 'net.nz', 'ac.nz', 'govt.nz',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp', 'gr.jp',
  'co.kr', 'or.kr', 'ac.kr', 'go.kr', 'ne.kr',
  'com.br', 'net.br', 'org.br', 'gov.br', 'edu.br',
  'com.mx', 'org.mx', 'gob.mx', 'edu.mx',
  'com.ar', 'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'com.tw', 'org.tw',
  'co.in', 'net.in', 'org.in', 'ac.in', 'gov.in', 'firm.in', 'nic.in',
  'co.za', 'org.za', 'net.za', 'web.za', 'gov.za',
  'com.sg', 'edu.sg', 'gov.sg', 'com.hk', 'org.hk', 'edu.hk', 'gov.hk',
  'com.tr', 'org.tr', 'edu.tr', 'gov.tr', 'com.my', 'org.my', 'edu.my', 'gov.my',
  'co.id', 'or.id', 'ac.id', 'go.id', 'com.ph', 'org.ph', 'gov.ph', 'com.vn', 'edu.vn',
  'com.eg', 'com.sa', 'edu.sa', 'gov.sa', 'co.il', 'org.il', 'ac.il', 'gov.il',
  'com.ua', 'org.ua', 'gov.ua', 'com.pl', 'org.pl', 'edu.pl', 'com.pk', 'edu.pk',
  'com.bd', 'com.ng', 'org.ng', 'gov.ng', 'co.ke', 'or.ke', 'ac.ke', 'go.ke',
  'com.pe', 'com.co', 'com.ve', 'com.ec', 'com.uy', 'com.py', 'com.bo', 'com.do',
  'com.gt', 'com.sv', 'com.hn', 'com.ni', 'co.cr', 'com.pa', 'com.pr',
  'co.th', 'ac.th', 'or.th', 'go.th', 'com.np', 'edu.np', 'com.lk', 'com.kw', 'com.qa',
  'com.ae', 'ac.ae', 'co.ao', 'co.mz', 'co.tz', 'co.ug', 'co.zw', 'com.gh', 'com.et',
  'com.ru', 'org.ru', 'net.ru', 'msk.ru', 'spb.ru',
  'github.io', 'gitlab.io', 'netlify.app', 'vercel.app', 'pages.dev', 'workers.dev',
  'herokuapp.com', 'web.app', 'firebaseapp.com', 'blogspot.com', 'wordpress.com',
  'tumblr.com', 'wixsite.com', 'squarespace.com', 'webflow.io', 'framer.website',
  'notion.site', 'substack.com', 'ghost.io', 'carrd.co', 'neocities.org', 'glitch.me',
  'repl.co', 'replit.app', 'surge.sh', 'now.sh', 'onrender.com', 'fly.dev', 'railway.app',
  'azurewebsites.net', 'cloudfront.net', 'amazonaws.com', 'appspot.com', 'googleusercontent.com',
  'sharepoint.com', 'myshopify.com', 'bigcartel.com', 'weebly.com', 'jimdosite.com',
  'readthedocs.io', 'gitbook.io', 'hashnode.dev', 'dev.to', 'bearblog.dev', 'pika.page',
]);

export const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:']);

export const DEFAULT_URL_OPTIONS = Object.freeze({
  ignoreQuery: false,
  keepFragment: false,
  groupSubdomains: false,
});

function isTrackingParam(name) {
  const lower = name.toLowerCase();
  if (TRACKING_PARAMS.has(lower)) return true;
  return TRACKING_PARAM_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

function stripWww(host) {
  return host.replace(/^www\d*\./i, '');
}

// Reduce a hostname to its registrable domain: "docs.example.com" -> "example.com",
// "a.b.example.co.uk" -> "example.co.uk", "alice.github.io" stays "alice.github.io".
// IP addresses and single label hosts (localhost) are returned unchanged.
export function registrableDomain(host) {
  const clean = stripWww(host).toLowerCase();
  if (/^[\d.]+$/.test(clean) || clean.includes(':')) return clean;
  const labels = clean.split('.');
  if (labels.length <= 2) return clean;
  const lastTwo = labels.slice(-2).join('.');
  if (MULTI_LABEL_SUFFIXES.has(lastTwo)) {
    return labels.slice(-3).join('.');
  }
  return lastTwo;
}

// The key notes are filed under in domain scope.
export function domainKey(host, options = DEFAULT_URL_OPTIONS) {
  const clean = stripWww(host).toLowerCase();
  return options.groupSubdomains ? registrableDomain(clean) : clean;
}

function normalizedPath(u) {
  const path = u.pathname || '/';
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

// Query string with tracking parameters removed and the rest sorted by name
// and value, so param order does not create a second page. Empty when nothing
// is left or when the query is ignored.
function normalizedSearch(u, options) {
  if (options.ignoreQuery || u.search.length <= 1) return '';
  const kept = [];
  for (const [name, value] of new URLSearchParams(u.search)) {
    if (!isTrackingParam(name)) kept.push([name, value]);
  }
  kept.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return kept.length ? '?' + new URLSearchParams(kept).toString() : '';
}

function normalizedHash(u, options) {
  return options.keepFragment && u.hash.length > 1 ? u.hash : '';
}

// The key notes are filed under in page scope. Normalises the URL so that
// harmless variations (trailing slash, tracking params, param order, hash)
// map to the same page.
export function pageKey(url, options = DEFAULT_URL_OPTIONS) {
  const u = url instanceof URL ? url : new URL(url);
  const host = stripWww(u.hostname).toLowerCase();
  const port = u.port ? ':' + u.port : '';
  return `${u.protocol}//${host}${port}${normalizedPath(u)}${normalizedSearch(u, options)}${normalizedHash(u, options)}`;
}

// Everything the popup needs to know about the current tab URL.
export function describeUrl(rawUrl, options = DEFAULT_URL_OPTIONS) {
  if (!rawUrl) return { supported: false, reason: 'empty' };
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return { supported: false, reason: 'invalid' };
  }
  if (!SUPPORTED_PROTOCOLS.has(u.protocol)) {
    return { supported: false, reason: 'protocol', protocol: u.protocol };
  }
  if (!u.hostname) return { supported: false, reason: 'nohost' };

  const host = stripWww(u.hostname).toLowerCase();
  // Path shown under the host in the popup header: the same parts that make up
  // the page key, decoded so it reads like the address bar.
  const displayPath = safeDecode(normalizedPath(u) + normalizedSearch(u, options) + normalizedHash(u, options));
  return {
    supported: true,
    href: u.href,
    host,
    domainKey: domainKey(u.hostname, options),
    pageKey: pageKey(u, options),
    displayPath,
  };
}

function safeDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

// Human friendly label for a stored key. Domain keys are shown as they are,
// page keys lose their protocol.
export function labelForKey(scope, key) {
  if (scope === 'domain') return key;
  return key.replace(/^https?:\/\//, '');
}
