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
  SubProcess_CheckAvailability: { label: 'Checking availability', tone: 'live' },
  User_FixService: { label: 'Service issue', tone: 'bad' },
  CallActivity_Approval: { label: 'Awaiting approval', tone: 'live' },
  Email_NotifyRequester: { label: 'Sending email', tone: 'live' },
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

// Element instances of one process instance. A multi-instance activity appears once as its MULTI_INSTANCE_BODY
// plus once per item; only the body is kept, so "Check session" over 3 sessions is one step, not four.
async function elementsOf(pik, state) {
  const filter = { processInstanceKey: pik };
  if (state) filter.state = state;
  const res = await camunda('POST', '/element-instances/search', { filter, sort: [{ field: 'startDate', order: 'ASC' }], page: { limit: 200 } });
  const items = res.items || [];
  const bodies = new Set(items.filter((e) => e.type === 'MULTI_INSTANCE_BODY').map((e) => e.elementId));
  return items.filter((e) => !bodies.has(e.elementId) || e.type === 'MULTI_INSTANCE_BODY');
}

async function instance(pik) {
  return camunda('GET', `/process-instances/${pik}`);
}

// The Hall Approval instances of a booking: one per approver in the chain, started by the Call Activity.
async function approvalInstancesOf(bookingKey) {
  const res = await camunda('POST', '/process-instances/search', {
    filter: { parentProcessInstanceKey: bookingKey }, sort: [{ field: 'startDate', order: 'ASC' }], page: { limit: 20 },
  });
  return (res.items || []).map((pi) => String(pi.processInstanceKey));
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

const refsOf = (heldSlots) => (Array.isArray(heldSlots) ? heldSlots.map((h) => h.ref).join(', ') : null);
const sessionsOf = (vars) => (Array.isArray(vars.sessions) ? vars.sessions.map(({ venue, bookingDate, startTime, endTime }) => ({ venue, bookingDate, startTime, endTime })) : []);

// One booking request for the pages. venue/bookingDate/startTime/endTime describe the first session, so pages
// that show one line per request keep working; `sessions` has all of them.
function summary(pi, vars, status) {
  const sessions = sessionsOf(vars);
  const first = sessions[0] || {};
  return {
    key: String(pi.processInstanceKey),
    state: pi.state,
    startDate: pi.startDate,
    endDate: pi.endDate || null,
    requesterName: vars.requesterName, email: vars.email,
    venue: first.venue, bookingDate: first.bookingDate, startTime: first.startTime, endTime: first.endTime, sessions,
    attendees: vars.attendees, purpose: vars.purpose,
    approvers: Array.isArray(vars.approvers) ? vars.approvers : [],
    approver: Array.isArray(vars.approvers) ? vars.approvers[0] : null,
    bookingRef: refsOf(vars.heldSlots), outcome: vars.outcome || null,
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
// Lanes: "desk" is the main process (hall-booking), "admin" the approval child processes (hall-approval).
// detail(v, el, a): v = booking variables, el = the element instance, a = that approval instance's variables.
const n = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const STEPS = {
  StartEvent_Requested: { lane: 'desk', label: () => 'Request submitted', detail: (v) => `${v.requesterName} · ${v.attendees} people · ${n(sessionsOf(v).length, 'session')}` },
  Script_PrepareSlot: { lane: 'desk', label: () => 'Sessions prepared', detail: (v) => sessionsOf(v).map((s) => `${s.startTime}–${s.endTime}`).join(', ') },
  Worker_ValidateRequest: { lane: 'desk', label: () => 'Checked by worker', detail: (v, el) => el.state === 'ACTIVE' ? 'Waiting for the worker' : (v.validation && v.validation.valid ? 'Valid' : '') },
  Boundary_Invalid: { lane: 'desk', label: () => 'Request invalid', detail: (v) => (v.validation && v.validation.message) || '' },
  Rest_CheckSession: { lane: 'desk', label: () => 'Sessions checked in parallel', detail: (v, el) => el.state === 'TERMINATED' ? 'Interrupted' : `${n(sessionsOf(v).length, 'register lookup')}` },
  Script_DetectConflict: { lane: 'desk', label: () => 'Clash check', detail: (v) => v.conflictCheck ? (v.conflictCheck.hasConflict ? `Clash: ${v.conflictCheck.clashes.map((c) => `${c.venue} ${c.bookingDate} ${c.startTime}–${c.endTime}`).join(', ')}` : 'All sessions free') : '' },
  Boundary_ServiceDown: { lane: 'desk', label: () => 'Booking service unreachable', detail: (v) => v.serviceError || '' },
  Timer_CheckTimeout: { lane: 'desk', label: () => 'Availability check timed out', detail: () => 'No answer within 30 seconds' },
  User_FixService: { lane: 'desk', label: () => 'Admin resolves service issue', detail: (v, el) => el.state === 'ACTIVE' ? 'Waiting for Retry or Cancel' : (v.serviceFixAction === 'RETRY' ? 'Retried' : 'Cancelled') },
  Script_SetReason: { lane: 'desk', label: () => 'Slot already taken', detail: () => '' },
  Script_SetServiceError: { lane: 'desk', label: () => 'Request cancelled', detail: () => 'Booking service unavailable' },
  Dmn_DecideApprover: { lane: 'desk', label: () => 'Approver per session', detail: (v) => Array.isArray(v.sessionApprovers) ? `${v.sessionApprovers.map(roleName).join(', ')} (decision table)` : '' },
  Script_PlanApprovals: { lane: 'desk', label: () => 'Approval chain', detail: (v) => Array.isArray(v.approvers) ? v.approvers.map(roleName).join(' → ') : '' },
  Rest_HoldSlot: { lane: 'desk', label: () => 'Slots held', detail: (v) => v.heldSlots ? `${refsOf(v.heldSlots)}, pending` : '' },
  CallActivity_Approval: { lane: 'desk', label: () => 'Approval requested', detail: (v) => Array.isArray(v.approvers) ? `${n(v.approvers.length, 'approver')}, one after another` : '', message: 'out' },
  StartEvent_Approval: { lane: 'admin', label: () => 'Review opened', detail: (v, el, a) => `For ${roleName(a.approver)}${a.approvalSteps > 1 ? ` (step ${a.approvalStep} of ${a.approvalSteps})` : ''}`, message: 'in' },
  User_Approval: { lane: 'admin', label: () => 'Review by approver', detail: (v, el, a) => el.state === 'ACTIVE' ? `Waiting for ${roleName(a.approver)}` : (el.state === 'TERMINATED' ? 'No response in time' : (a.approved ? 'Approved' : 'Rejected') + (a.remarks ? `: “${a.remarks}”` : '')) },
  Worker_Reminder: { lane: 'admin', label: () => 'Reminder sent', detail: (v, el, a) => `To ${roleName(a.approver)} after 1 minute` },
  Script_MarkExpired: { lane: 'admin', label: () => 'Marked as expired', detail: () => 'Not reviewed within 2 minutes' },
  End_Decided: { lane: 'admin', label: () => 'Decision returned', detail: (v, el, a) => a.decision ? `${a.decision.outcome} by ${roleName(a.approver)}` : '', message: 'out' },
  Script_SummarizeDecision: { lane: 'desk', label: () => 'Decisions combined', detail: (v) => v.decision ? v.decision.outcome : '', message: 'in' },
  Rest_ConfirmSlot: { lane: 'desk', label: () => 'Slots confirmed', detail: (v) => refsOf(v.heldSlots) || '' },
  Rest_ReleaseRejected: { lane: 'desk', label: () => 'Slots released', detail: () => 'Request was rejected' },
  Rest_ReleaseExpired: { lane: 'desk', label: () => 'Slots released', detail: () => 'Request expired' },
  Email_NotifyRequester: { lane: 'desk', label: () => 'Email sent', detail: (v, el) => el.state === 'ACTIVE' ? 'Sending…' : (el.state === 'TERMINATED' ? 'Not delivered' : `To ${v.email} (Email connector, SMTP)`) },
  Boundary_EmailFailed: { lane: 'desk', label: () => 'Email failed', detail: (v) => v.emailError || 'Mail server unreachable' },
  Worker_Notify: { lane: 'desk', label: () => 'Notification recorded', detail: (v) => v.emailStatus === 'FAILED' ? 'Kept for follow-up; the email did not go out' : 'In the notifications log' },
};
const roleName = (id) => (ROLES.find((r) => r.id === id) || {}).name || id || '';

async function bookingDetail(pik) {
  const pi = await instance(pik);
  if (pi.processDefinitionId && pi.processDefinitionId !== BOOKING_PROCESS) throw new UpstreamError('app', 'That is not a booking.', 404);
  const [vars, deskEls] = await Promise.all([variablesOf(pik), elementsOf(pik)]);
  const activeIds = deskEls.filter((e) => e.state === 'ACTIVE').map((e) => e.elementId);
  const status = statusOf(pi, vars, activeIds);

  // One Hall Approval instance per approver in the chain; each element remembers whose variables it uses.
  const approvalKeys = await approvalInstancesOf(pik);
  const approvals = await Promise.all(approvalKeys.map(async (k) => {
    const [a, els] = await Promise.all([variablesOf(k), elementsOf(k)]);
    return { key: k, vars: a, els: els.map((e) => ({ ...e, approvalVars: a })) };
  }));
  let review = null;
  for (const ap of approvals) {
    const open = ap.els.find((e) => e.elementId === 'User_Approval' && e.state === 'ACTIVE');
    if (open) {
      const due = new Date(new Date(open.startDate).getTime() + APPROVAL_MINUTES * 60000).toISOString();
      review = { since: open.startDate, due, reminderSent: !!ap.vars.reminderSentAt, approver: ap.vars.approver, step: ap.vars.approvalStep, steps: ap.vars.approvalSteps };
    }
  }

  // A step "happened" when it finished (a review can take minutes); running steps go last. Hand-overs between the
  // lanes are the exception: a hand-over counts from its start, so it sorts just before the step that receives it.
  // Zeebe often finishes a whole chain (timer -> child end -> parent's next step) in the same millisecond; then the
  // element instance key decides, as keys grow in creation order (one partition on Camunda 8 Run).
  const happened = (e) => (STEPS[e.elementId].message === 'out' ? new Date(e.startDate).getTime()
    : e.endDate ? new Date(e.endDate).getTime() : Infinity);
  const byKey = (a, b) => (BigInt(a.elementInstanceKey) < BigInt(b.elementInstanceKey) ? -1 : 1);
  const steps = [...deskEls, ...approvals.flatMap((ap) => ap.els)]
    .filter((e) => STEPS[e.elementId])
    .sort((a, b) => (happened(a) - happened(b)) || (new Date(a.startDate) - new Date(b.startDate)) || byKey(a, b))
    .map((e) => {
      const def = STEPS[e.elementId];
      const a = e.approvalVars || {};
      return {
        id: e.elementId, lane: def.lane, message: def.message || null, state: e.state,
        at: def.message === 'out' ? e.startDate : (e.endDate || e.startDate), label: def.label(vars, e, a), detail: def.detail(vars, e, a) || '',
      };
    });

  let notification = null;
  if (vars.notificationId) { try { notification = await bookingsDb(`/notifications/${vars.notificationId}`); } catch { /* shown without it */ } }

  return {
    ...summary(pi, vars, status),
    approvalKeys,
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
    // Review tasks live in a Hall Approval child instance: its parent is the booking. Service tasks are in the booking itself.
    const [v, pi] = await Promise.all([variablesOf(t.processInstanceKey), kind === 'approval' ? instance(t.processInstanceKey).catch(() => ({})) : null]);
    const sessions = sessionsOf(v);
    const first = sessions[0] || {};
    const created = t.creationDate;
    return {
      key: String(t.userTaskKey), kind, processInstanceKey: String(t.processInstanceKey), created,
      due: kind === 'approval' ? new Date(new Date(created).getTime() + APPROVAL_MINUTES * 60000).toISOString() : null,
      reminderSent: !!v.reminderSentAt,
      requesterName: v.requesterName, email: v.email, venue: first.venue, bookingDate: first.bookingDate,
      startTime: first.startTime, endTime: first.endTime, sessions, attendees: v.attendees, purpose: v.purpose,
      approver: v.approver || null, approvalStep: v.approvalStep || null, approvalSteps: v.approvalSteps || null,
      bookingRef: v.bookingRef || refsOf(v.heldSlots), serviceError: v.serviceError || null,
      bookingKey: kind === 'service' ? String(t.processInstanceKey) : (pi && pi.parentProcessInstanceKey ? String(pi.parentProcessInstanceKey) : null),
    };
  }));
  return tasks
    .filter((t) => !role || role === 'all' || t.approver === role)
    .sort((a, b) => new Date(a.created) - new Date(b.created));
}

// ---------------------------------------------------------------- validation of new requests

const HOURS = Array.from({ length: 11 }, (_, i) => `${String(8 + i).padStart(2, '0')}:00`);
// Form checks only (missing or malformed fields). Business rules (past dates, capacity, overlaps) are left
// to the worker, so the process shows them as outcomes. Session errors are keyed by the single-session field
// name for the first session (the current form) and as sessions.<n>.<field> for the others.
function checkNewBooking(b) {
  const errors = {};
  const need = (k, msg) => { if (b[k] === undefined || b[k] === null || String(b[k]).trim() === '') errors[k] = msg; };
  need('requesterName', 'Enter your name.');
  need('email', 'Enter your email.');
  if (b.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email)) errors.email = 'Enter an email like name@college.edu.';
  if (!Number.isInteger(b.attendees) || b.attendees < 1) errors.attendees = 'Enter the number of people (at least 1).';
  if (!b.sessions.length) errors.sessions = 'Add at least one session.';
  if (b.sessions.length > 10) errors.sessions = 'Ten sessions at most per request.';
  b.sessions.forEach((s, i) => {
    const key = (field) => (i === 0 ? field : `sessions.${i}.${field}`);
    if (!VENUES.some((v) => v.id === s.venue)) errors[key('venue')] = 'Choose a venue.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.bookingDate || '')) errors[key('bookingDate')] = 'Choose a date.';
    if (!HOURS.includes(s.startTime)) errors[key('startTime')] = 'Choose a start time.';
    if (!HOURS.includes(s.endTime)) errors[key('endTime')] = 'Choose an end time.';
  });
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
    // The process takes a list of sessions. The current form sends one session as flat fields; a list is used as is.
    const raw = Array.isArray(b.sessions) ? b.sessions : [{ venue: b.venue, bookingDate: b.bookingDate, startTime: b.startTime, endTime: b.endTime }];
    const booking = {
      requesterName: String(b.requesterName || '').trim(), email: String(b.email || '').trim(),
      attendees: Number(b.attendees), purpose: String(b.purpose || '').trim(),
      sessions: raw.map((s) => ({ venue: s.venue, bookingDate: s.bookingDate, startTime: s.startTime, endTime: s.endTime })),
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
