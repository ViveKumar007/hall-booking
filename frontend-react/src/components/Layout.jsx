import { NavLink, Outlet } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../context/AppContext.jsx';
import { usePoll } from '../lib/hooks.js';
import SignIn from '../pages/SignIn.jsx';

/** Everyone books; approvers also get the inbox; admins also get service issues, everyone's requests and the log. */
function navFor({ isAdmin, isApprover }) {
  return [
    ['/', 'Room board'],
    ['/new', 'New booking'],
    (isApprover || isAdmin) && ['/inbox', 'Inbox', 'approval'],
    ['/requests', isAdmin ? 'All requests' : 'My requests'],
    isAdmin && ['/issues', 'Service issues', 'service'],
    ['/calendar', 'Calendar'],
    isAdmin && ['/notifications', 'Notifications'],
  ].filter(Boolean);
}

/** The signed-in Google account: photo (or initial), name, roles, and Sign out. */
function Account() {
  const { user, signOut, roleName } = useApp();
  const roles = [...(user.admin ? ['admin'] : []), ...user.approverRoles];
  return (
    <div className="flex items-center gap-2.5">
      {user.picture
        ? <img src={user.picture} alt="" referrerPolicy="no-referrer" className="size-8 rounded-full" />
        : <span className="grid size-8 place-items-center rounded-full bg-accent-soft font-semibold text-accent" aria-hidden="true">{(user.name || user.email || '?').charAt(0).toUpperCase()}</span>}
      <span className="grid leading-tight">
        <b className="text-sm font-semibold">{user.name || user.email}</b>
        <small className="text-xs text-ink-3" title={user.email}>{roles.length ? roles.map(roleName).join(' · ') : 'Requester'}</small>
      </span>
      <button type="button" className="btn btn-sm btn-ghost" onClick={signOut}>Sign out</button>
    </div>
  );
}

function StatusLights() {
  const { data: h, error } = usePoll(() => api('/health'), 5000);
  if (error && !h) return <span className="font-semibold text-bad"><Dot up={false} />Backend stopped</span>;
  if (!h) return null;
  const lights = [
    [h.camunda, 'Camunda', 'Start start-camunda.cmd'],
    [h.bookings, 'Bookings', 'The booking register is switched to DOWN (Service issues page)'],
    [h.worker, 'Workers', 'The job workers need Camunda'],
    [h.mail, 'Mail', 'Start start-mail.cmd'],
  ];
  return (
    <div className="flex gap-2.5 text-xs text-ink-2" aria-live="polite">
      {lights.map(([up, name, hint]) => (
        <span key={name} title={up ? `${name} is running` : hint} className={`inline-flex items-center gap-1.5 ${up ? '' : 'font-semibold text-bad'}`}>
          <Dot up={up} />{name}
        </span>
      ))}
    </div>
  );
}

const Dot = ({ up }) => <i className={`inline-block size-2 rounded-full ${up ? 'bg-ok' : 'bg-bad'}`} aria-hidden="true" />;

export default function Layout() {
  const { user, loadingUser } = useApp();
  if (loadingUser) return <main className="grid min-h-screen place-items-center text-ink-3">Loading…</main>;
  if (!user.signedIn) return <SignIn />;
  return <SignedIn />;
}

function SignedIn() {
  const { isAdmin, isApprover, metaError } = useApp();
  // The inbox count: reviews this person may decide (an admin also sees, but cannot decide, other roles' reviews).
  const approvals = usePoll(() => (isApprover || isAdmin ? api('/tasks?kind=approval') : []), 4000, [isApprover, isAdmin]);
  const service = usePoll(() => (isAdmin ? api('/tasks?kind=service') : []), 4000, [isAdmin]);
  const counts = { approval: approvals.data?.filter((t) => t.canDecide).length || 0, service: service.data?.length || 0 };

  return (
    <>
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-4 border-b border-rule bg-card px-6 py-2.5 max-md:px-4">
        <NavLink to="/" className="flex items-center gap-2.5 text-ink no-underline" aria-label="Hall Booking, room board">
          <span className="grid size-[34px] place-items-center rounded-md bg-accent font-display text-[15px] font-bold tracking-wider text-accent-ink" aria-hidden="true">HB</span>
          <span className="grid leading-tight">
            <b className="font-display text-[17px] font-semibold">Hall Booking</b>
            <small className="text-xs text-ink-3">Seminar halls &amp; labs</small>
          </span>
        </NavLink>
        <nav className="flex flex-1 flex-wrap gap-0.5" aria-label="Main">
          {navFor({ isAdmin, isApprover }).map(([to, label, countKey]) => (
            <NavLink key={to} to={to} end={to === '/'}
              className={({ isActive }) => `relative rounded-md px-3 py-1.5 font-medium no-underline ${isActive ? 'bg-accent-soft text-accent' : 'text-ink-2 hover:bg-paper hover:text-ink'}`}>
              {label}
              {countKey && counts[countKey] > 0 && (
                <span className="ml-1.5 inline-grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 text-xs font-semibold text-accent-ink">{counts[countKey]}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-4">
          <StatusLights />
          <Account />
        </div>
      </header>
      <main className="mx-auto grid max-w-[1240px] gap-[22px] px-6 pb-16 pt-7 max-md:px-4">
        {metaError && <div role="alert" className="rounded-lg bg-bad-soft px-3.5 py-3 text-bad">{metaError.message}</div>}
        <Outlet />
      </main>
    </>
  );
}
