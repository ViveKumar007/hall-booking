// External job worker for the hall booking process.
//
// Camunda does not run these tasks itself. It creates a "job" for each one, and this program asks
// Camunda for jobs of the four types below (POST /v2/jobs/activation), does the work, and reports
// back (POST /v2/jobs/{key}/completion, or /failure if something went wrong).
//
// No libraries needed: Node 18+ has fetch built in. Start it with scripts\start-worker.cmd.

const fs = require('fs');
const path = require('path');

const CAMUNDA = process.env.CAMUNDA_URL || 'http://localhost:8080';
const MOCK = process.env.MOCK_BASE_URL || 'http://127.0.0.1:3000';
const WORKER_NAME = 'hall-booking-worker';
const OUTBOX = path.join(__dirname, 'outbox');

// Maximum people per venue. Requests above this end with outcome OVER_CAPACITY.
const CAPACITY = { 'hall-a': 200, 'hall-b': 150, 'lab-1': 60 };

const handlers = {
  'validate-booking': validateBooking,
  'publish-message': publishMessage,
  'send-reminder': sendReminder,
  'send-notification': sendNotification,
};

// ---------------------------------------------------------------- job handlers

// Checks what FEEL can't easily check: times make sense, the date is not in the past, the venue is big enough.
async function validateBooking(v) {
  const today = new Date().toLocaleDateString('en-CA'); // yyyy-mm-dd in local time
  const capacity = CAPACITY[v.venue] ?? null;
  let reason = null;
  if (!v.slot || !(v.slot.durationHours > 0)) reason = 'INVALID_TIME';
  else if (!v.bookingDate || v.bookingDate < today) reason = 'PAST_DATE';
  else if (capacity !== null && v.attendees > capacity) reason = 'OVER_CAPACITY';

  const validation = { valid: reason === null, reason, capacity, checkedOn: today };
  log('validate-booking', `${v.requesterName} | ${v.venue} ${v.bookingDate} ${v.startTime}-${v.endTime}, ${v.attendees} people -> ${reason || 'VALID'}`);
  return reason ? { validation, outcome: reason } : { validation };
}

// Used by both send tasks. The message name comes from the task header, the correlation key and
// payload from the task's input mappings. Camunda delivers the message to whichever process is
// waiting for it: the approval pool's message start event, or the booking pool's receive task.
async function publishMessage(v, job) {
  const name = job.customHeaders.messageName;
  const correlationKey = String(v.correlationKey);
  await api('POST', '/v2/messages/publication', {
    name,
    correlationKey,
    timeToLive: 3600000, // keep it for 1 hour if nobody is waiting yet
    variables: v.messageVariables || {},
  });
  log('publish-message', `${name} (key ${correlationKey})`);
  return {};
}

async function sendReminder(v) {
  const text = `To: ${v.approverRole}\nSubject: Reminder: booking ${v.bookingRef} is waiting for your review\n\n` +
    `${v.requesterName} asked for ${v.venue} on ${v.bookingDate}, ${v.startTime}-${v.endTime}, for ${v.attendees} people.\n` +
    `Please approve or reject it in Tasklist. It expires automatically after 2 minutes.\n`;
  const file = writeOutbox('REMINDER', v.approverRole, text);
  log('send-reminder', `reminded ${v.approverRole} about ${v.bookingRef} -> outbox/${file}`);
  return { reminderSentAt: new Date().toISOString() };
}

// "Sends" the email: saves it in outbox/ and records it in the mock API's /notifications list.
// The mock call is best effort, so the requester is still notified when the booking service is down.
async function sendNotification(v) {
  const text = `To: ${v.to}\nSubject: ${v.subject}\n\n${v.message}\n`;
  const file = writeOutbox(v.outcome, v.to, text);
  let notificationId = null;
  try {
    const res = await fetch(`${MOCK}/notifications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: v.to, subject: v.subject, message: v.message, bookingRef: v.bookingRef ?? null, sentAt: new Date().toISOString() }),
    });
    if (res.ok) notificationId = (await res.json()).id;
  } catch (e) {
    log('send-notification', `could not record in mock API (${e.message}); email saved anyway`);
  }
  log('send-notification', `${v.subject} -> ${v.to} | outbox/${file}`);
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
      } catch (e) {
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

log('worker', `started: ${Object.keys(handlers).join(', ')}`);
log('worker', `Camunda ${CAMUNDA} | mock API ${MOCK} | outbox ${OUTBOX}`);
for (const [type, handler] of Object.entries(handlers)) work(type, handler);
