import { api } from '../api.js';
import { esc, fmtDay, timeLeft, every, toast, errorBox } from '../ui.js';

export default async function inbox(el, ctx) {
  if (ctx.kind === 'requester') {
    el.innerHTML = `<section class="head"><div><div class="eyebrow">Inbox</div><h1>Approver inbox</h1>
      <p>Switch <b>Viewing as</b> to an approver (for example Dean) to see the bookings waiting for that role.</p></div></section>`;
    return null;
  }
  const role = ctx.kind === 'approver' ? ctx.role : 'all';
  el.innerHTML = `
    <section class="head"><div><div class="eyebrow">Inbox</div>
      <h1>${role === 'all' ? 'All bookings waiting for approval' : `Waiting for ${esc(ctx.roleName(role))}`}</h1>
      <p>Approve or reject each request. A reminder goes out after 1 minute; after 2 minutes the request expires and the slot is released.</p></div>
    </section>
    <div class="cards" id="cards"></div>`;
  const box = el.querySelector('#cards');
  const shown = new Map(); // task key -> card element

  function card(t) {
    const a = document.createElement('article');
    a.className = 'card';
    a.dataset.key = t.key;
    a.dataset.due = t.due;
    a.dataset.created = t.created;
    a.innerHTML = `
      <div>
        <div class="eyebrow">${esc(t.bookingRef || '')}${role === 'all' ? ` · for ${esc(ctx.roleName(t.approver))}` : ''}</div>
        <h3>${esc(ctx.venueName(t.venue))} · ${esc(fmtDay(t.bookingDate))} · ${esc(t.startTime)}–${esc(t.endTime)}</h3>
        <div class="who">${esc(t.requesterName)} · ${esc(t.email)} · <b>${esc(t.attendees)}</b> people</div>
        ${t.purpose ? `<p class="small muted" style="margin:6px 0 0">${esc(t.purpose)}</p>` : ''}
        ${t.bookingKey ? `<p class="small" style="margin:6px 0 0"><a href="#/requests/${t.bookingKey}">Follow this request</a></p>` : ''}
      </div>
      <div class="clock">
        <span class="eyebrow">Expires in</span>
        <span class="left" data-left>${timeLeft(t.due)}</span>
        <div class="bar-track"><div class="bar-fill" data-fill></div></div>
        <span class="badge" data-reminder ${t.reminderSent ? '' : 'hidden'}>Reminder sent</span>
      </div>
      <div class="actions">
        <label class="field"><span>Remarks</span><input data-remarks placeholder="Optional. Included in the email if you reject."></label>
        <button class="btn bad" data-act="reject">Reject</button>
        <button class="btn ok" data-act="approve">Approve</button>
      </div>`;
    a.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('button[data-act]');
      if (!btn) return;
      const approved = btn.dataset.act === 'approve';
      a.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      try {
        await api(`/tasks/${t.key}/decision`, { method: 'POST', body: { approved, remarks: a.querySelector('[data-remarks]').value } });
        toast(approved ? `Approved ${t.bookingRef || ''}` : `Rejected ${t.bookingRef || ''}`);
        a.innerHTML = `<div class="small" style="grid-column:1/-1">${approved ? 'Approved' : 'Rejected'}. The booking desk confirms or releases the slot and emails ${esc(t.requesterName)}.
          ${t.bookingKey ? `<a href="#/requests/${t.bookingKey}">See the request</a>` : ''}</div>`;
        a.dataset.done = '1';
      } catch (e) {
        a.querySelectorAll('button').forEach((b) => { b.disabled = false; });
        toast(e.status === 404 || e.status === 409 ? 'This request has already expired or been decided.' : e.message, 'bad');
      }
    });
    return a;
  }

  function tick() {
    for (const a of shown.values()) {
      if (a.dataset.done) continue;
      const left = a.querySelector('[data-left]');
      const fill = a.querySelector('[data-fill]');
      const total = new Date(a.dataset.due) - new Date(a.dataset.created);
      const remaining = Math.max(0, new Date(a.dataset.due) - Date.now());
      left.textContent = timeLeft(a.dataset.due);
      fill.style.width = `${(remaining / total) * 100}%`;
      fill.classList.toggle('late', remaining < 60000);
    }
  }

  async function load() {
    const tasks = await api(`/tasks?kind=approval&role=${role}`);
    const keys = new Set(tasks.map((t) => t.key));
    for (const [k, a] of shown) if (!keys.has(k) && !a.dataset.done) { a.remove(); shown.delete(k); }
    for (const [k, a] of shown) if (a.dataset.done && !keys.has(k) && Date.now() - (a._doneSeen ||= Date.now()) > 6000) { a.remove(); shown.delete(k); }
    for (const t of tasks) {
      if (!shown.has(t.key)) { const a = card(t); shown.set(t.key, a); box.append(a); }
      else if (t.reminderSent) shown.get(t.key).querySelector('[data-reminder]')?.removeAttribute('hidden');
    }
    if (!shown.size) box.innerHTML = `<div class="empty">Nothing is waiting${role === 'all' ? '' : ` for ${esc(ctx.roleName(role))}`}. New requests appear here automatically.</div>`;
    else box.querySelector('.empty')?.remove();
    tick();
  }

  try { await load(); } catch (e) { box.innerHTML = errorBox(e); }
  const clock = setInterval(tick, 1000);
  const stop = every(3000, load);
  return () => { clearInterval(clock); stop(); };
}
