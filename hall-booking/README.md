# Seminar Hall & Lab Booking (Camunda 8: multi-instance, sub-process, call activity, job workers)

One request books **one or more sessions** (for example a three-day workshop). The main process validates the request
through a job worker, then checks every session for clashes **in parallel** inside a **sub-process** that has an
**error boundary** (booking service down) and a **timer boundary** (no answer within 30 s). A DMN table picks an
approver **per session**; the slots are held; then a **Call Activity** asks each approver **in turn** through the
reusable child process *Hall Approval* (reminder after 1 minute, expiry after 2), stopping at the first rejection. The
slots are confirmed or released and the requester is notified.

Runs on **Camunda 8 Run 8.8 (local)** with the **Spring Boot backend** ([`../backend-springboot`](../backend-springboot/README.md)):
REST API, booking register (JPA, H2), and the job workers. Specification:
[`../PLAN.md`](../PLAN.md). Background and run guide: [`../PROJECT-GUIDE.md`](../PROJECT-GUIDE.md) (still describes
the earlier two-pool version in places).

| Course requirement | Where |
|---|---|
| Main process + reusable child process | `hall-booking` (main), `hall-approval` (child, own file) |
| **Call Activity** with input/output mappings | *Get approval* → `hall-approval`; only mapped variables go in, only `decision` comes back |
| **Multi-instance, parallel** | *Check session*, *Decide approver*, *Hold slot*, *Confirm slot*, *Release slot* ×2 (one per session) |
| **Multi-instance, sequential** | *Get approval*: one approver after another, stops at the first decision that is not APPROVED |
| **Sub-process with error + timer boundary** | *Check availability*: *Service down* (error), *After 30 s* (timer) → *Resolve service issue* |
| User tasks with Camunda Forms | *Review booking* (`approval-form`), *Resolve service issue* (`service-fix-form`); start form with a session list |
| Exclusive gateways (with default flows) | Retry?, All sessions free?, Decision? (+ merges) |
| Script tasks (FEEL) | Prepare sessions, Detect conflict, Plan approval chain, Combine decisions, Set timeout error, … |
| **REST connectors** (secret `BOOKING_API_URL`) | Check session, Hold slot, Confirm slot, Release slot ×2 |
| **Email connector** (SMTP secrets) | *Email requester*: host, port, login and sender from `{{secrets.SMTP_*}}` / `{{secrets.MAIL_FROM}}`; *Email failed* error boundary |
| **Job workers** with a BPMN error | Spring Boot `@JobWorker`s: Validate request (throws `ZeebeBpmnError` `INVALID_REQUEST`), Remind approver, Record notification |
| Business rule task (DMN) | Decide approver → `decide-approver.dmn` |
| Timer boundary events on a task | 1 min non-interrupting (reminder), 2 min interrupting (expiry) on *Review booking* |
| Notification step | Compose notification (FEEL) → Email requester (connector, to the MailDev inbox) → Record notification (job worker, `notification` table) |

## Files

| File | What it is |
|---|---|
| `hall-booking.bpmn` | Main process `hall-booking` |
| `hall-approval.bpmn` | Child process `hall-approval`, called once per approver |
| `decide-approver.dmn` | Decision `decide-approver` (hit policy FIRST) |
| `booking-request-form.form`, `approval-form.form`, `service-fix-form.form` | The three forms |
| `app/public/` | The pages (plain HTML/CSS/JS), served by the backend on http://localhost:8090 until the React app replaces them |
| `../backend-springboot/` | Spring Boot backend: `/api`, booking register `/register`, job workers, H2 database |
| `scripts/start-all.cmd` | Opens the three windows below and the app in the browser |
| `scripts/start-mail.cmd`, `start-camunda.cmd`, `start-backend.cmd` | The three windows to keep open |
| `scripts/secrets.example.cmd` | Connector secrets template; copied to the git-ignored `secrets.cmd` on the first start |
| `scripts/deploy.cmd`, `reset-data.cmd`, `stop-camunda.cmd` | Deploy by hand (the backend also deploys at start); restore the seed bookings; stop Camunda |
| `scripts/run-scenarios.ps1` | 25 automated test cases with PASS/FAIL |

## Start everything (about 3 minutes)

Quickest: double-click `scripts\start-all.cmd`, wait until the three lights at the top of the app are green, then run
`scripts\reset-data.cmd`. Step by step:

