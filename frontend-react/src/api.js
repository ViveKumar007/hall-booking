// Every call goes to the Spring Boot backend's /api on the same origin, never straight to Camunda.
// The login is a session cookie (set after Sign in with Google); writes also carry the CSRF token.

export class ApiError extends Error {
  constructor(message, status, fields) {
    super(message);
    this.status = status;
    this.fields = fields || null;
  }
}

/** Fired when the backend says the session is gone (401), so the app shows the sign-in page again. */
export const SIGNED_OUT_EVENT = 'hb:signed-out';

/** The CSRF token the backend puts in the XSRF-TOKEN cookie; sent back in a header that other sites cannot set. */
function csrfToken() {
  const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') {
    const token = csrfToken();
    if (token) headers['X-XSRF-TOKEN'] = token;
  }
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      signal,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError('The backend is not running. Start it with start-backend.cmd.', 0);
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
  if (!res.ok) throw new ApiError(data?.error || `Request failed (${res.status})`, res.status, data?.fields);
  return data;
}
