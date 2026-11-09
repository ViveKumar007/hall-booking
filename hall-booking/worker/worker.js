// External job worker for the hall booking process.
//
// Camunda does not run these tasks itself. It creates a "job" for each one, and this program asks
// Camunda for jobs of the three types below (POST /v2/jobs/activation), does the work, and reports
// back: /completion when done, /error for a business error the process handles (BPMN error),
// /failure for a technical problem (Camunda retries, then raises an incident).
//
// No libraries needed: Node 18+ has fetch built in. Start it with scripts\start-worker.cmd.

const fs = require('fs');
const http = require('http');
const path = require('path');

const CAMUNDA = process.env.CAMUNDA_URL || 'http://localhost:8080';
const MOCK = process.env.MOCK_BASE_URL || 'http://127.0.0.1:3000';
const WORKER_NAME = 'hall-booking-worker';
const OUTBOX = path.join(__dirname, 'outbox');
const HEALTH_PORT = Number(process.env.WORKER_PORT || 8091);

// Counters for GET http://127.0.0.1:8091/health (the web app shows whether the worker is running).
const stats = { status: 'UP', startedAt: new Date().toISOString(), lastJobAt: null, handled: {} };

// Maximum people per venue. Requests above this end with outcome OVER_CAPACITY.
const CAPACITY = { 'hall-a': 200, 'hall-b': 150, 'lab-1': 60 };

const handlers = {
  'validate-booking': validateBooking,
  'send-reminder': sendReminder,
  'record-notification': recordNotification,
};

// A business error: the worker reports it with POST /v2/jobs/{key}/error, and the process continues at the
// matching error boundary event (here: Boundary_Invalid on Validate request) instead of raising an incident.
class BpmnError extends Error {
  constructor(code, message, variables = {}) { super(message); this.code = code; this.variables = variables; }
}

// ---------------------------------------------------------------- job handlers

const describe = (s) => `${s.venue} ${s.bookingDate} ${s.startTime}-${s.endTime}`;

// Checks what FEEL can't easily check, for every session of the request: times make sense, the date is not
// in the past, the venue is big enough, and no two sessions of the same request overlap each other.
async function validateBooking(v) {
  const today = new Date().toLocaleDateString('en-CA'); // yyyy-mm-dd in local time
  const sessions = Array.isArray(v.sessions) ? v.sessions : [];
  const many = sessions.length > 1;
  const reject = (reason, message, session = null) => {
    log('validate-booking', `${v.requesterName} | ${sessions.map(describe).join(' + ')} -> ${reason}: ${message}`);
    throw new BpmnError('INVALID_REQUEST', message, {
      outcome: reason,
      validation: { valid: false, reason, message, session, checkedOn: today },
    });
  };
  // "Session 2: the end time ..." for multi-session requests, "The end time ..." for a single one.
  const say = (i, text) => (many ? `Session ${i + 1}: ${text}` : text.charAt(0).toUpperCase() + text.slice(1));

  if (!sessions.length) reject('INVALID_TIME', 'The request has no sessions.');
  sessions.forEach((s, i) => {
    const capacity = CAPACITY[s.venue];
    if (!s.slot || !(s.slot.durationHours > 0)) reject('INVALID_TIME', say(i, 'the end time must be after the start time.'), i + 1);
    if (!s.bookingDate || s.bookingDate < today) reject('PAST_DATE', say(i, `the booking date ${s.bookingDate} has already passed.`), i + 1);
    if (capacity !== undefined && v.attendees > capacity) {
      reject('OVER_CAPACITY', say(i, `${s.venue} holds at most ${capacity} people; you asked for ${v.attendees}.`), i + 1);
    }
  });
  for (let i = 0; i < sessions.length; i++) {
    for (let j = i + 1; j < sessions.length; j++) {
      const a = sessions[i], b = sessions[j];
      if (a.venue === b.venue && a.bookingDate === b.bookingDate && a.slot.startHour < b.slot.endHour && a.slot.endHour > b.slot.startHour) {
        reject('INVALID_TIME', `Sessions ${i + 1} and ${j + 1} overlap (${describe(a)} and ${describe(b)}).`, j + 1);
      }
    }
  }

  log('validate-booking', `${v.requesterName} | ${sessions.map(describe).join(' + ')}, ${v.attendees} people -> VALID`);
  return { validation: { valid: true, reason: null, message: null, sessions: sessions.length, checkedOn: today } };
}

