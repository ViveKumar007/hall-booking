# Hall Booking App — Implementation Plan

> **Status (2026-11-09): Option B's backend is built** in `backend-springboot/` (Spring Boot 3.5, `@JobWorker`s, JPA on
> H2/PostgreSQL, Camunda Java client); it replaced the Node server, the Node worker and json-server, and serves the same
> pages with the same `/api`. The booking register moved into the backend, so the optional H2 phase is done too. Next: the
> React frontend (course guidelines) instead of the plain pages. See `backend-springboot/README.md`.
>
> Earlier status (2026-10-27): Option A was built (review the next day, so the faster option). Phases 1–6 and 8 were done:
> `hall-booking/app/` (server.js + public/), started with `scripts/start-app.cmd` or `start-all.cmd`, on http://localhost:8090.
> The pages only call `/api`, so Option B (Spring Boot) can still replace the Node server later without changing them.
> Found while building: `bookingRef` can repeat after a data reset, so the messages now use `requestId` (see PLAN.md §0).

## 1. What we are building

A web application that becomes the front door to the existing Camunda workflow, for the people who use it:

- **Requesters** submit a booking and follow its progress live.
- **Approvers** see the bookings waiting for their role and approve or reject them.
- **Admins** handle "booking service down" cases and see everything: calendar, notifications, system status.

**The workflow does not change.** The BPMN (both pools), the DMN, the REST connectors and the mock booking API stay
exactly as they are and keep passing the 19 tests. The app talks to Camunda through its REST API, using the same calls
`run-scenarios.ps1` already uses successfully. Tasklist and Operate keep working next to the app, as a backup and for
showing process paths.

```
  Browser: our HTML/CSS/JS pages
        |  /api/...  (only our own API)
        v
  App server on :8090  (Option A: small Node server | Option B: Spring Boot)
        |  Camunda REST API /v2/...                 |  GET /bookings, /notifications
        v                                           v
  Camunda 8 Run :8080  -- REST connectors -->  booking service (json-server :3000)
        ^
        |  jobs: validate-booking, publish-message, send-reminder, send-notification
  External worker  (Option A: worker.js as today | Option B: inside the Spring Boot app)
```

## 2. The two options

| | **A: HTML/CSS/JS** | **B: Spring Boot + HTML/CSS/JS** |
|---|---|---|
| Frontend | Plain HTML, CSS and JavaScript pages | The **same** pages, served by Spring Boot |
| Server side | A small Node.js file (no libraries) that serves the pages and implements `/api` by calling Camunda. Needed because browsers block direct calls from a page to Camunda on another port (CORS) | Spring Boot REST controllers (Java 21) using Camunda's official Java client |
| External worker | Keep `worker/worker.js` | Move the 4 job types into Spring Boot as `@JobWorker` methods; retire `worker.js` |
| Booking database | json-server mock, unchanged | json-server at first; optional later: Spring Data + H2 serving the same `/bookings` API |
| New installs | None (Node is installed) | None. The Maven wrapper downloads Maven and the libraries on the first build (needs internet) |
| Windows to keep open | mock, Camunda, worker, app (4) | mock, Camunda, app (3; the app includes the workers) |
| Memory | Tiny | One more Java process (~300–500 MB). RAM is already tight with Camunda running |
| Amount of work | Smaller (roughly half of B) | Larger |
| Rubric fit | Good: our worker, REST connectors, a real UI | Strongest: a real application that is both the UI backend and the external worker |
| Viva | Easy: the same JavaScript as the worker | You must explain Spring Boot basics: controllers, services, `@JobWorker`, `application.yaml` |

**Recommendation: Option B.** It meets both of the professor's suggestions at once: a Spring Boot backend *and* a plain
HTML/CSS/JS frontend. Moving the external worker into the Spring Boot app also makes the "External Workers" part a
proper service instead of a script.
**Choose Option A** if the next review is only a few days away, or if the professor only wants a frontend.

Because the frontend only talks to our own `/api` (section 3.2), **the pages are identical in both options**. If we start
with A, we can later swap the Node server for Spring Boot without rewriting the pages.

## 3. Same in both options

### 3.1 Users and pages

There is no real login. A **role switcher** in the header picks *Requester*, *Approver (admin-office / dean / hod / lab-incharge)* or *Admin*.

