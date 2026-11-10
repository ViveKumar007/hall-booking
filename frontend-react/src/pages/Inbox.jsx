import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../context/AppContext.jsx';
import { Countdown, Empty, ErrorBox, PageHead } from '../components/ui.jsx';
import { usePoll } from '../lib/hooks.js';
import { fmtDay } from '../lib/format.js';

/**
 * The custom Tasklist: open "Review booking" user tasks (one per approver in a request's approval chain) for the
 * signed-in person's approver roles. Admins also see the other roles' reviews, but only the role's holder decides.
 * Approve / Reject completes the task with {approved, remarks}; the backend adds who decided.
 */
export default function Inbox() {
  const { isAdmin, isApprover, user, roleName, meta } = useApp();
  const allowed = isApprover || isAdmin;
  const { data: tasks, error, reload } = usePoll(() => api('/tasks?kind=approval'), 3000, [], { enabled: allowed });
  const [done, setDone] = useState({}); // task key -> "Approved" | "Rejected", kept visible briefly after deciding

  if (!allowed) {
    return (
      <PageHead eyebrow="Inbox" title="Approver inbox">
        Your account ({user.email}) is not an approver. Approvers (Admin office, Dean, HOD, Lab in-charge) are set by the
        administrator; you can book rooms and follow your requests.
      </PageHead>
    );
  }

  const shown = [...(tasks || [])];
  for (const [k, v] of Object.entries(done)) if (!shown.some((t) => t.key === k)) shown.push(v.task);
  const mine = user.approverRoles.map(roleName).join(', ');
  const showRole = isAdmin || user.approverRoles.length > 1;

  return (
    <>
      <PageHead eyebrow="Inbox" title={isAdmin ? 'All bookings waiting for approval' : `Waiting for you (${mine})`}>
        Approve or reject each request. You get an email when one arrives and a reminder after {meta.approval.reminderText};
        after {meta.approval.timeoutText} the request expires and its slots are released. Requests with several approvers reach them one after the other.
        {isAdmin && <> As admin you see every role&apos;s reviews; you decide only those for {mine || 'roles you hold'}.</>}
      </PageHead>
      <ErrorBox error={!tasks && error} />
      {tasks && !shown.length && <Empty>Nothing is waiting. New requests appear here automatically.</Empty>}
      <div className="grid gap-3.5">
        {shown.map((t) => (
          <TaskCard key={t.key} task={t} showRole={showRole} outcome={done[t.key]?.outcome}
            onDone={(outcome) => {
              setDone((d) => ({ ...d, [t.key]: { outcome, task: t } }));
              setTimeout(() => setDone(({ [t.key]: _, ...rest }) => rest), 6000);
              reload();
            }} />
        ))}
      </div>
    </>
  );
}

function TaskCard({ task: t, showRole, outcome, onDone }) {
  const { venueName, roleName, toast } = useApp();
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);

  async function decide(approved) {
    setBusy(true);
    try {
      await api(`/tasks/${t.key}/decision`, { method: 'POST', body: { approved, remarks } });
      toast(`${approved ? 'Approved' : 'Rejected'} ${t.bookingRef || ''}`);
      onDone(approved ? 'Approved' : 'Rejected');
    } catch (e) {
      setBusy(false);
      toast(e.status === 404 || e.status === 409 ? 'This request has already expired or been decided.' : e.message, 'bad');
    }
  }

  if (outcome) {
    return (
      <article className="panel text-sm">
        {outcome}. The booking desk now {t.approvalSteps > t.approvalStep && outcome === 'Approved' ? 'asks the next approver' : 'confirms or releases the slots and emails'} {t.requesterName}.{' '}
        {t.bookingKey && <Link to={`/requests/${t.bookingKey}`}>See the request</Link>}
      </article>
    );
  }

  return (
    <article className="panel grid gap-x-[22px] gap-y-3.5 md:grid-cols-[minmax(0,1fr)_190px]">
      <div className="grid gap-1">
        <div className="eyebrow">
          {t.bookingRef}{showRole ? ` · for ${roleName(t.approver)}` : ''}{t.approvalSteps > 1 ? ` · approval ${t.approvalStep} of ${t.approvalSteps}` : ''}
        </div>
        <ul className="m-0 grid list-none gap-0.5 p-0">
          {t.sessions.map((s, i) => (
            <li key={i}><h3 className="text-lg">{venueName(s.venue)} · {fmtDay(s.bookingDate)} · {s.startTime}–{s.endTime}</h3></li>
          ))}
        </ul>
        <div className="text-ink-2">{t.requesterName} · {t.email} · <b>{t.attendees}</b> people</div>
        {t.purpose && <p className="m-0 text-[13px] text-ink-2">{t.purpose}</p>}
        {t.bookingKey && <p className="m-0 text-[13px]"><Link to={`/requests/${t.bookingKey}`}>Follow this request</Link></p>}
      </div>
      <div className="grid content-start gap-1.5">
        <span className="eyebrow">Expires in</span>
        <Countdown since={t.created} due={t.due} />
        {t.reminderSent && <span className="justify-self-start rounded-full bg-warn-soft px-2 py-px text-xs font-semibold text-warn">Reminder sent</span>}
      </div>
      {t.canDecide ? (
        <div className="grid items-end gap-2.5 md:col-span-2 md:grid-cols-[minmax(0,1fr)_auto_auto]">
          <label className="grid gap-1.5">
            <span className="text-sm font-semibold">Remarks</span>
            <input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional. Included in the email if you reject." />
          </label>
          <button className="btn btn-bad" disabled={busy} onClick={() => decide(false)}>Reject</button>
          <button className="btn btn-ok" disabled={busy} onClick={() => decide(true)}>Approve</button>
        </div>
      ) : (
        <p className="m-0 text-[13px] text-ink-3 md:col-span-2">Only the {roleName(t.approver)} can decide this review; they have been emailed.</p>
      )}
    </article>
  );
}
