# Seminar Hall & Lab Booking (Camunda 8: multi-instance, sub-process, call activity, job workers)

One request books **one or more sessions** (for example a three-day workshop). The main process validates the request
through a job worker, then checks every session for clashes **in parallel** inside a **sub-process** that has an
**error boundary** (booking service down) and a **timer boundary** (no answer within 30 s). A DMN table picks an
approver **per session**; the slots are held; then a **Call Activity** asks each approver **in turn** through the
reusable child process *Hall Approval* (reminder after 1 hour, expiry after 1 day; 1 and 2 minutes for demos), stopping at the first rejection. The
slots are confirmed or released and the requester is notified.

Everyone **signs in with Google**; the approver and admin roles belong to listed Google accounts, everyone else is a
requester. At every step people get an **email update** through the reusable child process *Send email*: the requester
when the slots are held and when the decision is made, the approver when a review waits (and again with the reminder),
the admins when the booking service fails.

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
| Timer boundary events on a task | Non-interrupting reminder (1 hour) and interrupting expiry (1 day) on *Review booking*; both FEEL expressions on the variable `approvalTimes` (backend settings `APPROVAL_REMINDER`, `APPROVAL_TIMEOUT`) |
| Reusable child process called from two processes | *Send email* (`send-email`): from hall-booking (*Email requester: received*, *Email admins: service issue*) and hall-approval (*Email approver*, *Email reminder*) |
| Sign-in and roles | Sign in with Google (OpenID Connect, verified email only); roles per account from `APP_ACCOUNTS`; reviews decided only by the role holder |
| Notification step | Compose notification (FEEL) → Email requester (connector, to the MailDev inbox) → Record notification (job worker, `notification` table) |

## Files

| File | What it is |
|---|---|
| `hall-booking.bpmn` | Main process `hall-booking` |
| `hall-approval.bpmn` | Child process `hall-approval`, called once per approver |
| `send-email.bpmn` | Child process `send-email` (Find recipients worker → Email connector), called from both processes above |
| `decide-approver.dmn` | Decision `decide-approver` (hit policy FIRST) |
| `booking-request-form.form`, `approval-form.form`, `service-fix-form.form` | The three forms |
| `../frontend-react/` | React frontend (Vite, Tailwind): session builder, custom Tasklist inbox, live route; served by the backend on http://localhost:8090 |
| `app/public/` | The earlier plain HTML/CSS/JS pages (no longer served) |
| `../backend-springboot/` | Spring Boot backend: `/api`, booking register `/register`, job workers, H2 database |
| `scripts/start-all.cmd` | Opens the three windows below and the app in the browser |
| `scripts/start-mail.cmd`, `start-camunda.cmd`, `start-backend.cmd` | The three windows to keep open |
| `scripts/secrets.example.cmd` | Connector secrets template; copied to the git-ignored `secrets.cmd` on the first start |
| `scripts/build-frontend.cmd` | Builds the React app into `frontend-react/dist` (start-backend.cmd does it when missing) |
| `scripts/deploy.cmd`, `reset-data.cmd`, `stop-camunda.cmd` | Deploy by hand (the backend also deploys at start); restore the seed bookings; stop Camunda |
| `scripts/run-scenarios.ps1` | 25 automated test cases with PASS/FAIL |

## Start everything (about 3 minutes)

**Once:** sign-in needs a Google OAuth client (free). In Google Cloud Console → *Google Auth Platform*: audience
*External*, publishing status *Testing*, add every Google account that will sign in as a test user; create a *Web
application* client with origins `http://localhost:8090` and `http://localhost:5173` and redirect URI
`http://localhost:8090/login/oauth2/code/google`. Put its client ID and secret, the roles (`APP_ACCOUNTS`) and a random
`REGISTER_API_KEY` in `scripts\secrets.cmd` (see `secrets.example.cmd`). Never commit that file or the downloaded
`client_secret_*.json`; both are git-ignored.

**For a demo:** an approver normally has 1 day. To show the reminder and the expiry live, remove `rem` in front of
`APPROVAL_TIMEOUT=PT2M` and `APPROVAL_REMINDER=PT1M` in `scripts\secrets.cmd` and restart the backend.

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
2. **Start the timer case first** in the app (http://localhost:8090, sign in with any Google account → New booking):
   Computer Lab 1, 13 Jan 2027, 10:00–12:00, 30 people. Leave its approval alone.
3. **Happy path:** New booking for Seminar Hall A, 12 Jan 2027, 14:00–16:00, 50 people. The request page shows the
   route filling in live, and http://localhost:1080 shows the *request received* email and the Admin office's *waiting
   for your review* email. In a second browser profile, sign in as the Admin office account → Inbox → Approve. The route
   ends in the APPROVED stamp; the requester's decision email is in the mail inbox.
4. **Worker validation:** Computer Lab 1 with 61 people. The form warns first; send it anyway → `OVER CAPACITY`.
5. **Conflict:** Seminar Hall A, 11 Jan 2027, 11:00–13:00. The form's day board shows the clash → `SLOT TAKEN`.
6. **Service down:** signed in as an admin → Service issues, switch *Booking register (demo)* to **Down** (the *Bookings* light
   turns red) and send a booking: it lands here through the error boundary. Switch back to **Normal**, click
   **Retry now** → the booking continues. The admins got an *Action needed* email when it failed. With **Slow** the 30 s timer boundary fires instead.
7. **Timer case and Operate:** open the timer case's request page: reminder after 1 minute, expired after 2 (with the
   demo times above).
   Then in Operate open a booking: the multi-instance bodies, and the *Get approval* call activity drilling into its
   *Hall Approval* child instance(s).
8. **Several sessions:** in Tasklist → Processes → *Seminar Hall and Lab Booking*, add two sessions (Seminar Hall A
   and Computer Lab 1). Two approvers are asked one after the other; reject at the first one and show in Operate that
   the second was never asked (chain stopped) and both slots were released.
9. **Deployment:** change something the app does not repeat (e.g. the 30 s availability timer), deploy from Modeler,
   and show in Operate that a new version appeared while finished instances keep their old version.

## Real email through Gmail

By default every email stops in MailDev on this computer. To deliver them to real inboxes:

1. Pick the Gmail account that sends (best a dedicated one, for example a new `hallbooking.srm@gmail.com`).
2. On that account turn on **2-Step Verification** (myaccount.google.com → Security).
3. Create an **App Password** at https://myaccount.google.com/apppasswords (name it *Hall Booking*) and copy the
   16 letters. It is shown once; it is not the account password.
4. In `scripts\secrets.cmd`, replace the six mail lines with the commented Gmail block: `SMTP_HOST=smtp.gmail.com`,
   `SMTP_PORT=587`, `SMTP_SECURITY=TLS`, `SMTP_USERNAME` and `MAIL_FROM` = the sending address, `SMTP_PASSWORD` = the App
   Password without spaces. Never paste it anywhere else.
5. Restart Camunda (`stop-camunda.cmd`, then `start-camunda.cmd`) and the backend: both read the settings at start.

Then every requester, approver and admin email goes to the real address (Gmail allows about 500 a day).
`start-mail.cmd` is no longer needed, and `run-scenarios.ps1` refuses to run (its test emails would reach the
approver accounts); switch back to the MailDev lines and restart Camunda before running the tests.

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
