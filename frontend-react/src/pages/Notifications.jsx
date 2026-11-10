import { api } from '../api.js';
import { Empty, ErrorBox, PageHead, Panel } from '../components/ui.jsx';
import { usePoll, useNow } from '../lib/hooks.js';
import { ago } from '../lib/format.js';

const TONE = { APPROVED: 'ok', REJECTED: 'bad', SERVICE_UNAVAILABLE: 'bad', EXPIRED: 'idle', REMINDER: 'live' };

/** Requester notices (sent by the Email connector, recorded by the job worker) and the reminders to approvers. */
export default function Notifications() {
  const { data: items, error } = usePoll(() => api('/notifications'), 5000);
  const now = useNow(15000);

  return (
    <>
      <PageHead eyebrow="Notifications" title="Emails and reminders">
        Every finished request emails the requester through the Email connector; the Spring Boot job worker records it here,
        together with the 1-minute reminders to approvers. Read the delivered emails in
        the <a href="http://localhost:1080" target="_blank" rel="noopener noreferrer">mail inbox (MailDev) ↗</a>.
      </PageHead>
      <Panel>
        <ErrorBox error={!items && error} />
        {items && !items.length && <Empty>No emails yet. They appear when a request finishes.</Empty>}
        {items?.length > 0 && (
          <ul className="m-0 grid list-none divide-y divide-rule p-0">
            {items.map((n) => {
              const outcome = n.kind === 'REMINDER' ? 'REMINDER' : String(n.subject || '').replace('Hall booking ', '');
              return (
                <li key={n.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 py-2.5">
                  <span className={`stamp tone-${TONE[outcome] || 'warn'}`}>{outcome.replace(/_/g, ' ')}</span>
                  <span>
                    <span className="font-semibold">{n.to}</span>
                    {n.bookingRef && <span className="ml-1.5 font-mono text-[13px] text-ink-2">{n.bookingRef}</span>}
                    {n.emailStatus === 'FAILED' && <span className="ml-1.5 rounded-full bg-warn-soft px-2 py-px text-xs font-semibold text-warn">email not delivered</span>}
                    <br /><span className="whitespace-pre-line text-[13px] text-ink-2">{n.message}</span>
                  </span>
                  <span className="text-[13px] text-ink-2">{ago(n.sentAt, now)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </>
  );
}
