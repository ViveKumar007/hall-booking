import { api } from '../api.js';
import { esc, fmtDay, today, addDays, weekStart, pad2, legend, every, errorBox } from '../ui.js';

export default async function calendar(el, ctx) {
  let start = null;
  el.innerHTML = `
    <section class="head"><div><div class="eyebrow">Calendar</div><h1 id="title">&nbsp;</h1>
      <p>A week at a glance for every venue.</p></div>
      <div class="datenav">
        <button class="btn small" id="prev" aria-label="Previous week">‹</button>
        <button class="btn small" id="next-booked">Next booked week</button>
        <button class="btn small" id="next" aria-label="Next week">›</button>
      </div>
    </section>
    <section class="panel"><div class="board-wrap" id="grid"></div><div style="margin-top:12px">${legend()}</div></section>`;
  const $ = (id) => el.querySelector('#' + id);
  let all = [];

  const nextBookedWeek = () => weekStart(all.map((b) => b.day).filter((d) => d >= today()).sort()[0] || today());

  async function load() {
    all = await api('/calendar');
    if (!start) start = nextBookedWeek();
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    $('title').textContent = `Week of ${fmtDay(start, { weekday: undefined })}`;
    const head = `<div class="dh"></div>${days.map((d) => `<div class="dh${d === today() ? ' today' : ''}">${esc(fmtDay(d, { year: undefined }))}</div>`).join('')}`;
    const rows = ctx.meta.venues.map((v) => `<div class="vn"><b>${esc(v.name)}</b><small>up to ${v.capacity}</small></div>${days.map((d) => {
      const items = all.filter((b) => b.hall === v.id && b.day === d).sort((a, b) => a.startHour - b.startHour);
      return `<div>${items.map((b) => `<div class="slot ${b.status === 'CONFIRMED' ? 'confirmed' : 'pending'}" title="${esc(b.requester)}"><b>${pad2(b.startHour)}–${pad2(b.endHour)}</b><span>${esc(b.requester)}</span></div>`).join('')}</div>`;
    }).join('')}`).join('');
    $('grid').innerHTML = `<div class="week">${head}${rows}</div>`;
  }

  $('prev').onclick = () => { start = addDays(start, -7); load(); };
  $('next').onclick = () => { start = addDays(start, 7); load(); };
  $('next-booked').onclick = () => { start = nextBookedWeek(); load(); };

  try { await load(); } catch (e) { $('grid').innerHTML = errorBox(e); }
  return every(5000, load);
}
