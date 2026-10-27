// Hall Booking web app: serves the pages in public/ and the /api the pages call.
//
// The pages never call Camunda directly (a browser blocks calls to another port). This server does,
// using the same Camunda 8 REST API (/v2) as run-scenarios.ps1. No libraries: Node 18+ only.
// Start it with scripts\start-app.cmd, then open http://localhost:8090

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.APP_PORT || 8090);
const CAMUNDA = process.env.CAMUNDA_URL || 'http://localhost:8080';
const MOCK = process.env.MOCK_BASE_URL || 'http://127.0.0.1:3000';
const WORKER_HEALTH = process.env.WORKER_HEALTH_URL || 'http://127.0.0.1:8091/health';
const PUBLIC = path.join(__dirname, 'public');
const SEED = path.join(__dirname, '..', 'mock', 'db.seed.json');
const DB = path.join(__dirname, '..', 'mock', 'db.json');

const BOOKING_PROCESS = 'hall-booking';
const APPROVAL_PROCESS = 'hall-approval';
const APPROVAL_MINUTES = 2;

// Same capacities as the worker's validation (worker/worker.js).
const VENUES = [
  { id: 'hall-a', name: 'Seminar Hall A', capacity: 200 },
  { id: 'hall-b', name: 'Seminar Hall B', capacity: 150 },
  { id: 'lab-1', name: 'Computer Lab 1', capacity: 60 },
];
const ROLES = [
  { id: 'admin-office', name: 'Admin office' },
  { id: 'dean', name: 'Dean' },
  { id: 'hod', name: 'HOD' },
  { id: 'lab-incharge', name: 'Lab in-charge' },
];
const OUTCOMES = {
  APPROVED: { label: 'Approved', tone: 'ok' },
  REJECTED: { label: 'Rejected', tone: 'bad' },
  EXPIRED: { label: 'Expired', tone: 'idle' },
  CONFLICT: { label: 'Slot taken', tone: 'warn' },
  INVALID_TIME: { label: 'Invalid time', tone: 'warn' },
  PAST_DATE: { label: 'Date passed', tone: 'warn' },
  OVER_CAPACITY: { label: 'Over capacity', tone: 'warn' },
  SERVICE_UNAVAILABLE: { label: 'Service unavailable', tone: 'bad' },
};
const WAITING_AT = {
  Worker_ValidateRequest: { label: 'Validating', tone: 'live' },
  User_FixService: { label: 'Service issue', tone: 'bad' },
  Receive_Decision: { label: 'Awaiting approval', tone: 'live' },
  Worker_Notify: { label: 'Notifying', tone: 'live' },
};

// ---------------------------------------------------------------- outgoing calls

class UpstreamError extends Error {
  constructor(service, message, status = 502) { super(message); this.service = service; this.status = status; }
}

