import { api } from '../api.js';
import { esc, roomBoard, legend, fmtDay, today, hourOf, pad2, toast } from '../ui.js';

const HOURS = Array.from({ length: 11 }, (_, i) => `${pad2(8 + i)}:00`);

export default async function newBooking(el, ctx) {
  const options = (sel) => HOURS.map((h) => `<option${h === sel ? ' selected' : ''}>${h}</option>`).join('');
  el.innerHTML = `
    <section class="head">
      <div><div class="eyebrow">New booking</div><h1>Book a hall or lab</h1>
      <p>Pick a venue and a time. The request is checked automatically, held for you, and sent to the right approver.</p></div>
    </section>
    <div class="cols-main">
      <form class="panel form" id="f" novalidate>
        <fieldset class="field" style="border:0;padding:0;margin:0"><legend class="field-l"><span style="font-weight:600;font-size:14px">Venue</span></legend>
          <div class="venues">${ctx.meta.venues.map((v, i) => `
            <label class="venue"><input type="radio" name="venue" value="${v.id}"${i === 0 ? ' checked' : ''}>
              <b>${esc(v.name)}</b><span>up to ${v.capacity} people</span></label>`).join('')}</div>
          <span class="msg" data-for="venue"></span>
        </fieldset>
        <div class="row2">
          <label class="field"><span>Date</span><input type="date" name="bookingDate" required><span class="msg" data-for="bookingDate"></span></label>
          <label class="field"><span>Expected people</span><input type="number" name="attendees" min="1" inputmode="numeric" placeholder="e.g. 50"><span class="msg" data-for="attendees"></span></label>
        </div>
        <div class="row2">
          <label class="field"><span>Start time</span><select name="startTime">${options('10:00')}</select><span class="msg" data-for="startTime"></span></label>
          <label class="field"><span>End time</span><select name="endTime">${options('12:00')}</select><span class="msg" data-for="endTime"></span></label>
        </div>
        <div class="row2">
          <label class="field"><span>Your name</span><input name="requesterName" autocomplete="name" value="${esc(ctx.recall('hb-name'))}"><span class="msg" data-for="requesterName"></span></label>
          <label class="field"><span>Email</span><input type="email" name="email" autocomplete="email" value="${esc(ctx.recall('hb-email'))}" placeholder="name@college.edu"><span class="msg" data-for="email"></span></label>
        </div>
        <label class="field"><span>Purpose</span><textarea name="purpose" placeholder="e.g. Guest lecture on cloud computing"></textarea></label>
        <div><button class="btn primary" id="send" type="submit">Send request</button></div>
      </form>
      <aside class="panel" style="display:grid;gap:14px">
        <div><div class="eyebrow">That day</div><h2 id="dayname">Choose a date</h2></div>
        <div id="board" class="compact"><div class="empty">Choose a date to see what is already booked.</div></div>
        <div id="legend" hidden>${legend(true)}</div>
        <div><div class="eyebrow" style="margin-bottom:8px">Before you send</div><ul class="checks" id="checks"></ul></div>
      </aside>
    </div>`;

  const f = el.querySelector('#f');
  const boardEl = el.querySelector('#board');
  let dayBookings = [];
  let loadedDay = null;

  const values = () => {
    const d = Object.fromEntries(new FormData(f));
    return { ...d, attendees: d.attendees === '' ? '' : Number(d.attendees) };
  };

  async function update() {
    const v = values();
    if (v.bookingDate && v.bookingDate !== loadedDay) {
      loadedDay = v.bookingDate;
      try { dayBookings = await api(`/calendar?from=${v.bookingDate}&to=${v.bookingDate}`); } catch { dayBookings = []; }
    }
    const from = hourOf(v.startTime), to = hourOf(v.endTime);
    const venue = ctx.meta.venues.find((x) => x.id === v.venue);
    const clashes = dayBookings.filter((b) => b.hall === v.venue && b.startHour < to && b.endHour > from);

    const warn = [];
    if (to <= from) warn.push('The end time must be after the start time. The request will be rejected.');
    if (v.bookingDate && v.bookingDate < today()) warn.push(`${fmtDay(v.bookingDate)} has passed. The request will be rejected.`);
    if (venue && v.attendees > venue.capacity) warn.push(`${venue.name} holds up to ${venue.capacity} people. The request will be rejected.`);
    for (const c of clashes) warn.push(`Overlaps ${c.requester}'s booking (${pad2(c.startHour)}:00–${pad2(c.endHour)}:00). The request will be rejected as a clash.`);
    el.querySelector('#checks').innerHTML = warn.length
      ? warn.map((w) => `<li class="warn">${esc(w)}</li>`).join('')
      : `<li>No problems found. A decision table picks the approver after you send it.</li>`;

    if (v.bookingDate) {
      el.querySelector('#dayname').textContent = fmtDay(v.bookingDate, { weekday: 'long' });
      boardEl.innerHTML = roomBoard(ctx.meta.venues, dayBookings, to > from ? { venue: v.venue, from, to, clash: clashes.length > 0 } : null);
      el.querySelector('#legend').hidden = false;
    }
  }

  f.addEventListener('input', update);
  f.addEventListener('change', update);
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    f.querySelectorAll('.msg').forEach((m) => { m.textContent = ''; });
    const v = values();
    const btn = el.querySelector('#send');
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const { key } = await api('/bookings', { method: 'POST', body: v });
      ctx.remember('hb-name', v.requesterName);
      ctx.remember('hb-email', v.email);
      toast('Request sent');
      ctx.go(`#/requests/${key}`);
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Send request';
      if (e.fields) {
        for (const [k, msg] of Object.entries(e.fields)) { const m = f.querySelector(`.msg[data-for="${k}"]`); if (m) m.textContent = msg; }
        toast('Some fields need attention', 'bad');
      } else toast(e.message, 'bad');
    }
  });
  update();
  return null;
}
