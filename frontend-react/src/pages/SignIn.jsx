import { useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context/AppContext.jsx';
import { Field } from '../components/ui.jsx';

/** Google's "G", drawn inline so the button needs no image download. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-5" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.9 6.1C12.4 13.7 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.1z" />
      <path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.6 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.2-13.5-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}

/**
 * Everyone signs in with their Google account. Google confirms the email address; the backend then gives the
 * account its roles (approver roles and admin come from APP_ACCOUNTS, everyone else is a requester).
 */
export default function SignIn() {
  const { authConfig, authError, refreshUser } = useApp();
  const failed = new URLSearchParams(window.location.search).has('login');

  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="panel grid w-full max-w-[420px] gap-5 p-7">
        <div className="flex items-center gap-3">
          <span className="grid size-[42px] place-items-center rounded-md bg-accent font-display text-[17px] font-bold tracking-wider text-accent-ink" aria-hidden="true">HB</span>
          <div className="grid leading-tight">
            <h1 className="m-0 font-display text-[22px] font-semibold">Hall Booking</h1>
            <span className="text-sm text-ink-3">Seminar halls &amp; labs</span>
          </div>
        </div>

        <p className="m-0 text-ink-2">
          Sign in with your Google account to book a hall or lab, follow your requests, and get updates by email.
          Approvers see the bookings waiting for them.
        </p>

        {failed && (
          <div role="alert" className="rounded-lg bg-bad-soft px-3.5 py-3 text-sm text-bad">
            Sign-in did not work. Use a Google account with a verified email address, and while the app is in testing,
            one that has been added as a test user.
          </div>
        )}
        {authError && (
          <div role="alert" className="rounded-lg bg-bad-soft px-3.5 py-3 text-sm text-bad">{authError.message}</div>
        )}

        {authConfig.googleConfigured ? (
          <a className="btn justify-center gap-3 py-2.5 text-[15px] font-semibold no-underline" href={authConfig.googleLoginUrl}>
            <GoogleMark />Sign in with Google
          </a>
        ) : (
          <div role="alert" className="rounded-lg bg-warn-soft px-3.5 py-3 text-sm text-warn">
            Google sign-in is not set up yet: put GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in
            hall-booking/scripts/secrets.cmd and restart the backend.
          </div>
        )}

        {authConfig.devLogin && <DevLogin onDone={refreshUser} />}
      </div>
    </main>
  );
}

/** Test-only sign-in (APP_DEVLOGIN_ENABLED=true): the same roles as a Google sign-in with that address. */
function DevLogin({ onDone }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/auth/dev-login', { method: 'POST', body: { email, name: '' } });
      await onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-lg border border-dashed border-warn p-4">
      <div className="text-sm font-semibold text-warn">Test sign-in (development only, no Google)</div>
      <Field label="Email" error={error}>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@college.edu" aria-invalid={!!error} required />
      </Field>
      <button className="btn btn-sm justify-self-start" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in for testing'}</button>
    </form>
  );
}