async function camunda(method, urlPath, body) {
  let res;
  try {
    res = await fetch(CAMUNDA + '/v2' + urlPath, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new UpstreamError('camunda', 'Camunda is not reachable. Start it with start-camunda.cmd.', 503);
  }
  const text = await res.text();
  if (res.status === 404) throw new UpstreamError('camunda', 'Camunda has no record of that (yet). A request that was just sent can take a few seconds to appear.', 404);
  if (!res.ok) throw new UpstreamError('camunda', `Camunda answered ${res.status}: ${text.slice(0, 300)}`, 502);
  return text ? JSON.parse(text) : {};
}

async function bookingsDb(urlPath) {
  try {
    const res = await fetch(MOCK + urlPath);
    if (!res.ok) throw new Error(String(res.status));
    return await res.json();
  } catch (e) {
    throw new UpstreamError('bookings', 'The booking service is not reachable. Start it with start-mock.cmd.', 503);
  }
}

// ---------------------------------------------------------------- reading the workflow

const parse = (value) => { try { return JSON.parse(value); } catch { return value; } };

// Process-level variables of one instance (connector inputs such as url/method live on task scopes and are skipped).
// serviceError is the exception: Camunda keeps it on the error boundary event's scope.
const FROM_INNER_SCOPES = new Set(['serviceError']);
async function variablesOf(pik) {
  const res = await camunda('POST', '/variables/search', { filter: { processInstanceKey: pik }, page: { limit: 200 } });
  const vars = {};
  for (const v of res.items || []) {
    const inner = v.scopeKey && String(v.scopeKey) !== String(pik);
    if (inner && !FROM_INNER_SCOPES.has(v.name)) continue;
    if (inner && v.name in vars) continue;
    let value = v.value;
    if (v.isTruncated && v.variableKey) {
      try { value = (await camunda('GET', `/variables/${v.variableKey}`)).value; } catch { /* keep the truncated value */ }
    }
    vars[v.name] = parse(value);
  }
  return vars;
}

async function elementsOf(pik, state) {
  const filter = { processInstanceKey: pik };
  if (state) filter.state = state;
  const res = await camunda('POST', '/element-instances/search', { filter, sort: [{ field: 'startDate', order: 'ASC' }], page: { limit: 200 } });
  return res.items || [];
}

async function instance(pik) {
  return camunda('GET', `/process-instances/${pik}`);
}

// The Hall Approval instance of a booking: the other instance holding the same requestId (= the booking's key).
// requestId is the messages' correlation key, so there is exactly one. Found once, it never changes: cache it.
const approvalOf = new Map();
async function approvalInstanceFor(bookingKey) {
  if (approvalOf.has(bookingKey)) return approvalOf.get(bookingKey);
  const res = await camunda('POST', '/variables/search', {
    filter: { name: 'requestId', value: JSON.stringify(String(bookingKey)) }, page: { limit: 10 },
  });
  const other = (res.items || []).find((v) => String(v.processInstanceKey) !== String(bookingKey));
  if (!other) return null;
  approvalOf.set(bookingKey, String(other.processInstanceKey));
  return approvalOf.get(bookingKey);
}

function statusOf(pi, vars, activeElementIds) {
  if (pi.hasIncident) return { code: 'INCIDENT', label: 'Needs attention', tone: 'bad' };
  if (pi.state === 'COMPLETED') {
    const o = OUTCOMES[vars.outcome];
    return o ? { code: vars.outcome, ...o } : { code: 'DONE', label: 'Finished', tone: 'idle' };
  }
  if (pi.state === 'TERMINATED') return { code: 'CANCELED', label: 'Cancelled', tone: 'idle' };
  for (const id of activeElementIds) if (WAITING_AT[id]) return { code: id, ...WAITING_AT[id] };
  return { code: 'RUNNING', label: 'In progress', tone: 'live' };
}

function summary(pi, vars, status) {
  return {
    key: String(pi.processInstanceKey),
    state: pi.state,
    startDate: pi.startDate,
    endDate: pi.endDate || null,
    requesterName: vars.requesterName, email: vars.email, venue: vars.venue,
    bookingDate: vars.bookingDate, startTime: vars.startTime, endTime: vars.endTime,
    attendees: vars.attendees, purpose: vars.purpose,
    approver: vars.approver || null, bookingRef: vars.bookingRef || null, outcome: vars.outcome || null,
    status,
  };
}

async function bookingSummary(pi) {
  const pik = String(pi.processInstanceKey);
  const vars = await variablesOf(pik);
  const active = pi.state === 'ACTIVE' ? (await elementsOf(pik, 'ACTIVE')).map((e) => e.elementId) : [];
  return summary(pi, vars, statusOf(pi, vars, active));
}

async function listBookings({ email, limit = 25 }) {
  const res = await camunda('POST', '/process-instances/search', {
    filter: { processDefinitionId: BOOKING_PROCESS }, sort: [{ field: 'startDate', order: 'DESC' }], page: { limit: email ? 200 : limit },
  });
  const rows = await Promise.all((res.items || []).map(bookingSummary));
  const wanted = email ? rows.filter((r) => String(r.email || '').toLowerCase() === email.toLowerCase()) : rows;
  return wanted.slice(0, limit);
}

// The two-lane routing slip: which steps to show, in which lane, and what to say about them.
const STEPS = {
  StartEvent_Requested: { lane: 'desk', label: () => 'Request submitted', detail: (v) => `${v.requesterName} · ${v.attendees} people` },
  Script_PrepareSlot: { lane: 'desk', label: () => 'Slot prepared', detail: (v) => v.slot ? `${v.startTime}–${v.endTime}, ${v.slot.durationHours} h` : '' },
  Worker_ValidateRequest: { lane: 'desk', label: () => 'Checked by worker', detail: (v) => v.validation ? (v.validation.valid ? `Valid · venue holds ${v.validation.capacity}` : `Rejected: ${OUTCOMES[v.validation.reason]?.label || v.validation.reason}`) : 'Waiting for the worker' },
  Rest_FetchBookings: { lane: 'desk', label: () => 'Booking register read', detail: (v, el) => el.state === 'TERMINATED' ? 'Booking service did not answer' : '' },
  Boundary_ServiceDown: { lane: 'desk', label: () => 'Booking service unreachable', detail: (v) => v.serviceError || '' },
  User_FixService: { lane: 'desk', label: () => 'Admin resolves service issue', detail: (v, el) => el.state === 'ACTIVE' ? 'Waiting for Retry or Cancel' : (v.serviceFixAction === 'RETRY' ? 'Retried' : 'Cancelled') },
  Script_DetectConflict: { lane: 'desk', label: () => 'Clash check', detail: (v) => v.conflictCheck ? (v.conflictCheck.hasConflict ? 'Overlaps an existing booking' : 'Slot is free') : '' },
  Script_SetReason: { lane: 'desk', label: () => 'Slot already taken', detail: () => '' },
  Script_SetServiceError: { lane: 'desk', label: () => 'Request cancelled', detail: () => 'Booking service unavailable' },
  Dmn_DecideApprover: { lane: 'desk', label: () => 'Approver chosen', detail: (v) => v.approver ? `${roleName(v.approver)} (decision table)` : '' },
  Rest_HoldSlot: { lane: 'desk', label: () => 'Slot held', detail: (v) => v.bookingRef ? `${v.bookingRef}, pending` : '' },
  Send_ApprovalRequest: { lane: 'desk', label: () => 'Approval request sent', detail: () => 'Message to Hall Administration', message: 'out' },
  MsgStart_ApprovalRequested: { lane: 'admin', label: () => 'Request received', detail: () => 'New review opened', message: 'in' },
  User_Approval: { lane: 'admin', label: () => 'Review by approver', detail: (v, el, a) => el.state === 'ACTIVE' ? `Waiting for ${roleName(a.approver)}` : (el.state === 'TERMINATED' ? 'No response in time' : (a.approved ? 'Approved' : 'Rejected') + (a.remarks ? `: “${a.remarks}”` : '')) },
  Worker_Reminder: { lane: 'admin', label: () => 'Reminder sent', detail: (v, el, a) => `To ${roleName(a.approver)} after 1 minute` },
  Script_MarkExpired: { lane: 'admin', label: () => 'Marked as expired', detail: () => 'Not reviewed within 2 minutes' },
  Send_Decision: { lane: 'admin', label: () => 'Decision sent', detail: (v, el, a) => a.decision ? a.decision.outcome : '', message: 'out' },
  Receive_Decision: { lane: 'desk', label: () => 'Decision received', detail: (v, el) => el.state === 'ACTIVE' ? 'Waiting for Hall Administration' : (v.decision ? v.decision.outcome : ''), message: 'in' },
  Rest_ConfirmSlot: { lane: 'desk', label: () => 'Slot confirmed', detail: (v) => v.bookingRef || '' },
  Rest_ReleaseRejected: { lane: 'desk', label: () => 'Slot released', detail: () => 'Request was rejected' },
  Rest_ReleaseExpired: { lane: 'desk', label: () => 'Slot released', detail: () => 'Request expired' },
  Worker_Notify: { lane: 'desk', label: () => 'Requester notified', detail: (v) => v.email ? `Email to ${v.email}` : '' },
};
const roleName = (id) => (ROLES.find((r) => r.id === id) || {}).name || id || '';

async function bookingDetail(pik) {
  const pi = await instance(pik);
  if (pi.processDefinitionId && pi.processDefinitionId !== BOOKING_PROCESS) throw new UpstreamError('app', 'That is not a booking.', 404);
  const [vars, deskEls] = await Promise.all([variablesOf(pik), elementsOf(pik)]);
  const activeIds = deskEls.filter((e) => e.state === 'ACTIVE').map((e) => e.elementId);
  const status = statusOf(pi, vars, activeIds);

  const approvalKey = vars.requestId ? await approvalInstanceFor(pik) : null;
  let adminVars = {}, adminEls = [], review = null;
  if (approvalKey) {
    [adminVars, adminEls] = await Promise.all([variablesOf(approvalKey), elementsOf(approvalKey)]);
    const open = adminEls.find((e) => e.elementId === 'User_Approval' && e.state === 'ACTIVE');
    if (open) {
      const due = new Date(new Date(open.startDate).getTime() + APPROVAL_MINUTES * 60000).toISOString();
      review = { since: open.startDate, due, reminderSent: !!adminVars.reminderSentAt, approver: adminVars.approver };
    }
  }

  // A step "happened" when it finished (a review or a wait for a message can take minutes); running steps go last.
  // Sending is the exception: the message is delivered while the send step is still finishing, so a send counts
  // from its start. That keeps every send just before its receive.
  const happened = (e) => (STEPS[e.elementId].message === 'out' ? new Date(e.startDate).getTime()
    : e.endDate ? new Date(e.endDate).getTime() : Infinity);
  const steps = [...deskEls, ...adminEls]
    .filter((e) => STEPS[e.elementId])
    .sort((a, b) => (happened(a) - happened(b)) || (new Date(a.startDate) - new Date(b.startDate)))
    .map((e) => {
      const def = STEPS[e.elementId];
      return {
        id: e.elementId, lane: def.lane, message: def.message || null, state: e.state,
        at: def.message === 'out' ? e.startDate : (e.endDate || e.startDate), label: def.label(vars, e, adminVars), detail: def.detail(vars, e, adminVars) || '',
      };
    });

  let notification = null;
  if (vars.notificationId) { try { notification = await bookingsDb(`/notifications/${vars.notificationId}`); } catch { /* shown without it */ } }

  return {
    ...summary(pi, vars, status),
    approvalKey,
    review,
    remarks: (vars.decision && vars.decision.remarks) || null,
    serviceError: vars.serviceError || null,
    validation: vars.validation || null,
    steps,
    notification,
    operateUrl: `${CAMUNDA}/operate/processes/${pik}`,
  };
}

async function openTasks(kind, role) {
  const elementId = kind === 'service' ? 'User_FixService' : 'User_Approval';
  const res = await camunda('POST', '/user-tasks/search', { filter: { elementId, state: 'CREATED' }, page: { limit: 100 } });
  const tasks = await Promise.all((res.items || []).map(async (t) => {
    const v = await variablesOf(t.processInstanceKey);
    const created = t.creationDate;
    return {
      key: String(t.userTaskKey), kind, processInstanceKey: String(t.processInstanceKey), created,
      due: kind === 'approval' ? new Date(new Date(created).getTime() + APPROVAL_MINUTES * 60000).toISOString() : null,
      reminderSent: !!v.reminderSentAt,
      requesterName: v.requesterName, email: v.email, venue: v.venue, bookingDate: v.bookingDate,
      startTime: v.startTime, endTime: v.endTime, attendees: v.attendees, purpose: v.purpose,
      approver: v.approver || null, bookingRef: v.bookingRef || null, serviceError: v.serviceError || null,
      bookingKey: kind === 'service' ? String(t.processInstanceKey) : (v.requestId ? String(v.requestId) : null),
    };
  }));
  return tasks
    .filter((t) => !role || role === 'all' || t.approver === role)
    .sort((a, b) => new Date(a.created) - new Date(b.created));
}

// ---------------------------------------------------------------- validation of new requests

const HOURS = Array.from({ length: 11 }, (_, i) => `${String(8 + i).padStart(2, '0')}:00`);
function checkNewBooking(b) {
  const errors = {};
  const need = (k, msg) => { if (b[k] === undefined || b[k] === null || String(b[k]).trim() === '') errors[k] = msg; };
  need('requesterName', 'Enter your name.');
  need('email', 'Enter your email.');
  if (b.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email)) errors.email = 'Enter an email like name@college.edu.';
  if (!VENUES.some((v) => v.id === b.venue)) errors.venue = 'Choose a venue.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.bookingDate || '')) errors.bookingDate = 'Choose a date.';
  if (!HOURS.includes(b.startTime)) errors.startTime = 'Choose a start time.';
  if (!HOURS.includes(b.endTime)) errors.endTime = 'Choose an end time.';
  if (!Number.isInteger(b.attendees) || b.attendees < 1) errors.attendees = 'Enter the number of people (at least 1).';
  return errors;
}