| Page | For | Shows / does | Camunda behind it |
|---|---|---|---|
| **Dashboard** | everyone | Counts (waiting approvals, service issues, bookings this week), latest requests, system status (Camunda, booking service, worker) | process instance search, user task search, `GET /bookings` |
| **New booking** | requester | Same fields as the request form; venue capacity shown; checks in the browser (end after start, date not past, fits the venue). The worker still validates on the server | `POST /v2/process-instances` |
| **My requests** | requester | Requests for an email address, with a status chip per request | variable search `email` → instances |
| **Request detail** | requester, admin | Live **timeline**: Validated → Slot checked → Approver chosen (dean) → Slot held BK-12 → Waiting for approval → Approved → Notified. Outcome and the email text. Refreshes every 3 s while running | element-instance search on both instances, variables |
| **Approver inbox** | approver | Open *Review booking* tasks for the selected role, **time left** before expiry, "reminder sent" badge | user task search (`User_Approval`, CREATED) + variables |
| **Review** | approver | Details, **Approve** / **Reject**, remarks | `POST /v2/user-tasks/{key}/completion` `{approved, remarks}` |
| **Service issues** | admin | Open *Resolve service issue* tasks with the error text, **Retry** / **Cancel** | user task search (`User_FixService`), completion `{serviceFixAction}` |
| **Calendar** | everyone | Week view per venue: CONFIRMED and PENDING blocks | `GET /bookings` |
| **Notifications** | admin | Emails the worker sent | `GET /notifications` |

### 3.2 Our API (the only thing the pages call)

| Method and path | Does |
|---|---|
| `GET /api/health` | Is Camunda, the booking service and the worker reachable? |
| `POST /api/bookings` | Start a booking. Body: the form fields. Returns the booking's process instance key |
| `GET /api/bookings?email=` | A requester's bookings with status and outcome |
| `GET /api/bookings/{key}` | One booking: status, outcome, approver, bookingRef, timeline, notification |
| `GET /api/tasks?kind=approval&role=dean` | Open approval tasks (optionally for one role) |
| `GET /api/tasks?kind=service` | Open service-issue tasks |
| `POST /api/tasks/{key}/decision` | `{approved, remarks}` → completes *Review booking* |
| `POST /api/tasks/{key}/service-action` | `{action: "RETRY" \| "CANCEL"}` → completes *Resolve service issue* |
| `GET /api/calendar?from=&to=` | Bookings in a date range |
| `GET /api/notifications` | Sent notifications |
| `POST /api/demo/reset` | Demo only: restore the seed bookings |

### 3.3 How the app reads the workflow (no BPMN changes)

- A booking is one *Seminar Hall and Lab Booking* instance. Its approval is one *Hall Approval* instance, linked by `bookingRef`.
- **Status** comes from the instance state plus the step it is currently waiting at:

  | Waiting at (element ID) | Shown as |
  |---|---|
  | `Worker_ValidateRequest` | Validating |
  | `User_FixService` | Booking service issue |
  | `Receive_Decision` | Waiting for approval |
  | completed | the `outcome` variable: Approved, Rejected, Expired, Conflict, Invalid time, Past date, Over capacity, Service unavailable |
  | has incident | Needs attention |

- **Time left** on an approval = the task's creation time + 2 minutes. **Reminder sent** = the approval instance has `reminderSentAt`.
- **Approver role** = the `approver` variable the DMN set. The inbox filters on it.
- Optional later: enforce roles in Camunda by setting `User_Approval`'s candidate group to `=approver`. Not needed for the demo.

## 4. Option A in detail

```
hall-booking/app/
├─ server.js            serves public/ and implements /api by calling Camunda and the booking service (Node, no libraries)
└─ public/
   ├─ index.html        dashboard
   ├─ new-booking.html, my-requests.html, request.html, inbox.html, review.html,
   │  service-issues.html, calendar.html, notifications.html
   ├─ css/style.css
   └─ js/api.js (fetch wrapper), js/roles.js (role switcher), js/<page>.js
hall-booking/scripts/start-app.cmd   ->  http://localhost:8090
```

- The worker stays as it is (`start-worker.cmd`).
- Ports: Camunda 8080, connectors 8086, mock 3000, **app 8090**.

## 5. Option B in detail

