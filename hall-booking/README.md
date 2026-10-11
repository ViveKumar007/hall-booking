# Seminar Hall & Lab Booking (Camunda 8, BPMN + DMN)

A booking workflow with no Java code. A requester fills a form; FEEL scripts work out the slot and check
it against existing bookings fetched over REST; a DMN table picks the approver; the slot is held while
an admin approves in Tasklist; and a 2-minute timer releases the slot automatically if nobody acts.
Every path ends with a notification.

Runs on **Camunda 8 Run 8.8 (local)**. A mock REST API (json-server) plays the booking database.

```
Booking requested -> Prepare slot -> Fetch existing bookings -> Detect conflict -> <Slot available?>
   conflict / invalid time -> Set rejection reason ---------------------------------------------+
   free -> Decide approver (DMN) -> Hold slot -> Admin approval -> <Approved?>                   |
                                                  |  yes -> Confirm slot ------------------------+
                                                  |  no  -> Release slot (rejected) -------------+
                                                  +-(timer 2 min)-> Release slot (expired) ------+-> Notify requester -> Done
```

| Course requirement | Where |
|---|---|
| User task with a Camunda Form | `User_Approval` + `approval-form`; start form `booking-request-form` |
| Exclusive gateway | `Gateway_SlotOk`, `Gateway_Approved` (both with default flows) |
| Script task (FEEL) | `Script_PrepareSlot`, `Script_DetectConflict`, `Script_SetReason` |
| REST connector | `Rest_FetchBookings`, `Rest_HoldSlot`, `Rest_ConfirmSlot`, `Rest_Release*`, `Rest_Notify` |
| Business rule task (DMN) | `Dmn_DecideApprover` -> `decide-approver.dmn` |
| Timer boundary event | `Timer_Timeout` (interrupting, `PT2M`) on `User_Approval` |
| Notification step | `Rest_Notify` -> `POST /notifications` |

## Files

| File | What it is |
|---|---|
| `hall-booking.bpmn` | Process `hall-booking` ("Seminar Hall and Lab Booking") |
| `decide-approver.dmn` | Decision `decide-approver` (hit policy FIRST) |
| `booking-request-form.form` | Start form |
| `approval-form.form` | Approval task form |
| `mock/db.seed.json` | Seed data. `mock/db.json` (live data) is created from it by `start-mock.cmd` and is not committed |
| `scripts/start-mock.cmd` | Start the mock API on http://127.0.0.1:3000 |
| `scripts/start-camunda.cmd` / `stop-camunda.cmd` | Start/stop Camunda 8 Run with the right `JAVA_HOME` and `MOCK_BASE_URL` |
| `scripts/deploy.cmd` | Deploy all four files in one go |
| `scripts/reset-mock.cmd` | Put the mock data back to the 3 seed bookings |
| `scripts/run-scenarios.ps1` | Run scenarios A-F automatically through the REST API and print PASS/FAIL |

## Start everything (about 3 minutes)

1. Double-click `scripts\start-mock.cmd`. Keep the window open.
2. Double-click `scripts\start-camunda.cmd`. Wait until http://localhost:8080/operate shows the login page.
   Log in with `demo` / `demo`. On the very first start, wait about 30 s more before logging in.
3. Double-click `scripts\deploy.cmd`. The JSON it prints should list `hall-booking`, `decide-approver` and both forms.

To deploy from Desktop Modeler instead: deploy the DMN and both forms first, then the BPMN. Use target
*Camunda 8 Self-Managed*, cluster endpoint `http://localhost:26500`, authentication *None*.

## Demo script

1. **Model.** Open `hall-booking.bpmn` in Desktop Modeler. Walk left to right: start form, FEEL scripts, REST
   connector (show URL and result expression in the properties panel), gateway with default flow, business
   rule task, user task with timer. Open `decide-approver.dmn` and explain the FIRST hit policy and rule order.
