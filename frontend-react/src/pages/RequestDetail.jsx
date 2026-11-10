import { useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../context/AppContext.jsx';
import { Countdown, Empty, ErrorBox, Panel, Stamp } from '../components/ui.jsx';
import { usePoll } from '../lib/hooks.js';
import { fmtClock, fmtDay } from '../lib/format.js';

/**
 * The live process status tracker for one booking: every step of hall-booking (left lane) and of its hall-approval
 * child instances (right lane) in the order they happened, refreshed every 2 s while the request runs.
 */
export default function RequestDetail() {
  const { key } = useParams();
  const { isAdmin, user, venueName, roleName } = useApp();
  const extra = useRef(0); // a few refreshes after the end: the last steps' details arrive slightly later
  const attempts = useRef(0);

  const { data: d, error } = usePoll(async () => {
    attempts.current += 1;
    const next = await api(`/bookings/${key}`);
    if (next.state !== 'ACTIVE') extra.current += 1;
    return next;
  }, 2000, [key], { enabled: extra.current < 4 });

  // Approvers open other people's requests from their inbox; everyone else from their own list.
  const back = isAdmin ? ['/requests', 'All requests'] : d && d.email !== user.email ? ['/inbox', 'Inbox'] : ['/requests', 'My requests'];

  if (!d) {
    // A request that was just sent takes a moment to appear in Camunda's search.
    if (error && error.status === 404 && attempts.current < 20) return <Empty>Registering your request with the workflow…</Empty>;
    if (error) return <ErrorBox error={error} />;
    return <Empty>Loading the request…</Empty>;
  }

  const finished = d.state !== 'ACTIVE';
  // A hand-over's "sent" and "received" share a row, so the arrow lines up across the lanes. Only paired hand-overs
  // get an arrow: between two approvers of a chain the next review opens without a step on the desk side.
  const pairs = (a, b) => a && b && a.message === 'out' && b.message === 'in' && a.lane !== b.lane;
  let row = 0;
  const steps = d.steps.map((s, i) => {
    const withPrev = pairs(d.steps[i - 1], s);
    if (!withPrev) row += 1;
    return { ...s, row, arrow: withPrev || pairs(s, d.steps[i + 1]) };
  });

  return (
    <>
      <Link to={back[0]} className="text-sm">← {back[1]}</Link>

      <section className="panel flex flex-wrap items-center justify-between gap-5">
        <div>
          <div className="eyebrow">Booking request{d.bookingRef ? ` · ${d.bookingRef}` : ''}</div>
          {d.sessions.length > 1 ? (
            <>
              <h1>{d.sessions.length} sessions</h1>
              {d.sessions.map((s, i) => (
                <div key={i} className="mt-1 font-display text-lg font-medium text-ink-2">
                  {venueName(s.venue)} · {fmtDay(s.bookingDate, { weekday: 'long' })} · {s.startTime}–{s.endTime}
                </div>
              ))}
            </>
          ) : (
            <>
              <h1>{venueName(d.venue)}</h1>
              <div className="mt-1 font-display text-lg font-medium text-ink-2">{fmtDay(d.bookingDate, { weekday: 'long' })} · {d.startTime}–{d.endTime}</div>
            </>
          )}
        </div>
        <Stamp status={d.status} />
      </section>

      <div className="grid items-start gap-[22px] lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)]">
        <Panel title="Route" aside={finished ? 'Finished' : 'Updates live'}>
          <div className="relative isolate">
            <div className="slip-grid pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
              <div className="rounded-l-lg bg-lane-desk" />
              <div />
              <div className="rounded-r-lg bg-lane-admin" />
            </div>
            <div className="slip-grid">
              <div className="border-b-2 border-rule-2 px-3.5 py-2.5 font-display text-[13px] font-semibold uppercase tracking-widest text-ink-2">Booking desk</div>
              <div />
              <div className="border-b-2 border-rule-2 px-3.5 py-2.5 font-display text-[13px] font-semibold uppercase tracking-widest text-ink-2">Approvals</div>
            </div>
            <ol className="slip-grid relative m-0 list-none gap-y-2 p-0 pt-2.5 before:absolute before:inset-y-0 before:left-[calc(50%-1px)] before:w-0.5 before:bg-rule before:content-['']">
              {steps.map((s, i) => (
                <li key={i} style={{ gridRow: s.row, gridColumn: s.lane === 'desk' ? 1 : 3 }}
                  className={`step ${s.state === 'ACTIVE' ? 'step-active' : ''} ${s.state === 'TERMINATED' ? 'step-terminated' : ''} ${s.message && s.arrow ? `step-handover ${s.message}-${s.lane}` : ''}`}>
                  <b>{s.label}</b>
                  <time className="col-start-2 row-start-1 font-mono text-xs text-ink-3">{fmtClock(s.at)}</time>
                  {s.detail && <span className="col-start-1 text-[13.5px] text-ink-2">{s.detail}</span>}
                </li>
              ))}
              {finished && d.status.code !== 'CANCELED' && (
                <li className="col-span-3 grid place-items-center pb-2.5 pt-6" style={{ gridRow: row + 1 }}>
                  <Stamp status={d.status} big />
                </li>
              )}
            </ol>
          </div>
        </Panel>

        <aside className="grid content-start gap-4">
          {d.review && (
            <section className="panel grid gap-1.5" aria-live="polite">
              <div className="eyebrow">Waiting for {roleName(d.review.approver)}{d.review.steps > 1 ? ` · approval ${d.review.step} of ${d.review.steps}` : ''}</div>
              <Countdown since={d.review.since} due={d.review.due} large />
              <span className="text-[13px] text-ink-2">
                {d.review.reminderSent ? 'Reminder sent to the approver.' : `A reminder goes out after ${d.review.reminderText || 'a while'}.`} The request expires {new Date(d.review.due).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.
              </span>
            </section>
          )}
          {d.status.code === 'User_FixService' && (
            <Panel>
              <div className="eyebrow">Booking service problem</div>
              <p className="my-1.5 text-[13px]">{d.serviceError || 'The booking register could not be read.'}</p>
              {isAdmin
                ? <Link className="btn btn-primary btn-sm" to="/issues">Resolve in Service issues</Link>
                : <p className="m-0 text-[13px] text-ink-2">An admin has been asked to retry or cancel.</p>}
            </Panel>
          )}
          <Panel title="Request">
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1.5 text-sm">
              <dt className="text-ink-3">Requester</dt><dd className="m-0 break-words">{d.requesterName}<br /><span className="text-[13px] text-ink-2">{d.email}</span></dd>
              <dt className="text-ink-3">People</dt><dd className="m-0">{d.attendees}</dd>
              <dt className="text-ink-3">Purpose</dt><dd className="m-0">{d.purpose || '–'}</dd>
              <dt className="text-ink-3">{d.approvers.length > 1 ? 'Approvers' : 'Approver'}</dt>
              <dd className="m-0">{d.approvers.length ? d.approvers.map(roleName).join(' → ') : <span className="text-ink-2">not chosen</span>}</dd>
              {d.remarks && <><dt className="text-ink-3">Remarks</dt><dd className="m-0">{d.remarks}</dd></>}
              <dt className="text-ink-3">Request no.</dt><dd className="m-0 font-mono text-[13px]">{d.key}</dd>
            </dl>
            {isAdmin && <p className="mb-0 mt-3"><a className="text-sm" href={d.operateUrl} target="_blank" rel="noopener noreferrer">Open in Operate ↗</a></p>}
          </Panel>
          {d.notification && (
            <Panel title={d.notification.emailStatus === 'FAILED' ? 'Email not delivered' : 'Email sent'}>
              <div className="whitespace-pre-wrap rounded-md border border-rule bg-paper px-3.5 py-3 text-sm">
                <b>{d.notification.subject}</b>{'\n'}To: {d.notification.to}{'\n\n'}{d.notification.message}
              </div>
            </Panel>
          )}
        </aside>
      </div>
    </>
  );
}
