# Seminar Hall & Lab Booking (Camunda 8, two pools + external worker)

A booking workflow drawn as a **collaboration of two pools**. The **Booking Desk** validates a request (through our
external worker), checks it for clashes against a REST booking service, asks a DMN table who must approve, holds the
slot, and sends an approval request to the **Hall Administration**. There, an approver reviews it, gets a reminder
after 1 minute, and the request expires after 2 minutes. The decision goes back by message; the slot is confirmed or
released; the requester is notified. If the booking service is down, an admin chooses Retry or Cancel.

Runs on **Camunda 8 Run 8.8 (local)**. A mock REST API (json-server) plays the booking database. Full explanation:
[`../PROJECT-GUIDE.md`](../PROJECT-GUIDE.md). Specification: [`../PLAN.md`](../PLAN.md).

| Course requirement | Where |
|---|---|
| User tasks with Camunda Forms | *Review booking* (`approval-form`), *Resolve service issue* (`service-fix-form`); start form `booking-request-form` |
| Exclusive gateways (with default flows) | Request valid?, Retry?, Slot available?, Decision? |
| Script tasks (FEEL) | Prepare slot, Detect conflict, Set rejection reason, Set service error, Record decision, Mark as expired |
| **REST connectors** | Fetch existing bookings, Hold slot, Confirm slot, Release slot ×2 |
| **External worker** | `worker/worker.js`: Validate request, Send approval request, Send decision, Remind approver, Notify requester |
| Business rule task (DMN) | Decide approver → `decide-approver.dmn` |
| Timer boundary events | 1 min non-interrupting (reminder), 2 min interrupting (expiry) on *Review booking* |
| Error boundary event | *Service down* on Fetch existing bookings |
| Pools and message flows | Booking Desk ⇄ Hall Administration: approval request, decision |
| Notification step | Notify requester (worker): email in `worker/outbox/`, recorded in `/notifications` |

## Files

| File | What it is |
|---|---|
| `hall-booking.bpmn` | Collaboration: processes `hall-booking` (Booking Desk) and `hall-approval` (Hall Administration) |
| `decide-approver.dmn` | Decision `decide-approver` (hit policy FIRST) |
| `booking-request-form.form`, `approval-form.form`, `service-fix-form.form` | The three forms |
| `worker/worker.js` | External job worker (plain Node.js, no libraries); health at http://127.0.0.1:8091/health |
| `app/server.js`, `app/public/` | The web app (plain HTML/CSS/JS + a small Node server) on http://localhost:8090 |
| `mock/db.seed.json` | Seed data (3 bookings in January 2027). `mock/db.json` is created from it and not committed |
| `scripts/start-all.cmd` | Opens the four windows below and the app in the browser |
| `scripts/start-mock.cmd`, `start-camunda.cmd`, `start-worker.cmd`, `start-app.cmd` | The four windows to keep open |
| `scripts/deploy.cmd`, `reset-mock.cmd`, `stop-camunda.cmd` | Deploy everything; restore seed data; stop Camunda |
| `scripts/run-scenarios.ps1` | 19 automated test cases with PASS/FAIL |

## Start everything (about 3 minutes)

Quickest: double-click `scripts\start-all.cmd`, wait until the three lights at the top of the app are green, then run
`scripts\reset-mock.cmd`. Step by step:

1. `scripts\start-mock.cmd`: mock API on http://127.0.0.1:3000. Keep the window open.
2. `scripts\start-camunda.cmd`: wait for "All processes are running and healthy". Run it once more if it gives up.
3. `scripts\start-worker.cmd`: the external worker. Keep the window open; it prints every job.
4. `scripts\start-app.cmd`: the web app. Open **http://localhost:8090**.
5. http://localhost:8080/operate: log in with `demo` / `demo`.
6. `scripts\deploy.cmd`: first time, or after changing a file.
7. `scripts\reset-mock.cmd`: before a demo or a test run.

## Demo outline (about 10 minutes)

1. **Model.** In Modeler, show the two pools and the dashed message flows. Then the Desk path, the worker tasks, the error
   boundary, and the two timers. Open the DMN table.
2. **Start the timer case first** in the app (http://localhost:8090, *Viewing as: Requester* → New booking):
   Computer Lab 1, 13 Jan 2027, 10:00–12:00, 30 people. Leave its approval alone.
3. **Happy path:** New booking for Seminar Hall A, 12 Jan 2027, 14:00–16:00, 50 people. The request page shows the
   route filling in live. Switch *Viewing as* to *Approver · Admin office* → Inbox → Approve. The route ends in the
   APPROVED stamp and shows the email.
4. **Worker validation:** Computer Lab 1 with 61 people. The form warns first; send it anyway → `OVER CAPACITY`.
5. **Conflict:** Seminar Hall A, 11 Jan 2027, 11:00–13:00. The form's day board shows the clash → `SLOT TAKEN`.
6. **Service down:** close the booking service window (the *Bookings* light turns red), send a booking. As *Admin* →
   Service issues. Restart `start-mock.cmd`, click **Retry now** → the booking continues.
7. **Timer case and Operate:** open the timer case's request page: reminder after 1 minute, expired after 2.
   Then in Operate show that each booking has two instances (Booking + Hall Approval).
8. **Deployment:** change something small (e.g. the reminder to `PT30S`), deploy from Modeler, and show in Operate
   that a new version of the process appeared while finished instances keep their old version.

## Test cases

19 automated cases (A–R, all PASS on 2026-10-21) and 3 manual ones (service down + retry, service down + cancel,
worker down; all PASS). The full table is in [`PROJECT-GUIDE.md` §8](../PROJECT-GUIDE.md#8-test-cases).

```
scripts\reset-mock.cmd
powershell -ExecutionPolicy Bypass -File scripts\run-scenarios.ps1
```

## Screenshot checklist for the report

- [ ] The collaboration diagram (both pools, message flows) in Modeler
- [ ] DMN decision table
- [ ] Tasklist: start form; *Review booking* form; *Resolve service issue* form
- [ ] Worker window with a few jobs, and an email file from `worker/outbox`
- [ ] Operate: an approved booking and its Hall Approval instance; a conflict; an expired one (timer path, reminder)
- [ ] Operate: the *Resolve service issue* → Retry path
- [ ] Operate: process versions after a redeploy
- [ ] `run-scenarios.ps1` output: 19 of 19 passed
