// Small shared helpers. No dependencies, no build step.

// ---------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------
// Everything is a local "YYYY-MM-DD" string. Deliberately NOT toISOString(),
// which converts to UTC and can hand you yesterday's date after dinner.

export function ymd(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s, n) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

export function dayOfWeek(s) {
  return parseYmd(s).getDay(); // 0 = Sunday
}

/** Start of the week containing `s`, honouring the household's week start day. */
export function weekStartFor(s, weekStartDay = 0) {
  return addDays(s, -(((dayOfWeek(s) - weekStartDay) + 7) % 7));
}

export function daysBetween(a, b) {
  return Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
}

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAY_INITIAL = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** "Today", "Tomorrow", "Yesterday", or "Thursday". */
export function friendlyDay(s, today = ymd()) {
  const diff = daysBetween(today, s);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return DAY_NAMES[dayOfWeek(s)];
}

export function formatWeekRange(weekStart) {
  const end = addDays(weekStart, 6);
  const a = parseYmd(weekStart);
  const b = parseYmd(end);
  const opts = { month: 'short', day: 'numeric' };
  return `${a.toLocaleDateString(undefined, opts)} – ${b.toLocaleDateString(undefined, opts)}`;
}

/**
 * Timestamps arrive as epoch millis (demo mode) or ISO strings (Postgres).
 * Normalise both here so callers never have to care.
 */
export function toDate(value) {
  if (value === null || value === undefined) return null;
  const d = typeof value === 'number' ? new Date(value) : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function timeAgo(value) {
  const d = toDate(value);
  if (!d) return '';
  const secs = Math.round((Date.now() - d.getTime()) / 1000);
  if (secs < 45) return 'just now';
  if (secs < 5400) {
    const mins = Math.round(secs / 60);
    return mins < 60 ? `${mins} min ago` : 'an hour ago';
  }
  const hours = Math.round(secs / 3600);
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatDateTime(value) {
  const d = toDate(value);
  if (!d) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ---------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------
// Stored as integer cents everywhere. Floats never touch a balance.

export function formatMoney(cents, symbol = '$') {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  return `${neg ? '-' : ''}${symbol}${(abs / 100).toFixed(2)}`;
}

/** Parse "3", "3.50", "$3.50" → cents. Returns null if it isn't a number. */
export function parseMoney(text) {
  const cleaned = String(text ?? '').replace(/[^0-9.]/g, '');
  if (cleaned === '' || cleaned === '.') return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

// ---------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [prop, val] of Object.entries(v)) {
        // Object.assign onto a CSSStyleDeclaration silently drops custom
        // properties, so `--ring-pct` and friends need setProperty.
        if (prop.startsWith('--')) node.style.setProperty(prop, val);
        else node.style[prop] = val;
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Readable contrast colour for text sitting on `hex`. */
export function contrastOn(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return '#fff';
  const [r, g, b] = [1, 2, 3].map((i) => parseInt(m[i], 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.45 ? '#1a1a1a' : '#ffffff';
}
