# Project 28 — Seminar Hall & Lab Booking (Camunda 8.8, BPMN + DMN + job workers)

> Instructions for Claude Code. Read this whole file before changing anything in `hall-booking/`.
> Process logic lives in BPMN, DMN, forms, FEEL and the REST and Email Outbound Connectors. The application is the
> Spring Boot backend in `backend-springboot/` (REST API, booking register with JPA, `@JobWorker`s); see its README.
> The frontend is the React app in `frontend-react/` (Vite, Tailwind). Still to come for Milestone 2 (13 Nov 2026): Docker.

## 0. Status (2026-11-10)

**Sign in with Google and email updates added.** Everyone signs in with a Google account (Spring Security OAuth2 /
OpenID Connect, verified emails only); roles per account from `APP_ACCOUNTS`; requesters see only their own requests,
approvers decide only reviews for a role they hold (`decidedBy` recorded), admins see everything; CSRF on every POST;
the booking register needs `X-Register-Key` (REST connectors: API key authentication). New reusable child process
`send-email` (worker *Find recipients* → Email connector) called four times: requester (request received), approver
(review waiting, reminder), admins (service issue). Deployed as hall-booking v12, hall-approval v11, send-email v1.
**25 of 25 automated scenarios pass** with the new email checks; 44 unit tests pass; a browser test (23 checks:
sign-in, roles, refused API calls, CSRF, emails in MailDev, sign out) passes. Found and fixed on the way: typed text
containing `secrets.NAME` was filled in by the connector runtime (now broken up by `SafeText`).

### React frontend (2026-11-09)

**React frontend added** (`frontend-react/`, React 19.1, Vite 8.3, Tailwind CSS 4.3, React Router 7): the same pages as
before plus a **session builder** (add/remove rows feeding the `sessions` multi-instance input), the custom Tasklist inbox
and the live route tracker, calling only the backend's `/api`. The backend serves the build (`frontend-react/dist`) on
:8090; `npm run dev` serves it on :5173 with hot reload. Tested end to end in a browser: two-session request, both
approvals in the inbox, APPROVED; every page loads without script errors. `hall-booking/app/public` is no longer served.

### Spring Boot backend (2026-11-09)

**Spring Boot backend added** (`backend-springboot/`, Spring Boot 3.5.16, `camunda-spring-boot-starter` 8.8.44, Java 21),
replacing the Node worker, the Node web server and the json-server mock:

| Part | Now |
|---|---|
| Job workers | `@JobWorker` methods with `@VariablesAsType` records: `validate-booking` (throws `ZeebeBpmnError` INVALID_REQUEST), `send-reminder`, `record-notification` |
| Booking register | `/register/bookings` in the backend, JPA entities in H2 (file `backend-springboot/data`) or PostgreSQL (profile `postgres`); connector secret renamed `MOCK_BASE_URL` → `BOOKING_API_URL` |
| Frontend API | `/api/**` controllers using the official Camunda Java client (start, user task completion, searches); request lists come from the database |
| Outage demos | `POST /api/demo/register-mode` {UP, DOWN, SLOW} instead of closing or slowing the json-server window |
| Start-up | The backend deploys the DMN, forms and both BPMN files, and seeds or imports the register |

Deployed as hall-booking v10 / hall-approval v9. **25 of 25 automated tests pass** against the backend, 15 unit tests
pass (`mvnw test`), manual S1 and T1 pass. The Node files `worker/worker.js`, `app/server.js` and their start scripts are
unused (not started by `start-all.cmd`) and can be deleted.

### Email connector (2026-11-08)

