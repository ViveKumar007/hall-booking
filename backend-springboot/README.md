# Hall Booking backend (Spring Boot 3.5, Camunda 8.8 Java client)

The application behind the Seminar Hall & Lab Booking workflow. One Spring Boot process that:

- serves the **REST API** the React frontend calls (`/api/**`) and the frontend's build (`../frontend-react/dist`);
- is the **booking register** the BPMN's REST connectors call (`/register/**`), stored with **JPA** in **H2** (file) or
  **PostgreSQL** (profile `postgres`);
- runs the **job workers** (`@JobWorker`) for the BPMN's job types, with typed variables and `ZeebeBpmnError`;
- deploys the BPMN, DMN and forms to Camunda at startup.

```
Browser ──/api──▶ Spring Boot :8090 ──Camunda Java client (REST + gRPC)──▶ Camunda 8 Run :8080 / :26500
                      ▲   │                                                      │
                      │   └── JPA ──▶ H2 file (data/) or PostgreSQL               │ REST connectors
                      └──────────── /register/bookings ◀──────────────────────────┘ ({{secrets.BOOKING_API_URL}})
                      job workers ◀── jobs: validate-booking, send-reminder, record-notification
```

## Run

Needs JDK 21 and a running Camunda 8 Run (`hall-booking\scripts\start-camunda.cmd`).

```
hall-booking\scripts\start-backend.cmd          :: = mvnw spring-boot:run in this folder, http://localhost:8090
backend-springboot\mvnw.cmd test               :: unit tests (no Camunda needed)
```

The Maven wrapper downloads Maven 3.10 and the libraries on the first run. On start-up the backend deploys the models
from `../hall-booking` and, when the register is empty, imports the old json-server data (`../hall-booking/mock/db.json`)
or the three seed bookings (`src/main/resources/seed/register-seed.json`).

## Layers

| Package | Contents |
|---|---|
| `web` | REST controllers for the frontend: `BookingApiController`, `TaskApiController`, `InfoController`, `DemoController`; `ApiExceptionHandler` maps errors to `{error, service, fields}` |
| `register` | `RegisterController`: the booking register for the REST connectors; `RegisterMode` + `RegisterOutageInterceptor` make it fail (DOWN) or hang (SLOW) on purpose for the error and timer boundary demos |
| `service` | `BookingService` (start, list, live route), `TaskService` (custom Tasklist), `ValidationService` (business rules), `HealthService`, `SeedService`, `BookingStatus`, `StepCatalog` |
| `worker` | `BookingWorkers`: the three `@JobWorker` methods; `BookingVariables`: the typed variable records |
| `camunda` | `CamundaGateway` (every Camunda call, official Java client), `ModelDeployer`, `Vars` |
| `domain` / `repository` | JPA entities `RegisterSlot`, `Notification`, `BookingRequest` (+ `RequestSession`) and their Spring Data repositories |

## Job workers

| Job type | BPMN task | Input (`@VariablesAsType`) | Result |
|---|---|---|---|
| `validate-booking` | Validate request | `ValidateInput` (requester, attendees, sessions with slot) | `validation`; on a broken rule **`ZeebeBpmnError("INVALID_REQUEST", message, {outcome, validation})`**, caught by the *Invalid request* error boundary. Also records the request in `booking_request` |
| `send-reminder` | Remind approver (hall-approval) | `ReminderInput` | `reminderSentAt`; a REMINDER row in `notification` |
| `resolve-recipients` | Find recipients (send-email) | `RecipientsInput` (to or toRole, link) | `recipients` (the accounts holding the role in `APP_ACCOUNTS`, else the admins), `recipientCount`, `linkUrl` (`APP_URL` + link), `emailStatus` PENDING / NO_RECIPIENT |
| `record-notification` | Record notification | `RecordInput` (to, subject, message, emailStatus, ...) | `notificationId`, `notifiedAt`; an OUTCOME row in `notification`; finishes the `booking_request` row |

`ZeebeBpmnError` is the course's name for the business error. In the 8.8 SDK it is a deprecated subclass of
`io.camunda.client.exception.BpmnError` (`CamundaError.bpmnError(...)`), handled the same way.

## Sign-in and access

- **Sign in with Google** (Spring Security OAuth2 Client, OpenID Connect, scopes `openid email profile`):
  `/oauth2/authorization/google` → Google → `/login/oauth2/code/google` → back to `/`. `GoogleUserService` accepts the
  login only when Google reports the email as **verified**, records the account in `app_user`, and turns its roles into
  authorities (`ROLE_USER`, plus `ROLE_dean`, `ROLE_admin`, ...).
- **Roles** come from `APP_ACCOUNTS` (`email=role+role;email=role`, kept in the git-ignored `secrets.cmd`). Roles:
  `admin`, `admin-office`, `dean`, `hod`, `lab-incharge`. Every other Google account is a requester.
- The login is an **HTTP session** (cookie `JSESSIONID`: HttpOnly, SameSite=Lax, 8 hours). The API answers **401/403 as
  JSON**; the React app then shows its sign-in page. Sign out: `POST /api/auth/logout`.
- **CSRF**: the token is in the `XSRF-TOKEN` cookie; every POST must send it back in `X-XSRF-TOKEN` (the React app does).
- **Rules**: a requester sees and starts only their own requests (the requester is always the signed-in account); an
  approver sees the reviews for their roles and the requests sent to them, and decides only reviews for a role they hold
  (the completion records `decidedBy`); admins see everything, handle service issues and the demo switches.