1. `scripts\start-mail.cmd`: local mail server; read the emails at **http://localhost:1080**. Keep the window open.
2. `scripts\start-camunda.cmd`: wait for "All processes are running and healthy". Run it once more if it gives up.
   It loads the connector secrets from `scripts\secrets.cmd` (created from `secrets.example.cmd` the first time).
3. `scripts\start-backend.cmd`: the Spring Boot backend (about 20 s; the first start downloads Maven and the libraries).
   It deploys the BPMN, DMN and forms, runs the job workers and prints every job. Open **http://localhost:8090**.
4. http://localhost:8080/operate: log in with `demo` / `demo`.
5. `scripts\reset-data.cmd`: before a demo or a test run.

## Demo outline (about 10 minutes)

1. **Model.** In Modeler, show the main process: the *Check availability* sub-process with its error and timer
   boundaries, the parallel markers (|||) on the per-session tasks, and *Get approval* (sequential ≡, call activity).
   Open `hall-approval.bpmn` (the child) and the DMN table.
2. **Start the timer case first** in the app (http://localhost:8090, *Viewing as: Requester* → New booking):
   Computer Lab 1, 13 Jan 2027, 10:00–12:00, 30 people. Leave its approval alone.
3. **Happy path:** New booking for Seminar Hall A, 12 Jan 2027, 14:00–16:00, 50 people. The request page shows the
   route filling in live. Switch *Viewing as* to *Approver · Admin office* → Inbox → Approve. The route ends in the
   APPROVED stamp; open http://localhost:1080 to show the email the Email connector delivered.
4. **Worker validation:** Computer Lab 1 with 61 people. The form warns first; send it anyway → `OVER CAPACITY`.
5. **Conflict:** Seminar Hall A, 11 Jan 2027, 11:00–13:00. The form's day board shows the clash → `SLOT TAKEN`.
6. **Service down:** as *Admin* → Service issues, switch *Booking register (demo)* to **Down** (the *Bookings* light
   turns red) and send a booking: it lands here through the error boundary. Switch back to **Normal**, click
   **Retry now** → the booking continues. With **Slow** the 30 s timer boundary fires instead.
7. **Timer case and Operate:** open the timer case's request page: reminder after 1 minute, expired after 2.
   Then in Operate open a booking: the multi-instance bodies, and the *Get approval* call activity drilling into its
   *Hall Approval* child instance(s).
8. **Several sessions:** in Tasklist → Processes → *Seminar Hall and Lab Booking*, add two sessions (Seminar Hall A
   and Computer Lab 1). Two approvers are asked one after the other; reject at the first one and show in Operate that
   the second was never asked (chain stopped) and both slots were released.
9. **Deployment:** change something the app does not repeat (e.g. the 30 s availability timer), deploy from Modeler,
   and show in Operate that a new version appeared while finished instances keep their old version.

## Test cases

25 automated cases (A–R plus MS1–MS6 for several sessions, all PASS on 2026-11-09 against the Spring Boot backend)
and manual ones (service down + retry, service down + cancel, slow service / timer boundary, mail down, workers down).
The full table is in [`../PLAN.md` §8](../PLAN.md#8-test-cases). Backend unit tests: `backend-springboot\mvnw.cmd test`.

```
scripts\reset-data.cmd
powershell -ExecutionPolicy Bypass -File scripts\run-scenarios.ps1
```

## Screenshot checklist for the report

- [ ] The main process and the child process in Modeler (sub-process, MI markers, call activity)
- [ ] DMN decision table
- [ ] Tasklist: start form with two sessions; *Review booking* form (approval 1 of 2); *Resolve service issue* form
- [ ] Backend window with a few jobs (including a BPMN error), and the H2 console (http://localhost:8090/h2-console) with the tables
- [ ] MailDev inbox (http://localhost:1080) with a delivered booking email; the *Email requester* properties in Modeler showing `{{secrets.…}}`
- [ ] Operate: a booking that took the *Email failed* path (mail server closed), still completed
- [ ] Operate: a two-session booking with its two Hall Approval instances; a chain stopped at the first rejection
- [ ] Operate: a conflict; an expired one (timer path, reminder)
- [ ] Operate: the *Resolve service issue* → Retry path, from both the error boundary and the 30 s timer
- [ ] Operate: process versions after a redeploy
- [ ] `run-scenarios.ps1` output: 25 of 25 passed
