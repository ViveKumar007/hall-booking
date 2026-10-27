import { api } from '../api.js';
import { esc, fmtDay, ago, every, toast, errorBox } from '../ui.js';

export default async function issues(el, ctx) {
  el.innerHTML = `
    <section class="head"><div><div class="eyebrow">Service issues</div><h1>Bookings stuck on the booking service</h1>
      <p>These requests could not read the booking register. Start the booking service (start-mock.cmd), then retry. Cancel ends the request and emails the requester.</p></div>
    </section>
    <div id="svc"></div>
    <div class="cards" id="cards"></div>`;
  const box = el.querySelector('#cards');

  async function load() {
    const [tasks, health] = await Promise.all([api('/tasks?kind=service'), api('/health')]);
    el.querySelector('#svc').innerHTML = tasks.length && !health.bookings
      ? '<div class="error">The booking service is still down. A retry now would fail again.</div>' : '';
    const busy = box.querySelector('button:disabled');
    if (busy) return;
    box.innerHTML = tasks.length ? tasks.map((t) => `
      <article class="card" data-key="${t.key}">
        <div>
          <div class="eyebrow">Waiting since ${esc(ago(t.created))}</div>
          <h3>${esc(ctx.venueName(t.venue))} · ${esc(fmtDay(t.bookingDate))} · ${esc(t.startTime)}–${esc(t.endTime)}</h3>
          <div class="who">${esc(t.requesterName)} · ${esc(t.email)} · ${esc(t.attendees)} people</div>
          <p class="small" style="margin:6px 0 0"><a href="#/requests/${t.bookingKey}">Follow this request</a></p>
        </div>
        <div><span class="eyebrow">Error</span><p class="small" style="margin:4px 0 0">${esc(t.serviceError || 'Booking service unreachable')}</p></div>
        <div class="actions" style="grid-template-columns:1fr auto auto">
          <span></span>
          <button class="btn bad" data-act="CANCEL">Cancel booking</button>
          <button class="btn primary" data-act="RETRY">Retry now</button>
        </div>
      </article>`).join('')
      : '<div class="empty">No service issues. Every request reached the booking register.</div>';
  }

  box.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-act]');
    if (!btn) return;
    const article = btn.closest('article');
    article.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try {
      await api(`/tasks/${article.dataset.key}/service-action`, { method: 'POST', body: { action: btn.dataset.act } });
      toast(btn.dataset.act === 'RETRY' ? 'Retrying: the request continues' : 'Booking cancelled; the requester is emailed');
      article.remove();
      if (!box.children.length) box.innerHTML = '<div class="empty">No service issues.</div>';
    } catch (e) {
      article.querySelectorAll('button').forEach((b) => { b.disabled = false; });
      toast(e.message, 'bad');
    }
  });

  try { await load(); } catch (e) { box.innerHTML = errorBox(e); }
  return every(3000, load);
}
