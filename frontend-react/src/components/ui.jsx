// Small building blocks shared by the pages.
import { cloneElement, isValidElement, useId } from 'react';
import { useNow } from '../lib/hooks.js';
import { timeLeft } from '../lib/format.js';

export function Panel({ title, aside, className = '', children }) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <h2 className="mb-3 flex items-baseline gap-2.5">
          {title}
          {aside && <span className="font-body text-sm font-normal text-ink-2">{aside}</span>}
        </h2>
      )}
      {children}
    </section>
  );
}

/** Page heading: eyebrow, title, intro, and optional controls on the right. */
export function PageHead({ eyebrow, title, children, actions }) {
  return (
    <section className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {children && <p className="mt-1 max-w-[70ch] text-ink-2">{children}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
    </section>
  );
}

export function Empty({ children }) {
  return <div className="rounded-lg border border-dashed border-rule-2 p-4 text-center text-ink-2">{children}</div>;
}

export function ErrorBox({ error }) {
  if (!error) return null;
  return <div role="alert" className="rounded-lg bg-bad-soft px-3.5 py-3 text-bad">{error.message || String(error)}</div>;
}

/** A status chip ({code, label, tone} from the API); big = the rubber stamp at the end of a route. */
export function Stamp({ status, big = false }) {
  if (!status) return null;
  return <span className={`stamp tone-${status.tone}${big ? ' stamp-big' : ''}`}>{status.label}</span>;
}

/** Time left until `due`, with a bar that empties from `since` to `due` and turns amber in the last minute. */
export function Countdown({ since, due, large = false }) {
  const now = useNow(1000);
  const total = new Date(due) - new Date(since);
  const remaining = Math.max(0, new Date(due) - now);
  const pct = total > 0 ? (remaining / total) * 100 : 0;
  return (
    <div className="grid gap-1.5">
      <span className={`font-mono font-semibold tabular-nums ${large ? 'text-3xl leading-none' : 'text-2xl leading-none'}`} aria-live="off">
        {timeLeft(due, now)}
      </span>
      <div className="h-1.5 overflow-hidden rounded bg-rule" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="Time left before it expires">
        <div className={`bar-fill ${remaining < 60000 ? 'bar-late' : ''}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * A labelled control. The label points at the control (htmlFor/id), so the accessible name is exactly the label
 * text; the hint or error is linked with aria-describedby and announced after it.
 */
export function Field({ label, error, hint, children, className = '' }) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error || hint;
  const control = isValidElement(children)
    ? cloneElement(children, { id, 'aria-describedby': note ? noteId : undefined })
    : children;
  return (
    <div className={`grid gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-sm font-semibold">{label}</label>
      {control}
      {error ? <span id={noteId} role="alert" className="text-[13px] text-bad">{error}</span>
        : hint && <small id={noteId} className="text-ink-3">{hint}</small>}
    </div>
  );
}
