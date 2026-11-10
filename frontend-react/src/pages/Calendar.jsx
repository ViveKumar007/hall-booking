import { useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context/AppContext.jsx';
import { ErrorBox, PageHead, Panel } from '../components/ui.jsx';
import { Legend } from '../components/RoomBoard.jsx';
import { usePoll } from '../lib/hooks.js';
import { addDays, fmtDay, pad2, today, weekStart } from '../lib/format.js';

/** A week at a glance for every venue: confirmed and held slots from the booking register. */
export default function Calendar() {
  const { meta } = useApp();
  const [start, setStart] = useState(null);
  const { data: all = [], error } = usePoll(() => api('/calendar'), 5000);

  const nextBookedWeek = weekStart(all.map((b) => b.day).filter((d) => d >= today()).sort()[0] || today());
  const from = start || nextBookedWeek;
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const cell = 'grid min-h-[74px] content-start gap-1.5 border-b border-r border-rule p-2';

  return (
    <>
      <PageHead eyebrow="Calendar" title={`Week of ${fmtDay(from, { weekday: undefined })}`}
        actions={(
          <>
            <button className="btn btn-sm" aria-label="Previous week" onClick={() => setStart(addDays(from, -7))}>‹</button>
            <button className="btn btn-sm" onClick={() => setStart(nextBookedWeek)}>Next booked week</button>
            <button className="btn btn-sm" aria-label="Next week" onClick={() => setStart(addDays(from, 7))}>›</button>
          </>
        )}>
        A week at a glance for every venue.
      </PageHead>
      <Panel>
        <ErrorBox error={error} />
        <div className="overflow-x-auto">
          <div className="grid min-w-[760px] grid-cols-[150px_repeat(7,minmax(0,1fr))] overflow-hidden rounded-lg border border-rule bg-card">
            <div className={`${cell} min-h-0 bg-lane-desk`} />
            {days.map((d) => (
              <div key={d} className={`${cell} min-h-0 bg-lane-desk font-display text-[13px] font-semibold uppercase tracking-wide ${d === today() ? 'text-accent' : 'text-ink-2'}`}>
                {fmtDay(d, { year: undefined })}
              </div>
            ))}
            {meta.venues.map((v) => (
              <div key={v.id} className="contents">
                <div className={cell}><b className="font-display text-[15px] font-semibold">{v.name}</b><small className="text-ink-3">up to {v.capacity}</small></div>
                {days.map((d) => (
                  <div key={d} className={cell}>
                    {all.filter((b) => b.hall === v.id && b.day === d).sort((a, b) => a.startHour - b.startHour).map((b) => (
                      <div key={b.id} className={`slot m-0 min-h-0 px-1.5 py-1 ${b.status === 'CONFIRMED' ? 'slot-confirmed' : 'slot-pending'}`} title={b.requester}>
                        <b>{pad2(b.startHour)}–{pad2(b.endHour)}</b><span className="overflow-hidden text-ellipsis">{b.requester}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        <Legend />
      </Panel>
    </>
  );
}
