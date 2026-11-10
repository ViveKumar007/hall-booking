import { pad2 } from '../lib/format.js';

const AXIS = Array.from({ length: 10 }, (_, i) => `${pad2(8 + i)}:00`);

function Block({ from, to, className, title, children }) {
  const a = Math.max(8, Math.min(18, from));
  const b = Math.max(8, Math.min(18, to));
  if (b <= a) return null;
  return (
    <div className={`slot ${className}`} style={{ gridColumn: `${a - 7} / ${b - 7}` }} title={title}>
      {children}
    </div>
  );
}

/**
 * The room board: one row per venue, 08:00-18:00, booked slots as blocks.
 * `proposed` = sessions being typed into the booking form: [{venue, from, to, clash, label}].
 */
export function RoomBoard({ venues, bookings, proposed = [], compact = false }) {
  return (
    <div className="overflow-x-auto">
      <div className={`grid gap-y-2 ${compact ? 'grid-cols-[96px_minmax(0,1fr)]' : 'min-w-[680px] grid-cols-[170px_1fr]'}`}>
        <div className="col-start-2 grid grid-cols-10 font-mono text-xs text-ink-3">
          {AXIS.map((h, i) => (
            <span key={h} className={`${i === 0 ? '' : '-translate-x-1/2'} ${compact && i % 2 ? 'invisible' : ''}`}>{h}</span>
          ))}
        </div>
        {venues.map((v) => (
          <div key={v.id} className="contents">
            <div className="grid content-center pr-3">
              <b className={`font-display font-semibold ${compact ? 'text-sm' : 'text-[15px]'}`}>{v.name}</b>
              {!compact && <small className="text-xs text-ink-3">up to {v.capacity} people</small>}
            </div>
            <div className={`track ${compact ? 'min-h-10' : ''}`}>
              {bookings.filter((b) => b.hall === v.id).map((b) => (
                <Block key={`b${b.id}`} from={b.startHour} to={b.endHour} className={b.status === 'CONFIRMED' ? 'slot-confirmed' : 'slot-pending'}
                  title={`${b.requester}, ${pad2(b.startHour)}:00–${pad2(b.endHour)}:00, ${String(b.status).toLowerCase()}`}>
                  <b>{b.requester}</b><span>{pad2(b.startHour)}–{pad2(b.endHour)}</span>
                </Block>
              ))}
              {proposed.filter((p) => p.venue === v.id).map((p, i) => (
                <Block key={`p${i}`} from={p.from} to={p.to} className={`slot-proposed ${p.clash ? 'slot-clash' : ''}`} title={p.title || p.label}>
                  <b>{p.label}</b><span>{pad2(p.from)}–{pad2(p.to)}</span>
                </Block>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Legend({ withProposed = false }) {
  return (
    <div className="mt-3 flex flex-wrap gap-4 text-[12.5px] text-ink-2">
      <span><i className="swatch border-ok bg-ok-soft" />Confirmed</span>
      <span><i className="swatch slot-pending" />Held, waiting for approval</span>
      {withProposed && <span><i className="swatch border-2 border-dashed border-accent" />Your sessions</span>}
    </div>
  );
}
