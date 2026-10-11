# Project 28 — Seminar Hall & Lab Booking (Camunda 8.8, BPMN + DMN only)

> Instructions for Claude Code. Read this whole file before changing anything in `hall-booking/`.
> **Do not write any Java or Spring Boot code.** All logic lives in BPMN, DMN, forms, FEEL and REST Outbound Connectors.

## 0. Status (2026-10-11)

**Built, deployed and verified on the local Camunda 8 Run 8.8.32.** All six test scenarios pass (section 8).
See `hall-booking/README.md` for how to start everything and the demo script.

### Changes from the first version of this plan

| Was | Now | Why |
|---|---|---|
| Target Camunda 8.8 **SaaS** | Target **Camunda 8 Run 8.8.32, local** (`E:\camunda8-run-8.8-windows-x86_64\c8run-8.8.32`) | That is what the course install guide uses and what is installed. |
| Mock API exposed through ngrok/cloudflared | json-server on `http://127.0.0.1:3000`, no tunnel | The local connectors runtime can reach localhost. |
| Secret `MOCK_BASE_URL` created in Console | Environment variable `MOCK_BASE_URL` set by `scripts/start-camunda.cmd` | Self-managed connectors read secrets from their environment. |
| Timer `PT30S` | Timer `PT2M` | 30 s is too short to approve live while talking. In the demo, start scenario C first. |
| Deploy from Web Modeler | `scripts/deploy.cmd` (REST `POST /v2/deployments`, all 4 files at once); Desktop Modeler deploy still works | One click, and forms and DMN are always deployed with the BPMN. |
| — | `scripts/run-scenarios.ps1` runs A–F through the REST API and prints PASS/FAIL | Regression check, and fills Operate with one instance per path. |
| — | `Rest_Notify` stores `notificationId` | Shows the notification in Operate's variables. |
| — | Scenario F uses 150 attendees | Also covers the DMN `hod` rule. |

## 1. Goal and rules

Build a booking workflow with conflict detection, DMN-based approver selection, admin approval, and automatic release of unconfirmed bookings (timer).

- Target: Camunda 8.8 (Camunda 8 Run). Use Zeebe-flavoured BPMN (`zeebe:` extension namespace) and **Camunda user tasks** (`<zeebe:userTask />`).
- Every element needs a `bpmndi` diagram shape/edge with sensible coordinates (left-to-right, ~150px spacing). Same for the DMN (`dmndi`).
- IDs below are fixed. Do not rename them.
- Course requirements this must satisfy: user task with a Camunda Form, exclusive gateway, script task (FEEL) and REST connector, timer boundary event, notification step.

### Local environment (this machine)

| Thing | Value |
|---|---|
| Camunda 8 Run | `E:\camunda8-run-8.8-windows-x86_64\c8run-8.8.32` |
| JDK for c8run | `E:\jdk-21.0.6`. Do **not** use `D:\`: c8run searches `JAVA_HOME` for a file called `java`, and on the D: drive root it finds a source folder first. |
| Operate / Tasklist | http://localhost:8080/operate, http://localhost:8080/tasklist (`demo` / `demo`) |
| Zeebe gRPC (Desktop Modeler deploy) | `http://localhost:26500`, authentication None |
| Mock API | http://127.0.0.1:3000 (Node 24, `npx json-server@0.17.4`) |
| Desktop Modeler | `E:\camunda-modeler-5.49.0-win-x64` (form schemaVersion 19) |

### Files (folder `hall-booking/`)

```
hall-booking/
├─ hall-booking.bpmn          process id: hall-booking
├─ decide-approver.dmn        decision id: decide-approver
├─ booking-request-form.form  form id: booking-request-form
├─ approval-form.form         form id: approval-form
├─ mock/db.json               live data (json-server writes to it; git-ignored, created from the seed)
├─ mock/db.seed.json          clean seed copy
├─ mock/README.md             how the mock API works
├─ scripts/start-mock.cmd     json-server on 127.0.0.1:3000
├─ scripts/reset-mock.cmd     copy seed over db.json
├─ scripts/start-camunda.cmd  c8run start with JAVA_HOME + MOCK_BASE_URL
├─ scripts/stop-camunda.cmd   c8run stop
├─ scripts/deploy.cmd         deploy all 4 files via REST
├─ scripts/run-scenarios.ps1  automated scenarios A–F
└─ README.md                  setup, demo script, scenarios, screenshot checklist
```

