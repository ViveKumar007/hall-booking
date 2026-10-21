# Seminar Hall & Lab Booking — Project Guide

This guide explains how the whole project works and how to build it yourself. It has three parts:

- **Part A, How it works:** the pieces of Camunda, the two pools, what happens at every step, and the logic behind each decision.
- **Part B, Running it:** the run guide, using Tasklist and Operate, and the test cases.
- **Part C, Building it yourself:** recreating every file in Desktop Modeler, click by click.

Quick links: [Part A](#part-a--how-it-works) · [Run guide](#6-run-guide) · [Test cases](#8-test-cases) · [Part C](#part-c--building-it-yourself) · [Troubleshooting](#11-troubleshooting) · [Questions you may be asked](#12-questions-you-may-be-asked)

> This is **version 2** (review 2): two pools, an external worker, validation, error handling and reminders.
> Version 1 (review 1) is saved in git as tag `review-1`.

---

# Part A — How it works

## 1. The project in one minute

Staff request a seminar hall or lab for a date and time. Two parties take part, drawn as two **pools**:

**Booking Desk** (the requester's side):
1. Collects the request through a **form**.
2. Prepares the slot (FEEL) and has an **external worker** validate it: the end must be after the start, the date can't be in the past, and the group must fit the venue.
3. Fetches the existing bookings over **REST** and checks for a clash. If the booking service is down, an admin decides to **retry or cancel**.
4. A **DMN table** decides who must approve: lab in-charge, dean, HOD or admin office.
5. **Holds** the slot (a `PENDING` booking), then **sends an approval request** to the Hall Administration and **waits for its decision**.
6. Confirms or releases the slot, and **notifies** the requester (through the external worker).

**Hall Administration** (the approver's side):
1. **Receives** the approval request, which starts its own process.
2. An approver reviews it in Tasklist. After **1 minute** a reminder is sent (the task stays open). After **2 minutes** the request **expires**.
3. **Sends the decision** back to the Booking Desk.

There are eight possible outcomes: `APPROVED`, `REJECTED`, `EXPIRED`, `CONFLICT`, `INVALID_TIME`, `PAST_DATE`, `OVER_CAPACITY` and `SERVICE_UNAVAILABLE`.

No Java. The process logic is BPMN, DMN, FEEL, forms and REST connectors. The only code is the external worker: about 150 lines of plain Node.js.

## 2. The building blocks

### 2.1 How the pieces fit together

```
   YOU (browser)                                                YOUR FILES (hall-booking/)
   +------------+   +------------+                               +-------------------------------+
   |  Tasklist  |   |  Operate   |                               | Desktop Modeler               |
   | fill forms |   | watch runs |                               | .bpmn (2 pools) .dmn .form x3 |
   +-----+------+   +-----+------+                               +---------------+---------------+
         |                |                                                      | deploy
         v                v                                                      v
   +--------------------------------------------------------------------------------------------+
   | CAMUNDA 8 RUN   (REST http://localhost:8080, gRPC localhost:26500)                         |
   |   Zeebe engine ..... runs both processes, evaluates FEEL + DMN, creates user tasks,        |
   |                      fires timers, delivers messages between the pools, hands out JOBS     |
   |   Elasticsearch .... history that Operate and Tasklist read                                |
   +-----------------+------------------------------------------------+-------------------------+
                     | jobs of type io.camunda:http-json:1            | jobs of type validate-booking,
                     v                                                v publish-message, send-reminder,
   +-----------------------------------+                  +---------------------------------+ send-notification
   | CONNECTORS RUNTIME (:8086)        |                  | EXTERNAL WORKER (worker.js)     |
   | REST calls, fills {{secrets.*}}   |                  | your own code, polls for jobs   |
   +-----------------+-----------------+                  +------+-------------------+-------+
                     | HTTP                                      | HTTP              | files
                     v                                           v                   v
   +-----------------------------------+                  POST /notifications   worker/outbox/*.txt
   | MOCK API json-server (:3000)      | <----------------+                     ("sent" emails)
   | bookings + notifications, db.json |
   +-----------------------------------+
```

### 2.2 What each piece does

| Piece | What it is | In this project |
|---|---|---|
| **Desktop Modeler** | Editor for BPMN, DMN and forms | Open and edit the files; can deploy |
| **Zeebe** | Camunda 8's workflow engine | Runs both processes, delivers messages, hands out jobs |
| **Tasklist** | Web app for people's work | Start a booking; *Review booking*; *Resolve service issue* |
| **Operate** | Web app for monitoring | Every instance of both processes, its path, variables and errors |
| **Connectors runtime** | Camunda's ready-made workers | The five REST calls to the booking database |
| **External worker** | **Our own** worker program (`worker/worker.js`) | Validation, publishing messages, reminders, notifications |
| **json-server** | Fake REST API from a JSON file | The college's booking database |

### 2.3 Concepts you need

| Term | Meaning |
|---|---|
| **BPMN** | Standard diagram language for processes: events (circles), tasks (boxes), gateways (diamonds), flows (arrows) |
| **Pool** | A participant in the collaboration. Each pool here is its own executable process |
| **Message flow** | Dashed arrow between pools: a message one sends and the other receives |
| **Send task / receive task** | A send task sends a message (here, our worker publishes it). A receive task waits until a matching message arrives |
| **Message start event** | Starts a new process instance when a message with its name arrives |
| **Correlation key** | Which waiting instance a message is for. Here `bookingRef`, e.g. `BK-12` |
| **DMN** | Decision table: inputs, rules and outputs |
| **FEEL** | Camunda's expression language. Expressions start with `=` |
| **Process definition / instance** | The deployed model (versioned) and one run of it |
| **Process variable** | Named value stored with an instance, e.g. `venue = "hall-a"` |
| **Job** | A unit of work Zeebe hands to a worker. Service, send and connector tasks create jobs |
| **Job worker** | A program that asks for jobs of a type, does the work and reports *complete* or *fail*. The connectors runtime is Camunda's; `worker.js` is ours |
| **Connector** | A ready-made job worker you configure instead of code (here: REST) |
| **Secret** | `{{secrets.MOCK_BASE_URL}}`: filled in by the connectors runtime, never shown in the model or Operate |
| **Incident** | A stuck step (e.g. a job failed 3 times). Shown in red in Operate; fix the cause and click *Retry* |
| **Boundary event** | An event on the edge of a task: a timer (here 1 min and 2 min) or an error (here: service down) |
| **Interrupting / non-interrupting** | Solid border: cancels the task. Dashed border: leaves the task running and starts an extra path |

## 3. The process, step by step

### 3.1 The two pools

```
BOOKING DESK (hall-booking)
(Booking requested) -> [Prepare slot] -> [[Validate request]] -> <Valid?> --invalid-----------------------------------+
                                                                    | valid                                          |
                         +--------------------------------------> <merge> -> [Fetch bookings] -> [Detect conflict] -> <Slot available?> --conflict-> [Set reason] --+
                         | retry                                              |(!) service down                       | free                                   |
                         |                                   [Resolve service issue] -> <Retry?> --cancel-> [Set service error] -------------------------------+
                         +---------------------------------------------------------------+                           v                                        |
                                                                                      [Decide approver (DMN)] -> [Hold slot] -> [[Send approval request]] -> [Wait for decision] -> <Decision?>
                                                                                                                                   :                  ^       approved -> [Confirm slot] ----+
                                                                                                                                   : request          : decision rejected -> [Release] ----+
                                                                                                                                   v                  :       expired  -> [Release] ----+  |
HALL ADMINISTRATION (hall-approval)                                                                                                                              v
(Approval request received) -> [Review booking] -> [Record decision] -> <merge> -> [[Send decision]] -> (Decision sent)       <merge> -> [[Notify requester]] -> (Done)
                                  |  (1 min, non-interrupting) -> [[Remind approver]] -> (Reminder sent)        :
                                  |  (2 min, interrupting) -> [Mark as expired] --------> <merge>               ......... message to "Wait for decision"

[[ ]] = done by our external worker      ( ) = event      < > = gateway      ..... = message flow
```

### 3.2 Following one real booking (scenario A)

Values from the test run on 21 Oct 2026. Operate shows the same values in the *Variables* panel.

| # | Pool | Element | What happens | Variables after this step |
|---|---|---|---|---|
| 1 | Desk | **Booking requested** | Form submitted in Tasklist | `venue="hall-a"`, `bookingDate="2027-01-12"`, `startTime="14:00"`, `endTime="16:00"`, `attendees=50`, … |
| 2 | Desk | **Prepare slot** (FEEL) | Times to numbers | `slot = {startHour:14, endHour:16, durationHours:2}` |
| 3 | Desk | **Validate request** (worker) | Duration > 0, date not past, 50 ≤ 200 | `validation = {valid:true, reason:null, capacity:200, checkedOn:"2026-10-21"}` |
| 4 | Desk | **Request valid?** | Valid, so the default flow | – |
| 5 | Desk | **Fetch existing bookings** (REST) | `GET /bookings` | `existing = [ …3 seed bookings… ]` |
| 6 | Desk | **Detect conflict** (FEEL) | No overlap on hall-a, 12 Jan | `conflictCheck = {hasConflict:false}` |
| 7 | Desk | **Decide approver** (DMN) | 2 h, 50 people → rule 4 | `approver = "admin-office"` |
| 8 | Desk | **Hold slot** (REST) | `POST /bookings` with status PENDING | `bookingId = 4`, `bookingRef = "BK-4"` |
| 9 | Desk | **Send approval request** (worker) | Publishes message `booking-approval-request`, key `BK-4` | – |
| 10 | Admin | **Approval request received** | A new *Hall Approval* instance starts with the request data | `bookingRef="BK-4"`, `approver`, requester fields |
| 11 | Admin | **Review booking** | Task in Tasklist; the approver ticks *Approve* | `approved = true`, `remarks = "ok"` |
| 12 | Admin | **Record decision** (FEEL) | Packs the decision | `decision = {outcome:"APPROVED", remarks:"ok"}` |
| 13 | Admin | **Send decision** (worker) | Publishes `booking-approval-decision`, key `BK-4` | – |
| 14 | Desk | **Wait for decision** | Receives the message for `BK-4` | `decision = {outcome:"APPROVED", …}` |
| 15 | Desk | **Decision?** → **Confirm slot** (REST) | `PATCH /bookings/4` to CONFIRMED | `outcome = "APPROVED"` |
| 16 | Desk | **Notify requester** (worker) | Saves the email in `outbox/`, records it in `/notifications` | `notificationId = 1` |

### 3.3 All the paths

| Outcome | Where it turns off | What happens |
|---|---|---|
| `INVALID_TIME` | Validate request | End not after start → straight to notify |
| `PAST_DATE` | Validate request | Date before today → notify |
| `OVER_CAPACITY` | Validate request | Too many people for the venue → notify (message states the capacity) |
| `SERVICE_UNAVAILABLE` | Fetch bookings fails | *Resolve service issue* task → admin chooses **Cancel** → notify |
| (continues) | Fetch bookings fails | Admin chooses **Retry** → back to Fetch bookings |
| `CONFLICT` | Slot available? | Overlaps an existing or pending booking → notify |
| `APPROVED` | Decision? | Approver ticks *Approve* → confirm → notify |
| `REJECTED` | Decision? | Approver completes without ticking → release (DELETE) → notify (with remarks) |
| `EXPIRED` | Review booking | Nobody acts: reminder at 1 min, expiry at 2 min → *Mark as expired* → decision sent → release → notify |

## 4. The logic, explained

### 4.1 Prepare slot (FEEL, result `slot`)

```
={ startHour: number(substring(startTime, 1, 2)),
   endHour: number(substring(endTime, 1, 2)),
   durationHours: number(substring(endTime, 1, 2)) - number(substring(startTime, 1, 2)) }
```
`substring("14:00", 1, 2)` → `"14"` (FEEL counts from 1), and `number("14")` → `14`.

### 4.2 Validate request (external worker, job type `validate-booking`)

The worker reads the variables and checks, in this order:

| Check | Fails with |
|---|---|
| `slot.durationHours > 0` | `INVALID_TIME` |
| `bookingDate >= today` (the computer's date) | `PAST_DATE` |
| `attendees <= capacity` (hall-a 200, hall-b 150, lab-1 60) | `OVER_CAPACITY` |

It completes the job with `validation = {valid, reason, capacity, checkedOn}`, and also sets `outcome` when invalid.
The gateway **Request valid?** sends `=validation.valid = false` to the merge; the default flow continues.

Why a worker instead of FEEL? "Today" and the capacity list belong to systems outside the process: a clock and a
facilities database. A worker is where such integration code lives.

### 4.3 Detect conflict (FEEL, result `conflictCheck`)

```
={ hasConflict: count(existing[item.hall = venue and item.day = bookingDate
                               and item.startHour < slot.endHour and item.endHour > slot.startHour]) > 0 }
```
- Two ranges overlap when **existing.start < new.end AND existing.end > new.start**. Back-to-back (10–12 and 12–14) is allowed.
- `PENDING` bookings count too, so a slot being held for approval can't be taken twice (test Q).
- Booking fields are `hall`/`day`, not `venue`/`bookingDate`, on purpose. Inside a filter, a field with the same name as a variable would hide it.

### 4.4 Gateways

| Gateway | Conditional flow(s) | Default flow |
|---|---|---|
| Request valid? | Invalid: `=validation.valid = false` | Valid |
| Retry? | Retry: `=serviceFixAction = "RETRY"` | Cancel |
| Slot available? | Conflict: `=conflictCheck.hasConflict = true` | Free |
| Decision? | Approved: `=decision.outcome = "APPROVED"`; Expired: `=decision.outcome = "EXPIRED"` | Rejected |

The unnamed gateways are **merges** (several in, one out). The one before *Fetch bookings* makes the Retry loop possible.

### 4.5 The DMN decision `decide-approver`

| | Venue | Duration (h) | Attendees | → Approver |
|---|---|---|---|---|
| 1 | `"lab-1"` | - | - | `"lab-incharge"` |
| 2 | `"hall-a","hall-b"` | `> 4` | - | `"dean"` |
| 3 | `"hall-a","hall-b"` | - | `> 100` | `"hod"` |
| 4 | - | - | - | `"admin-office"` |

Hit policy **FIRST**: rules are checked top to bottom and the first match wins. Hall B for 8 hours with 150 people
matches rules 2, 3 and 4, and gets **dean** (test P). `> 4` and `> 100` are strict: exactly 4 hours or 100 people
gives admin-office (test N).

### 4.6 REST connectors and error handling

| Task | Method | URL | Result expression |
|---|---|---|---|
| Fetch existing bookings | GET | `{{secrets.MOCK_BASE_URL}}/bookings` | `={existing: response.body}` |
| Hold slot | POST | `…/bookings` | `={bookingId: response.body.id, bookingRef: "BK-" + string(response.body.id)}` |
| Confirm slot | PATCH | `="{{secrets.MOCK_BASE_URL}}/bookings/" + string(bookingId)` | `={outcome: "APPROVED"}` |
| Release slot (rejected / expired) | DELETE | same | `={outcome: "REJECTED"}` / `"EXPIRED"` |

*Fetch existing bookings* also has an **error expression**:

```
=if error != null then bpmnError("BOOKING_SERVICE_DOWN", "Booking service unreachable", {serviceError: error.message}) else null
```

If the call fails (e.g. the mock API is closed), this turns the failure into the BPMN error `BOOKING_SERVICE_DOWN`. The
**error boundary event** *Service down* catches it and routes the booking to **Resolve service issue**, a user task
whose form shows `serviceError` and asks **Retry** or **Cancel**. Without this, the booking would sit as an incident.

### 4.7 Messages between the pools

| Message | Sent by | Received by | Correlation key | Payload |
|---|---|---|---|---|
| `booking-approval-request` | *Send approval request* (Desk) | *Approval request received* (Admin, **start event**) | `bookingRef` | requester fields, `approver`, `bookingId`, `bookingRef` |
| `booking-approval-decision` | *Send decision* (Admin) | *Wait for decision* (Desk, **receive task**) | `bookingRef` | `decision = {outcome, remarks}` |

- The dashed **message flows** in the diagram document who talks to whom; Zeebe does not execute them. The **send tasks**
  create jobs of type `publish-message`; our worker publishes the message through Camunda's REST API.
- The message **name** says which kind of event it is; the **correlation key** says which instance it's for. Several
  bookings can wait at the same time; each gets only its own decision.
- Messages are kept for 1 hour (time-to-live), so nothing is lost even if a message arrives before the receiver is waiting.

### 4.8 The two timers

Both are attached to *Review booking* in the Admin pool.

| Timer | Type | Duration | Effect |
|---|---|---|---|
| After 1 min | **Non-interrupting** (dashed) | `PT1M` | Starts an extra path: *Remind approver*. The task **stays open** |
| After 2 min | **Interrupting** (solid) | `PT2M` | **Cancels** the task, *Mark as expired*, sends decision `EXPIRED` |

Completing the task first cancels both timers. In real use these would be `PT24H` and `PT48H`.

### 4.9 How the external worker works

`worker/worker.js` runs four loops, one per job type. Each loop:

1. **Activate:** `POST /v2/jobs/activation` with `type`, `timeout: 10 s` and long polling, which means "give me up to 10 jobs of this type; wait up to 10 s if there are none".
2. **Work:** runs the handler with the job's variables, e.g. validates the request.
3. **Complete:** `POST /v2/jobs/{key}/completion` with the result variables. The process moves on.
4. **Fail:** if the handler throws, `POST /v2/jobs/{key}/failure` with one retry fewer. After 3 failures Camunda raises an incident.

If the worker is not running, jobs simply **wait**: no error, no incident (test W). If a worker dies while holding a
job, Camunda gives the job to another worker after the 10 s job timeout.

### 4.10 The forms

| Form | Used by | Fields (key) |
|---|---|---|
| `booking-request-form` | Start event | `requesterName`, `email`, `venue` (with capacity in the label), `bookingDate`, `startTime`, `endTime`, `attendees`, `purpose` |
| `approval-form` | Review booking | text with `{{bookingRef}}`, `{{approver}}`, request details; `approved` checkbox; `remarks` |
| `service-fix-form` | Resolve service issue | text with `{{serviceError}}`; `serviceFixAction` radio: Retry / Cancel |

A field's **key** is the variable name it writes. Forms are linked by **form ID**, so they must be deployed with the BPMN.

---

# Part B — Running it

## 5. Files in this project

```
WFA - Project/
├─ README.md                   GitHub landing page
├─ PLAN.md                     the specification (IDs, expressions, messages, test results)
├─ PROJECT-GUIDE.md            this guide
└─ hall-booking/
   ├─ hall-booking.bpmn          both pools: hall-booking (Booking Desk) + hall-approval (Hall Administration)
   ├─ decide-approver.dmn        decision table
   ├─ booking-request-form.form  start form
   ├─ approval-form.form         Review booking form
   ├─ service-fix-form.form      Resolve service issue form
   ├─ README.md                  short setup + demo + screenshot checklist
   ├─ worker/
   │  ├─ worker.js               the external job worker
   │  └─ outbox/                 emails and reminders it "sends" (not in git)
   ├─ mock/
   │  ├─ db.seed.json            3 seed bookings (January 2027)
   │  ├─ db.json                 live data (created from the seed; not in git)
   │  └─ README.md               how the mock API works
   └─ scripts/
      ├─ start-mock.cmd          mock API on 127.0.0.1:3000
      ├─ start-camunda.cmd       Camunda 8 Run with JAVA_HOME + MOCK_BASE_URL
      ├─ start-worker.cmd        the external worker
      ├─ stop-camunda.cmd        stop Camunda 8 Run
      ├─ deploy.cmd              deploy DMN + 3 forms + BPMN
      ├─ reset-mock.cmd          restore the seed data
      └─ run-scenarios.ps1       automated test cases, prints PASS/FAIL
```

## 6. Run guide

All scripts are in `hall-booking\scripts\`. Each `.cmd` can be double-clicked in Explorer.

### 6.1 First time on a new computer (one-time setup)

Skip this on Vivek's laptop: everything is installed.

1. Install **JDK 21** into **its own folder**, e.g. `C:\Java\jdk-21`. Never unpack it onto a drive root such as `D:\`.
2. Install **Node.js** (LTS). It runs the mock API and the worker.
3. Download **Camunda 8 Run 8.8** (https://downloads.camunda.cloud/release/camunda/c8run/8.8/) and **Desktop Modeler** (https://camunda.com/download/modeler/), and unzip both.
4. `git clone https://github.com/ViveKumar007/hall-booking.git`
5. In `start-camunda.cmd` and `stop-camunda.cmd`, change the two paths at the top (`C8RUN`, `JAVA_HOME`) to your folders.

### 6.2 Every time: start the project (about 3 minutes)

| Step | Do this | You should see |
|---|---|---|
| 1 | Double-click `start-mock.cmd` | json-server banner, `Resources http://127.0.0.1:3000/bookings`. **Keep open.** |
| 2 | Double-click `start-camunda.cmd` | `JAVA_HOME: E:\jdk-21.0.6`, then Elasticsearch, Connectors and Camunda start. Ends with "All processes are running and healthy". If it gives up, run it once more. |
| 3 | Double-click `start-worker.cmd` | `worker started: validate-booking, publish-message, send-reminder, send-notification`. **Keep open.** Every job it handles is printed here. |
| 4 | Open http://localhost:8080/operate | Login page after 1–3 min (`ERR_CONNECTION_REFUSED` until then). Log in with `demo` / `demo`. |
| 5 | Double-click `deploy.cmd` (first time, or after a change) | JSON listing `hall-booking`, `hall-approval`, `decide-approver` and three forms |
| 6 | Double-click `reset-mock.cmd` (before a demo or test run) | `Mock data reset to seed.` |
| 7 | Open **Camunda Modeler** by double-clicking `E:\camunda-modeler-5.49.0-win-x64\Camunda Modeler.exe` → open the `.bpmn` and `.dmn` | The two pools; the DMN as a box (click its **table icon** for the rules) |

Close heavy apps before step 2. Camunda needs a few GB of free RAM, and low memory made a start fail once.

### 6.3 Check it works (1 minute)

```
powershell -ExecutionPolicy Bypass -File "hall-booking\scripts\run-scenarios.ps1" -SkipTimer
hall-booking\scripts\reset-mock.cmd
```
Every line should say PASS. The worker window prints each job as it runs.

### 6.4 After you change a file

Save in Modeler → `deploy.cmd` (or the rocket icon) → Camunda creates a new version of each changed file → start a
**new** booking. Running instances keep their version. Saving in Modeler may reformat the XML (e.g. `&lt;` → `&#60;`); that's harmless.

### 6.5 Stop and restart

| Situation | Do this |
|---|---|
| Finished for the day | `stop-camunda.cmd`; close the worker and mock windows (Ctrl+C, then close) |
| After the PC restarted | Steps 1–4 of 6.2. Deployments and finished instances are kept. |
| Camunda won't start after an unclean shutdown | Delete `camunda.process`, `connectors.process`, `elasticsearch.process` in the c8run folder, then `start-camunda.cmd` |

### 6.6 Addresses

| Address | What |
|---|---|
| http://localhost:8080/operate | Operate |
| http://localhost:8080/tasklist | Tasklist |
| http://localhost:8080/v2/... | Camunda REST API (scripts and worker) |
| `localhost:26500` | Zeebe gRPC (Modeler deploys here) |
| http://127.0.0.1:3000/bookings, /notifications | Mock data |
| `hall-booking\worker\outbox\` | Emails and reminders the worker "sent" |

## 7. Seeing it work

### 7.1 In Tasklist

1. **Processes** → **Seminar Hall and Lab Booking** → **Start process**, fill in the form. (Don't start *Hall Approval* directly: it is started by the message.)
2. **Tasks** → **Review booking** appears within a few seconds (process *Hall Approval*). It shows the booking ref and approver role.
3. Tick *Approve this booking* (or leave it unticked to reject), add remarks → **Complete task**.
4. Leave a review open: after 1 min the worker window prints a reminder; after 2 min the task disappears (expired).
5. If the booking service is down, the task is **Resolve service issue** instead: choose Retry or Cancel.

### 7.2 In Operate

1. **Processes** → tick **Finished instances** in the filter panel (finished runs are hidden by default).
2. Each booking has **two instances**: one *Seminar Hall and Lab Booking*, one *Hall Approval*. Match them by `bookingRef`.
3. Open an instance: the highlighted path, and the **Variables** panel (`validation`, `slot`, `conflictCheck`, `approver`, `bookingRef`, `decision`, `outcome`).
4. **Decisions** (top bar) → *Decide approver*: the inputs and the rule that matched.
5. A red badge is an **incident**: read the error, fix the cause, click **Retry**.

### 7.3 Outside Camunda

- **Worker window:** one line per job, e.g. `validate-booking  Scenario A | hall-a 2027-01-12 14:00-16:00, 50 people -> VALID`.
- **`worker\outbox\`:** one `.txt` email per finished booking, plus reminders.
- **http://127.0.0.1:3000/bookings:** a `PENDING` booking appears at *Hold slot*, becomes `CONFIRMED`, or disappears when released.

## 8. Test cases

Seed bookings (2027): **hall-a 11 Jan 10–12**, **hall-b 11 Jan 14–16**, **lab-1 12 Jan 9–13**. Run `reset-mock.cmd` before testing.

### 8.1 Automated (`run-scenarios.ps1`, about 3 minutes)

| # | Group | Input | Expected | Result 21 Oct 2026 |
|---|---|---|---|---|
| A | Main path | hall-a, 12 Jan, 14–16, 50; approve | `admin-office`, `APPROVED` | PASS |
| B | Main path | hall-a, 11 Jan, 11–13 | `CONFLICT` | PASS |
| C | Main path | lab-1, 13 Jan, 10–12; nobody acts | reminder at 1 min; `EXPIRED`; `lab-incharge` | PASS |
| D | Main path | hall-b, 14 Jan, 15–13 | `INVALID_TIME` | PASS |
| E | Main path | hall-b, 15 Jan, 09–15 (6 h), 80; approve | `dean`, `APPROVED` | PASS |
| F | Main path | hall-b, 18 Jan, 10–12, 150; reject | `hod`, `REJECTED` | PASS |
| G | Worker validation | hall-a, 1 Oct 2026 | `PAST_DATE` | PASS |
| H | Worker validation | lab-1, 61 people | `OVER_CAPACITY` | PASS |
| I | Worker validation | lab-1, exactly 60; approve | `lab-incharge`, `APPROVED` | PASS |
| J | Worker validation | hall-a, 10:00–10:00 | `INVALID_TIME` | PASS |
| K | Conflict check | hall-a, 11 Jan, 12–14 (back-to-back); approve | `APPROVED` | PASS |
| L | Conflict check | hall-b, 11 Jan, 10–12 (other venue); approve | `APPROVED` | PASS |
| M | Conflict check | hall-a, 11 Jan, 09–13 (covers seed) | `CONFLICT` | PASS |
| N | DMN | hall-a, exactly 4 h and 100 people; approve | `admin-office` | PASS |
| O | DMN | hall-a, 101 people; approve | `hod` | PASS |
| P | DMN | hall-b, 8 h, 150 people; approve | `dean` (FIRST) | PASS |
| Q1/Q2 | Slot hold | Q1 left pending; Q2 asks for the same slot | Q2 `CONFLICT`; Q1 then `APPROVED` | PASS |
| R | Slot hold | rebook C's slot after it expired; approve | `APPROVED` | PASS |

### 8.2 Manual (need a window closed and reopened)

| # | Steps | Expected | Result 21 Oct 2026 |
|---|---|---|---|
| S1 | Close the **mock API** window, start a booking. Restart `start-mock.cmd`, open *Resolve service issue*, choose **Retry**, then reject the review with a remark | Task shows the error; after Retry the booking continues; `REJECTED`, remark in the email | PASS |
| S2 | Close the mock API, start a booking, choose **Cancel** | `SERVICE_UNAVAILABLE`; email saved in `outbox` although the mock is down | PASS |
| W | Close the **worker** window, start a booking, wait, restart `start-worker.cmd` | Booking waits at *Validate request* with no incident, then continues | PASS |

### 8.3 Form checks (Tasklist)

Leave a required field empty, type an email without `@`, or enter 0 attendees: the form refuses to submit.

---

# Part C — Building it yourself

Build in this order: **forms → DMN → BPMN → worker**. The BPMN refers to the others by ID:
`booking-request-form`, `approval-form`, `service-fix-form`, `decide-approver`. The worker refers to job types.

## 9. Step by step in Desktop Modeler

### 9.1 Forms

**File → New File → Form (Camunda 8)**. Click the empty canvas to set the form **ID**. Drag components from the
palette and set each one's **Key**.

| Form ID | Components (key) |
|---|---|
| `booking-request-form` | Text view (heading); Text field `requesterName` (required); Text field `email` (required, validation *Email*); Select `venue`: `hall-a` "Seminar Hall A (up to 200 people)", `hall-b` "… (up to 150)", `lab-1` "Computer Lab 1 (up to 60)"; Date time `bookingDate` (subtype Date, required); Select `startTime` and `endTime` (`08:00` … `18:00`); Number `attendees` (required, min 1); Text area `purpose` |
| `approval-form` | Text view: `# Booking approval` / `**Booking:** {{bookingRef}}` / `**Approver role:** {{approver}}` / a list of `{{requesterName}}`, `{{venue}}`, `{{bookingDate}}`, `{{startTime}}`–`{{endTime}}`, `{{attendees}}`, `{{purpose}}`; Checkbox `approved` (default unchecked); Text area `remarks` (default empty) |
| `service-fix-form` | Text view with `{{serviceError}}` and the request; Radio `serviceFixAction`: `RETRY` "Retry now" (default), `CANCEL` "Cancel the booking" (required) |

### 9.2 DMN

1. **File → New File → DMN diagram (Camunda 8)**. Click the decision: **ID** `decide-approver`, **Name** "Decide approver".
2. Click the **table icon** on the decision. Set the hit policy to **First**.
3. Inputs (double-click a header): `venue` (string), `slot.durationHours` (number), `attendees` (number). Output: name `approver` (string).
4. Add the four rules from [4.5](#45-the-dmn-decision-decide-approver) in that order. An empty cell means "any". Strings need quotes.

### 9.3 BPMN: the two pools

1. **File → New File → BPMN diagram (Camunda 8)**.
2. Click the canvas and use **Create pool/participant**, or drag a **pool** from the palette. Name it "Booking Desk". In the properties panel, set the **process ID** `hall-booking`, process name "Seminar Hall and Lab Booking", and tick **Executable**.
3. Drag a second pool below it: "Hall Administration", process ID `hall-approval`, name "Hall Approval", **Executable**.
4. Build each pool from left to right with the tables below. To change an element's type, select it → **wrench** icon.
5. **Message flows:** select *Send approval request*, drag its arrow to *Approval request received* in the other pool (the connection becomes dashed). Do the same from *Send decision* to *Wait for decision*.

**Booking Desk** (set each element's **ID** in the General section):

| ID / name | Create as | Properties panel |
|---|---|---|
| `StartEvent_Requested` "Booking requested" | Start event | Form: *Camunda Form (linked)*, `booking-request-form` |
| `Script_PrepareSlot` "Prepare slot" | Script task | Implementation *FEEL expression*, result `slot`, expression from 4.1 |
| `Worker_ValidateRequest` "Validate request" | Service task | Implementation *Job worker*, **Task definition type** `validate-booking`, retries 3 |
| `Gateway_Valid` "Request valid?" | Exclusive gateway | conditions on its flows |
| `Gateway_FetchRetry` | Exclusive gateway | merge, no name |
| `Rest_FetchBookings` "Fetch existing bookings" | Task → wrench → **REST Outbound Connector** | Auth None, GET, URL `{{secrets.MOCK_BASE_URL}}/bookings`, result expression `={existing: response.body}`, **Error handling → Error expression** from 4.6 |
| `Boundary_ServiceDown` "Service down" | Drag an intermediate event onto the task edge → wrench → **Error boundary event** | Global error reference: new error, name "Booking service down", code `BOOKING_SERVICE_DOWN` |
| `User_FixService` "Resolve service issue" | User task | *Camunda user task*, form `service-fix-form` |
| `Gateway_FixAction` "Retry?" | Exclusive gateway | Retry flow back to `Gateway_FetchRetry` |
| `Script_SetServiceError` "Set service error" | Script task | `="SERVICE_UNAVAILABLE"`, result `outcome` |
| `Script_DetectConflict` "Detect conflict" | Script task | expression from 4.3, result `conflictCheck` |
| `Gateway_SlotOk` "Slot available?" | Exclusive gateway | |
| `Script_SetReason` "Set rejection reason" | Script task | `="CONFLICT"`, result `outcome` |
| `Dmn_DecideApprover` "Decide approver" | Business rule task | *DMN decision*, ID `decide-approver`, result `approver` |
| `Rest_HoldSlot` "Hold slot" | REST Outbound Connector | POST, body `={hall: venue, day: bookingDate, startHour: slot.startHour, endHour: slot.endHour, status: "PENDING", requester: requesterName}`, result expression from 4.6 |
| `Send_ApprovalRequest` "Send approval request" | **Send task** | *Job worker*, type `publish-message`; **Task headers**: `messageName` = `booking-approval-request`; **Inputs**: `correlationKey` = `=bookingRef`, `messageVariables` = `={requesterName: requesterName, email: email, venue: venue, bookingDate: bookingDate, startTime: startTime, endTime: endTime, attendees: attendees, purpose: purpose, approver: approver, bookingId: bookingId, bookingRef: bookingRef}` |
| `Receive_Decision` "Wait for decision" | **Receive task** | Message: new, name `booking-approval-decision`, **correlation key** `=bookingRef` |
| `Gateway_Decision` "Decision?" | Exclusive gateway | three outgoing flows |
| `Rest_ConfirmSlot`, `Rest_ReleaseRejected`, `Rest_ReleaseExpired` | REST Outbound Connector | PATCH / DELETE / DELETE, URL `="{{secrets.MOCK_BASE_URL}}/bookings/" + string(bookingId)`, result expressions from 4.6 |
| `Gateway_Merge` | Exclusive gateway | merge of the six endings |
| `Worker_Notify` "Notify requester" | Service task | *Job worker*, type `send-notification`; **Inputs** `to` = `=email`, `subject` = `="Hall booking " + outcome`, `message` = the FEEL text from `PLAN.md` |
| `EndEvent_Done` "Done" | End event | |

**Hall Administration:**

| ID / name | Create as | Properties panel |
|---|---|---|
| `MsgStart_ApprovalRequested` "Approval request received" | Start event → wrench → **Message start event** | Message: new, name `booking-approval-request` |
| `User_Approval` "Review booking" | User task | *Camunda user task*, form `approval-form` |
| `Timer_Reminder` "After 1 min" | Event on the task edge → wrench → **Timer boundary event (non-interrupting)** | Timer type *Duration*, `PT1M` |
| `Worker_Reminder` "Remind approver" | Service task | *Job worker*, type `send-reminder`; Input `approverRole` = `=approver` |
| `End_Reminded` "Reminder sent" | End event | |
| `Timer_Timeout` "After 2 min" | Event on the task edge → wrench → **Timer boundary event** (interrupting) | Duration `PT2M` |
| `Script_RecordDecision` "Record decision" | Script task | `={outcome: if approved = true then "APPROVED" else "REJECTED", remarks: remarks}`, result `decision` |
| `Script_MarkExpired` "Mark as expired" | Script task | `={outcome: "EXPIRED", remarks: "Not reviewed within 2 minutes"}`, result `decision` |
| `Gateway_DecisionMerge` | Exclusive gateway | merge |
| `Send_Decision` "Send decision" | Send task | type `publish-message`; header `messageName` = `booking-approval-decision`; inputs `correlationKey` = `=bookingRef`, `messageVariables` = `={decision: decision}` |
| `End_Decided` "Decision sent" | End event | |

6. **Conditions and default flows** (select a flow → *Condition*; for a default flow: select it → wrench → **Default flow**): see the table in [4.4](#44-gateways).
7. Check the **Problems** panel (0 errors), then save as `hall-booking.bpmn`.

### 9.4 The worker

`worker/worker.js` is ready to use. To write your own, the minimum is one loop per job type:

```js
const res = await fetch('http://localhost:8080/v2/jobs/activation', { method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ type: 'validate-booking', worker: 'me', timeout: 10000, maxJobsToActivate: 10 }) });
for (const job of (await res.json()).jobs) {
  const result = { /* do the work with job.variables */ };
  await fetch(`http://localhost:8080/v2/jobs/${job.jobKey}/completion`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ variables: result }) });
}
```

### 9.5 Deploy and run

Run `scripts\deploy.cmd`, or in Modeler use the **rocket** icon (Camunda 8 Self-Managed, `http://localhost:26500`,
authentication None): deploy the DMN and the three forms first, then the BPMN. One BPMN file with two executable
pools deploys **two process definitions**.

### 9.6 Common mistakes

| Mistake | Symptom |
|---|---|
| Form ID or decision ID typed differently | Incident "form/decision not found" |
| Pool not marked **Executable** | Its process is not deployed; messages to it are never received |
| Message name differs between sender and receiver | The booking waits forever at *Wait for decision* |
| Correlation key missing or different | The decision never reaches the right booking |
| Worker not running | Bookings wait at *Validate request* (no error); start `start-worker.cmd` |
| Job type in the BPMN differs from the worker's | Same as worker not running |
| Missing `=` before a FEEL expression | The text is used literally |
| No default flow on a gateway | Incident when no condition matches |
| Boundary event placed near, not on, the task | It never fires |
| `localhost` in the mock URL | Connection refused (IPv6 vs IPv4). Use `127.0.0.1` |

---

## 10. How this machine was set up

| Item | Location / value | Note |
|---|---|---|
| Java (JDK 21.0.6) | `E:\jdk-21.0.6` | Copied from `D:\`, where it was unpacked on the drive root (c8run picked up a wrong `java` folder there) |
| Camunda 8 Run 8.8.32 | `E:\camunda8-run-8.8-windows-x86_64\c8run-8.8.32` | Logs in its `log\` folder |
| Desktop Modeler 5.49 | `E:\camunda-modeler-5.49.0-win-x64` | Launch by double-click (from VS Code's terminal it quits, because of `ELECTRON_RUN_AS_NODE`) |
| Node.js 24 | on PATH | Mock API and worker |
| Login | `demo` / `demo` | Created on the first start |

## 11. Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `ERR_CONNECTION_REFUSED` on :8080 | Camunda not running yet | `start-camunda.cmd`, wait 1–3 min |
| c8run "Failed to get Java version" | Wrong `JAVA_HOME` | Use `start-camunda.cmd` |
| c8run gives up while starting Camunda | Usually low memory | Close heavy apps, run `start-camunda.cmd` again |
| Booking stuck at *Validate request* | Worker not running | `start-worker.cmd` |
| *Resolve service issue* task appears | Mock API not reachable | Start `start-mock.cmd`, choose Retry |
| A step waits ~10 s after the worker was restarted | The old worker held the job | Expected: it is handed over after the 10 s job timeout |
| Scenario ends `PAST_DATE` unexpectedly | Test date before today | Use dates in the future (seed and tests use January 2027) |
| Scenario A/E ends `CONFLICT` | Leftover booking from an earlier run | `reset-mock.cmd` |
| Operate shows no instances | Finished instances hidden | Tick **Finished instances** |
| *Review booking* disappeared | Expired after 2 minutes | Expected (scenario C) |
| DMN shows only a box | Overview (DRD) view | Click the table icon. Use Camunda Modeler, not VS Code's DMN editor |
| Login refused right after first start | Demo user not created yet | Wait 30 s |

## 12. Questions you may be asked

**What is an external worker, and how is it different from a connector?**
Both are job workers: programs that ask Camunda for jobs of a type, do the work, and complete or fail the job.
A connector is a ready-made worker you configure in the Modeler (our REST calls). An external worker is your own
code (`worker.js`), used where there is custom logic: validation rules, message publishing, notifications.

**What happens if the worker crashes?**
Jobs wait; there's no error. When a worker restarts, it picks them up. A job a dead worker was holding is
handed to another worker after the job timeout (10 s). If the handler itself throws, the job is failed with one
retry fewer; after three failures Camunda raises an incident.

**Why two pools? How do they communicate?**
The booking desk and the hall administration are separate participants with their own processes, which could even run
on different systems. They communicate only by messages: the send task publishes `booking-approval-request` with
correlation key `bookingRef`; the message start event in the admin pool starts a new instance. The decision comes back
the same way to the receive task. The dashed message flows document this.

**What is a correlation key, and why `bookingRef`?**
It says which waiting instance a message is for. Many bookings can wait for decisions at once, and `bookingRef`
(`BK-` + the booking ID) is unique per booking, so each gets only its own decision.

**Interrupting vs non-interrupting timer?**
After 1 minute, the non-interrupting timer sends a reminder and leaves the task open. After 2 minutes, the interrupting
timer cancels the task and expires the request. Completing the task first cancels both.

**What if the booking service is down?**
The REST connector's error expression turns the failure into BPMN error `BOOKING_SERVICE_DOWN`. The error boundary
event catches it, and an admin gets *Resolve service issue*: Retry loops back to the fetch, and Cancel ends with
`SERVICE_UNAVAILABLE` and notifies the requester. Nothing is stuck and nothing is lost.

**Why validate in a worker and not in FEEL?**
"Today" and venue capacities come from outside the process: a clock and a facilities database. Integration logic
belongs in a worker, so it can change without redeploying the process.

**Why hold the slot before approval?**
So nobody else can take it while it's being approved: test Q shows a second request for a held slot gets `CONFLICT`.
Rejected or expired holds are deleted, freeing the slot (test R).

**Why DMN for the approver? What does FIRST do?**
Business rules change more often than the process; a table is readable and redeployable on its own. FIRST takes the
first matching rule from the top, so hall-b, 8 h, 150 people gets dean, not HOD (test P). UNIQUE would fail there,
because three rules match.

**How does deployment work? What happens to running instances?**
`deploy.cmd` sends all files in one deployment; one BPMN file with two pools creates two process definitions. A changed
file becomes a new version. Running instances finish on their version; new ones use the latest.

**Known limitation?**
Two requests for the same slot at exactly the same moment could both pass the conflict check before either holds the
slot. A real booking database would stop this with a uniqueness constraint when creating the hold.
