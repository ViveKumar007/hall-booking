# Seminar Hall & Lab Booking — Camunda 8 (BPMN + DMN)

A booking workflow for seminar halls and labs, built only with BPMN, DMN, Camunda Forms, FEEL and REST connectors (no Java).
A request is checked for conflicts against a REST API, a DMN table picks the approver, the slot is held during approval,
and a 2-minute timer releases it if nobody approves. Every path ends with a notification.

| Start here | |
|---|---|
| [PROJECT-GUIDE.md](PROJECT-GUIDE.md) | How everything works, how to run it, and how to build it yourself in Desktop Modeler |
| [hall-booking/README.md](hall-booking/README.md) | Quick start, demo script, test scenarios, screenshot checklist |
| [PLAN.md](PLAN.md) | The specification: element IDs, FEEL expressions, DMN rules, test results |

## Quick start (Windows, Camunda 8 Run 8.8)

```
hall-booking\scripts\start-mock.cmd       :: mock booking API on http://127.0.0.1:3000
hall-booking\scripts\start-camunda.cmd    :: Camunda 8 Run (edit the paths inside for your machine)
hall-booking\scripts\deploy.cmd           :: deploy BPMN + DMN + forms
```

Then open http://localhost:8080/tasklist (login `demo` / `demo`) and start **Seminar Hall and Lab Booking**.
To run all six test scenarios automatically: `powershell -ExecutionPolicy Bypass -File hall-booking\scripts\run-scenarios.ps1`.

Requirements: Camunda 8 Run 8.8 with JDK 21, Node.js (for `npx json-server`), Camunda Desktop Modeler 5.x.
