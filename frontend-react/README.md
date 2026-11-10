# Hall Booking frontend (React 19, Vite 8, Tailwind CSS 4)

The web app for the Seminar Hall & Lab Booking workflow. It talks only to the Spring Boot backend's REST API
(`/api/...`, see [`../backend-springboot/README.md`](../backend-springboot/README.md)); the backend talks to Camunda.

```
React (this app) ──/api──▶ Spring Boot backend ──Camunda Java client──▶ Camunda 8 (Zeebe, user tasks, search)
```

## Run

```
hall-booking\scripts\build-frontend.cmd   :: npm ci + vite build -> dist\, served by the backend on http://localhost:8090
cd frontend-react && npm run dev          :: development server with hot reload on http://localhost:5173 (forwards /api and /oauth2 to :8090)
```

`start-backend.cmd` builds the frontend automatically when `dist\` is missing. Rebuild after changing the code.
Needs Node.js 20.19+ or 22.12+. With the development server, sign in once on http://localhost:8090 (Google returns there);
the login cookie then works on :5173 too.

## What the course asks for, and where it is

| Requirement | Where |
|---|---|
| UI to start and manage workflows | `pages/NewBooking.jsx` starts a booking (`POST /api/bookings`); Inbox and Service issues complete the user tasks |
| **Dynamic array item builder** for multi-instance input | `NewBooking.jsx`: the session list (add / remove rows, up to 10). Each row is one item of the `sessions` start variable that the BPMN processes with parallel multi-instance |
| **Custom Tasklist inbox** | `pages/Inbox.jsx`: open *Review booking* tasks for the chosen approver role, countdown to expiry, reminder badge, "approval 1 of 2", Approve / Reject with remarks. `pages/Issues.jsx`: *Resolve service issue* tasks with Retry / Cancel |
| **Live process status tracker** | `pages/RequestDetail.jsx`: the two-lane route of the booking process and its approval child processes, refreshed every 2 s while running |
| Integration with the Spring Boot REST API | `src/api.js` (one `fetch` wrapper); every page polls its endpoint with `usePoll` |
| Sign-in | `pages/SignIn.jsx`: *Sign in with Google* (a link to the backend's `/oauth2/authorization/google`); the header shows the account, its roles and *Sign out*. A 401 from the API brings the sign-in page back |
| Validation and user feedback | Form checks before sending (people, sessions); live warnings per session (end before start, past date, capacity, clashes with booked slots, overlaps between sessions); server field errors shown on the right row; toasts; status chips; "Registering…" while a new request is being indexed |

## Structure

```
src/
├─ main.jsx                 routes (hash routes: /#/new, /#/requests/123, ...)
├─ index.css                Tailwind 4 + the design tokens (@theme) + a few component styles (stamps, room board, route)
├─ api.js                   fetch wrapper for /api: CSRF header on writes, 401 = signed out, errors as ApiError {status, fields}
├─ context/AppContext.jsx   the signed-in account and roles (/api/auth/me), reference data (/api/meta), sign out, toasts
├─ lib/hooks.js             usePoll (refresh every n s), useNow (countdowns), useStored (localStorage)
├─ lib/format.js            dates, times, countdown text
├─ components/              Layout (header, nav with task counts, status lights), RoomBoard, ui (Panel, Stamp, Countdown, Field, ...)
└─ pages/                   SignIn, Dashboard, NewBooking, Requests, RequestDetail, Inbox, Issues, Calendar, Notifications
```

Everyone signs in with Google. The roles belong to the account (set in `APP_ACCOUNTS` on the backend); one account can
hold several, for example Dean and Admin. The backend enforces every rule; the pages only hide what does not apply.

| Account | Pages |
|---|---|
| Anyone (requester) | Room board, New booking (as the signed-in account), My requests, Calendar |
| Approver (Admin office, Dean, HOD, Lab in-charge) | The above + Inbox (reviews for their own roles) |
| Admin | The above + Inbox (every role's reviews; decides only those for roles held), Service issues (with the booking-register outage switch), All requests, Notifications |
