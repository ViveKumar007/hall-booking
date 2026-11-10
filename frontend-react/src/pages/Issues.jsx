import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../context/AppContext.jsx';
import { Empty, ErrorBox, PageHead } from '../components/ui.jsx';
import { usePoll, useNow } from '../lib/hooks.js';
import { ago, fmtDay } from '../lib/format.js';

const MODES = [['UP', 'Normal'], ['DOWN', 'Down'], ['SLOW', 'Slow (40 s)']];

/**
 * Service issues: "Resolve service issue" user tasks, reached through the error boundary (register down) or the
 * 30 s timer boundary (register too slow) of Check availability. Retry runs the check again, Cancel ends the request.
 */
export default function Issues() {
  const { venueName, toast } = useApp();
  const tasks = usePoll(() => api('/tasks?kind=service'), 3000);
  const health = usePoll(() => api('/health'), 3000);
  const [busy, setBusy] = useState(null);
  const now = useNow(15000);
  const mode = health.data?.registerMode;

  async function setMode(m) {
    try {
      await api('/demo/register-mode', { method: 'POST', body: { mode: m } });
      toast(m === 'UP' ? 'Booking register back to normal' : `Booking register is now ${m.toLowerCase()} (demo)`);
      health.reload();
    } catch (e) {
      toast(e.message, 'bad');
    }
  }

  async function act(t, action) {
    setBusy(t.key);
    try {
      await api(`/tasks/${t.key}/service-action`, { method: 'POST', body: { action } });
      toast(action === 'RETRY' ? 'Retrying: the request checks the register again' : 'Request cancelled; the requester is emailed');
      tasks.reload();
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHead eyebrow="Service issues" title="Bookings stuck on the booking service"
        actions={(
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Booking register (demo)">
            <span className="text-[13px] text-ink-2">Booking register (demo):</span>
            {MODES.map(([m, label]) => (
              <button key={m} className={`btn btn-sm ${mode === m ? 'btn-primary' : ''}`} aria-pressed={mode === m} onClick={() => setMode(m)}>{label}</button>
            ))}
          </div>
        )}>
        These requests could not read the booking register: it answered with an error, or took longer than 30 seconds.
        Retry once it is back; Cancel ends the request and emails the requester.
      </PageHead>
      {tasks.data?.length > 0 && health.data && !health.data.bookings && (
        <div role="alert" className="rounded-lg bg-bad-soft px-3.5 py-3 text-bad">The booking register is still down. A retry now would fail again; switch it back to Normal first.</div>
      )}
      <ErrorBox error={!tasks.data && tasks.error} />
      {tasks.data && !tasks.data.length && <Empty>No service issues. Every request reached the booking register.</Empty>}
      <div className="grid gap-3.5">
        {(tasks.data || []).map((t) => (
          <article key={t.key} className="panel grid gap-x-[22px] gap-y-3.5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="grid gap-1">
              <div className="eyebrow">Waiting since {ago(t.created, now)}</div>
              {t.sessions.map((s, i) => <h3 key={i} className="text-lg">{venueName(s.venue)} · {fmtDay(s.bookingDate)} · {s.startTime}–{s.endTime}</h3>)}
              <div className="text-ink-2">{t.requesterName} · {t.email} · {t.attendees} people</div>
              <p className="m-0 text-[13px]"><Link to={`/requests/${t.bookingKey}`}>Follow this request</Link></p>
            </div>
            <div>
              <span className="eyebrow">Error</span>
              <p className="mb-0 mt-1 text-[13px]">{t.serviceError || 'Booking service unreachable'}</p>
            </div>
            <div className="flex justify-end gap-2.5 md:col-span-2">
              <button className="btn btn-bad" disabled={busy === t.key} onClick={() => act(t, 'CANCEL')}>Cancel booking</button>
              <button className="btn btn-primary" disabled={busy === t.key} onClick={() => act(t, 'RETRY')}>Retry now</button>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
