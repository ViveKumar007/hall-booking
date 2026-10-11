# Seminar Hall & Lab Booking — Project Guide

This guide explains how the whole project works and how to build it yourself. It has three parts:

- **Part A, How it works:** the pieces of Camunda, what happens at every step of the process, and the logic behind each decision.
- **Part B, Running it:** starting everything, using Tasklist and Operate, and the test scenarios.
- **Part C, Building it yourself:** recreating every file in Desktop Modeler, click by click.

Quick links: [Part A](#part-a--how-it-works) · [Part B](#part-b--running-it) · [Part C](#part-c--building-it-yourself) · [Troubleshooting](#10-troubleshooting) · [Questions you may be asked](#11-questions-you-may-be-asked)

---

# Part A — How it works

## 1. The project in one minute

Staff request a seminar hall or lab for a date and time. The workflow:

1. Collects the request through a **form**.
2. Fetches the existing bookings from a **REST API** and checks whether the slot is free.
3. If the slot is taken (or the times make no sense), it stops and tells the requester why.
4. If the slot is free, a **DMN decision table** decides who must approve it (lab in-charge, dean, HOD or admin office).
5. It **holds** the slot (a `PENDING` booking) so nobody else can take it during approval.
6. An approver sees an **approval task** in Tasklist and approves or rejects it.
7. If nobody acts within **2 minutes**, a **timer** cancels the task and releases the slot.
8. Every path ends by **notifying** the requester.

There are five possible outcomes: `APPROVED`, `REJECTED`, `EXPIRED`, `CONFLICT` and `INVALID_TIME`.

There is **no Java code**. All logic is in BPMN (the flow), DMN (the approver rules), FEEL (small expressions), forms, and REST connectors.

## 2. The building blocks

### 2.1 How the pieces fit together

```
   YOU (browser)                                    YOUR FILES (hall-booking/)
   +------------+   +------------+                  +------------------------------+
   |  Tasklist  |   |  Operate   |                  | Desktop Modeler              |
   | fill forms |   | watch runs |                  | .bpmn  .dmn  .form           |
   +-----+------+   +-----+------+                  +--------------+---------------+
         |                |                                        | deploy
         v                v                                        v
   +-----------------------------------------------------------------------------+
   | CAMUNDA 8 RUN   (http://localhost:8080, gRPC localhost:26500)                |
   |                                                                             |
   |   Zeebe engine ...... runs the BPMN, evaluates FEEL, evaluates the DMN,      |
   |                       creates user tasks, fires timers                       |
   |   Elasticsearch ..... stores history; Operate and Tasklist read from it      |
   +-------------------------------------+---------------------------------------+
                                         | "please run this REST call" (a job)
                                         v
   +-------------------------------------+---------------+          +--------------------------+
   | CONNECTORS RUNTIME (localhost:8086)                 |   HTTP   | MOCK API (json-server)   |
   | replaces {{secrets.MOCK_BASE_URL}}, makes the call, | -------> | http://127.0.0.1:3000    |
   | applies the result expression, reports back         |          | data in mock/db.json     |
   +-----------------------------------------------------+          +--------------------------+
```

### 2.2 What each piece does

| Piece | What it is | In this project |
|---|---|---|
| **Desktop Modeler** | The editor for BPMN, DMN and forms | Where you open/edit the 4 files and can deploy them |
| **Zeebe** | Camunda 8's workflow engine | Runs the process. It executes script tasks and DMN itself, and hands REST calls to the connectors runtime |
| **Tasklist** | Web app for people's work | Start a booking (start form), approve or reject it (approval form) |
| **Operate** | Web app for monitoring | Shows every process instance, the path it took, its variables and any errors |
| **Connectors runtime** | A service that runs ready-made integrations | Performs the 6 REST calls to the mock API |
| **Elasticsearch** | Search database | Holds the history that Operate and Tasklist display |
| **json-server** | A tiny fake REST API built from a JSON file | Plays the "college booking database" |

### 2.3 Concepts you need

| Term | Meaning |
|---|---|
| **BPMN** | Standard diagram language for processes: events (circles), tasks (rounded boxes), gateways (diamonds), arrows (sequence flows) |
| **DMN** | Standard for decision tables: inputs, rules and outputs, evaluated like a lookup table |
| **FEEL** | The small expression language Camunda uses everywhere (conditions, scripts, mappings). Expressions start with `=` |
| **Process definition** | The deployed BPMN (the template). Redeploying a changed file creates version 2, 3, ... |
| **Process instance** | One run of the process, i.e. one booking request |
| **Process variable** | A named value stored with an instance, e.g. `venue = "hall-a"`. Form fields become variables; tasks add more |
| **Camunda Form** | A form defined in JSON. Each field's **key** is the variable name it reads/writes |
| **Connector** | A ready-made task type (here: REST). You fill in method, URL and body instead of writing code |
| **Secret** | A named value such as `MOCK_BASE_URL`, written as `{{secrets.MOCK_BASE_URL}}`. It is filled in by the connectors runtime, so it never appears in the model or in Operate |
| **Job** | A unit of work Zeebe hands to a worker. Each connector task is a job picked up by the connectors runtime |
| **Incident** | A stuck step (e.g. the REST call failed 3 times). Shown in red in Operate; fix the cause and click *Retry* |
| **Boundary event** | An event attached to the edge of a task. Here: a timer that fires if the task takes too long |

## 3. The process, step by step

```
(Booking requested) -> [Prepare slot] -> [Fetch existing bookings] -> [Detect conflict] -> <Slot available?>
                                                                                              |
     +--------------- conflict or invalid time -------------------------------------------- +
     |                                                                                        | free (default)
     v                                                                                        v
 [Set rejection reason]                [Decide approver (DMN)] -> [Hold slot] -> [Admin approval] -> <Approved?>
     |                                                                              |                 |   |
     |                                                                     (timer 2 min)        yes  |   | no (default)
     |                                                                              v                 v   v
     |                                                               [Release slot (expired)] [Confirm] [Release (rejected)]
     |                                                                              |                 |   |
     +------------------------------------------------------------------------> <merge> <-----------+---+
                                                                                    |
                                                                          [Notify requester] -> (Done)
```

### 3.1 Following one real booking (scenario A)

These are the **actual values** from the test run of scenario A. Operate shows the same values in the *Variables* panel.

| # | Element | Type | What happens | Variables after this step |
|---|---|---|---|---|
| 1 | **Booking requested** | Start event + start form | The requester fills `booking-request-form` in Tasklist | `requesterName="Scenario A"`, `email`, `venue="hall-a"`, `bookingDate="2026-10-21"`, `startTime="14:00"`, `endTime="16:00"`, `attendees=50`, `purpose` |
| 2 | **Prepare slot** | Script task (FEEL) | Turns `"14:00"`/`"16:00"` into numbers and computes the length | `slot = {startHour:14, endHour:16, durationHours:2}` |
| 3 | **Fetch existing bookings** | REST connector, `GET /bookings` | Downloads all bookings from the mock API | `existing = [ {id:1, hall:"hall-a", day:"2026-10-20", startHour:10, endHour:12, ...}, ... ]` |
| 4 | **Detect conflict** | Script task (FEEL) | Looks for a booking on the same hall and day whose hours overlap | `conflictCheck = {hasConflict:false}` |
| 5 | **Slot available?** | Exclusive gateway | Not a conflict and duration > 0, so it takes the default "Free" path | – |
| 6 | **Decide approver** | Business rule task (DMN) | Evaluates `decide-approver` with venue, duration and attendees | `approver = "admin-office"` |
| 7 | **Hold slot** | REST connector, `POST /bookings` | Creates a `PENDING` booking so the slot is reserved | `bookingId = 4` |
| 8 | **Admin approval** | Camunda user task + `approval-form` | Appears in Tasklist. The approver ticks *Approve* and completes it. The 2-minute timer is running | `approved = true`, `remarks` |
| 9 | **Approved?** | Exclusive gateway | `approved = true`, so it goes to Confirm | – |
| 10 | **Confirm slot** | REST connector, `PATCH /bookings/4` | Sets the booking's status to `CONFIRMED` | `outcome = "APPROVED"` |
| 11 | (merge) | Exclusive gateway | Joins the four ending paths into one | – |
| 12 | **Notify requester** | REST connector, `POST /notifications` | Sends `{to, subject:"Hall booking APPROVED", message:"Your booking of hall-a on 2026-10-21 (14:00-16:00) is confirmed."}` | `notificationId = 1` |
| 13 | **Done** | End event | The instance is completed | – |

> In Operate you will also see variables like `url`, `method` and `body` inside each connector task.
> Those are the connector's **inputs** (local to that task), not process variables. Notice that `url` still reads
> `{{secrets.MOCK_BASE_URL}}/bookings`: the real address is only inserted inside the connectors runtime.

### 3.2 The other paths

| Scenario | Where it turns off | What happens | `outcome` |
|---|---|---|---|
| **B: conflict** (hall-a, 2026-10-20, 11:00-13:00) | *Slot available?* | Seed booking 1 (10-12) overlaps, so `hasConflict = true` → *Set rejection reason* → notify | `CONFLICT` |
| **D: invalid time** (15:00-13:00) | *Slot available?* | `durationHours = -2` (≤ 0) → *Set rejection reason* → notify | `INVALID_TIME` |
| **F: rejected** | *Approved?* | Approver completes the task without ticking → default flow → `DELETE /bookings/{id}` → notify | `REJECTED` |
| **C: expired** | *Admin approval* | Nobody acts; after 2 min the timer **interrupts** the task → `DELETE /bookings/{id}` → notify | `EXPIRED` |

Every path ends at the same *Notify requester* task, and its message text depends on `outcome`.

## 4. The logic, explained

### 4.1 Prepare slot (FEEL script, result variable `slot`)

```
={
  startHour: number(substring(startTime, 1, 2)),
  endHour: number(substring(endTime, 1, 2)),
  durationHours: number(substring(endTime, 1, 2)) - number(substring(startTime, 1, 2))
}
```

- `substring("14:00", 1, 2)` → `"14"`. FEEL counts from **1**, not 0, and the third argument is the length.
- `number("14")` → `14`.
- `{ a: ..., b: ... }` builds a **context** (like a JSON object). The whole object is saved as `slot`.

### 4.2 Detect conflict (FEEL script, result variable `conflictCheck`)

```
={ hasConflict: count(existing[item.hall = venue and item.day = bookingDate
                               and item.startHour < slot.endHour and item.endHour > slot.startHour]) > 0 }
```

- `existing[ ... ]` is a **filter**: it keeps only the list items for which the condition is true. `item` is the current element.
- Two time ranges overlap when **existing.start < new.end AND existing.end > new.start**.
  - Scenario B: existing 10-12, new 11-13 → `10 < 13` and `12 > 11` → overlap.
  - Back-to-back is allowed: existing 10-12, new 12-14 → `12 > 12` is false → no overlap.
- `count(...) > 0` → `true` if at least one booking clashes.
- The booking fields are called `hall`/`day`, not `venue`/`bookingDate`, **on purpose**. Inside a filter, FEEL also lets you use an item's fields by bare name. If a booking had a field called `venue`, it would hide the process variable `venue` and the comparison would silently compare a field with itself.

### 4.3 Gateways and default flows

An **exclusive gateway** sends the token down exactly **one** outgoing flow: the first whose condition is true. The **default flow** (shown with a slash mark) is taken when no condition is true. It needs no condition, and it guarantees the process never gets stuck at the gateway.

| Gateway | Conditional flow | Default flow |
|---|---|---|
| *Slot available?* | "Conflict or invalid time": `=slot.durationHours <= 0 or conflictCheck.hasConflict` | "Free", to Decide approver |
| *Approved?* | "Approved": `=approved = true` | "Rejected", to Release slot (rejected) |

The last gateway, before *Notify requester*, is a **merge**: it has four incoming flows and one outgoing flow, and just passes each token through.

### 4.4 The DMN decision `decide-approver`

| | Venue (`venue`) | Duration (`slot.durationHours`) | Attendees (`attendees`) | → Approver |
|---|---|---|---|---|
| 1 | `"lab-1"` | - | - | `"lab-incharge"` |
| 2 | `"hall-a","hall-b"` | `> 4` | - | `"dean"` |
| 3 | `"hall-a","hall-b"` | - | `> 100` | `"hod"` |
| 4 | - | - | - | `"admin-office"` |

- `-` means "any value".
- `"hall-a","hall-b"` means "hall-a **or** hall-b".
- **Hit policy FIRST**: rules are checked top to bottom and the **first** matching rule wins. So the order matters:
  - hall-b, 6 hours, 150 people matches rules 2, 3 and 4. FIRST picks **rule 2 → dean**.
  - hall-a, 2 hours, 50 people matches only rule 4 → **admin-office** (the catch-all).
- With one output column, the result is a plain string, saved as `approver` by the business rule task.
- Why DMN instead of more gateways? The rules are readable as a table, can be changed and redeployed without touching the process, and are tested independently.

### 4.5 The REST connectors

Each REST task is a **service task** using the *REST Outbound Connector* template (`io.camunda.connectors.HttpJson.v2`, version 12). You fill in fields instead of writing code:

| Task | Method | URL | Body | Result expression |
|---|---|---|---|---|
| Fetch existing bookings | GET | `{{secrets.MOCK_BASE_URL}}/bookings` | – | `={existing: response.body}` |
| Hold slot | POST | `{{secrets.MOCK_BASE_URL}}/bookings` | `={hall: venue, day: bookingDate, startHour: slot.startHour, endHour: slot.endHour, status: "PENDING", requester: requesterName}` | `={bookingId: response.body.id}` |
| Confirm slot | PATCH | `="{{secrets.MOCK_BASE_URL}}/bookings/" + string(bookingId)` | `={status: "CONFIRMED"}` | `={outcome: "APPROVED"}` |
| Release slot (rejected) | DELETE | same as Confirm | – | `={outcome: "REJECTED"}` |
| Release slot (expired) | DELETE | same as Confirm | – | `={outcome: "EXPIRED"}` |
| Notify requester | POST | `{{secrets.MOCK_BASE_URL}}/notifications` | `={to: email, subject: ..., message: ...}` | `={notificationId: response.body.id}` |

- **Result expression**: after the call, the connector evaluates this FEEL expression on `response` (which has `status`, `headers` and `body`) and stores each key as a process variable. This is how `existing`, `bookingId` and `outcome` are created.
- **Secrets**: `{{secrets.MOCK_BASE_URL}}` is replaced by the connectors runtime with the environment variable `MOCK_BASE_URL` (set to `http://127.0.0.1:3000` by `start-camunda.cmd`). To point the project at a real API you change one value, not six tasks.
- **Retries = 3**: if a call fails (e.g. the mock API is down), it is retried 3 times. After that an **incident** appears in Operate.

### 4.6 The timer

- *Not approved in time* is a **boundary timer event** attached to *Admin approval*.
- Duration `PT2M` is ISO-8601 for "2 minutes" (`PT24H` = 24 hours, `P1D` = 1 day).
- It is **interrupting** (solid border): when it fires, the approval task is **cancelled** and the process continues along the timer's path. A non-interrupting timer (dashed border) would leave the task open and start a parallel path, e.g. a reminder.
- If the approver completes the task first, the timer is cancelled automatically.

### 4.7 The forms

- A form field's **key** is the variable name. The `venue` select writes `venue`, the `approved` checkbox writes `approved`, and so on.
- Forms are **linked** to the process by **form ID**: the start event uses `booking-request-form`, and the user task uses `approval-form`. That is why the forms must be deployed along with the BPMN.
- The approval form's text block uses **templating**: `{{approver}}`, `{{venue}}`, ... are replaced by the instance's variable values when the task is opened.
- The date picker returns `"2026-10-21"` (a string), and the time selects return `"14:00"`. That is why *Prepare slot* has to convert the times to numbers.

---

# Part B — Running it

## 5. Files in this project

```
WFA - Project/
├─ PLAN.md                     the specification (IDs, expressions, decisions, test results)
├─ PROJECT-GUIDE.md            this guide
└─ hall-booking/
   ├─ hall-booking.bpmn          the process (id: hall-booking)
   ├─ decide-approver.dmn        the decision table (id: decide-approver)
   ├─ booking-request-form.form  start form (id: booking-request-form)
   ├─ approval-form.form         approval task form (id: approval-form)
   ├─ README.md                  short setup + demo script + screenshot checklist
   ├─ mock/
   │  ├─ db.json                 live mock data (changes as the process runs)
   │  ├─ db.seed.json            clean copy: 3 seed bookings, no notifications
   │  └─ README.md               how the mock API works
   └─ scripts/
      ├─ start-mock.cmd          start the mock API (json-server) on 127.0.0.1:3000
      ├─ reset-mock.cmd          restore db.json from db.seed.json
      ├─ start-camunda.cmd       start Camunda 8 Run with JAVA_HOME + MOCK_BASE_URL
      ├─ stop-camunda.cmd        stop Camunda 8 Run
      ├─ deploy.cmd              deploy the 4 files in one deployment
      └─ run-scenarios.ps1       run test scenarios A-F automatically, print PASS/FAIL
```

## 6. Starting everything

Do these in order. Each `.cmd` can be double-clicked in Explorer.

| Step | Do this | What it does | Ready when |
|---|---|---|---|
| 1 | `hall-booking\scripts\start-mock.cmd` | `npx json-server@0.17.4 --watch mock/db.json --host 127.0.0.1 --port 3000` | http://127.0.0.1:3000/bookings shows the bookings |
| 2 | `hall-booking\scripts\start-camunda.cmd` | Sets `JAVA_HOME=E:\jdk-21.0.6` and `MOCK_BASE_URL=http://127.0.0.1:3000`, then runs `c8run.exe start` | http://localhost:8080/operate shows the login page (1-3 min) |
| 3 | Log in with `demo` / `demo` | – | You see the Operate dashboard |
| 4 | `hall-booking\scripts\deploy.cmd` | `POST /v2/deployments` with the DMN, both forms and the BPMN | The printed JSON lists `hall-booking`, `decide-approver` and both forms |
| 5 | (before a demo) `hall-booking\scripts\reset-mock.cmd` | Restores the 3 seed bookings | – |

**Keep the mock and Camunda windows open.** Closing them stops the services. To stop Camunda cleanly, run `stop-camunda.cmd`.

> **Order matters:** start Camunda with `start-camunda.cmd`, not by running `c8run.exe` directly.
> Otherwise `MOCK_BASE_URL` is missing and every REST task fails. Also, `JAVA_HOME` on this machine must be
> `E:\jdk-21.0.6`, not `D:\` (see section 9).

| Address | What |
|---|---|
| http://localhost:8080/operate | Operate (monitoring) |
| http://localhost:8080/tasklist | Tasklist (forms and tasks) |
| http://localhost:8080/v2/... | Camunda REST API (used by the scripts) |
| `localhost:26500` | Zeebe gRPC (Desktop Modeler deploys here) |
| http://127.0.0.1:3000/bookings | Mock bookings |
| http://127.0.0.1:3000/notifications | Mock notifications |

## 7. Seeing it work

### 7.1 Start a booking in Tasklist

1. Open http://localhost:8080/tasklist → **Processes** tab.
2. Find **Seminar Hall and Lab Booking** → **Start process**. The booking form opens.
3. Fill it in and submit. If the slot is free, an **Admin approval** task appears under **Tasks** within a few seconds.
4. Open the task. It shows the summary and "Approver role: …". Tick **Approve this booking** (or leave it unticked to reject) → **Complete task**.
5. Don't open the task for 2 minutes, and it disappears: the timer released the slot.

### 7.2 Watch it in Operate

1. Open http://localhost:8080/operate → **Processes** → *Seminar Hall and Lab Booking*.
2. Click an instance key. The diagram highlights the path taken, with a check mark on completed elements.
3. The **Variables** panel shows `slot`, `existing`, `conflictCheck`, `approver`, `bookingId`, `outcome`, … Click an element in the diagram to see what was set at that step.
4. A red badge marks an **incident**. Click it to read the error, fix the cause (e.g. start the mock API), then click **Retry**.

### 7.3 Watch the data change

Open http://127.0.0.1:3000/bookings while running a scenario:
- After *Hold slot*, a new booking with `"status": "PENDING"` appears.
- Approved: it becomes `CONFIRMED`. Rejected or expired: it disappears.

http://127.0.0.1:3000/notifications gets one new entry per finished instance.

### 7.4 Test scenarios

| # | Form input | Expected | Verified 2026-10-11 |
|---|---|---|---|
| A | hall-a, 2026-10-21, 14:00-16:00, 50 people; approve | `admin-office`, `APPROVED`, booking CONFIRMED | PASS |
| B | hall-a, 2026-10-20, 11:00-13:00 | `CONFLICT`, no task | PASS |
| C | lab-1, 2026-10-22, 10:00-12:00; wait 2 min | `lab-incharge`, `EXPIRED`, booking deleted | PASS |
| D | hall-b, 2026-10-24, 15:00-13:00 | `INVALID_TIME`, no task | PASS |
| E | hall-b, 2026-10-23, 09:00-15:00, 80 people; approve | `dean`, `APPROVED` | PASS |
| F | hall-b, 2026-10-25, 10:00-12:00, 150 people; leave unticked | `hod`, `REJECTED`, booking deleted | PASS |

To run all six automatically (about 2.5 min, because C waits for the timer):

```
hall-booking\scripts\reset-mock.cmd
powershell -ExecutionPolicy Bypass -File "hall-booking\scripts\run-scenarios.ps1"
```

The script starts the instances through the REST API, completes the approval tasks, waits for each instance to finish, and checks `outcome` and `approver`. The instances then stay visible in Operate.

---

# Part C — Building it yourself

This part shows how to recreate the four files in **Desktop Modeler** (`E:\camunda-modeler-5.49.0-win-x64\Camunda Modeler.exe`).
Build them in this order: **forms → DMN → BPMN**. The BPMN refers to the others by ID, so their IDs must be fixed first.

> Exact IDs matter. The process finds the forms and the decision **only** by these IDs:
> `booking-request-form`, `approval-form`, `decide-approver`, `hall-booking`.

## 8. Step by step in Desktop Modeler

### 8.1 Booking request form

1. **File → New File → Form (Camunda 8)**.
2. Click an empty area of the canvas. In the properties panel on the right, set the form **ID** to `booking-request-form`.
3. Drag components from the left palette. For each one, set the **Key** (the variable name) and the label:

   | Component | Key | Settings |
   |---|---|---|
   | Text view | – | Heading text |
   | Text field | `requesterName` | Required |
   | Text field | `email` | Required, validation pattern *Email* |
   | Select | `venue` | Static options: `hall-a` "Seminar Hall A", `hall-b` "Seminar Hall B", `lab-1` "Computer Lab 1"; required |
   | Date time | `bookingDate` | Subtype **Date**; required |
   | Select | `startTime` | Options `08:00` … `18:00` (label = value); required |
   | Select | `endTime` | Options `08:00` … `18:00`; required |
   | Number | `attendees` | Required, minimum 1 |
   | Text area | `purpose` | – |

4. Drag fields next to each other to put them on the same row (e.g. start and end time).
5. Save it as `booking-request-form.form`.

### 8.2 Approval form

1. New form, ID `approval-form`.
2. **Text view** with templating. Variables go in double curly braces:
   ```
   # Booking approval
   **Approver role:** {{approver}}

   - **Requester:** {{requesterName}} ({{email}})
   - **Venue:** {{venue}}
   - **Date:** {{bookingDate}}
   - **Time:** {{startTime}} to {{endTime}}
   - **Attendees:** {{attendees}}
   - **Purpose:** {{purpose}}
   ```
3. **Checkbox**, key `approved`, label "Approve this booking", default value unchecked.
4. **Text area**, key `remarks`.
5. Save it as `approval-form.form`.

### 8.3 DMN decision

1. **File → New File → DMN diagram (Camunda 8)**.
2. Click the decision box. Set **ID** = `decide-approver` and **Name** = "Decide approver".
3. Click the **table icon** on the decision to open the decision table editor.
4. Set the **hit policy** (top-left of the table) to **First**.
5. Set up the columns. Double-click a column header to edit its expression and type:
   - Input 1: expression `venue`, type `string`
   - Input 2: expression `slot.durationHours`, type `number`
   - Input 3: expression `attendees`, type `number`
   - Output: name `approver`, type `string`
6. Add the four rules from [4.4](#44-the-dmn-decision-decide-approver), in that order. Leave a cell empty for "any" (it shows `-`). Strings need quotes: `"lab-1"`.
7. Optional: write a description in the annotation column of each rule.
8. Save it as `decide-approver.dmn`.

### 8.4 The BPMN process

1. **File → New File → BPMN diagram (Camunda 8)**.
2. Click the canvas background. Set the process **ID** = `hall-booking` and **Name** = "Seminar Hall and Lab Booking".
3. Build the main line from left to right. To change an element's type, select it, click the **wrench** icon, and pick the type.

| Element (ID / name) | Create as | Properties panel |
|---|---|---|
| `StartEvent_Requested` "Booking requested" | Start event | **Form**: type *Camunda Form (linked)*, Form ID `booking-request-form` |
| `Script_PrepareSlot` "Prepare slot" | Script task | **Implementation**: *FEEL expression*; Result variable `slot`; expression from [4.1](#41-prepare-slot-feel-script-result-variable-slot) |
| `Rest_FetchBookings` "Fetch existing bookings" | Task → wrench → **REST Outbound Connector** | **Authentication**: None. **HTTP endpoint**: Method GET, URL `{{secrets.MOCK_BASE_URL}}/bookings`. **Output mapping**: Result expression `={existing: response.body}` |
| `Script_DetectConflict` "Detect conflict" | Script task | FEEL expression from [4.2](#42-detect-conflict-feel-script-result-variable-conflictcheck); Result variable `conflictCheck` |
| `Gateway_SlotOk` "Slot available?" | Exclusive gateway | – (the conditions go on its outgoing flows) |
| `Script_SetReason` "Set rejection reason" | Script task | `=if slot.durationHours <= 0 then "INVALID_TIME" else "CONFLICT"`; Result variable `outcome` |
| `Dmn_DecideApprover` "Decide approver" | Business rule task | **Implementation**: *DMN decision*; Decision ID `decide-approver`; Result variable `approver` |
| `Rest_HoldSlot` "Hold slot" | REST Outbound Connector | POST, URL `{{secrets.MOCK_BASE_URL}}/bookings`. **Payload**: Request body from [4.5](#45-the-rest-connectors). Result expression `={bookingId: response.body.id}` |
| `User_Approval` "Admin approval" | User task | **Implementation**: *Camunda user task*. **Form**: *Camunda Form (linked)*, Form ID `approval-form` |
| `Timer_Timeout` "Not approved in time" | Drag an intermediate event onto the **edge** of the user task → wrench → **Timer boundary event** (interrupting) | **Timer**: type *Duration*, value `PT2M` |
| `Gateway_Approved` "Approved?" | Exclusive gateway | – |
| `Rest_ConfirmSlot` "Confirm slot" | REST Outbound Connector | PATCH, URL `="{{secrets.MOCK_BASE_URL}}/bookings/" + string(bookingId)`, body `={status: "CONFIRMED"}`, result expression `={outcome: "APPROVED"}` |
| `Rest_ReleaseRejected` "Release slot (rejected)" | REST Outbound Connector | DELETE, same URL, result expression `={outcome: "REJECTED"}` |
| `Rest_ReleaseExpired` "Release slot (expired)" | REST Outbound Connector | DELETE, same URL, result expression `={outcome: "EXPIRED"}` |
| `Gateway_Merge` | Exclusive gateway | – (four incoming flows, one outgoing) |
| `Rest_Notify` "Notify requester" | REST Outbound Connector | POST, URL `{{secrets.MOCK_BASE_URL}}/notifications`, body from `PLAN.md` §4, result expression `={notificationId: response.body.id}` |
| `EndEvent_Done` "Done" | End event | – |

4. **Set the IDs.** Each element's **ID** is at the top of its properties panel (General). Change it to the IDs above. They appear in Operate and in `PLAN.md`.
5. **Connect the flows.** Drag from an element's arrow icon (context pad) to the next element. See `PLAN.md` §4 for the full list.
6. **Conditions.** Select the flow *Slot available? → Set rejection reason*. Under **Condition**, enter `=slot.durationHours <= 0 or conflictCheck.hasConflict`. Do the same for *Approved? → Confirm slot* with `=approved = true`.
7. **Default flows.** Select the flow *Slot available? → Decide approver*, click the wrench, and choose **Default flow**. Do the same for *Approved? → Release slot (rejected)*. A small slash appears at the start of a default flow.
8. **Timer path.** Connect the timer boundary event to *Release slot (expired)*.
9. Check the **Problems** panel at the bottom (it should show 0 errors), then save as `hall-booking.bpmn`.

> **Tip:** the finished `hall-booking.bpmn` is in the folder. Open it next to your own and compare the
> properties panels element by element.

### 8.5 Deploy and run from Desktop Modeler

1. Open `decide-approver.dmn`, click the **rocket** icon (bottom-left), choose **Camunda 8 Self-Managed**, set Cluster endpoint `http://localhost:26500` and authentication **None**, and click **Deploy**.
2. Do the same for both `.form` files, then for `hall-booking.bpmn`. The BPMN goes **last**, because it needs the forms and the decision to exist.
   Alternatively, run `scripts\deploy.cmd`, which deploys all four at once.
3. To start an instance straight from the Modeler, click the **play** icon next to the rocket and paste variables:
   ```json
   {"requesterName":"Test","email":"t@example.com","venue":"hall-a","bookingDate":"2026-10-21",
    "startTime":"14:00","endTime":"16:00","attendees":50,"purpose":"test"}
   ```
   Or start it from Tasklist (section 7.1) to use the form.
4. Redeploying a changed BPMN creates a **new version**. Running instances stay on their old version; new ones use the latest.

### 8.6 Common mistakes when building it

| Mistake | Symptom |
|---|---|
| Form ID or decision ID typed differently from the BPMN | Deploy error, or an incident "form/decision not found" |
| Forgetting `=` before a FEEL expression in a condition or connector field | The text is used literally, e.g. the URL contains `"..." + string(bookingId)` |
| No default flow on a gateway | An instance gets stuck with an incident when no condition matches |
| Boundary timer not attached (just placed near the task) | The timer never fires; in the XML, `attachedToRef` is missing |
| Form field key differs from the variable name used in FEEL | The variable is `null`, so conflict checks and DMN rules fail |
| Using `localhost` in the mock URL | Node may listen on IPv6 only, the connector uses IPv4, and you get "Connection refused". Use `127.0.0.1` |
| Starting c8run without `start-camunda.cmd` | `MOCK_BASE_URL` is missing and every REST task fails |

---

## 9. How this machine was set up

| Item | Location / value | Note |
|---|---|---|
| Java (JDK 21.0.6) | `E:\jdk-21.0.6` | Copied from `D:\`, where it was unpacked on the drive root. c8run searches `JAVA_HOME` for a file named `java`; on `D:\` it found a folder of an Android project first and crashed. A dedicated folder fixes it. |
| Camunda 8 Run 8.8.32 | `E:\camunda8-run-8.8-windows-x86_64\c8run-8.8.32` | Logs in its `log\` folder (`camunda.log`, `connectors.log`, `elasticsearch.log`) |
| Desktop Modeler 5.49 | `E:\camunda-modeler-5.49.0-win-x64` | Includes the token-simulation plugin (useful to animate the flow without running it) |
| Node.js 24 | on PATH | Needed for `npx json-server` |
| Login | `demo` / `demo` | Created on the first start; it takes ~30 s after Operate comes up |

`JAVA_HOME` is **not** set permanently. `start-camunda.cmd` sets it for that window only. To set it permanently instead, run this in PowerShell and open a new terminal:
`[Environment]::SetEnvironmentVariable('JAVA_HOME', 'E:\jdk-21.0.6', 'User')`

## 10. Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| Browser: `ERR_CONNECTION_REFUSED` on :8080 | Camunda is not running | Run `start-camunda.cmd` and wait 1-3 min |
| c8run: "Failed to get Java version" | Wrong `JAVA_HOME` | Use `start-camunda.cmd` |
| Login: "Username and Password do not match" right after the first start | The demo user isn't created yet | Wait 30 s and retry |
| Incident on *Fetch existing bookings* or another REST task | Mock API down, or `MOCK_BASE_URL` missing | Start the mock; if Camunda wasn't started with the script, restart it with the script. Then **Retry** in Operate |
| Scenario A/E ends as `CONFLICT` | Leftover bookings from an earlier run | `reset-mock.cmd` |
| No approval task in Tasklist | Slot was a conflict or invalid, or the timer already fired | Check the instance in Operate |
| Deploy error mentioning a form or decision | IDs don't match, or files deployed in the wrong order | Use `deploy.cmd` (all at once) |
| Approval task disappeared | The 2-minute timer fired (expected) | Start a new booking and approve it sooner |

## 11. Questions you may be asked

**Why hold the slot before it is approved?**
So two people can't both get the same slot while waiting for approval. The `PENDING` booking blocks the slot. If the request is rejected or expires, the slot is released (`DELETE`).

**Why use a DMN table instead of gateways for the approver?**
Business rules change more often than the process. In a table they are readable by non-developers, can be changed and redeployed without touching the BPMN, and FIRST hit policy makes the priority explicit (lab rule, then long bookings, then large audiences, then default).

**What does the FIRST hit policy do? What would UNIQUE do?**
FIRST returns the first matching rule from the top. UNIQUE requires exactly one rule to match. With these rules, hall-b for 6 hours with 150 people matches rules 2, 3 and 4, so UNIQUE would fail.

**What is the difference between an interrupting and a non-interrupting timer?**
Interrupting (used here) cancels the approval task and takes the timer path. Non-interrupting keeps the task open and starts an extra parallel path, good for reminders.

**What happens if the booking API is down?**
The REST connector fails and is retried 3 times. Then Zeebe raises an **incident** and the instance waits. In Operate you see the error, fix the cause, and click Retry. No data is lost. (A stretch goal is an error boundary event that routes to an "Admin Fix" task instead.)

**Where is the API address configured, and why not type it into each task?**
In one place, the connector secret `MOCK_BASE_URL` (an environment variable of the connectors runtime). Changing environments (local → SaaS → real API) means changing one value. Secrets also never show up in the model or in Operate.

**How does the conflict check work?**
It filters the bookings list for the same hall and day where `existing.start < new.end` and `existing.end > new.start`, which is the standard interval-overlap test. Back-to-back bookings (10-12 and 12-14) are allowed.

**What happens to running instances when you redeploy?**
Each deploy of a changed file creates a new version. Running instances finish on the version they started with, and new instances use the latest version.

**Known limitation?**
Two requests for the same slot submitted at the same moment could both pass the check before either one holds the slot. A real booking database would close this gap with a uniqueness constraint when creating the `PENDING` booking, and the error would route to a rejection path.

**What would you add next?**
Real approver assignment (use `approver` as the user task's candidate group), an error boundary on *Hold slot*, a DMN for the notification text, and the Email/SendGrid connector instead of the mock notification.
