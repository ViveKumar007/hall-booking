import { api } from '../api.js';
import { esc, stamp, fmtDay, ago, every, errorBox } from '../ui.js';

export default async function requests(el, ctx) {
  const own = ctx.kind === 'requester';
  let email = own ? ctx.recall('hb-email') : '';
  el.innerHTML = `
    <section class="head">
      <div><div class="eyebrow">${own ? 'My requests' : 'All requests'}</div>
      <h1>${own ? 'Your booking requests' : 'Booking requests'}</h1>
      <p>${own ? 'Every request you sent, newest first. Open one to follow it step by step.' : 'The latest requests from everyone, newest first.'}</p></div>
      ${own ? '<a class="btn primary" href="#/new">Book a room</a>' : ''}
    </section>
    ${own ? `<form class="panel" id="who" style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">
      <label class="field" style="flex:1;min-width:240px"><span>Your email</span><input type="email" name="email" value="${esc(email)}" placeholder="name@college.edu"></label>
      <button class="btn">Show my requests</button></form>` : ''}
    <section class="panel"><div id="list"></div></section>`;
  const list = el.querySelector('#list');

  async function load() {
    if (own && !email) { list.innerHTML = '<div class="empty">Enter your email to see your requests.</div>'; return; }
    const rows = await api(`/bookings?limit=40${own ? `&email=${encodeURIComponent(email)}` : ''}`);
    list.innerHTML = rows.length ? `<div class="table-wrap"><table class="table">
      <thead><tr><th>Sent</th><th>Venue and time</th>${own ? '' : '<th>Requester</th>'}<th>People</th><th>Approver</th><th>Ref</th><th>Status</th></tr></thead>
      <tbody>${rows.map((b) => `<tr class="link" data-key="${b.key}" tabindex="0">
        <td class="muted">${ago(b.startDate)}</td>
        <td><b>${esc(ctx.venueName(b.venue))}</b><br><span class="muted small">${esc(fmtDay(b.bookingDate))}, ${esc(b.startTime)}–${esc(b.endTime)}</span></td>
        ${own ? '' : `<td>${esc(b.requesterName)}<br><span class="muted small">${esc(b.email)}</span></td>`}
        <td class="mono">${esc(b.attendees)}</td>
        <td>${esc(ctx.roleName(b.approver)) || '<span class="muted">–</span>'}</td>
        <td class="mono">${esc(b.bookingRef || '–')}</td>
        <td>${stamp(b.status)}</td></tr>`).join('')}</tbody></table></div>`
      : `<div class="empty">${own ? `No requests for ${esc(email)} yet. <a href="#/new">Book a room</a>.` : 'No requests yet.'}</div>`;
  }

  list.addEventListener('click', (ev) => { const tr = ev.target.closest('tr[data-key]'); if (tr) ctx.go(`#/requests/${tr.dataset.key}`); });
  list.addEventListener('keydown', (ev) => { const tr = ev.target.closest('tr[data-key]'); if (tr && ev.key === 'Enter') ctx.go(`#/requests/${tr.dataset.key}`); });
  el.querySelector('#who')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    email = new FormData(ev.target).get('email').trim();
    ctx.remember('hb-email', email);
    load().catch((e) => { list.innerHTML = errorBox(e); });
  });

  try { await load(); } catch (e) { list.innerHTML = errorBox(e); }
  return every(4000, load);
}
