import { api } from '../api.js';
import { esc, stamp, fmtDay, fmtClock, timeLeft, every, errorBox } from '../ui.js';

export default async function request(el, ctx, key) {
  el.innerHTML = `<div class="empty">Loading the request…</div>`;
  let d = null;
  let stopClock = null;

  function draw() {
    const back = ctx.kind === 'requester' ? ['#/requests', 'My requests'] : ctx.kind === 'admin' ? ['#/requests', 'All requests'] : ['#/', 'Room board'];
    // One step per row, in the order things happened. A message's "sent" and "received" share a row so the arrow lines up.
    let row = 0;
    const steps = d.steps.map((s, i) => {
      const prev = d.steps[i - 1];
      const pairsWithPrev = s.message === 'in' && prev && prev.message === 'out' && prev.lane !== s.lane;
      if (!pairsWithPrev) row += 1;
      return `
      <li class="step ${s.lane} ${s.state.toLowerCase()}${s.message ? ` msg-${s.message}` : ''}" style="grid-row:${row}">
        <b>${esc(s.label)}</b><time>${esc(fmtClock(s.at))}</time>
        ${s.detail ? `<span class="d">${esc(s.detail)}</span>` : ''}
      </li>`;
    }).join('');
    const finaleRow = row + 1;
    const finished = d.state !== 'ACTIVE';

    el.innerHTML = `
      <a href="${back[0]}" class="small">← ${back[1]}</a>
      <section class="req-head panel">
        <div>
          <div class="eyebrow">Booking request${d.bookingRef ? ` · ${esc(d.bookingRef)}` : ''}</div>
          <h1>${esc(ctx.venueName(d.venue))}</h1>
          <div class="when">${esc(fmtDay(d.bookingDate, { weekday: 'long' }))} · ${esc(d.startTime)}–${esc(d.endTime)}</div>
        </div>
        <div>${stamp(d.status)}</div>
      </section>
      <div class="cols-main">
        <section class="panel">
          <h2>Route <span class="muted">${finished ? 'Finished' : 'Updates live'}</span></h2>
          <div class="slip">
            <div class="slip-bg" aria-hidden="true"><div class="d"></div><div class="a"></div></div>
            <div class="lanes"><div>Booking Desk</div><div class="admin">Hall Administration</div></div>
            <ol class="steps">${steps}${finished && d.status.code !== 'CANCELED' ? `<li class="finale" style="grid-row:${finaleRow}">${stamp(d.status, true)}</li>` : ''}</ol>
          </div>
        </section>
        <aside style="display:grid;gap:16px;align-content:start">
          ${d.review ? `<section class="panel clock" aria-live="polite">
            <div class="eyebrow">Waiting for ${esc(ctx.roleName(d.review.approver))}</div>
            <span class="left" id="left">${timeLeft(d.review.due)}</span>
            <div class="bar-track"><div class="bar-fill" id="fill"></div></div>
            <span class="small muted">${d.review.reminderSent ? 'Reminder sent to the approver.' : 'A reminder goes out after 1 minute.'} The request expires at ${esc(fmtClock(d.review.due))}.</span>
          </section>` : ''}
          ${d.status.code === 'User_FixService' ? `<section class="panel"><div class="eyebrow">Booking service down</div>
            <p class="small">${esc(d.serviceError || 'The booking register could not be read.')}</p>
            ${ctx.kind === 'admin' ? '<a class="btn primary small" href="#/issues">Resolve in Service issues</a>' : '<p class="small muted">An admin has been asked to retry or cancel.</p>'}</section>` : ''}
          <section class="panel">
            <h2>Request</h2>
            <dl class="facts">
              <dt>Requester</dt><dd>${esc(d.requesterName)}<br><span class="muted small">${esc(d.email)}</span></dd>
              <dt>People</dt><dd>${esc(d.attendees)}</dd>
              <dt>Purpose</dt><dd>${esc(d.purpose || '–')}</dd>
              <dt>Approver</dt><dd>${esc(ctx.roleName(d.approver)) || '<span class="muted">not chosen</span>'}</dd>
              ${d.remarks ? `<dt>Remarks</dt><dd>${esc(d.remarks)}</dd>` : ''}
              <dt>Request no.</dt><dd class="mono">${esc(d.key)}</dd>
            </dl>
            ${ctx.kind === 'admin' ? `<p style="margin:12px 0 0"><a class="small" href="${esc(d.operateUrl)}" target="_blank" rel="noopener">Open in Operate ↗</a></p>` : ''}
          </section>
          ${d.notification ? `<section class="panel"><h2>Email sent</h2>
            <div class="letter"><b>${esc(d.notification.subject)}</b>\nTo: ${esc(d.notification.to)}\n\n${esc(d.notification.message)}</div></section>` : ''}
        </aside>
      </div>`;
    tick();
  }

  function tick() {
    if (!d || !d.review) return;
    const left = el.querySelector('#left');
    const fill = el.querySelector('#fill');
    if (!left || !fill) return;
    const total = new Date(d.review.due) - new Date(d.review.since);
    const remaining = Math.max(0, new Date(d.review.due) - Date.now());
    left.textContent = timeLeft(d.review.due);
    fill.style.width = `${(remaining / total) * 100}%`;
    fill.classList.toggle('late', remaining < 60000);
  }

  async function load() {
    const next = await api(`/bookings/${key}`);
    const changed = !d || JSON.stringify(next) !== JSON.stringify(d);
    d = next;
    if (changed) draw();
  }

  // A request that was just sent takes a moment to show up in Camunda's search; wait for it instead of failing.
  for (let attempt = 0; ; attempt++) {
    try { await load(); break; } catch (e) {
      if (e.status !== 404 || attempt >= 20) { el.innerHTML = errorBox(e); return null; }
      el.innerHTML = '<div class="empty">Registering your request with the workflow…</div>';
      await new Promise((r) => setTimeout(r, 1000));
      if (!el.isConnected || location.hash !== `#/requests/${key}`) return null;
    }
  }
  stopClock = setInterval(tick, 1000);
  // Refresh while the request runs, plus a few times after it ends (the last steps' details arrive slightly later).
  let afterEnd = 0;
  const stopPoll = every(2000, async () => { if (d.state === 'ACTIVE' || afterEnd++ < 3) await load(); });
  return () => { clearInterval(stopClock); stopPoll(); };
}