```
hall-booking/app/                       Spring Boot 3.x, Java 21, Maven wrapper (mvnw)
├─ pom.xml                              spring-boot-starter-web, -validation, camunda-spring-boot-starter (8.8.x)
└─ src/main/
   ├─ java/.../hallbooking/
   │  ├─ HallBookingApplication.java
   │  ├─ api/          BookingController, TaskController, CalendarController, HealthController
   │  ├─ camunda/      CamundaService: start instance, search tasks/instances/variables, complete task (CamundaClient)
   │  ├─ worker/       BookingWorkers: @JobWorker for validate-booking, publish-message, send-reminder, send-notification
   │  └─ bookings/     BookingServiceClient (RestClient → json-server /bookings, /notifications)
   └─ resources/
      ├─ application.yaml   server.port 8090; camunda.client: self-managed, REST http://localhost:8080, gRPC localhost:26500, no auth
      └─ static/            the same HTML/CSS/JS pages as Option A
hall-booking/scripts/start-app.cmd   sets JAVA_HOME=E:\jdk-21.0.6, runs mvnw spring-boot:run
```

- **Workers move into Java** with the same behaviour as `worker.js`: capacities, outbox files, best-effort `/notifications`.
  `worker.js` is then no longer started. Two workers for the same job types would split the jobs between them, which is confusing in a demo.
- Optional later phase: bookings stored in H2 through Spring Data JPA, offering the same `/bookings` API, with
  `MOCK_BASE_URL` pointed at the app. json-server is then retired.
- To check when building: Spring Boot and Camunda starter versions compatible with Camunda 8 Run **8.8.32**, and the exact `camunda.client.*` property names for 8.8.

## 6. Build order

| Phase | Result | A | B |
|---|---|---|---|
| 1 | App starts on :8090; dashboard shows the status of Camunda, the booking service and the worker | ✓ | ✓ |
| 2 | **New booking** + **Request detail** with live timeline | ✓ | ✓ |
| 3 | **Approver inbox** + **Review** (approve/reject, countdown, reminder badge) | ✓ | ✓ |
| 4 | **My requests** | ✓ | ✓ |
| 5 | **Service issues** (Retry/Cancel) + **Notifications** | ✓ | ✓ |
| 6 | **Calendar** | ✓ | ✓ |
| 7 | Workers in Spring Boot; `run-scenarios.ps1` passes 19/19 again | – | ✓ |
| 8 | Styling pass: one consistent look, loading, empty and error states, works at laptop and projector size | ✓ | ✓ |
| 9 | Tests and docs (section 7), updated presentation script | ✓ | ✓ |
| opt. | Booking database in H2 instead of json-server | – | ✓ |

Phases 1–3 are the minimum for a convincing demo.

## 7. Testing

- **Workflow regression:** `run-scenarios.ps1`, 19 automated cases. The process is unchanged, so they must keep passing. Under Option B they must also pass with the Java workers.
- **UI walkthrough**, one per existing test case, done through the app instead of Tasklist:

  | Case | In the app |
  |---|---|
  | A approved | New booking → Inbox (admin-office) → Approve → detail shows APPROVED, calendar shows CONFIRMED |
  | B conflict | New booking on a taken slot → detail shows CONFLICT at once, no inbox entry |
  | C expired | New booking, don't act → inbox countdown, reminder badge after 1 min, gone after 2 min → detail shows EXPIRED |
  | H over capacity | Browser warns; submitting anyway → detail shows OVER_CAPACITY (the worker's check) |
  | S1 service down | Close mock → New booking → Service issues → Retry after restarting the mock → continues |
  | P DMN priority | Hall B, 8 h, 150 people → inbox shows it under *dean* |

- **Option B extra:** unit tests for the validation rules and the status mapping; a controller test with a mocked Camunda client.

## 8. Effect on the demo

The live part runs in the app instead of Tasklist: requester page → approver inbox → admin page. That's easier to
follow for the examiners. Operate is still used to show the process paths, and Modeler for the BPMN and DMN. The
presentation script gets a new version.

## 9. Decisions needed

1. **Stack:** A or B. Ask the professor whether a Spring Boot backend is expected, or HTML/CSS/JS is enough.
2. **When is the next review?** If it's only a few days away, start with A; the pages carry over to B later.
3. **Booking data:** keep json-server, or (B only) a real database (H2)?
4. **Login:** is a role switcher acceptable instead of real users?
5. **Tasklist:** keep it as a backup UI? (Default: yes.)

## 10. Risks

| Risk | Mitigation |
|---|---|
| Memory: Camunda + Elasticsearch + (B) another JVM | Close other apps; run the app with a small heap (`-Xmx512m`) |
| Browser can't call Camunda directly (CORS) | Pages only call our own `/api` on the same port |
| Camunda's REST API is unprotected in Camunda 8 Run | Fine for local demos; a real deployment needs authentication |
| (B) Java client version mismatch with 8.8.32 | Pin the starter to an 8.8.x version |
| Worker and Spring Boot both handling the same jobs | Only one of them runs (B: don't start `worker.js`) |
