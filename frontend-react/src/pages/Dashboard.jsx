import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../context/AppContext.jsx';
import { Empty, ErrorBox, PageHead, Panel, Stamp } from '../components/ui.jsx';
import { Legend, RoomBoard } from '../components/RoomBoard.jsx';
import { usePoll, useNow } from '../lib/hooks.js';
import { addDays, ago, fmtDay, timeLeft, today } from '../lib/format.js';

/** The room board: who has each hall and lab on one day, what waits for approval, the latest requests. */
export default function Dashboard() {
  const { meta, isAdmin, isApprover, venueName, roleName } = useApp();
  const [day, setDay] = useState(null);
  const now = useNow(1000);
  const reviews = isApprover || isAdmin;

  const board = usePoll(() => api('/calendar'), 4000);
  // Reviews for this person's roles (admins: every role); requesters only see their own requests.
  const tasks = usePoll(() => (reviews ? api('/tasks?kind=approval') : []), 4000, [reviews]);
  const latest = usePoll(() => api('/bookings?limit=6'), 4000);

  const all = board.data || [];
  const nextBooked = all.map((b) => b.day).filter((d) => d >= today()).sort()[0] || today();
  const shownDay = day || nextBooked;

  return (
    <>
      <PageHead eyebrow="Room board" title={fmtDay(shownDay, { weekday: 'long' })}
        actions={(
          <>
            <button className="btn btn-sm" aria-label="Previous day" onClick={() => setDay(addDays(shownDay, -1))}>‹</button>
            <button className="btn btn-sm" onClick={() => setDay(nextBooked)}>Next booked day</button>
            <button className="btn btn-sm" aria-label="Next day" onClick={() => setDay(addDays(shownDay, 1))}>›</button>
            <Link className="btn btn-primary" to="/new">Book a room</Link>
          </>
        )}>
        Who has each hall and lab, hour by hour. Held slots are waiting for an approver.
      </PageHead>

      <Panel>
        <ErrorBox error={!board.data && board.error} />
        <RoomBoard venues={meta.venues} bookings={all.filter((b) => b.day === shownDay)} />
        <Legend />
      </Panel>

      <section className={`grid gap-[22px] ${reviews ? 'md:grid-cols-2' : ''}`}>
        {reviews && (
        <Panel title="Waiting for approval" aside={tasks.data?.length || ''}>
          {tasks.data?.length ? (
            <ul className="m-0 grid list-none divide-y divide-rule p-0">
              {tasks.data.map((t) => (
                <li key={t.key}>
                  <Link to="/inbox"
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-0.5 py-2.5 text-inherit no-underline hover:bg-paper">
                    <span>
                      <span className="font-semibold">{venueName(t.venue)} · {t.startTime}–{t.endTime}{t.sessions.length > 1 ? ` +${t.sessions.length - 1}` : ''}</span><br />
                      <span className="text-[13px] text-ink-2">{t.requesterName} · {fmtDay(t.bookingDate)} · for {roleName(t.approver)}</span>
                    </span>
                    <span className="font-mono text-sm" title="Time left before it expires">{timeLeft(t.due, now)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : tasks.data && <Empty>Nothing is waiting for you.</Empty>}
        </Panel>
        )}

        <Panel title={isAdmin ? 'Latest requests' : 'Your latest requests'}>
          <ErrorBox error={!latest.data && latest.error} />
          {latest.data?.length ? (
            <ul className="m-0 grid list-none divide-y divide-rule p-0">
              {latest.data.map((b) => (
                <li key={b.key}>
                  <Link to={`/requests/${b.key}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-0.5 py-2.5 text-inherit no-underline hover:bg-paper">
                    <span>
                      <span className="font-semibold">{venueName(b.venue)} · {fmtDay(b.bookingDate)}, {b.startTime}–{b.endTime}{b.sessions.length > 1 ? ` +${b.sessions.length - 1}` : ''}</span><br />
                      <span className="text-[13px] text-ink-2">{b.requesterName} · {ago(b.startDate, now)}</span>
                    </span>
                    <Stamp status={b.status} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : latest.data && <Empty>No requests yet. <Link to="/new">Book a room</Link></Empty>}
        </Panel>
      </section>
    </>
  );
}