## 2. Mock API

`scripts\start-mock.cmd` runs `npx json-server@0.17.4 --watch mock/db.json --host 127.0.0.1 --port 3000`.
Bind to `127.0.0.1`, not `localhost`: Node may bind `localhost` to IPv6 only, and the Java connector runtime connects over IPv4.

Connector URLs use `{{secrets.MOCK_BASE_URL}}`. `scripts\start-camunda.cmd` sets `MOCK_BASE_URL=http://127.0.0.1:3000` before `c8run.exe start`; the connectors runtime inherits it.
For SaaS you would need a tunnel plus a Console secret instead (see `mock/README.md`).

Contract (json-server conventions):

| Call | Purpose | Response |
|---|---|---|
| `GET /bookings` | all bookings (FEEL filters them) | array of booking objects |
| `POST /bookings` | hold a slot | created object incl. `id` |
| `PATCH /bookings/{id}` | confirm | updated object |
| `DELETE /bookings/{id}` | release | `{}` |
| `POST /notifications` | notification | created object |

Seed (`mock/db.seed.json`). The field names are deliberately different from the process variable names, so FEEL filters don't shadow them:

```json
{
  "bookings": [
    {"id": 1, "hall": "hall-a", "day": "2026-10-20", "startHour": 10, "endHour": 12, "status": "CONFIRMED", "requester": "Dr. Rao"},
    {"id": 2, "hall": "hall-b", "day": "2026-10-20", "startHour": 14, "endHour": 16, "status": "CONFIRMED", "requester": "Dr. Meena"},
    {"id": 3, "hall": "lab-1",  "day": "2026-10-21", "startHour": 9,  "endHour": 13, "status": "CONFIRMED", "requester": "Prof. Iyer"}
  ],
  "notifications": []
}
```

## 3. Process variables

From the start form: `requesterName`, `email`, `venue` (`hall-a` | `hall-b` | `lab-1`), `bookingDate` (`yyyy-MM-dd`), `startTime`, `endTime` (hourly `HH:00`), `attendees` (number), `purpose`.

Produced: `slot` (context), `existing` (list), `conflictCheck` (context), `approver` (string), `bookingId`, `approved`, `remarks`, `outcome` (`APPROVED` | `REJECTED` | `EXPIRED` | `CONFLICT` | `INVALID_TIME`), `notificationId`.

## 4. BPMN: `hall-booking` ("Seminar Hall and Lab Booking")

| # | ID | Type | Name | Configuration |
|---|---|---|---|---|
| 1 | `StartEvent_Requested` | Start event | Booking requested | start form = `booking-request-form` |
| 2 | `Script_PrepareSlot` | Script task (FEEL) | Prepare slot | result variable `slot`, expression below |
| 3 | `Rest_FetchBookings` | REST Outbound Connector | Fetch existing bookings | GET `{{secrets.MOCK_BASE_URL}}/bookings`, auth none, result expression `={existing: response.body}` |
| 4 | `Script_DetectConflict` | Script task (FEEL) | Detect conflict | result variable `conflictCheck`, expression below |
| 5 | `Gateway_SlotOk` | Exclusive gateway | Slot available? | flows below |
| 6 | `Script_SetReason` | Script task (FEEL) | Set rejection reason | result variable `outcome`, expression below |
| 7 | `Dmn_DecideApprover` | Business rule task | Decide approver | called decision `decide-approver`, result variable `approver` |
| 8 | `Rest_HoldSlot` | REST Outbound Connector | Hold slot | POST `bookings`, body below, result expression `={bookingId: response.body.id}` |
| 9 | `User_Approval` | Camunda user task | Admin approval | form `approval-form`, no assignee or candidate groups |
| 10 | `Timer_Timeout` | Boundary timer, **interrupting** | Not approved in time | attached to #9, `timeDuration` = `PT2M` (demo; real value `PT24H`) |
| 11 | `Gateway_Approved` | Exclusive gateway | Approved? | flows below |
| 12 | `Rest_ConfirmSlot` | REST Outbound Connector | Confirm slot | PATCH `bookings/{id}`, body `={status: "CONFIRMED"}`, result expression `={outcome: "APPROVED"}` |
| 13 | `Rest_ReleaseRejected` | REST Outbound Connector | Release slot (rejected) | DELETE `bookings/{id}`, result expression `={outcome: "REJECTED"}` |
| 14 | `Rest_ReleaseExpired` | REST Outbound Connector | Release slot (expired) | DELETE `bookings/{id}`, result expression `={outcome: "EXPIRED"}` |
| 15 | `Gateway_Merge` | Exclusive gateway (merge) | | merges #6, #12, #13, #14 |
| 16 | `Rest_Notify` | REST Outbound Connector | Notify requester | POST `notifications`, body below, result expression `={notificationId: response.body.id}` |
| 17 | `EndEvent_Done` | End event | Done | |