- **Booking register** (`/register/**`): called by Camunda's REST connectors, not by people. They send the shared key
  `REGISTER_API_KEY` as `X-Register-Key` (HTTP connector authentication *API key*, `{{secrets.REGISTER_API_KEY}}`).
- **Test-only login** for automated tests (Google blocks automated sign-ins): `POST /api/auth/dev-login {email}`, off
  unless `APP_DEVLOGIN_ENABLED=true`. Same roles as a Google login with that email. Never switch it on for real use.
- Text people type (name, purpose, remarks) has the word `secrets.` broken up (`secrets .`) before it reaches Camunda,
  and an email address containing it cannot book: the connector runtime fills both `{{secrets.NAME}}` and the bare
  `secrets.NAME` into connector variables, and these texts go into emails and the register (`SafeText`).
  `start-camunda.cmd` also clears the variables Camunda does not need (Google client, `APP_ACCOUNTS`).

## REST API

| Method and path | Does |
|---|---|
| `GET /api/auth/me` | `{signedIn:false}` or `{signedIn, email, name, picture, roles, admin, approverRoles}` (open) |
| `GET /api/auth/config` | `{googleLoginUrl, googleConfigured, devLogin}` (open) |
| `POST /api/auth/logout` | Signs out (204) |
| `GET /api/meta` | Venues (with capacities), approver roles, outcome labels, approval minutes |
| `GET /api/health` | `{camunda, bookings, worker, mail, registerMode}` |
| `POST /api/bookings` | Start a booking for the signed-in account. Body: `attendees, purpose` and `sessions: [{venue, bookingDate, startTime, endTime}]` (or one session as flat fields). 400 `{error, fields}` for missing or malformed fields. Returns `{key}` |
| `GET /api/bookings?email=&limit=` | Own requests (admins: everyone's, `email` narrows), newest first, with a status chip |
| `GET /api/bookings/{key}` | One request: status, outcome, the live route through hall-booking and its hall-approval instances, the approval countdown, the email |
| `GET /api/tasks?kind=approval&role=` | Open *Review booking* tasks for the account's roles (admins: all), each with `canDecide` |
| `GET /api/tasks?kind=service` | Open *Resolve service issue* tasks (admins) |
| `POST /api/tasks/{key}/decision` | `{approved, remarks}` completes *Review booking* |
| `POST /api/tasks/{key}/service-action` | `{action: RETRY \| CANCEL}` completes *Resolve service issue* |
| `GET /api/calendar?from=&to=` | Booked slots in a date range |
| `GET /api/notifications` | Requester notices and approver reminders, newest first |
| `POST /api/demo/reset` | Back to the three seed bookings, notifications cleared (admins) |
| `GET/POST /api/demo/register-mode` | `{mode: UP \| DOWN \| SLOW}` for the outage demos |

Booking register (used by the connectors through `BOOKING_API_URL = http://127.0.0.1:8090/register`):
`GET/POST /register/bookings`, `GET/PATCH/DELETE /register/bookings/{id}`, `GET /register/notifications[/{id}]`, and
`POST /register/reset` for `scriptseset-data.cmd`. All need the `X-Register-Key` header.

## Database

| Table | Rows |
|---|---|
| `register_slot` | id, hall, booking_day, start_hour, end_hour, status (PENDING / CONFIRMED), requester |
| `booking_request` | process_instance_key (PK), requester_name, email, attendees, purpose, outcome, approvers, booking_ref, email_status, created_at, finished_at |
| `booking_request_session` | process_instance_key (FK), position, venue, booking_date, start_time, end_time |
| `app_user` | email (PK), name, picture_url, first_login, last_login: everyone who signed in |
| `notification` | id, kind (OUTCOME / REMINDER), recipient, subject, message, booking_ref, process_instance_key, email_status, email_error, sent_at |

H2 console while running: http://localhost:8090/h2-console, JDBC URL `jdbc:h2:file:./data/hallbooking;AUTO_SERVER=TRUE`, user `sa`, empty password.

## Configuration

`src/main/resources/application.yaml`; every value can be set by an environment variable (Spring relaxed binding):

| Property | Default | Meaning |
|---|---|---|
| `camunda.client.grpc-address` / `rest-address` | `http://localhost:26500` / `http://localhost:8080` | Camunda 8 Run, no authentication |
| `camunda.client.worker.defaults.timeout` | `PT30S` | Job lock time |
| `app.models-dir` | `../hall-booking` | BPMN/DMN/forms deployed at startup (`app.deploy-models`) |
| `app.import-file` | `../hall-booking/mock/db.json` | One-time import when the register is empty |
| `app.approval-timeout` / `app.approval-reminder` | `APPROVAL_TIMEOUT` = `P1D`, `APPROVAL_REMINDER` = `PT1H` | How long an approver has and when the reminder goes out; sent with every booking as `approvalTimes` (the timers in hall-approval.bpmn read it). `PT2M` / `PT1M` for demos |
| `app.smtp-host` / `app.smtp-port` | `SMTP_HOST` / `SMTP_PORT` from `secrets.cmd` | Mail server shown in /api/health |
| `spring.security.oauth2.client.registration.google.client-id` / `client-secret` | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | The Google OAuth client (Web application) |
| `app.accounts` | `APP_ACCOUNTS` | Roles per Google account |
| `app.register-key` | `REGISTER_API_KEY` | Key the REST connectors send; empty = register open (local tests only) |
| `app.dev-login-enabled` | `APP_DEVLOGIN_ENABLED`, false | Test-only login |
| `app.url` | `APP_URL`, `http://localhost:8090` | Address used in the email links |
| profile `postgres` | | `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` |
