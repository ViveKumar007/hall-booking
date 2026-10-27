# Project 28 — Seminar Hall & Lab Booking (Camunda 8.8, BPMN + DMN + external worker)

> Instructions for Claude Code. Read this whole file before changing anything in `hall-booking/`.
> **No Java or Spring Boot.** Process logic lives in BPMN, DMN, forms, FEEL and REST Outbound Connectors.
> The only code is the external job worker (`hall-booking/worker/worker.js`, plain Node.js, no libraries).

## 0. Status (2026-10-27)

**Web app added** (see `APP-PLAN.md`, Option A): `hall-booking/app/`, started with `scripts/start-app.cmd` or `start-all.cmd`, on http://localhost:8090.
**Correlation key changed** from `bookingRef` to `requestId` (the booking's process instance key, set by the worker): `bookingRef`
repeats after the booking database is reset, and Camunda won't start a second approval while one with the same key is open.
Deployed as hall-booking v4 / hall-approval v3; all 19 automated tests pass again.

### Earlier status (2026-10-21)

**Version 2 (review 2) is built, deployed and tested on the local Camunda 8 Run 8.8.32.** See section 8 for results.
Version 1 (review 1) is saved as git tag `review-1`.

### Changes for review 2

The review-2 rubric adds *External Workers & REST Connectors* and *Deployment & Workflow Execution*, so version 2 adds:

| Change | Why |
|---|---|
| **Two pools** (collaboration): *Booking Desk* (`hall-booking`) and *Hall Administration* (`hall-approval`), connected by two **message flows** | Shows inter-process communication; the approval office is a separate participant |
| **External worker** (`worker/worker.js`) handling 4 job types: `validate-booking`, `publish-message`, `send-reminder`, `send-notification` | Rubric: external workers. REST connectors stay for all booking-database calls |
| **Validate request** (worker) before the conflict check: invalid times, past dates, venue capacity | New outcomes `PAST_DATE`, `OVER_CAPACITY`; `INVALID_TIME` moved here from the gateway |
| **Error boundary** on *Fetch existing bookings* → *Resolve service issue* user task → Retry or Cancel | Booking service outages become a handled path instead of an incident. New outcome `SERVICE_UNAVAILABLE` |
| **Non-interrupting reminder timer** (1 min) next to the interrupting expiry timer (2 min) | Shows both timer types |
| Notify requester is now a worker task (email saved to `worker/outbox/`, logged in `/notifications`) | Notification works even when the booking service is down |
| Test dates moved to **January 2027** | The worker rejects past dates; October 2026 dates are now in the past |
| Capacity shown in the venue options; approval form shows `bookingRef` and the reminder/expiry rule | Testers can see the limits |
| `run-scenarios.ps1` covers 19 automated cases; 3 manual cases documented | More test coverage |

### Changes for review 1 (kept)

Target Camunda 8 Run locally (not SaaS); mock API on `127.0.0.1:3000` without a tunnel; `MOCK_BASE_URL` set as an
environment variable by `start-camunda.cmd`; expiry timer `PT2M` instead of `PT30S`; one-click `deploy.cmd`.

## 1. Goal and rules

A booking workflow with validation, conflict detection, DMN-based approver selection, approval by a separate
administration process, reminders, automatic release of unapproved bookings, and handling of booking-service outages.

- Target: Camunda 8.8 (Camunda 8 Run). Zeebe-flavoured BPMN (`zeebe:` namespace), **Camunda user tasks** (`<zeebe:userTask />`).
- Every element, pool and message flow has diagram interchange (`bpmndi`). Same for the DMN (`dmndi`).
- IDs below are fixed. Do not rename them.
- Course requirements covered: user tasks with Camunda Forms, exclusive gateways, FEEL script tasks, REST connectors,
  external worker, business rule task (DMN), timer boundary events (interrupting and non-interrupting), error boundary
  event, message send/receive between pools, notification step.

### Local environment (this machine)

| Thing | Value |
|---|---|
| Camunda 8 Run | `E:\camunda8-run-8.8-windows-x86_64\c8run-8.8.32` |
| JDK for c8run | `E:\jdk-21.0.6`. Do **not** use `D:\`: c8run searches `JAVA_HOME` for a file called `java`, and on the D: drive root it finds a source folder first. |
| Operate / Tasklist | http://localhost:8080/operate, http://localhost:8080/tasklist (`demo` / `demo`) |
| Camunda REST API (scripts, worker) | http://localhost:8080/v2 (unprotected in c8run) |
| Zeebe gRPC (Desktop Modeler deploy) | `http://localhost:26500`, authentication None |
| Mock API | http://127.0.0.1:3000 (Node 24, `npx json-server@0.17.4`) |
| Worker | Node 24, `node worker/worker.js` |
| Desktop Modeler | `E:\camunda-modeler-5.49.0-win-x64` (form schemaVersion 19). Launch by double-click: from VS Code's terminal it inherits `ELECTRON_RUN_AS_NODE=1` and quits. |

### Files (folder `hall-booking/`)

```
hall-booking/
├─ hall-booking.bpmn          collaboration: processes hall-booking (Booking Desk) + hall-approval (Hall Administration)
├─ decide-approver.dmn        decision id: decide-approver
├─ booking-request-form.form  form id: booking-request-form
├─ approval-form.form         form id: approval-form
├─ service-fix-form.form      form id: service-fix-form
├─ worker/worker.js           external job worker (4 job types)
├─ worker/outbox/             emails and reminders written by the worker (git-ignored)
├─ mock/db.seed.json          seed data (3 bookings, January 2027)
├─ mock/db.json               live data (git-ignored, created from the seed)
├─ mock/README.md             how the mock API works
├─ scripts/start-mock.cmd     json-server on 127.0.0.1:3000
├─ scripts/start-camunda.cmd  c8run start with JAVA_HOME + MOCK_BASE_URL
├─ scripts/start-worker.cmd   the external worker
├─ scripts/stop-camunda.cmd   c8run stop
├─ scripts/deploy.cmd         deploy DMN + 3 forms + BPMN via REST
├─ scripts/reset-mock.cmd     copy seed over db.json
├─ scripts/run-scenarios.ps1  automated test cases
└─ README.md                  setup, demo steps, test cases, screenshot checklist
```

## 2. Mock API

`npx json-server@0.17.4 --watch mock/db.json --host 127.0.0.1 --port 3000`. Bind to `127.0.0.1` (Node may bind
`localhost` to IPv6 only; the Java connector runtime uses IPv4). Connector URLs use `{{secrets.MOCK_BASE_URL}}`.

| Call | Used by | Response |
|---|---|---|
| `GET /bookings` | Fetch existing bookings | array of bookings |
| `POST /bookings` | Hold slot | created booking incl. `id` |
| `PATCH /bookings/{id}` | Confirm slot | updated booking |
| `DELETE /bookings/{id}` | Release slot (rejected / expired) | `{}` |
| `POST /notifications` | Worker, Notify requester (best effort) | created notification |

Seed (`mock/db.seed.json`). Booking field names differ from process variable names on purpose (FEEL filter scoping):

```json
{ "bookings": [
    {"id": 1, "hall": "hall-a", "day": "2027-01-11", "startHour": 10, "endHour": 12, "status": "CONFIRMED", "requester": "Dr. Rao"},
    {"id": 2, "hall": "hall-b", "day": "2027-01-11", "startHour": 14, "endHour": 16, "status": "CONFIRMED", "requester": "Dr. Meena"},
    {"id": 3, "hall": "lab-1",  "day": "2027-01-12", "startHour": 9,  "endHour": 13, "status": "CONFIRMED", "requester": "Prof. Iyer"} ],
  "notifications": [] }
```

## 3. Process variables

From the start form: `requesterName`, `email`, `venue` (`hall-a` | `hall-b` | `lab-1`), `bookingDate` (`yyyy-MM-dd`),
`startTime`, `endTime` (`HH:00`), `attendees`, `purpose`.

Booking Desk produces: `slot`, `validation` (`{valid, reason, capacity, checkedOn}`), `existing`, `conflictCheck`,
`serviceError`, `serviceFixAction` (`RETRY` | `CANCEL`), `approver`, `bookingId`, `bookingRef` (`"BK-" + bookingId`),
`decision` (`{outcome, remarks}`, received by message), `outcome`, `notificationId`, `notifiedAt`.

Outcomes: `APPROVED`, `REJECTED`, `EXPIRED`, `CONFLICT`, `INVALID_TIME`, `PAST_DATE`, `OVER_CAPACITY`, `SERVICE_UNAVAILABLE`.

Hall Administration receives (message variables): requester fields, `approver`, `bookingId`, `bookingRef`;
produces `approved`, `remarks`, `decision`, `reminderSentAt`.

## 4. BPMN collaboration (`hall-booking.bpmn`)

| Element | Value |
|---|---|
| Collaboration | `Collaboration_HallBooking` |
| Pool 1 | `Participant_BookingDesk` "Booking Desk" → process `hall-booking` "Seminar Hall and Lab Booking" |
| Pool 2 | `Participant_HallAdmin` "Hall Administration" → process `hall-approval` "Hall Approval" |
| Message flow | `MsgFlow_ApprovalRequest`: `Send_ApprovalRequest` → `MsgStart_ApprovalRequested` |
| Message flow | `MsgFlow_ApprovalDecision`: `Send_Decision` → `Receive_Decision` |
| Message | `Message_ApprovalRequest` name `booking-approval-request` (start event, no correlation key needed) |
| Message | `Message_ApprovalDecision` name `booking-approval-decision`, correlation key `=requestId` |
| Error | `Error_ServiceDown` code `BOOKING_SERVICE_DOWN` |

Zeebe does not execute message flows. The send tasks are job tasks of type `publish-message`; the worker publishes
the message (`POST /v2/messages/publication`, TTL 1 h) and Zeebe delivers it to the waiting start event or receive task.

### 4.1 Pool 1: Booking Desk (`hall-booking`)

| ID | Type | Name | Configuration |
|---|---|---|---|
| `StartEvent_Requested` | Start event | Booking requested | form `booking-request-form` |
| `Script_PrepareSlot` | Script (FEEL) | Prepare slot | result `slot` |
| `Worker_ValidateRequest` | Service task (worker) | Validate request | type `validate-booking` |
| `Gateway_Valid` | XOR | Request valid? | `Flow_Invalid` `=validation.valid = false` → `Gateway_Merge`; default `Flow_Valid` |
| `Gateway_FetchRetry` | XOR merge | | joins `Flow_Valid` and `Flow_Retry` |
| `Rest_FetchBookings` | REST connector | Fetch existing bookings | GET `/bookings`, result `={existing: response.body}`, errorExpression below |
| `Boundary_ServiceDown` | Error boundary | Service down | on `Rest_FetchBookings`, error `Error_ServiceDown` |
| `User_FixService` | Camunda user task | Resolve service issue | form `service-fix-form` |
| `Gateway_FixAction` | XOR | Retry? | `Flow_Retry` `=serviceFixAction = "RETRY"` → `Gateway_FetchRetry`; default `Flow_Cancel` |
| `Script_SetServiceError` | Script (FEEL) | Set service error | `="SERVICE_UNAVAILABLE"` → `outcome` |
| `Script_DetectConflict` | Script (FEEL) | Detect conflict | result `conflictCheck` |
| `Gateway_SlotOk` | XOR | Slot available? | `Flow_SlotTaken` `=conflictCheck.hasConflict = true`; default `Flow_SlotFree` |
| `Script_SetReason` | Script (FEEL) | Set rejection reason | `="CONFLICT"` → `outcome` |
| `Dmn_DecideApprover` | Business rule | Decide approver | decision `decide-approver`, result `approver` |
| `Rest_HoldSlot` | REST connector | Hold slot | POST `/bookings` (status PENDING), result `={bookingId: response.body.id, bookingRef: "BK-" + string(response.body.id)}` |
| `Send_ApprovalRequest` | Send task (worker) | Send approval request | type `publish-message`, header `messageName=booking-approval-request`, inputs `correlationKey=requestId`, `messageVariables` (requester fields, approver, bookingId, bookingRef, requestId) |
| `Receive_Decision` | Receive task | Wait for decision | message `Message_ApprovalDecision` |
| `Gateway_Decision` | XOR | Decision? | `Flow_Approved` `=decision.outcome = "APPROVED"`, `Flow_Expired` `=decision.outcome = "EXPIRED"`, default `Flow_Rejected` |
| `Rest_ConfirmSlot` | REST connector | Confirm slot | PATCH `/bookings/{id}`, result `={outcome: "APPROVED"}` |
| `Rest_ReleaseRejected` | REST connector | Release slot (rejected) | DELETE, result `={outcome: "REJECTED"}` |
| `Rest_ReleaseExpired` | REST connector | Release slot (expired) | DELETE, result `={outcome: "EXPIRED"}` |
| `Gateway_Merge` | XOR merge | | 6 incoming: invalid, conflict, service error, confirm, reject, expire |
| `Worker_Notify` | Service task (worker) | Notify requester | type `send-notification`, inputs `to`, `subject`, `message` (FEEL below) |
| `EndEvent_Done` | End event | Done | |

### 4.2 Pool 2: Hall Administration (`hall-approval`)

| ID | Type | Name | Configuration |
|---|---|---|---|
| `MsgStart_ApprovalRequested` | Message start | Approval request received | `Message_ApprovalRequest` |
| `User_Approval` | Camunda user task | Review booking | form `approval-form` |
| `Timer_Reminder` | Boundary timer, **non-interrupting** | After 1 min | `PT1M` → `Worker_Reminder` → `End_Reminded` |
| `Timer_Timeout` | Boundary timer, **interrupting** | After 2 min | `PT2M` → `Script_MarkExpired` |
| `Worker_Reminder` | Service task (worker) | Remind approver | type `send-reminder`, input `approverRole=approver` |
| `Script_RecordDecision` | Script (FEEL) | Record decision | `={outcome: if approved = true then "APPROVED" else "REJECTED", remarks: remarks}` → `decision` |
| `Script_MarkExpired` | Script (FEEL) | Mark as expired | `={outcome: "EXPIRED", remarks: "Not reviewed within 2 minutes"}` → `decision` |
| `Gateway_DecisionMerge` | XOR merge | | |
| `Send_Decision` | Send task (worker) | Send decision | type `publish-message`, header `messageName=booking-approval-decision`, inputs `correlationKey=requestId`, `messageVariables={decision: decision}` |
| `End_Decided` | End event | Decision sent | |

### 4.3 Expressions

`Script_PrepareSlot`: `={startHour: number(substring(startTime, 1, 2)), endHour: number(substring(endTime, 1, 2)), durationHours: endHour - startHour}` (written out in full in the BPMN).

`Script_DetectConflict`:
`={ hasConflict: count(existing[item.hall = venue and item.day = bookingDate and item.startHour < slot.endHour and item.endHour > slot.startHour]) > 0 }`

`Rest_FetchBookings` errorExpression (turns any connector failure into the BPMN error):
`=if error != null then bpmnError("BOOKING_SERVICE_DOWN", "Booking service unreachable", {serviceError: error.message}) else null`

`Worker_Notify` message: one `if … else if …` per outcome, including `decision.remarks` for REJECTED and
`validation.capacity` for OVER_CAPACITY.

### 4.4 External worker job types (`worker/worker.js`)

| Type | Used by | Does | Returns |
|---|---|---|---|
| `validate-booking` | `Worker_ValidateRequest` | `durationHours > 0`, `bookingDate >= today`, `attendees <= capacity` (hall-a 200, hall-b 150, lab-1 60) | `validation`, `requestId` (= process instance key, the messages' correlation key), plus `outcome` when invalid |
| `publish-message` | `Send_ApprovalRequest`, `Send_Decision` | `POST /v2/messages/publication` with header `messageName`, input `correlationKey`, input `messageVariables` | nothing |
| `send-reminder` | `Worker_Reminder` | writes `outbox/*_REMINDER_*.txt`, logs | `reminderSentAt` |
| `send-notification` | `Worker_Notify` | writes `outbox/*_<OUTCOME>_*.txt`, `POST /notifications` (best effort) | `notificationId`, `notifiedAt` |

Activation: `POST /v2/jobs/activation` (long poll 10 s, job timeout 10 s), completion `POST /v2/jobs/{key}/completion`,
failure `POST /v2/jobs/{key}/failure` with retries − 1 and 5 s backoff.

### 4.5 Connector notes

REST Outbound Connector template `io.camunda.connectors.HttpJson.v2` version **12** (newest for 8.8; v13 needs 8.9),
task type `io.camunda:http-json:1`, retries 3, `retryBackoff=PT0S`, auth `noAuth`.

## 5. DMN: `decide-approver`

Hit policy **FIRST**, one output column.

| `venue` | `slot.durationHours` | `attendees` | `approver` |
|---|---|---|---|
| `"lab-1"` | - | - | `"lab-incharge"` |
| `"hall-a","hall-b"` | `> 4` | - | `"dean"` |
| `"hall-a","hall-b"` | - | `> 100` | `"hod"` |
| - | - | - | `"admin-office"` |

## 6. Forms (schemaVersion 19)

- **`booking-request-form`**: name, email (validated), venue select with capacity in the label, date, start/end selects 08:00–18:00, attendees (min 1), purpose.
- **`approval-form`**: summary text with `{{bookingRef}}`, `{{approver}}` and the request; checkbox `approved` (default false); textarea `remarks` (default "").
- **`service-fix-form`**: text with `{{serviceError}}` and the request; radio `serviceFixAction` (`RETRY` default, `CANCEL`).

## 7. Manual steps

1. `start-mock.cmd`, `start-camunda.cmd`, `start-worker.cmd` (three windows, keep open).
2. `deploy.cmd` (or Modeler: DMN and forms first, then the BPMN).
3. `reset-mock.cmd` before a demo or test run.
4. Tasklist → Processes → "Seminar Hall and Lab Booking". Approval tasks appear as *Review booking* (process *Hall Approval*).

## 8. Test cases

Automated by `scripts/run-scenarios.ps1` (reset the mock first). Seed: hall-a 11 Jan 10–12, hall-b 11 Jan 14–16, lab-1 12 Jan 9–13 (2027).

| # | Group | Input | Expected | Result 2026-10-21 |
|---|---|---|---|---|
| A | Main path | hall-a, 12 Jan, 14–16, 50; approve | `admin-office`, `APPROVED` | PASS |
| B | Main path | hall-a, 11 Jan, 11–13 | `CONFLICT` | PASS |
| C | Main path | lab-1, 13 Jan, 10–12; nobody acts | reminder at 1 min, `EXPIRED` at 2 min, `lab-incharge` | PASS |
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

Manual (need a window closed and reopened):

| # | Steps | Expected | Result 2026-10-21 |
|---|---|---|---|
| S1 | Close mock API, start a booking, restart mock, choose **Retry**, reject | *Resolve service issue* task with `serviceError`; after retry continues; `REJECTED` with remarks in the email | PASS |
| S2 | Close mock API, start a booking, choose **Cancel** | `SERVICE_UNAVAILABLE`, email saved in outbox although the mock is down | PASS |
| W | Close the worker, start a booking, restart the worker | Booking waits at *Validate request* (no incident), continues after restart | PASS |

## 9. Acceptance checklist

- [x] Collaboration with two executable pools and two message flows, full DI
- [x] All gateways have default flows; conditions as in section 4
- [x] Interrupting and non-interrupting timers on `User_Approval`; error boundary on `Rest_FetchBookings`
- [x] External worker handles all four job types; REST connectors handle all booking-database calls
- [x] No Java, no `pom.xml`
- [x] Deployed to local Camunda 8 Run (hall-booking v2, hall-approval v1)
- [x] All automated test cases pass (section 8): 19 of 19 on 2026-10-21, plus the 3 manual cases

## 10. Next steps

- Assign `User_Approval` to real candidate groups from `approver` (Identity groups).
- Email connector (SendGrid/SMTP) instead of the outbox.
- Second DMN for venue capacities (instead of the constant in the worker).
