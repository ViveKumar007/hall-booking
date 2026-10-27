import { api } from '../api.js';
import { esc, roomBoard, legend, stamp, fmtDay, today, addDays, ago, timeLeft, every, errorBox } from '../ui.js';

export default async function dashboard(el, ctx) {
  let day = null;
  const isRequester = ctx.kind === 'requester';
  el.innerHTML = `
    <section class="head">
      <div>
        <div class="eyebrow">Room board</div>
        <h1 id="title">&nbsp;</h1>
        <p>Who has each hall and lab, hour by hour. Held slots are waiting for an approver.</p>
      </div>
      <div class="datenav">
        <button class="btn small" id="prev" aria-label="Previous day">‹</button>
        <button class="btn small" id="next-booked">Next booked day</button>
        <button class="btn small" id="next" aria-label="Next day">›</button>
        ${isRequester ? '<a class="btn primary" href="#/new">Book a room</a>' : ''}
      </div>
    </section>
    <section class="panel"><div id="board"></div><div style="margin-top:12px">${legend()}</div></section>
    <section class="cols">
      <div class="panel"><h2>Waiting for approval <span class="muted" id="wcount"></span></h2><div id="waiting"></div></div>
      <div class="panel"><h2>${isRequester && ctx.recall('hb-email') ? 'Your latest requests' : 'Latest requests'}</h2><div id="latest"></div></div>
    </section>`;
  const $ = (id) => el.querySelector('#' + id);

  let all = [];
  async function loadBoard() {
    all = await api('/calendar');
    if (!day) day = nextBookedDay(all) || today();
    $('title').textContent = fmtDay(day, { weekday: 'long' });
    $('board').innerHTML = roomBoard(ctx.meta.venues, all.filter((b) => b.day === day));
  }
  const nextBookedDay = (list) => list.map((b) => b.day).filter((d) => d >= today()).sort()[0];

  async function loadLists() {
    const role = ctx.kind === 'approver' ? ctx.role : 'all';
    const email = isRequester ? ctx.recall('hb-email') : '';
    const [tasks, latest] = await Promise.all([
      api(`/tasks?kind=approval&role=${role}`),
      api(`/bookings?limit=6${email ? `&email=${encodeURIComponent(email)}` : ''}`),
    ]);
    $('wcount').textContent = tasks.length ? `${tasks.length}` : '';
    $('waiting').innerHTML = tasks.length ? `<ul class="list">${tasks.map((t) => `
      <li><a class="item" href="${ctx.kind === 'requester' ? (t.bookingKey ? `#/requests/${t.bookingKey}` : '#/requests') : '#/inbox'}">
        <span><span class="t">${esc(ctx.venueName(t.venue))} · ${esc(t.startTime)}–${esc(t.endTime)}</span><br>
        <span class="s">${esc(t.requesterName)} · ${esc(fmtDay(t.bookingDate))} · for ${esc(ctx.roleName(t.approver))}</span></span>
        <span class="mono" title="Time left before it expires">${timeLeft(t.due)}</span></a></li>`).join('')}</ul>`
      : `<div class="empty">Nothing is waiting${ctx.kind === 'approver' ? ` for ${esc(ctx.roleName(ctx.role))}` : ''}.</div>`;
    $('latest').innerHTML = latest.length ? `<ul class="list">${latest.map((b) => `
      <li><a class="item" href="#/requests/${b.key}">
        <span><span class="t">${esc(ctx.venueName(b.venue))} · ${esc(fmtDay(b.bookingDate))}, ${esc(b.startTime)}–${esc(b.endTime)}</span><br>
        <span class="s">${esc(b.requesterName)} · ${ago(b.startDate)}</span></span>
        ${stamp(b.status)}</a></li>`).join('')}</ul>`
      : `<div class="empty">No requests yet. ${isRequester ? '<a href="#/new">Book a room</a>.' : ''}</div>`;
  }

  $('prev').onclick = () => { day = addDays(day, -1); loadBoard(); };
  $('next').onclick = () => { day = addDays(day, 1); loadBoard(); };
  $('next-booked').onclick = () => { day = nextBookedDay(all) || today(); loadBoard(); };

  try { await Promise.all([loadBoard(), loadLists()]); } catch (e) { $('board').innerHTML = errorBox(e); }
  return every(4000, () => Promise.all([loadBoard(), loadLists()]));
}