async function sendReminder(v) {
  const sessions = (v.sessions || []).map((s) => `- ${describe(s)}`).join('\n');
  const text = `To: ${v.approverRole}\nSubject: Reminder: booking ${v.bookingRef} is waiting for your review\n\n` +
    `${v.requesterName} asked for these sessions, for ${v.attendees} people:\n${sessions}\n` +
    `Please approve or reject it in the Hall Booking inbox. It expires automatically after 2 minutes.\n`;
  const file = writeOutbox('REMINDER', v.approverRole, text);
  log('send-reminder', `reminded ${v.approverRole} about ${v.bookingRef} -> outbox/${file}`);
  return { reminderSentAt: new Date().toISOString() };
}

// Records the notification after the Email connector has tried to send it: a copy in outbox/ and an entry in
// the mock API's /notifications list, including whether the email went out (emailStatus SENT or FAILED).
// The mock call is best effort, so the record is kept in outbox/ even when the booking service is down.
async function recordNotification(v) {
  const emailStatus = v.emailStatus || 'UNKNOWN';
  const text = `To: ${v.to}\nSubject: ${v.subject}\nEmail: ${emailStatus}${v.emailError ? ` (${v.emailError})` : ''}\n\n${v.message}\n`;
  const file = writeOutbox(v.outcome, v.to, text);
  let notificationId = null;
  try {
    const res = await fetch(`${MOCK}/notifications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: v.to, subject: v.subject, message: v.message, bookingRef: v.bookingRef ?? null,
        emailStatus, emailError: v.emailError ?? null, sentAt: new Date().toISOString(),
      }),
    });
    if (res.ok) notificationId = (await res.json()).id;
  } catch (e) {
    log('record-notification', `could not record in mock API (${e.message}); kept in outbox anyway`);
  }
  log('record-notification', `${v.subject} -> ${v.to} | email ${emailStatus} | outbox/${file}`);
  return { notificationId, notifiedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------- plumbing

async function api(method, urlPath, body) {
  const res = await fetch(CAMUNDA + urlPath, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${urlPath} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

async function work(type, handler) {
  let waiting = false;
  for (;;) {
    let jobs;
    try {
      // Long poll: Camunda holds the request open up to 10 s until a job of this type exists.
      // timeout: the job is locked to this worker for 10 s. If the worker dies before completing it,
      // Camunda hands the job to another worker after that.
      const res = await api('POST', '/v2/jobs/activation', {
        type, worker: WORKER_NAME, timeout: 10000, maxJobsToActivate: 10, requestTimeout: 10000,
      });
      jobs = res.jobs || [];
      if (waiting) { log('worker', `connected to Camunda again (${type})`); waiting = false; }
    } catch (e) {
      if (!waiting) { log('worker', `Camunda not reachable for ${type}, retrying every 5 s (${e.message.split('\n')[0]})`); waiting = true; }
      await sleep(5000);
      continue;
    }
    for (const job of jobs) {
      try {
        const variables = await handler(job.variables || {}, job);
        await api('POST', `/v2/jobs/${job.jobKey}/completion`, { variables });
        stats.handled[type] = (stats.handled[type] || 0) + 1;
        stats.lastJobAt = new Date().toISOString();
      } catch (e) {
        if (e instanceof BpmnError) {
          await api('POST', `/v2/jobs/${job.jobKey}/error`, { errorCode: e.code, errorMessage: e.message, variables: e.variables })
            .catch((err) => log(type, `could not report BPMN error for job ${job.jobKey}: ${err.message}`));
          stats.handled[type] = (stats.handled[type] || 0) + 1;
          stats.lastJobAt = new Date().toISOString();
          continue;
        }
        const retries = Math.max((job.retries || 1) - 1, 0);
        log(type, `FAILED job ${job.jobKey}: ${e.message} (retries left: ${retries})`);
        await api('POST', `/v2/jobs/${job.jobKey}/failure`, { retries, errorMessage: e.message, retryBackOff: 5000 }).catch(() => {});
      }
    }
  }
}

function writeOutbox(kind, who, text) {
  fs.mkdirSync(OUTBOX, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = `${stamp}_${kind || 'MESSAGE'}_${String(who || 'unknown').replace(/[^a-zA-Z0-9@._-]/g, '_')}.txt`;
  fs.writeFileSync(path.join(OUTBOX, file), text);
  return file;
}

function log(type, msg) {
  const time = new Date().toLocaleTimeString('en-GB');
  console.log(`[${time}] ${type.padEnd(17)} ${msg}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
  } else {
    res.writeHead(404);
    res.end();
  }
}).on('error', (e) => log('worker', `health endpoint not started: ${e.message}`))
  .listen(HEALTH_PORT, '127.0.0.1');

log('worker', `started: ${Object.keys(handlers).join(', ')}`);
log('worker', `Camunda ${CAMUNDA} | mock API ${MOCK} | outbox ${OUTBOX} | health http://127.0.0.1:${HEALTH_PORT}/health`);
for (const [type, handler] of Object.entries(handlers)) work(type, handler);
