import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../context/AppContext.jsx';
import { Empty, ErrorBox, PageHead, Panel, Stamp } from '../components/ui.jsx';
import { usePoll, useNow, useStored } from '../lib/hooks.js';
import { ago, fmtDay } from '../lib/format.js';

/**
 * The signed-in person's own requests; admins see everyone's and can narrow the list to their own. The backend
 * enforces this (a requester's list is always their own). Newest first, from the database.
 */
export default function Requests() {
  const { isAdmin, user, venueName, roleName } = useApp();
  const navigate = useNavigate();
  const [onlyMine, setOnlyMine] = useStored('hb-only-mine', 'no');
  const own = !isAdmin || onlyMine === 'yes';
  const now = useNow(15000);
  const list = usePoll(() => api(`/bookings?limit=40${isAdmin && own ? `&email=${encodeURIComponent(user.email)}` : ''}`), 4000, [isAdmin, own, user.email]);

  return (
    <>
      <PageHead eyebrow={isAdmin ? 'All requests' : 'My requests'} title={own ? 'Your booking requests' : 'Booking requests'}
        actions={(
          <>
            {isAdmin && (
              <label className="flex items-center gap-2 text-sm text-ink-2">
                <input type="checkbox" className="w-auto" checked={own} onChange={(e) => setOnlyMine(e.target.checked ? 'yes' : 'no')} />
                Only mine
              </label>
            )}
            <Link className="btn btn-primary" to="/new">Book a room</Link>
          </>
        )}>
        {own ? 'Every request you sent, newest first. Open one to follow it step by step.' : 'The latest requests from everyone, newest first.'}
      </PageHead>
      <Panel>
        <ErrorBox error={!list.data && list.error} />
        {list.data && !list.data.length ? <Empty>{own ? <>You have not sent a request yet. <Link to="/new">Book a room</Link>.</> : 'No requests yet.'}</Empty>
          : list.data && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="font-display text-xs uppercase tracking-wider text-ink-3 [&>th]:border-b [&>th]:border-rule-2 [&>th]:px-2.5 [&>th]:py-2 [&>th]:text-left [&>th]:font-semibold">
                    <th>Sent</th><th>Sessions</th>{!own && <th>Requester</th>}<th>People</th><th>Approvers</th><th>Ref</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.map((b) => (
                    <tr key={b.key} tabIndex={0} className="cursor-pointer hover:bg-paper [&>td]:border-b [&>td]:border-rule [&>td]:p-2.5"
                      onClick={() => navigate(`/requests/${b.key}`)} onKeyDown={(e) => e.key === 'Enter' && navigate(`/requests/${b.key}`)}>
                      <td className="text-ink-2">{ago(b.startDate, now)}</td>
                      <td>
                        {b.sessions.map((s, i) => (
                          <div key={i}><b>{venueName(s.venue)}</b> <span className="text-[13px] text-ink-2">{fmtDay(s.bookingDate)}, {s.startTime}–{s.endTime}</span></div>
                        ))}
                      </td>
                      {!own && <td>{b.requesterName}<br /><span className="text-[13px] text-ink-2">{b.email}</span></td>}
                      <td className="font-mono">{b.attendees}</td>
                      <td>{b.approvers.length ? b.approvers.map(roleName).join(' → ') : <span className="text-ink-2">–</span>}</td>
                      <td className="font-mono">{b.bookingRef || '–'}</td>
                      <td><Stamp status={b.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Panel>
    </>
  );
}