**Email connector added** (rubric: Connectors and FEEL). The requester is now emailed by the out-of-the-box **Email
Outbound Connector** over SMTP to a local mail server (MailDev, `scripts/start-mail.cmd`, inbox http://localhost:1080).
SMTP host, port, login and sender are **connector secrets** (`{{secrets.SMTP_*}}`, `{{secrets.MAIL_FROM}}`) from the
git-ignored `scripts/secrets.cmd`. A FEEL script composes the message once; an error boundary (`EMAIL_FAILED`) keeps a
mail outage from blocking the booking; the worker job `record-notification` logs the result. Deployed as hall-booking v8.
`run-scenarios.ps1` now also checks that every scenario's email reached the inbox.

**Mandatory BPMN constructs added** for the official guidelines (Milestone 1 rubric: multi-instance, sub-process with
error and timer boundaries, call activity). One request now books **one or more sessions**:

| Change | Construct |
|---|---|
| Start payload has `sessions` (list of venue, date, start, end); the Tasklist start form uses a dynamic list | Data contract |
| *Check availability* is an **embedded sub-process** with an **error boundary** (service down) and a **timer boundary** (no answer in 30 s) | Sub-process + error/timer boundaries |
| *Check session* (REST), *Decide approver* (DMN), *Hold slot*, *Confirm slot*, *Release slot* (REST) are **parallel multi-instance** over the sessions | Parallel MI |
| *Get approval* is a **Call Activity**, **sequential multi-instance** over the approvers, calling the reusable child process `hall-approval` (own file); stops at the first decision that is not APPROVED | Call activity + sequential MI |
| *Validate request* throws **BPMN error** `INVALID_REQUEST`, caught by an error boundary (was: a gateway on `validation.valid`) | Business error handling |
| The two message pools and the `publish-message` job type are gone (the call activity replaces them) | Simpler |

Deployed as hall-booking v7 / hall-approval v6 (now v8 / v7 with the Email connector). **25 of 25 automated tests pass** (19 old + 6 multi-session), plus
manual T1 (timer boundary). Version before this change: commit `9b271ae`; review 1: tag `review-1`.

### Earlier status

- 2026-10-27: web app added (`APP-PLAN.md`, Option A) on http://localhost:8090; message correlation moved to `requestId`.
- 2026-10-21 (review 2): two pools with message flows, external worker, validation, service-down handling, reminder timer.

## 1. Goal and rules

A booking workflow with validation, conflict detection per session, DMN-based approver selection, an approval chain
run by a reusable child process, reminders, automatic release of unapproved bookings, and handling of booking-service
outages and slowness.

- Target: Camunda 8.8 (Camunda 8 Run). Zeebe-flavoured BPMN (`zeebe:` namespace), **Camunda user tasks** (`<zeebe:userTask />`).
- Every element has diagram interchange (`bpmndi`), with label bounds where the default would overlap a line. Same for the DMN (`dmndi`).
- IDs below are fixed. Do not rename them.
- Constructs covered: user tasks with Camunda Forms, exclusive gateways (all with default flows), FEEL script tasks,
  REST connectors and an Email connector with externalized secrets, job workers with a BPMN error, business rule task (DMN), parallel and
  sequential multi-instance, embedded sub-process, error and timer boundary events (interrupting and non-interrupting),
  call activity with explicit input/output mappings, notification step.

### Local environment (this machine)

| Thing | Value |
|---|---|
| Camunda 8 Run | `E:\camunda8-run-8.8-windows-x86_64\c8run-8.8.32` |
| JDK for c8run | `E:\jdk-21.0.6`. Do **not** use `D:\`: c8run searches `JAVA_HOME` for a file called `java`, and on the D: drive root it finds a source folder first. |
| Operate / Tasklist | http://localhost:8080/operate, http://localhost:8080/tasklist (`demo` / `demo`) |
| Camunda REST API (scripts, backend) | http://localhost:8080/v2 (unprotected in c8run) |
| Zeebe gRPC (Desktop Modeler deploy) | `http://localhost:26500`, authentication None |
| Mail server | MailDev 3.0.0 (`npx maildev@3.0.0`): SMTP 127.0.0.1:1025 (login from `secrets.cmd`), inbox http://localhost:1080, REST `GET /api/email` |
| Backend | `backend-springboot`, `mvnw spring-boot:run` (`scripts/start-backend.cmd`) on http://localhost:8090: pages, `/api`, `/register`, job workers; H2 console /h2-console |
| Frontend | `frontend-react`: `scripts/build-frontend.cmd` (npm ci + vite build, Node 24) -> `dist/` served by the backend; dev server `npm run dev` on :5173 |
| Maven | none installed: the Maven wrapper (`mvnw.cmd`) downloads Maven 3.10.0 into `~/.m2/wrapper` |
| Desktop Modeler | `E:\camunda-modeler-5.49.0-win-x64` (form schemaVersion 19). Launch by double-click: from VS Code's terminal it inherits `ELECTRON_RUN_AS_NODE=1` and quits. |

### Files (folder `hall-booking/`)

```
hall-booking/
├─ hall-booking.bpmn          main process hall-booking
├─ hall-approval.bpmn         reusable child process hall-approval (called by the Call Activity)
├─ decide-approver.dmn        decision id: decide-approver
├─ booking-request-form.form  form id: booking-request-form (dynamic list of sessions)
├─ approval-form.form         form id: approval-form
├─ service-fix-form.form      form id: service-fix-form
├─ app/public/                the earlier plain HTML/CSS/JS pages (no longer served; replaced by frontend-react)
├─ mock/db.json               old json-server data (git-ignored), imported once into the backend's register
├─ scripts/start-*.cmd        mail, camunda, backend, all
├─ scripts/secrets.example.cmd connector secrets template (SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, MAIL_FROM)
├─ scripts/secrets.cmd        the real values (git-ignored; created from the example on first start)
├─ scripts/deploy.cmd         deploy DMN + 3 forms + both BPMN files via REST
├─ scripts/build-frontend.cmd builds frontend-react into dist/
├─ scripts/reset-data.cmd     POST /api/demo/reset: back to the 3 seed bookings
├─ scripts/run-scenarios.ps1  automated test cases
└─ README.md                  setup, demo steps, test cases, screenshot checklist

backend-springboot/           Spring Boot backend (see backend-springboot/README.md for layers, API and tables)
frontend-react/               React frontend (see frontend-react/README.md for pages and requirements)
```

## 2. Booking register (Spring Boot)

`RegisterController` in the backend, same contract as the json-server mock it replaced. Connector URLs use
`{{secrets.BOOKING_API_URL}}` = `http://127.0.0.1:8090/register` (IPv4 address: the connector runtime connects over IPv4).
`RegisterMode` DOWN answers 503, SLOW waits 40 s, for the error and timer boundary demos.

| Call | Used by | Response |
|---|---|---|
| `GET /bookings?hall={venue}&day={date}` | Check session (once per session) | bookings of that venue and day |
| `POST /bookings` | Hold slot (once per session) | created booking incl. `id` |
| `PATCH /bookings/{id}` | Confirm slot (once per held slot) | updated booking |
| `DELETE /bookings/{id}` | Release slot, rejected / expired (once per held slot) | `{}` |

Seed (`backend-springboot/src/main/resources/seed/register-seed.json`, ids assigned by the database). Booking field names differ from process variable names on purpose (FEEL filter scoping):

```json
{ "bookings": [
    {"id": 1, "hall": "hall-a", "day": "2027-01-11", "startHour": 10, "endHour": 12, "status": "CONFIRMED", "requester": "Dr. Rao"},
    {"id": 2, "hall": "hall-b", "day": "2027-01-11", "startHour": 14, "endHour": 16, "status": "CONFIRMED", "requester": "Dr. Meena"},
    {"id": 3, "hall": "lab-1",  "day": "2027-01-12", "startHour": 9,  "endHour": 13, "status": "CONFIRMED", "requester": "Prof. Iyer"} ],
  "notifications": [] }
```

## 3. Process variables (data contract)

**Start payload** (`hall-booking`):

```json
{ "requesterName": "Dr. Rao", "email": "rao@college.edu", "attendees": 40, "purpose": "Workshop",
  "sessions": [ { "venue": "hall-a", "bookingDate": "2027-01-26", "startTime": "10:00", "endTime": "12:00" },
                { "venue": "lab-1",  "bookingDate": "2027-01-26", "startTime": "14:00", "endTime": "16:00" } ] }
```

`venue` is `hall-a` | `hall-b` | `lab-1`; `bookingDate` is `yyyy-MM-dd`; times are `HH:00` between 08:00 and 18:00.

**Main process variables** (root scope):

| Variable | Set by | Shape |
|---|---|---|
| `sessions` | Prepare sessions (overwrites the input) | each session + `slot: {startHour, endHour, durationHours}` |
| `validation` | Validate request (completion or BPMN error) | `{valid, reason, message, session, checkedOn}` |
| `sessionChecks` | Check availability (output mapping) | per session `{venue, bookingDate, startTime, endTime, clash}` |
| `conflictCheck` | Check availability (output mapping) | `{hasConflict, clashes}` |
| `serviceError` | Service-down boundary (output mapping) or Set timeout error | text |
| `serviceFixAction` | Resolve service issue | `RETRY` \| `CANCEL` |
| `sessionApprovers` | Decide approver (MI output collection) | one role per session |
| `approvers` | Plan approval chain | `distinct values(sessionApprovers)` |
| `heldSlots` | Hold slot (MI output collection) | per session `{id, ref: "BK-<id>", venue, bookingDate, startTime, endTime}` |
| `decisions` | Get approval (MI output collection) | one `{outcome, remarks, approver}` per approver asked; `null` for those never asked |
| `decision` | Combine decisions | the first non-approved decision, or `{outcome: "APPROVED", approver, remarks}` |
| `outcome` | various | `APPROVED`, `REJECTED`, `EXPIRED`, `CONFLICT`, `INVALID_TIME`, `PAST_DATE`, `OVER_CAPACITY`, `SERVICE_UNAVAILABLE` |
| `notification` | Compose notification | `{to, subject, bookingRef, message, body}` |
| `emailStatus`, `emailError` | Email requester (result) or Email failed boundary (output mapping) | `SENT` \| `FAILED`, error text |
| `notificationId`, `notifiedAt` | Record notification | |

Local (not visible at the root): `session` (MI input element), `existing` (per Check session), `approver` (per DMN
evaluation and per call), `bookingId` (per Hold slot), `held` (per Confirm/Release), `loopCounter`.

**Child process `hall-approval`** receives only what the Call Activity maps in (`propagateAllParentVariables=false`):
`approver`, `approvalStep` (`=loopCounter`), `approvalSteps` (`=count(approvers)`), `requesterName`, `email`,
`attendees`, `purpose`, `sessions`, `bookingRef` (`=string join(for h in heldSlots return h.ref, ", ")`).
It produces `approved`, `remarks`, `reminderSentAt`, and `decision = {outcome, remarks, approver}`, of which only
`decision` is mapped back (`propagateAllChildVariables=false`).

## 4. BPMN

| Element | Value |
|---|---|
| Error | `Error_ServiceDown` code `BOOKING_SERVICE_DOWN` (thrown by Check session's errorExpression) |
| Error | `Error_InvalidRequest` code `INVALID_REQUEST` (thrown by the validate-booking worker) |
| Error | `Error_EmailFailed` code `EMAIL_FAILED` (thrown by Email requester's errorExpression) |

### 4.1 Main process `hall-booking` (`hall-booking.bpmn`)

| ID | Type | Name | Configuration |
|---|---|---|---|
| `StartEvent_Requested` | Start event | Booking requested | form `booking-request-form` |
| `Script_PrepareSlot` | Script (FEEL) | Prepare sessions | result `sessions` (adds `slot` to each) |
| `Worker_ValidateRequest` | Service task (worker) | Validate request | type `validate-booking` |
| `Boundary_Invalid` | Error boundary | Invalid request | on `Worker_ValidateRequest`, `Error_InvalidRequest`; outputs `validation`, `outcome` → `Gateway_Merge` |
| `Gateway_FetchRetry` | XOR merge | | joins `Flow_Valid` and `Flow_Retry` |
| `SubProcess_CheckAvailability` | Embedded sub-process | Check availability | inputs `sessionChecks=null`, `conflictCheck=null` (local); outputs both to the root |
| `Start_Check`, `End_Check` | Start / end | | inside the sub-process |
| `Rest_CheckSession` | REST connector, **parallel MI** | Check session | over `=sessions` as `session`; GET `/bookings?hall=…&day=…`; local `existing`; result `={existing: response.body}`; outputElement `{venue, bookingDate, startTime, endTime, clash}` → `sessionChecks`; read timeout 60 s; errorExpression below |
| `Script_DetectConflict` | Script (FEEL) | Detect conflict | result `conflictCheck` (inside the sub-process) |
| `Boundary_ServiceDown` | Error boundary | Service down | on the sub-process, `Error_ServiceDown`; output `serviceError` |
| `Timer_CheckTimeout` | Timer boundary, **interrupting** | After 30 s | on the sub-process, `PT30S` → `Script_SetTimeoutError` |
| `Script_SetTimeoutError` | Script (FEEL) | Set timeout error | text → `serviceError` |
| `Gateway_ServiceIssue` | XOR merge | | joins service down and timeout |
| `User_FixService` | Camunda user task | Resolve service issue | form `service-fix-form` |
| `Gateway_FixAction` | XOR | Retry? | `Flow_Retry` `=serviceFixAction = "RETRY"` → `Gateway_FetchRetry`; default `Flow_Cancel` |
| `Script_SetServiceError` | Script (FEEL) | Set service error | `="SERVICE_UNAVAILABLE"` → `outcome` |
| `Gateway_SlotOk` | XOR | All sessions free? | `Flow_SlotTaken` `=conflictCheck.hasConflict = true`; default `Flow_SlotFree` |
| `Script_SetReason` | Script (FEEL) | Set rejection reason | `="CONFLICT"` → `outcome` |
| `Dmn_DecideApprover` | Business rule, **parallel MI** | Decide approver | over `=sessions` as `session`; inputs `venue=session.venue`, `slot=session.slot`, `approver=null`; decision `decide-approver` → `approver`; outputElement `=approver` → `sessionApprovers` |
| `Script_PlanApprovals` | Script (FEEL) | Plan approval chain | `=distinct values(sessionApprovers)` → `approvers` |
| `Rest_HoldSlot` | REST connector, **parallel MI** | Hold slot | over `=sessions`; POST `/bookings` (status PENDING); local `bookingId`; outputElement `{id, ref, venue, bookingDate, startTime, endTime}` → `heldSlots` |
| `CallActivity_Approval` | **Call Activity**, **sequential MI** | Get approval | calls `hall-approval`; over `=approvers` as `approver`; mappings in §3; outputElement `=decision` → `decisions`; completionCondition `=decision != null and decision.outcome != "APPROVED"` |
| `Script_SummarizeDecision` | Script (FEEL) | Combine decisions | result `decision` (§4.3) |
| `Gateway_Decision` | XOR | Decision? | `Flow_Approved` `=decision.outcome = "APPROVED"`, `Flow_Expired` `=decision.outcome = "EXPIRED"`, default `Flow_Rejected` |
| `Rest_ConfirmSlot` | REST connector, **parallel MI** | Confirm slot | over `=heldSlots` as `held`; PATCH `/bookings/{held.id}`; result `={outcome: "APPROVED"}` |
| `Rest_ReleaseRejected` | REST connector, **parallel MI** | Release slot (rejected) | over `=heldSlots`; DELETE; result `={outcome: "REJECTED"}` |
| `Rest_ReleaseExpired` | REST connector, **parallel MI** | Release slot (expired) | over `=heldSlots`; DELETE; result `={outcome: "EXPIRED"}` |
| `Gateway_Merge` | XOR merge | | 6 incoming: invalid, conflict, service error, confirm, reject, expire |
| `Script_ComposeNotification` | Script (FEEL) | Compose notification | result `notification` (§4.3) |
| `Email_NotifyRequester` | **Email connector** (SMTP) | Email requester | template `io.camunda.connectors.email.v1` v3, type `io.camunda:email:1`; host, port, username, password, from = `{{secrets.SMTP_HOST}}`, `{{secrets.SMTP_PORT}}`, `{{secrets.SMTP_USERNAME}}`, `{{secrets.SMTP_PASSWORD}}`, `{{secrets.MAIL_FROM}}`; to/subject/body from `notification`; result `={emailStatus: "SENT"}`; errorExpression → `EMAIL_FAILED` |
| `Boundary_EmailFailed` | Error boundary | Email failed | on `Email_NotifyRequester`, `Error_EmailFailed`; outputs `emailError`, `emailStatus="FAILED"` |
| `Gateway_NotifyMerge` | XOR merge | | joins email sent and email failed |
| `Worker_Notify` | Service task (worker) | Record notification | type `record-notification`, inputs `to`, `subject`, `message`, `bookingRef` (from `notification`) |
| `EndEvent_Done` | End event | Done | |

### 4.2 Child process `hall-approval` (`hall-approval.bpmn`)

| ID | Type | Name | Configuration |
|---|---|---|---|
| `StartEvent_Approval` | Start event | Approval requested | (started by the Call Activity) |
| `CallActivity_EmailApprover` | Call activity → `send-email` | Email approver | `toRole=approver`, subject "Booking … is waiting for your review", link `/#/inbox`; out `approverEmail = {status, to, error}` |
| `User_Approval` | Camunda user task | Review booking | form `approval-form` |
| `Timer_Reminder` | Boundary timer, **non-interrupting** | Reminder time | `=approvalTimes.reminder` (default `PT1H`) → `Worker_Reminder` → `CallActivity_EmailReminder` → `End_Reminded` |
| `CallActivity_EmailReminder` | Call activity → `send-email` | Email reminder | `toRole=approver`, link `/#/inbox`; out `reminderEmail` |
| `Timer_Timeout` | Boundary timer, **interrupting** | Time is up | `=approvalTimes.timeout` (default `P1D`) → `Script_MarkExpired` |
| `Worker_Reminder` | Service task (worker) | Remind approver | type `send-reminder`, input `approverRole=approver` |
| `Script_RecordDecision` | Script (FEEL) | Record decision | `={outcome: if approved = true then "APPROVED" else "REJECTED", remarks: remarks, approver: approver, decidedBy: decidedBy}` → `decision` (`decidedBy` = the signing-in account, set by the backend on completion) |
| `Script_MarkExpired` | Script (FEEL) | Mark as expired | `={outcome: "EXPIRED", remarks: "Not reviewed within " + approvalTimes.timeoutText, approver: approver}` → `decision` |
| `Gateway_DecisionMerge` | XOR merge | | |
| `End_Decided` | End event | Decision made | |

### 4.2b Child process `send-email` (`send-email.bpmn`)

Called with `propagateAllParentVariables=false`: in `to` (an address) or `toRole` (approver role or `admin`), `subject`,
`body`, `link`; out `emailStatus`, `recipients`, `emailError`.

| ID | Type | Name | Configuration |
|---|---|---|---|
| `StartEvent_Email` | Start event | Email requested | |
| `Worker_FindRecipients` | Service task (worker) | Find recipients | type `resolve-recipients` → `recipients`, `recipientCount`, `linkUrl`, `emailStatus` |
| `Gateway_AnyRecipient` | XOR | Anyone to email? | `=recipientCount > 0` → `Email_Send`; default → `End_Nobody` |
| `Email_Send` | Email connector (`io.camunda:email:1`) | Send email | same SMTP secrets as *Email requester*; to `=recipients`; body `=body` + the link; result `{emailStatus: "SENT"}` |
| `Boundary_SendFailed` | Error boundary `EMAIL_FAILED` | Email failed | out `emailStatus = "FAILED"`, `emailError` → `End_Failed` |
| `End_Sent`, `End_Failed`, `End_Nobody` | End events | | |

Called from hall-booking by `CallActivity_EmailReceived` (after *Hold slot*: to the requester, "request received",
out `receivedEmail`) and `CallActivity_EmailAdmin` (between *Gateway_ServiceIssue* and *Resolve service issue*:
`toRole="admin"`, out `serviceEmail`). The five REST connectors authenticate to the register with *API key* in the
header `X-Register-Key` = `{{secrets.REGISTER_API_KEY}}`.

### 4.3 Expressions

`Script_PrepareSlot`: `=for s in sessions return context put(s, "slot", {startHour: number(substring(s.startTime, 1, 2)), endHour: …, durationHours: …})`.

`Rest_CheckSession` URL: `="{{secrets.BOOKING_API_URL}}/bookings?hall=" + session.venue + "&day=" + session.bookingDate`;
outputElement clash test: `count(existing[item.startHour < session.slot.endHour and item.endHour > session.slot.startHour]) > 0`.

`Rest_CheckSession` errorExpression (turns any connector failure into the BPMN error):
`=if error != null then bpmnError("BOOKING_SERVICE_DOWN", "Booking service unreachable", {serviceError: error.message}) else null`

`Script_DetectConflict`: `={hasConflict: some c in sessionChecks satisfies c.clash, clashes: sessionChecks[item.clash]}`.

`Script_SummarizeDecision`:
`=if every d in decisions satisfies d != null and d.outcome = "APPROVED" then {outcome: "APPROVED", approver: string join(approvers, ", "), remarks: …} else (decisions[item != null and item.outcome != "APPROVED"])[1]`.

`Script_ComposeNotification`: a context `{to: email, subject: "Hall booking " + outcome, bookingRef: …, message: …, body: …}`.
`message` is one `if … else if …` per outcome: APPROVED lists all sessions; REJECTED/EXPIRED name `decision.approver`
(plus remarks); CONFLICT lists `conflictCheck.clashes`; the validation outcomes use `validation.message`. `body` reuses the
earlier entries of the same context: `"Dear " + requesterName + ",\n\n" + message + (booking reference) + "\n\nHall Booking Office"`.

`Email_NotifyRequester` errorExpression:
`=if error != null then bpmnError("EMAIL_FAILED", "Email could not be sent", {emailError: error.message}) else null`.
The connector masks secret values in error texts (`host, port: ***, ***`), so they never reach Operate or the notification record.

Why the completion condition tests `decision` and not `decisions`: when an inner instance completes, the output
collection is not yet updated when the condition is evaluated, so `decision` is declared local (`=null` input) and
tested directly. Verified on 8.8.32: with `some d in decisions …` all approvers were asked.

### 4.4 Job worker types (`backend-springboot`, class `BookingWorkers`)

| Type | Used by | Does | Returns |
|---|---|---|---|
| `validate-booking` | `Worker_ValidateRequest` | per session: `durationHours > 0`, `bookingDate >= today`, `attendees <= capacity` (hall-a 200, hall-b 150, lab-1 60); no two sessions of the request overlap | `validation`, or **`ZeebeBpmnError`** `INVALID_REQUEST` with variables `outcome`, `validation`; records the request in `booking_request` |
| `send-reminder` | `Worker_Reminder` | writes `outbox/*_REMINDER_*.txt`, logs | `reminderSentAt` |
| `resolve-recipients` | `Worker_FindRecipients` (send-email, class `EmailWorkers`) | `to` → that address; `toRole` → the accounts holding it in `APP_ACCOUNTS`, else the admins | `recipients` (comma-separated), `recipientCount`, `linkUrl`, `recipientNote`, `emailStatus` PENDING / NO_RECIPIENT |
| `record-notification` | `Worker_Notify` | writes `outbox/*_<OUTCOME>_*.txt`, `POST /notifications` with `emailStatus`/`emailError` (best effort) | `notificationId`, `notifiedAt` |

Spring `@JobWorker(type = ...)` methods with `@VariablesAsType` records (only the named variables are fetched); the SDK
activates jobs over gRPC (job timeout 30 s, `camunda.client.worker.defaults.timeout`), completes them with the returned
record, reports a thrown `ZeebeBpmnError` as a BPMN error and any other exception as a failure (retries − 1).
`ZeebeBpmnError` is the 8.8 SDK's deprecated compatibility subclass of `io.camunda.client.exception.BpmnError`.

### 4.5 Connector notes

REST Outbound Connector template `io.camunda.connectors.HttpJson.v2` version **12** (newest for 8.8; v13 needs 8.9),
task type `io.camunda:http-json:1`, retries 3, auth `noAuth`. Check session: `retryBackoff=PT0S` (the errorExpression
turns the first failure into the BPMN error anyway), read timeout **60 s** so a slow service meets the 30 s timer
first. Hold / Confirm / Release: `retryBackoff=PT10S`, so a short outage heals itself instead of becoming an incident.

Email Outbound Connector template `io.camunda.connectors.email.v1` version **3** (newest for 8.8; v4 needs 8.9), task type
`io.camunda:email:1`, `protocol=smtp`, action `sendEmailSmtp`, auth `simple` (the only option, so the mail server always
gets a login), `smtpCryptographicProtocol=NONE` (local MailDev; a real server would use TLS on 587), content type PLAIN.

**Secrets.** The connectors runtime of Camunda 8 Run reads `{{secrets.NAME}}` from its environment variables.
`start-camunda.cmd` sets `BOOKING_API_URL` and calls `secrets.cmd` (copied from `secrets.example.cmd` on the first start,
git-ignored) for the SMTP values; `start-mail.cmd` starts MailDev with the same login, so the two always match. Changing a
secret needs a Camunda restart (the runtime reads the environment once). Scripts must call `secrets.cmd` by full path
(`%~dp0`): with `NoDefaultCurrentDirectoryInExePath` set, `call secrets.cmd` fails.

## 5. DMN: `decide-approver`

Hit policy **FIRST**, one output column. Evaluated once per session (parallel MI), with `venue` and `slot` mapped from the session.

| `venue` | `slot.durationHours` | `attendees` | `approver` |
|---|---|---|---|
| `"lab-1"` | - | - | `"lab-incharge"` |
| `"hall-a","hall-b"` | `> 4` | - | `"dean"` |
| `"hall-a","hall-b"` | - | `> 100` | `"hod"` |
| - | - | - | `"admin-office"` |

## 6. Forms (schemaVersion 19)

- **`booking-request-form`**: name, email (validated), attendees (min 1), **dynamic list `sessions`** (venue select with
  capacity in the label, date, start/end selects 08:00–18:00; add/remove rows), purpose.
- **`approval-form`**: `{{bookingRef}}`, `{{approver}}`, step `{{approvalStep}} of {{approvalSteps}}`, the request and a
  `{{#loop sessions}}` list; checkbox `approved` (default false); textarea `remarks` (default "").
- **`service-fix-form`**: `{{serviceError}}` and a `{{#loop sessions}}` list; radio `serviceFixAction` (`RETRY` default, `CANCEL`).

## 7. Manual steps

1. `start-mail.cmd`, `start-camunda.cmd`, `start-backend.cmd` (or `start-all.cmd`). The backend deploys the models at startup.
2. `deploy.cmd` (or Modeler: DMN and forms first, then `hall-approval.bpmn`, then `hall-booking.bpmn`).
3. `reset-data.cmd` before a demo or test run.
4. Tasklist → Processes → "Seminar Hall and Lab Booking". Approval tasks appear as *Review booking* (process *Hall Approval*), one approver at a time.

## 8. Test cases

Automated by `scripts/run-scenarios.ps1` (reset the mock first). Seed: hall-a 11 Jan 10–12, hall-b 11 Jan 14–16, lab-1 12 Jan 9–13 (2027).
"Approver" is the approval chain (`approvers`). Every case must also end with `emailStatus = SENT` and its email in the
MailDev inbox (`GET /api/email`). **All dates are fixed: from 12 Jan 2027 the tests dated 11 Jan return `PAST_DATE`.**

| # | Group | Input | Expected | Result 2026-11-08 |
|---|---|---|---|---|
| A | Main path | hall-a, 12 Jan, 14–16, 50; approve | `admin-office`, `APPROVED` | PASS |
| B | Main path | hall-a, 11 Jan, 11–13 | `CONFLICT` | PASS |
| C | Main path | lab-1, 13 Jan, 10–12; nobody acts (the script starts it with `approvalTimes` 2 min / 1 min) | reminder at 1 min, `EXPIRED` at 2 min, `lab-incharge` | PASS |
| D | Main path | hall-b, 14 Jan, 15–13 | `INVALID_TIME` | PASS |
| E | Main path | hall-b, 15 Jan, 09–15, 80; approve | `dean`, `APPROVED` | PASS |
| F | Main path | hall-b, 18 Jan, 10–12, 150; reject | `hod`, `REJECTED` | PASS |
| G | Worker validation | hall-a, 1 Oct 2026 | `PAST_DATE` | PASS |
| H | Worker validation | lab-1, 61 people | `OVER_CAPACITY` | PASS |
| I | Worker validation | lab-1, exactly 60; approve | `lab-incharge`, `APPROVED` | PASS |
| J | Worker validation | hall-a, 10:00–10:00 | `INVALID_TIME` | PASS |
| K | Conflict check | hall-a, 11 Jan, 12–14 (back-to-back); approve | `APPROVED` | PASS |
| L | Conflict check | hall-b, 11 Jan, 10–12 (other venue); approve | `APPROVED` | PASS |
| M | Conflict check | hall-a, 11 Jan, 09–13 (covers seed) | `CONFLICT` | PASS |
| N | DMN | hall-a, 4 h, 100 people; approve | `admin-office` | PASS |
| O | DMN | hall-a, 2 h, 101 people; approve | `hod` | PASS |
| P | DMN | hall-b, 8 h, 150 people; approve | `dean` (FIRST) | PASS |
| Q1/Q2 | Slot hold | Q1 pending, Q2 same slot | Q2 `CONFLICT`, Q1 then `APPROVED` | PASS |
| R | Slot hold | rebook C's slot after it expired; approve | `APPROVED` | PASS |
| MS1 | Multi-session | hall-a + lab-1, 26 Jan; both approve | chain `admin-office,lab-incharge`, `APPROVED`, 2 approval instances, 2 slots | PASS |
| MS2 | Multi-session | hall-b 6 h + hall-a, 27 Jan; approve, reject | chain `dean,admin-office`, `REJECTED`, 2 instances | PASS |
| MS3 | Multi-session | hall-b 6 h + lab-1, 28 Jan; first rejects | `REJECTED`, **1** instance (chain stops), both slots released | PASS |
| MS4 | Multi-session | lab-1 29 Jan + hall-a 11 Jan 11–13 | `CONFLICT`, no approval | PASS |
| MS5 | Multi-session | hall-a 29 Jan 10–12 and 11–13 | `INVALID_TIME` (sessions overlap, BPMN error) | PASS |
| MS6 | Multi-session | hall-a 1 Feb + hall-a 2 Feb; approve | one approver (`distinct values`), `APPROVED`, 2 slots | PASS |

Manual (need a window closed, slowed or reopened):

| # | Steps | Expected | Result |
|---|---|---|---|
| S1 | Register mode DOWN (`POST /api/demo/register-mode`), start a booking, mode UP, choose **Retry**, reject | *Service down* error boundary; *Resolve service issue* says "answered with error 503"; Retry checks again; `REJECTED` | PASS 2026-11-09 |
| S2 | Register mode DOWN, start a booking, choose **Cancel** | `SERVICE_UNAVAILABLE`, requester emailed | PASS 2026-10-21 (old model; T1 below also ends with Cancel) |
| T1 | Register mode SLOW (every call takes 40 s), start a booking, mode UP, choose **Cancel** | Timer boundary interrupts *Check availability* after 30 s, *Resolve service issue* says "did not answer within 30 seconds"; `SERVICE_UNAVAILABLE` | PASS 2026-11-09 |
| W | Close the backend (job workers), start a booking in Tasklist, restart the backend | Booking waits at *Validate request* (no incident), continues after restart | PASS 2026-10-21 with the Node worker; not yet re-run with the backend |
| E1 | Close the mail server, start a booking (e.g. a conflict), restart the mail server | *Email failed* boundary: booking completes, `emailStatus = FAILED`, `emailError` set (secrets masked), notification recorded as not delivered | PASS 2026-11-08 |

## 9. Acceptance checklist

- [x] Main process and reusable child process, both with full DI; Call Activity with explicit input/output mappings
- [x] Parallel multi-instance (check, decide, hold, confirm, release) and sequential multi-instance (approval chain with completion condition)
- [x] Embedded sub-process with error boundary and timer boundary; error boundary on the worker task (BPMN error from a job worker)
- [x] Interrupting and non-interrupting timers on `User_Approval`
- [x] All gateways have default flows; conditions as in section 4
- [x] REST connectors handle all booking-register calls, URL from the secret `BOOKING_API_URL`
- [x] Spring Boot backend: REST controllers, JPA (H2 / PostgreSQL), typed `@JobWorker`s with `ZeebeBpmnError`, Camunda Java client; 15 unit tests
- [x] Email connector emails the requester; SMTP host, port, login and sender are secrets from git-ignored `secrets.cmd`; failures go to an error boundary
- [x] Deployed to local Camunda 8 Run (hall-booking v8, hall-approval v7)
- [x] 25 of 25 automated tests pass (2026-11-08), plus manual T1

## 10. Next steps (course guidelines, Milestone 2 by 13 Nov 2026)

- Docker: Dockerfiles + root `docker-compose.yml`; repository layout `bpmn-models/`, `backend-springboot/`, `frontend-react/`.
- Make test dates relative to today (they expire on 12 Jan 2027).