### Sequence flows

- 1 → 2 → 3 → 4 → 5
- 5 → 6 (`Flow_SlotTaken`), condition `=slot.durationHours <= 0 or conflictCheck.hasConflict`
- 5 → 7 (`Flow_SlotFree`), **default flow**
- 6 → 15
- 7 → 8 → 9 → 11
- 10 → 14 (timer path)
- 11 → 12 (`Flow_Yes`), condition `=approved = true`
- 11 → 13 (`Flow_No`), **default flow**
- 12 → 15, 13 → 15, 14 → 15
- 15 → 16 → 17

### Expressions

`Script_PrepareSlot` (result variable `slot`):
```
={
  startHour: number(substring(startTime, 1, 2)),
  endHour: number(substring(endTime, 1, 2)),
  durationHours: number(substring(endTime, 1, 2)) - number(substring(startTime, 1, 2))
}
```

`Script_DetectConflict` (result variable `conflictCheck`):
```
={ hasConflict: count(existing[item.hall = venue and item.day = bookingDate and item.startHour < slot.endHour and item.endHour > slot.startHour]) > 0 }
```

`Script_SetReason` (result variable `outcome`):
```
=if slot.durationHours <= 0 then "INVALID_TIME" else "CONFLICT"
```

`Rest_HoldSlot` body:
```
={hall: venue, day: bookingDate, startHour: slot.startHour, endHour: slot.endHour, status: "PENDING", requester: requesterName}
```

URL for confirm/release tasks: `="{{secrets.MOCK_BASE_URL}}/bookings/" + string(bookingId)`

`Rest_Notify` body:
```
={
  to: email,
  subject: "Hall booking " + outcome,
  message: if outcome = "APPROVED" then "Your booking of " + venue + " on " + bookingDate + " (" + startTime + "-" + endTime + ") is confirmed."
    else if outcome = "REJECTED" then "Your booking request was rejected by the approver."
    else if outcome = "EXPIRED" then "Your request was auto-cancelled because it was not approved in time."
    else if outcome = "CONFLICT" then "That slot is already booked. Please choose another time."
    else "The end time must be after the start time."
}
```

### Connector notes (as built)

- Element template `io.camunda.connectors.HttpJson.v2`, **version 12**: the newest whose `engines` range includes 8.8 (v13 needs `^8.9`). It was checked against the template the Desktop Modeler downloaded (`%APPDATA%\camunda-modeler\resources\element-templates\.camunda-connector-templates.json`).
- Task type `io.camunda:http-json:1`, retries 3. Inputs: `authentication.type=noAuth`, `method`, `url`, `storeResponse=false`, `connectionTimeoutInSeconds=20`, `readTimeoutInSeconds=20`, plus `body` and `ignoreNullValues=false` for POST/PATCH.
- Task headers: `elementTemplateVersion=12`, `elementTemplateId`, `resultExpression`, `retryBackoff=PT0S`.

## 5. DMN: `decide-approver`

Hit policy **FIRST**. One output column, so `approver` is a plain string. Inputs are FEEL expressions on process variables.