2. **Start the timer case first** (scenario C), so its 2 minutes run while you show the rest. In Tasklist go
   to **Processes**, start *Seminar Hall and Lab Booking*, and fill in lab-1, 2026-10-22, 10:00-12:00. Don't touch its task.
3. **Happy path** (scenario A). Start another booking: hall-a, 2026-10-21, 14:00-16:00, 50 people. Open
   **Tasks**, pick *Admin approval*, show "Approver role: admin-office", tick *Approve this booking*, and click
   **Complete task**.
4. **Conflict** (scenario B). hall-a, 2026-10-20, 11:00-13:00. No task appears; the process ends straight away.
5. **Operate.** Open each instance and show the highlighted path and the variables (`slot`, `conflictCheck`,
   `approver`, `bookingId`, `outcome`). By now C has taken the timer path.
6. **Data.** Show http://127.0.0.1:3000/bookings (A is `CONFIRMED`, C's hold is gone) and
   http://127.0.0.1:3000/notifications (one entry per finished run).

To avoid surprises, run `scripts\reset-mock.cmd` before the demo. A booking left over from a rehearsal
would turn the same slot into a conflict.

To fill Operate with one finished instance per path in a single step:
`powershell -ExecutionPolicy Bypass -File scripts\run-scenarios.ps1` (about 2.5 min; add `-SkipTimer` to skip C).

## Test scenarios

| # | Input | Expected | Verified |
|---|---|---|---|
| A | hall-a, 2026-10-21, 14:00-16:00, 50 people; tick approve | approver `admin-office`, outcome `APPROVED`, booking CONFIRMED | PASS: `admin-office`, `APPROVED`, booking 4 CONFIRMED |
| B | hall-a, 2026-10-20, 11:00-13:00 (overlaps seed booking 10-12) | Set rejection reason, `CONFLICT`, no task | PASS: `CONFLICT`, no task |
| C | lab-1, 2026-10-22, 10:00-12:00; do nothing for 2 min | approver `lab-incharge`; timer fires, hold deleted, `EXPIRED` | PASS: `lab-incharge`, timer fired after 2 min, booking deleted, `EXPIRED` |
| D | hall-b, 15:00-13:00 (end before start) | `INVALID_TIME`, no task | PASS: `INVALID_TIME`, no task |
| E | hall-b, 2026-10-23, 09:00-15:00 (6 h), 80 people; approve | DMN gives `dean`, `APPROVED` | PASS: `dean`, `APPROVED` |
| F | hall-b, 2026-10-25, 10:00-12:00, 150 people; leave unticked, complete | DMN gives `hod`, `REJECTED`, hold deleted | PASS: `hod`, `REJECTED`, booking deleted |

After a clean run of all six, the mock holds the 3 seed bookings plus A and E (both `CONFIRMED`), and 6 notifications.

## Screenshot checklist for the report

- [ ] BPMN diagram in Modeler (whole process)
- [ ] DMN decision table
- [ ] Tasklist: start form filled in, approval form showing the approver role
- [ ] Operate: path of A (approved), B (conflict) and C (timer -> release expired)
- [ ] Operate: variables panel of one instance (`slot`, `conflictCheck`, `approver`, `outcome`)
- [ ] `http://127.0.0.1:3000/bookings` after C (no PENDING booking left) and `/notifications`

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Incident on *Fetch existing bookings* | Mock not running, or Camunda was not started with `start-camunda.cmd` (secret `MOCK_BASE_URL` missing). Start the mock, then retry the incident in Operate. |
| c8run says "Failed to get Java version" | `JAVA_HOME` points at a drive root. Use `start-camunda.cmd` (it sets `E:\jdk-21.0.6`). |
| Login says the password doesn't match on first start | The `demo` user is still being created. Wait 30 s and try again. |
| Scenario A or E ends as `CONFLICT` | Leftover booking from an earlier run. Run `scripts\reset-mock.cmd`. |
| Approval task disappeared | The 2-minute timer released it. Expected behaviour; see scenario C. |
