import { api } from './api.js';
import { esc, every } from './ui.js';
import dashboard from './views/dashboard.js';
import newBooking from './views/new-booking.js';
import requests from './views/requests.js';
import request from './views/request.js';
import inbox from './views/inbox.js';
import issues from './views/issues.js';
import calendar from './views/calendar.js';
import notifications from './views/notifications.js';

const ROLE_OPTIONS = [
  { id: 'requester', label: 'Requester' },
  { id: 'admin-office', label: 'Approver · Admin office' },
  { id: 'dean', label: 'Approver · Dean' },
  { id: 'hod', label: 'Approver · HOD' },
  { id: 'lab-incharge', label: 'Approver · Lab in-charge' },
  { id: 'admin', label: 'Admin' },
];

const NAV = {
  requester: [['#/', 'Room board'], ['#/new', 'New booking'], ['#/requests', 'My requests'], ['#/calendar', 'Calendar']],
  approver: [['#/', 'Room board'], ['#/inbox', 'Inbox', 'approval'], ['#/calendar', 'Calendar']],
  admin: [['#/', 'Room board'], ['#/inbox', 'Inbox', 'approval'], ['#/issues', 'Service issues', 'service'], ['#/requests', 'All requests'], ['#/calendar', 'Calendar'], ['#/notifications', 'Notifications']],
};

const ROUTES = [
  [/^#?\/?$/, dashboard],
  [/^#\/new$/, newBooking],
  [/^#\/requests$/, requests],
  [/^#\/requests\/(\d+)$/, request],
  [/^#\/inbox$/, inbox],
  [/^#\/issues$/, issues],
  [/^#\/calendar$/, calendar],
  [/^#\/notifications$/, notifications],
];

const readRole = () => { try { return localStorage.getItem('hb-role') || 'requester'; } catch { return 'requester'; } };

const ctx = {
  meta: { venues: [], roles: [] },
  role: readRole(),
  get kind() { return this.role === 'requester' || this.role === 'admin' ? this.role : 'approver'; },
  venueName(id) { return (this.meta.venues.find((v) => v.id === id) || {}).name || id || ''; },
  roleName(id) { return (this.meta.roles.find((r) => r.id === id) || {}).name || id || ''; },
  go(hash) { location.hash = hash; },
  remember(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode */ } },
  recall(key) { try { return localStorage.getItem(key) || ''; } catch { return ''; } },
};

const view = document.getElementById('view');
const nav = document.getElementById('nav');
const roleSelect = document.getElementById('role');
let dispose = null;
let counts = { approval: 0, service: 0 };

function drawNav() {
  const here = location.hash || '#/';
  nav.innerHTML = NAV[ctx.kind].map(([href, label, countKey]) => {
    const current = href === '#/' ? (here === '#/' || here === '' || here === '#') : here.startsWith(href);
    const n = countKey ? counts[countKey] : 0;
    return `<a href="${href}"${current ? ' aria-current="page"' : ''}>${esc(label)}${n ? `<span class="count">${n}</span>` : ''}</a>`;
  }).join('');
}

async function render() {
  if (dispose) { try { dispose(); } catch { /* ignore */ } dispose = null; }
  const hash = location.hash || '#/';
  const route = ROUTES.find(([re]) => re.test(hash));
  drawNav();
  view.innerHTML = '';
  if (!route) { view.innerHTML = '<div class="empty">That page does not exist. <a href="#/">Go to the room board</a>.</div>'; return; }
  const params = hash.match(route[0]).slice(1);
  dispose = (await route[1](view, ctx, ...params)) || null;
  window.scrollTo(0, 0);
}

async function refreshCounts() {
  const role = ctx.kind === 'approver' ? ctx.role : 'all';
  const [a, s] = await Promise.all([
    ctx.kind === 'requester' ? [] : api(`/tasks?kind=approval&role=${role}`).catch(() => []),
    ctx.kind === 'admin' ? api('/tasks?kind=service').catch(() => []) : [],
  ]);
  const next = { approval: a.length, service: s.length };
  if (next.approval !== counts.approval || next.service !== counts.service) { counts = next; drawNav(); }
}

async function refreshStatus() {
  const box = document.getElementById('status');
  try {
    const h = await api('/health');
    const pill = (ok, name, hint) => `<span class="${ok ? 'up' : 'down'}" title="${esc(ok ? `${name} is running` : hint)}"><i></i>${name}</span>`;
    box.innerHTML = pill(h.camunda, 'Camunda', 'Start start-camunda.cmd') + pill(h.bookings, 'Bookings', 'Start start-mock.cmd') + pill(h.worker, 'Worker', 'Start start-worker.cmd');
  } catch {
    box.innerHTML = '<span class="down"><i></i>App server stopped</span>';
  }
}

async function start() {
  roleSelect.innerHTML = ROLE_OPTIONS.map((r) => `<option value="${r.id}">${esc(r.label)}</option>`).join('');
  roleSelect.value = ctx.role;
  roleSelect.addEventListener('change', () => {
    ctx.role = roleSelect.value;
    ctx.remember('hb-role', ctx.role);
    counts = { approval: 0, service: 0 };
    render();
    refreshCounts();
  });
  try { ctx.meta = await api('/meta'); } catch (e) { view.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
  window.addEventListener('hashchange', render);
  await render();
  refreshStatus(); refreshCounts();
  every(5000, refreshStatus);
  every(4000, refreshCounts);
}

start();
