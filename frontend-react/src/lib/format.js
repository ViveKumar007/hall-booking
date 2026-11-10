// Dates are yyyy-MM-dd strings (local time), times are "HH:00", like the process variables.

export const pad2 = (n) => String(n).padStart(2, '0');
export const HOURS = Array.from({ length: 11 }, (_, i) => `${pad2(8 + i)}:00`);
export const hourOf = (t) => Number(String(t || '').slice(0, 2));

export const today = () => new Date().toLocaleDateString('en-CA');

export function addDays(day, n) {
  const d = new Date(day + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('en-CA');
}

/** The Monday of the week containing day. */
export function weekStart(day) {
  const d = new Date(day + 'T00:00:00');
  return addDays(day, -((d.getDay() + 6) % 7));
}

export function fmtDay(day, opts = {}) {
  if (!day) return '';
  return new Date(day + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', ...opts });
}

export const fmtClock = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB') : '');

export function ago(iso, now = Date.now()) {
  if (!iso) return '';
  const s = Math.round((now - new Date(iso)) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** "1:42" until due, "0:00" once passed. */
export function timeLeft(dueIso, now = Date.now()) {
  const ms = new Date(dueIso) - now;
  if (ms <= 0) return '0:00';
  const s = Math.ceil(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  // 1:54 under an hour, 23:59:12 under a day, 1d 00:00:00 beyond.
  if (d > 0) return `${d}d ${pad2(h)}:${pad2(m)}:${pad2(s % 60)}`;
  if (h > 0) return `${h}:${pad2(m)}:${pad2(s % 60)}`;
  return `${m}:${pad2(s % 60)}`;
}

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