// ---------------------------------------------------------------- HTTP

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new UpstreamError('app', 'The request body is not valid JSON.', 400); }
}

async function health() {
  const check = async (fn) => { try { return await fn(); } catch { return false; } };
  const [camundaUp, bookingsUp, worker] = await Promise.all([
    check(async () => (await fetch(CAMUNDA + '/v2/topology')).ok),
    check(async () => (await fetch(MOCK + '/bookings')).ok),
    check(async () => { const r = await fetch(WORKER_HEALTH); return r.ok ? await r.json() : false; }),
  ]);
  return { camunda: camundaUp, bookings: bookingsUp, worker: !!worker, workerStats: worker || null };
}

async function handleApi(req, res, url) {
  const p = url.pathname;
  const m = (re) => p.match(re);
  let match;

  if (req.method === 'GET' && p === '/api/meta') return send(res, 200, { venues: VENUES, roles: ROLES, outcomes: OUTCOMES, approvalMinutes: APPROVAL_MINUTES });
  if (req.method === 'GET' && p === '/api/health') return send(res, 200, await health());

  if (req.method === 'POST' && p === '/api/bookings') {
    const b = await readJson(req);
    const booking = {
      requesterName: String(b.requesterName || '').trim(), email: String(b.email || '').trim(), venue: b.venue,
      bookingDate: b.bookingDate, startTime: b.startTime, endTime: b.endTime,
      attendees: Number(b.attendees), purpose: String(b.purpose || '').trim(),
    };
    const errors = checkNewBooking(booking);
    if (Object.keys(errors).length) return send(res, 400, { error: 'Some fields need attention.', fields: errors });
    const created = await camunda('POST', '/process-instances', { processDefinitionId: BOOKING_PROCESS, variables: booking });
    return send(res, 201, { key: String(created.processInstanceKey) });
  }
  if (req.method === 'GET' && p === '/api/bookings') {
    const email = url.searchParams.get('email') || '';
    const limit = Math.min(Number(url.searchParams.get('limit')) || 25, 100);
    return send(res, 200, await listBookings({ email, limit }));
  }
  if (req.method === 'GET' && (match = m(/^\/api\/bookings\/(\d+)$/))) return send(res, 200, await bookingDetail(match[1]));

  if (req.method === 'GET' && p === '/api/tasks') {
    const kind = url.searchParams.get('kind') === 'service' ? 'service' : 'approval';
    return send(res, 200, await openTasks(kind, url.searchParams.get('role')));
  }
  if (req.method === 'POST' && (match = m(/^\/api\/tasks\/(\d+)\/decision$/))) {
    const b = await readJson(req);
    if (typeof b.approved !== 'boolean') return send(res, 400, { error: 'Say whether the booking is approved.' });
    await camunda('POST', `/user-tasks/${match[1]}/completion`, { variables: { approved: b.approved, remarks: String(b.remarks || '').trim() } });
    return send(res, 200, { ok: true });
  }
  if (req.method === 'POST' && (match = m(/^\/api\/tasks\/(\d+)\/service-action$/))) {
    const b = await readJson(req);
    if (!['RETRY', 'CANCEL'].includes(b.action)) return send(res, 400, { error: 'Choose Retry or Cancel.' });
    await camunda('POST', `/user-tasks/${match[1]}/completion`, { variables: { serviceFixAction: b.action } });
    return send(res, 200, { ok: true });
  }

  if (req.method === 'GET' && p === '/api/calendar') {
    const from = url.searchParams.get('from') || '0000-00-00';
    const to = url.searchParams.get('to') || '9999-99-99';
    const all = await bookingsDb('/bookings');
    return send(res, 200, all.filter((b) => b.day >= from && b.day <= to));
  }
  if (req.method === 'GET' && p === '/api/notifications') {
    const all = await bookingsDb('/notifications');
    return send(res, 200, all.slice().reverse());
  }
  if (req.method === 'POST' && p === '/api/demo/reset') {
    fs.copyFileSync(SEED, DB);
    return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: `No API route ${req.method} ${p}` });
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };

function serveStatic(req, res, url) {
  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url);
  try {
    await handleApi(req, res, url);
  } catch (e) {
    const status = e instanceof UpstreamError ? e.status : 500;
    if (!(e instanceof UpstreamError)) console.error(e);
    send(res, status, { error: e.message, service: e.service || 'app' });
  }
}).listen(PORT, () => {
  console.log(`Hall Booking app on http://localhost:${PORT}`);
  console.log(`Camunda ${CAMUNDA} | booking service ${MOCK} | worker health ${WORKER_HEALTH}`);
});
