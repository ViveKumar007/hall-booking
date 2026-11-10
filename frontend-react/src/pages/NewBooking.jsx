import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../context/AppContext.jsx';
import { Field, PageHead, Panel } from '../components/ui.jsx';
import { Legend, RoomBoard } from '../components/RoomBoard.jsx';
import { usePoll } from '../lib/hooks.js';
import { HOURS, addDays, fmtDay, hourOf, pad2, plural, today } from '../lib/format.js';

const MAX_SESSIONS = 10;

/**
 * New booking. The session list is the dynamic array builder: each row becomes one item of the `sessions` start
 * variable, which the BPMN processes with parallel multi-instance (check, decide approver, hold, confirm/release).
 */
export default function NewBooking() {
  const { meta, venue, venueName, toast, user } = useApp();
  const navigate = useNavigate();
  const [attendees, setAttendees] = useState('');
  const [purpose, setPurpose] = useState('');
  const nextId = useRef(2);
  const [sessions, setSessions] = useState([{ id: 1, venue: 'hall-a', bookingDate: '', startTime: '10:00', endTime: '12:00' }]);
  const [focus, setFocus] = useState(1);
  const [errors, setErrors] = useState({});
  const [sending, setSending] = useState(false);

  // Existing bookings on every date the sessions use, for the clash preview.
  const dates = useMemo(() => [...new Set(sessions.map((s) => s.bookingDate).filter(Boolean))].sort(), [sessions]);
  const range = dates.length ? `from=${dates[0]}&to=${dates[dates.length - 1]}` : null;
  const { data: booked = [] } = usePoll(() => (range ? api(`/calendar?${range}`) : []), 10000, [range]);

  const people = attendees === '' ? null : Number(attendees);

  const checks = useMemo(() => sessions.map((s, i) => {
    const from = hourOf(s.startTime), to = hourOf(s.endTime);
    const v = venue(s.venue);
    const warn = [];
    if (to <= from) warn.push('The end time must be after the start time.');
    if (s.bookingDate && s.bookingDate < today()) warn.push(`${fmtDay(s.bookingDate)} has passed.`);
    if (v && people > v.capacity) warn.push(`${v.name} holds up to ${v.capacity} people.`);
    for (const b of booked) {
      if (b.hall === s.venue && b.day === s.bookingDate && b.startHour < to && b.endHour > from) {
        warn.push(`Overlaps ${b.requester}'s booking (${pad2(b.startHour)}:00–${pad2(b.endHour)}:00).`);
      }
    }
    sessions.forEach((o, j) => {
      if (j < i && o.venue === s.venue && o.bookingDate === s.bookingDate && s.bookingDate
        && hourOf(o.startTime) < to && hourOf(o.endTime) > from) warn.push(`Overlaps session ${j + 1} of this request.`);
    });
    return { from, to, warn, clash: warn.some((w) => w.startsWith('Overlaps')) };
  }), [sessions, booked, people, venue]);

  const update = (id, patch) => setSessions((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  // A new session copies the last one, one day later (the usual "same room, next day" for a workshop).
  const add = () => {
    const last = sessions[sessions.length - 1];
    const id = nextId.current++;
    setSessions([...sessions, { ...last, id, bookingDate: last.bookingDate ? addDays(last.bookingDate, 1) : '' }]);
    setFocus(id);
  };
  const remove = (id) => {
    const rest = sessions.filter((s) => s.id !== id);
    setSessions(rest);
    if (focus === id) setFocus(rest[0].id);
  };

  // Form checks before sending (the business rules are the worker's: warnings above do not block sending).
  function validate() {
    const e = {};
    if (!Number.isInteger(people) || people < 1) e.attendees = 'Enter the number of people (at least 1).';
    sessions.forEach((s, i) => {
      const k = (f) => (i === 0 ? f : `sessions.${i}.${f}`);
      if (!s.venue) e[k('venue')] = 'Choose a venue.';
      if (!s.bookingDate) e[k('bookingDate')] = 'Choose a date.';
    });
    return e;
  }

  async function submit(ev) {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      toast('Some fields need attention', 'bad');
      return;
    }
    setSending(true);
    try {
      const body = {
        attendees: people, purpose: purpose.trim(),
        sessions: sessions.map(({ venue: v, bookingDate, startTime, endTime }) => ({ venue: v, bookingDate, startTime, endTime })),
      };
      const { key } = await api('/bookings', { method: 'POST', body });
      toast(`Request sent: ${plural(sessions.length, 'session')}`);
      navigate(`/requests/${key}`);
    } catch (err) {
      setSending(false);
      if (err.fields) {
        setErrors(err.fields);
        toast('Some fields need attention', 'bad');
      } else toast(err.message, 'bad');
    }
  }

  const focused = sessions.find((s) => s.id === focus) || sessions[0];
  const focusDay = focused.bookingDate;
  const proposed = focusDay ? sessions.map((s, i) => ({ s, c: checks[i], i }))
    .filter(({ s, c }) => s.bookingDate === focusDay && c.to > c.from)
    .map(({ s, c, i }) => ({ venue: s.venue, from: c.from, to: c.to, clash: c.clash, label: `#${i + 1}`, title: `Session ${i + 1}` })) : [];
  const allWarnings = checks.flatMap((c, i) => c.warn.map((w) => (sessions.length > 1 ? `Session ${i + 1}: ${w}` : w)));
  const err = (k) => errors[k];

  return (
    <>
      <PageHead eyebrow="New booking" title="Book a hall or lab">
        Add one session per day and room you need, for example a three-day workshop. Every session is checked for clashes,
        held for you, and each approver they need is asked in turn.
      </PageHead>

      <div className="grid items-start gap-[22px] lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)]">
        <form className="panel grid gap-4" onSubmit={submit} noValidate>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <div className="grid content-start gap-1">
              <span className="text-sm font-semibold">Requested by</span>
              <span className="rounded-md border border-rule bg-paper px-2.5 py-2">
                {user.name || user.email}<br /><span className="text-[13px] text-ink-2">{user.email}</span>
              </span>
              <span className="text-[13px] text-ink-3">Your Google account. Updates and the decision are emailed here.</span>
            </div>
            <Field label="Expected people" error={err('attendees')} hint="The same group attends every session.">
              <input type="number" min="1" inputMode="numeric" value={attendees} onChange={(e) => setAttendees(e.target.value)} placeholder="e.g. 50" aria-invalid={!!err('attendees')} />
            </Field>
          </div>

          <fieldset className="grid gap-3 border-0 p-0">
            <legend className="mb-2 flex w-full items-baseline justify-between">
              <span className="text-sm font-semibold">Sessions <span className="font-normal text-ink-3">({sessions.length} of {MAX_SESSIONS})</span></span>
            </legend>
            {sessions.map((s, i) => (
              <SessionRow key={s.id} index={i} session={s} check={checks[i]} venues={meta.venues} focused={s.id === focus}
                canRemove={sessions.length > 1} errors={errors} onFocus={() => setFocus(s.id)}
                onChange={(patch) => update(s.id, patch)} onRemove={() => remove(s.id)} />
            ))}
            {err('sessions') && <span className="text-[13px] text-bad">{err('sessions')}</span>}
            <div>
              <button type="button" className="btn btn-sm" onClick={add} disabled={sessions.length >= MAX_SESSIONS}>+ Add session</button>
            </div>
          </fieldset>

          <Field label="Purpose">
            <textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Three-day workshop on cloud computing" />
          </Field>
          <div className="flex items-center gap-3">
            <button className="btn btn-primary" type="submit" disabled={sending}>{sending ? 'Sending…' : `Send request (${plural(sessions.length, 'session')})`}</button>
            {allWarnings.length > 0 && <span className="text-[13px] text-warn">{plural(allWarnings.length, 'warning')}: the workflow will reject this request.</span>}
          </div>
        </form>

        <aside className="panel grid gap-3.5 lg:sticky lg:top-20">
          <div>
            <div className="eyebrow">That day</div>
            <h2>{focusDay ? fmtDay(focusDay, { weekday: 'long' }) : 'Choose a date'}</h2>
          </div>
          {focusDay ? (
            <>
              <RoomBoard compact venues={meta.venues} bookings={booked.filter((b) => b.day === focusDay)} proposed={proposed} />
              <Legend withProposed />
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-rule-2 p-4 text-center text-ink-2">Pick a date to see what is already booked.</div>
          )}
          <div>
            <div className="eyebrow mb-2">Before you send</div>
            <ul className="m-0 grid list-none gap-2 p-0">
              {allWarnings.length ? allWarnings.map((w) => (
                <li key={w} className="rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">{w}</li>
              )) : (
                <li className="rounded-md bg-ok-soft px-3 py-2 text-sm text-ok">
                  No problems found. A decision table picks an approver for each session ({sessions.map((s) => venueName(s.venue)).filter((v, i, a) => a.indexOf(v) === i).join(', ')}).
                </li>
              )}
            </ul>
          </div>
        </aside>
      </div>
    </>
  );
}

function SessionRow({ index, session: s, check, venues, focused, canRemove, errors, onFocus, onChange, onRemove }) {
  const k = (f) => (index === 0 ? f : `sessions.${index}.${f}`);
  return (
    <div onFocus={onFocus} onClick={onFocus}
      className={`grid gap-3 rounded-lg border p-3 ${focused ? 'border-accent bg-accent-soft/40' : 'border-rule'} ${check.warn.length ? 'border-l-4 border-l-warn' : ''}`}>
      <div className="flex items-center justify-between">
        <span className="eyebrow">Session {index + 1}</span>
        {canRemove && <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove} aria-label={`Remove session ${index + 1}`}>Remove</button>}
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,.7fr)_minmax(0,.7fr)]">
        <Field label="Venue" error={errors[k('venue')]}>
          <select value={s.venue} onChange={(e) => onChange({ venue: e.target.value })} aria-invalid={!!errors[k('venue')]}>
            {venues.map((v) => <option key={v.id} value={v.id}>{v.name} (up to {v.capacity})</option>)}
          </select>
        </Field>
        <Field label="Date" error={errors[k('bookingDate')]}>
          <input type="date" value={s.bookingDate} onChange={(e) => onChange({ bookingDate: e.target.value })} aria-invalid={!!errors[k('bookingDate')]} />
        </Field>
        <Field label="From" error={errors[k('startTime')]}>
          <select value={s.startTime} onChange={(e) => onChange({ startTime: e.target.value })}>{HOURS.map((h) => <option key={h}>{h}</option>)}</select>
        </Field>
        <Field label="To" error={errors[k('endTime')]}>
          <select value={s.endTime} onChange={(e) => onChange({ endTime: e.target.value })}>{HOURS.map((h) => <option key={h}>{h}</option>)}</select>
        </Field>
      </div>
      {check.warn.length > 0 && <div className="text-[13px] text-warn">{check.warn.join(' ')}</div>}
    </div>
  );
}
