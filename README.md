# Seminar Hall & Lab Booking — Camunda 8 (BPMN, DMN, Spring Boot)

A booking workflow for seminar halls and labs. One request books **one or more sessions**. A **job worker** validates
it; every session is checked for clashes **in parallel** (REST connectors, multi-instance) inside a **sub-process** with
**error** (service down) and **timer** (too slow) boundaries; a **DMN** table picks an approver per session; a **Call
Activity** then asks each approver **in turn** through a reusable child process, with a reminder after 1 hour and
expiry after 1 day (2 minutes and 1 minute for demos). Booking-service problems go to an admin task (Retry/Cancel). Every path ends with an email sent by
the **Email connector** (SMTP settings are connector secrets), then a recorded notification.

The application is a **React** frontend (Vite, Tailwind) on a **Spring Boot** backend (REST API, booking register with
JPA on H2/PostgreSQL, `@JobWorker`s), which talks to Camunda through the official Java client.

| Start here | |
|---|---|
| [hall-booking/README.md](hall-booking/README.md) | Quick start, demo outline, screenshot checklist |
| [frontend-react/README.md](frontend-react/README.md) | The frontend: pages, session builder, custom Tasklist, live tracker |
| [backend-springboot/README.md](backend-springboot/README.md) | The backend: layers, job workers, REST API, database tables, configuration |
| [PLAN.md](PLAN.md) | The specification: element IDs, expressions, variables, job types, test results |
| [PROJECT-GUIDE.md](PROJECT-GUIDE.md) | Background and run guide (parts still describe the earlier two-pool version) |

## Quick start (Windows, Camunda 8 Run 8.8)

```
hall-booking\scripts\start-mail.cmd       :: local mail server, inbox on http://localhost:1080
hall-booking\scripts\start-camunda.cmd    :: Camunda 8 Run (edit the two paths inside for your machine)
hall-booking\scripts\start-backend.cmd    :: Spring Boot backend + React app on http://localhost:8090 (deploys the models)
hall-booking\scripts\reset-data.cmd       :: back to the 3 seed bookings
```

Or double-click `hall-booking\scripts\start-all.cmd` to open all three windows at once.

Then open **http://localhost:8090**: book a room, follow its route live, approve it in the inbox. Tasklist and Operate
(http://localhost:8080, login `demo` / `demo`) keep working alongside.
Run all 25 automated tests: `powershell -ExecutionPolicy Bypass -File hall-booking\scripts\run-scenarios.ps1`;
backend unit tests: `backend-springboot\mvnw.cmd test`.

Requirements: Camunda 8 Run 8.8 with JDK 21 (also used by the backend; the Maven wrapper downloads Maven), Node.js 20.19+
(builds the React app and runs the local mail server via `npx`), Camunda Desktop Modeler 5.x.
