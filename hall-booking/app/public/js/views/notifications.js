import { api } from '../api.js';
import { esc, ago, every, errorBox } from '../ui.js';

const TONE = { APPROVED: 'ok', REJECTED: 'bad', SERVICE_UNAVAILABLE: 'bad', EXPIRED: 'idle' };

export default async function notifications(el) {
  el.innerHTML = `
    <section class="head"><div><div class="eyebrow">Notifications</div><h1>Emails and reminders</h1>
      <p>Every finished request emails the requester through the Email connector; the Spring Boot job worker records it
        here, together with the 1-minute reminders to approvers.
        Read the delivered emails in the <a href="http://localhost:1080" target="_blank" rel="noopener">mail inbox (MailDev) ↗</a>.</p></div>
    </section>
    <section class="panel"><div id="list"></div></section>`;
  const list = el.querySelector('#list');

  async function load() {
    const items = await api('/notifications');
    list.innerHTML = items.length ? `<ul class="list">${items.map((n) => {
      const outcome = n.kind === 'REMINDER' ? 'REMINDER' : String(n.subject || '').replace('Hall booking ', '');
      return `<li class="item" style="grid-template-columns:auto minmax(0,1fr) auto;align-items:start">
        <span class="stamp tone-${TONE[outcome] || 'warn'}">${esc(outcome.replace(/_/g, ' '))}</span>
        <span><span class="t">${esc(n.to)}</span>${n.bookingRef ? ` <span class="mono muted small">${esc(n.bookingRef)}</span>` : ''}${n.emailStatus === 'FAILED' ? ' <span class="badge">email not delivered</span>' : ''}<br><span class="s">${esc(n.message)}</span></span>
        <span class="muted small">${esc(ago(n.sentAt))}</span></li>`;
    }).join('')}</ul>` : '<div class="empty">No emails yet. They appear when a request finishes.</div>';
  }

  try { await load(); } catch (e) { list.innerHTML = errorBox(e); }
  return every(5000, load);
}
