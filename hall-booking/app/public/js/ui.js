// Small helpers shared by the views.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const today = () => new Date().toLocaleDateString('en-CA'); // yyyy-mm-dd, local time

export function addDays(day, n) {
  const d = new Date(day + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('en-CA');
}

export function weekStart(day) {
  const d = new Date(day + 'T00:00:00');
  const back = (d.getDay() + 6) % 7; // Monday = 0
  return addDays(day, -back);
}

export function fmtDay(day, opts = {}) {
  if (!day) return '';
  return new Date(day + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', ...opts });
}

export const fmtClock = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB') : '');

export function ago(iso) {
  if (!iso) return '';
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function timeLeft(dueIso) {
  const ms = new Date(dueIso) - Date.now();
  if (ms <= 0) return '0:00';
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const pad2 = (h) => String(h).padStart(2, '0');
export const hourOf = (t) => Number(String(t || '').slice(0, 2));

export const stamp = (st, big = false) => (st ? `<span class="stamp tone-${esc(st.tone)}${big ? ' big' : ''}">${esc(st.label)}</span>` : '');

let toastTimer;
export function toast(message, tone = '') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast ${tone}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

export const errorBox = (e) => `<div class="error">${esc(e.message || e)}</div>`;

// The room board: one row per venue, 08:00–18:00, bookings as blocks. `proposed` draws a request being typed.
export function roomBoard(venues, bookings, proposed = null) {
  const axis = Array.from({ length: 10 }, (_, i) => `<span>${pad2(8 + i)}:00</span>`).join('');
  const block = (from, to, cls, inner, title) => {
    const a = Math.max(8, Math.min(18, from));
    const b = Math.max(8, Math.min(18, to));
    if (b <= a) return '';
    return `<div class="slot ${cls}" style="grid-column:${a - 7} / ${b - 7}" title="${esc(title)}">${inner}</div>`;
  };
  const rows = venues.map((v) => {
    const blocks = bookings.filter((b) => b.hall === v.id).map((b) => block(
      b.startHour, b.endHour, b.status === 'CONFIRMED' ? 'confirmed' : 'pending',
      `<b>${esc(b.requester)}</b><span>${pad2(b.startHour)}–${pad2(b.endHour)}</span>`,
      `${b.requester}, ${pad2(b.startHour)}:00–${pad2(b.endHour)}:00, ${b.status.toLowerCase()}`,
    ));
    if (proposed && proposed.venue === v.id) {
      blocks.push(block(proposed.from, proposed.to, `proposed${proposed.clash ? ' clash' : ''}`,
        `<b>Your request</b><span>${pad2(proposed.from)}–${pad2(proposed.to)}</span>`, 'Your request'));
    }
    return `<div class="venue-name"><b>${esc(v.name)}</b><small>up to ${v.capacity} people</small></div><div class="track">${blocks.join('')}</div>`;
  }).join('');
  return `<div class="board-wrap"><div class="board"><div class="axis">${axis}</div>${rows}</div></div>`;
}

export const legend = (withProposed = false) => `<div class="legend"><span><i class="c"></i>Confirmed</span><span><i class="p"></i>Held, waiting for approval</span>${withProposed ? '<span><i class="n"></i>Your request</span>' : ''}</div>`;

// Repeats `fn` every `ms` while the view is open. Returns a stop function.
export function every(ms, fn) {
  let stopped = false;
  let timer;
  const loop = async () => {
    if (stopped) return;
    try { await fn(); } catch { /* the view shows its own errors */ }
    if (!stopped) timer = setTimeout(loop, ms);
  };
  timer = setTimeout(loop, ms);
  return () => { stopped = true; clearTimeout(timer); };
}
