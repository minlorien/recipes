import { CONFIG } from '../config.js';

// ── Session token ──────────────────────────────────────────────────────────
// Kept in localStorage so the app stays signed in after the phone closes it.
// The token itself expires server-side (see functions/api/[[route]].js).
const TOKEN_KEY = 'session_token';

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

// ── POST helper ────────────────────────────────────────────────────────────
// Throws an Error with a readable message on failure. On 401 it clears the
// token and fires 'auth-expired' so main.js can show the login screen.
const RETRYABLE = new Set([429, 500, 502, 503, 529]);

export async function postJSON(path, body, { retry = false } = {}) {
  let res;
  try {
    res = await fetch(`${CONFIG.API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-token': getToken() || '' },
      body: JSON.stringify(body),
    });
  } catch {
    if (retry) return retryOnce(path, body);
    throw new Error('No connection — check your internet and try again.');
  }

  if (res.status === 401) {
    setToken(null);
    window.dispatchEvent(new Event('auth-expired'));
    throw new Error('Please sign in again.');
  }
  if (!res.ok) {
    if (retry && RETRYABLE.has(res.status)) return retryOnce(path, body);
    const err = await res.json().catch(() => ({}));
    const msg = typeof err.error === 'string' ? err.error : err.error?.message;
    throw new Error(msg || `Server error (${res.status})`);
  }
  return res.json();
}

async function retryOnce(path, body) {
  await new Promise(r => setTimeout(r, 1500));
  return postJSON(path, body, { retry: false });
}