| Input 1: `venue` (string) | Input 2: `slot.durationHours` (number) | Input 3: `attendees` (number) | Output: `approver` |
|---|---|---|---|
| `"lab-1"` | - | - | `"lab-incharge"` |
| `"hall-a","hall-b"` | `> 4` | - | `"dean"` |
| `"hall-a","hall-b"` | - | `> 100` | `"hod"` |
| - | - | - | `"admin-office"` |

The approval form shows `approver` as text, so the demo needs no real users or groups.

## 6. Forms (Camunda Forms JSON, schemaVersion 19, target 8.8)

**`booking-request-form`**: `requesterName` (text, required), `email` (text, required, email validation), `venue` (select: hall-a "Seminar Hall A", hall-b "Seminar Hall B", lab-1 "Computer Lab 1"), `bookingDate` (date-time, subtype date, required), `startTime` and `endTime` (selects, hourly values `"08:00"` to `"18:00"`), `attendees` (number, required, min 1), `purpose` (text area).

**`approval-form`**: a text view (bullet list, since Markdown tables may not render) showing requesterName, email, venue, bookingDate, startTime to endTime, attendees, purpose, bookingId and "Approver role: {{approver}}"; then `approved` (checkbox, default false, label "Approve this booking") and `remarks` (text area).

## 7. Manual steps (the human does these)

1. `scripts\start-mock.cmd` (keep window open).
2. `scripts\start-camunda.cmd` (keep window open; ready when Operate's login page loads).
3. `scripts\deploy.cmd`, or deploy DMN + forms + BPMN from Desktop Modeler (Camunda 8 Self-Managed, `http://localhost:26500`, auth None).
4. Tasklist → Processes → start "Seminar Hall and Lab Booking", fill the form.

## 8. Test scenarios

| # | Input | Expected | Result on 2026-10-11 |
|---|---|---|---|
| A | hall-a, 2026-10-21, 14:00-16:00, 50 attendees; tick approve | approver `admin-office`, outcome `APPROVED` | PASS: `admin-office`, `APPROVED`, booking 4 CONFIRMED |
| B | hall-a, 2026-10-20, 11:00-13:00 (overlaps seed booking 10-12) | ends via Set rejection reason, `CONFLICT` | PASS: `CONFLICT`, no task |
| C | lab-1, 2026-10-22, 10:00-12:00; do nothing for 2 min | timer fires, release, `EXPIRED` | PASS: `lab-incharge`, timer fired after 2 min, booking deleted, `EXPIRED` |
| D | end time before start time | `INVALID_TIME` | PASS: `INVALID_TIME`, no task |
| E | hall-b, 2026-10-23, 09:00-15:00 | DMN gives `dean` | PASS: `dean`, `APPROVED` |
| F | hall-b, 2026-10-25, 10:00-12:00, 150 attendees; leave approval unticked, complete task | DMN gives `hod`, `REJECTED` | PASS: `hod`, `REJECTED`, booking deleted |

Mock data check: A leaves a CONFIRMED booking, C leaves none, and every run adds a notification.
`scripts\run-scenarios.ps1` runs all six and prints PASS/FAIL. Run `scripts\reset-mock.cmd` first.

## 9. Acceptance checklist

- [x] All IDs match this file exactly
- [x] BPMN and DMN contain full diagram interchange (shapes and edges)
- [x] Both gateways have the default flows set as specified
- [x] Timer boundary is interrupting and attached to `User_Approval`
- [x] No Java, no `pom.xml`
- [x] `README.md` lists the screenshots needed: Operate path for A, B, C, the DMN table, Tasklist forms, and `db.json` after C
- [x] Deployed to local Camunda 8 Run and scenarios A–F executed

## 10. Next steps (after the progress demo)

- Click through scenarios A–C by hand in Tasklist to confirm both forms render as intended (the automated run uses the API, not the forms).
- Error boundary on `Rest_HoldSlot` leading to an "Admin Fix" user task (the reference flow's pattern)
- A second DMN that maps `outcome` to the notification text
- Swap the notify REST call for the SendGrid or Email connector
- Real approver assignment: use `approver` as the candidate group of `User_Approval` and create the groups in Identity
