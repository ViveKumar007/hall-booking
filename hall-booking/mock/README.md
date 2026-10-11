# Mock booking API

A [json-server](https://github.com/typicode/json-server/tree/v0.17.4) REST API that stands in for the
college's booking database. The REST connectors in `hall-booking.bpmn` call it.

## Run it

```
scripts\start-mock.cmd
```

This serves `db.json` on **http://127.0.0.1:3000**. Keep the window open. It needs Node.js;
`npx` downloads json-server 0.17.4 on the first run.

To restore the three seed bookings and clear notifications, run `scripts\reset-mock.cmd`. It works while the
server is running, because `--watch` reloads the file.

Open http://127.0.0.1:3000/bookings and http://127.0.0.1:3000/notifications in a browser to see the
data change as the process runs.

## How the process finds it

Each connector URL starts with `{{secrets.MOCK_BASE_URL}}`. On a local Camunda 8 Run, connector secrets
come from environment variables of the connectors runtime. `scripts\start-camunda.cmd` sets
`MOCK_BASE_URL=http://127.0.0.1:3000` before it starts c8run. If Camunda is started any other way, the
connectors fail with an incident on *Fetch existing bookings*.

The server binds to `127.0.0.1` rather than `localhost`. Node may bind `localhost` to IPv6 only,
and the Java connector runtime connects over IPv4.

## Contract

| Call | Used by | Response |
|---|---|---|
| `GET /bookings` | Fetch existing bookings | array of bookings |
| `POST /bookings` | Hold slot | created booking incl. `id` |
| `PATCH /bookings/{id}` | Confirm slot | updated booking |
| `DELETE /bookings/{id}` | Release slot (rejected / expired) | `{}` |
| `POST /notifications` | Notify requester | created notification |

Booking fields are `hall`, `day`, `startHour`, `endHour`, `status`, `requester`. They deliberately differ
from the process variable names (`venue`, `bookingDate`, ...), so the FEEL filter in *Detect conflict*
never confuses a booking field with a process variable.

## Running against Camunda SaaS instead

A SaaS cluster cannot reach `127.0.0.1`. Expose the mock with `ngrok http 3000` (or cloudflared), then
create a connector secret `MOCK_BASE_URL` in Console with the public https URL. Alternatively, use
Beeceptor/Mockoon static rules with the same responses; bookings won't persist, but every path still runs.
