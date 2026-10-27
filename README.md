# Seminar Hall & Lab Booking — Camunda 8 (BPMN, DMN, external worker)

A booking workflow for seminar halls and labs, modelled as **two pools**: a *Booking Desk* and a *Hall Administration*
that exchange messages. Requests are validated by an **external worker**, checked for clashes against a REST booking
service (**REST connectors**), routed to an approver chosen by a **DMN** table, reminded after 1 minute and expired after
2 minutes. Booking-service outages go to an admin task (Retry/Cancel). Every path ends with a notification.

| Start here | |
|---|---|
| [PROJECT-GUIDE.md](PROJECT-GUIDE.md) | How everything works, the run guide, the test cases, and how to build it yourself |
| [hall-booking/README.md](hall-booking/README.md) | Quick start, demo outline, screenshot checklist |
| [PLAN.md](PLAN.md) | The specification: element IDs, expressions, messages, worker job types, test results |

## Quick start (Windows, Camunda 8 Run 8.8)

```
hall-booking\scripts\start-mock.cmd       :: mock booking API on http://127.0.0.1:3000
hall-booking\scripts\start-camunda.cmd    :: Camunda 8 Run (edit the two paths inside for your machine)
hall-booking\scripts\start-worker.cmd     :: the external job worker
hall-booking\scripts\start-app.cmd        :: the web app on http://localhost:8090
hall-booking\scripts\deploy.cmd           :: deploy BPMN (both pools) + DMN + forms
```

Or double-click `hall-booking\scripts\start-all.cmd` to open all four windows at once.

Then open **http://localhost:8090**: book a room, follow its route live, approve it in the inbox. Tasklist and Operate
(http://localhost:8080, login `demo` / `demo`) keep working alongside.
Run all 19 automated tests: `powershell -ExecutionPolicy Bypass -File hall-booking\scripts\run-scenarios.ps1`.

Requirements: Camunda 8 Run 8.8 with JDK 21, Node.js 18+ (mock API and worker; no npm install needed), Camunda Desktop Modeler 5.x.
