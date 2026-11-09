import { api } from '../api.js';
import { esc, fmtDay, ago, every, toast, errorBox } from '../ui.js';

export default async function issues(el, ctx) {
  el.innerHTML = `
    <section class="head"><div><div class="eyebrow">Service issues</div><h1>Bookings stuck on the booking service</h1>
      <p>These requests could not read the booking register (it was down, or slower than 30 seconds). Retry once it is back. Cancel ends the request and emails the requester.</p></div>
      <div class="datenav" role="group" aria-label="Booking register (demo)">
        <span class="small muted">Booking register (demo):</span>
        <button class="btn small" data-mode="UP">Normal</button>
        <button class="btn small" data-mode="DOWN">Down</button>
        <button class="btn small" data-mode="SLOW">Slow (40 s)</button>
      </div>
    </section>
    <div id="svc"></div>
    <div class="cards" id="cards"></div>`;
  const box = el.querySelector('#cards');

  // Demo switch: DOWN makes the register answer 503 (error boundary), SLOW makes it wait 40 s (30 s timer boundary).
  const modeButtons = el.querySelectorAll('button[data-mode]');
  const showMode = (mode) => modeButtons.forEach((b) => b.classList.toggle('primary', b.dataset.mode === mode));
  modeButtons.forEach((b) => b.addEventListener('click', async () => {
    try {
      const r = await api('/demo/register-mode', { method: 'POST', body: { mode: b.dataset.mode } });
      showMode(r.mode);
      toast(r.mode === 'UP' ? 'Booking register back to normal' : `Booking register is now ${r.mode.toLowerCase()} (demo)`);
    } catch (e) { toast(e.message, 'bad'); }
  }));

  async function load() {
    const [tasks, health] = await Promise.all([api('/tasks?kind=service'), api('/health')]);
    showMode(health.registerMode);
    el.querySelector('#svc').innerHTML = tasks.length && !health.bookings
      ? '<div class="error">The booking register is still down. A retry now would fail again; switch it back to Normal first.</div>' : '';
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
