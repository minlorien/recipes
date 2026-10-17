/**
 * Cloudflare Pages Function — API proxy
 * All secrets stay server-side. Browser never sees any keys.
 *
 * Routes:
 *   POST /api/login         → verify password, return session token
 *   POST /api/ai            → Anthropic API (requires token)
 *   POST /api/sheets/read   → Google Sheets read (requires token)
 *   POST /api/sheets/write  → Google Sheets append / update-by-id (requires token)
 *   POST /api/sheets/delete → Google Sheets delete row (requires token)
 *
 * Env: ANTHROPIC_API_KEY, SHEETS_ID, GOOGLE_SERVICE_ACCOUNT_JSON, APP_PASSWORD,
 *      SESSION_SECRET (recommended; falls back to a value derived from APP_PASSWORD).
 * The app is same-origin, so no CORS headers are sent.
 */

const TOKEN_HEADER = 'x-session-token';
const SESSION_DAYS = 30;

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const path = new URL(request.url).pathname;

  try {
    if (path === '/api/login') return await handleLogin(request, env);

    // All other routes require a valid session token
    if (!await verifyToken(request.headers.get(TOKEN_HEADER), env)) {
      return json({ error: 'Unauthorized' }, 401);
    }

    switch (path) {
      case '/api/ai':           return await handleAI(request, env);
      case '/api/sheets/read':  return await handleSheetsRead(request, env);
      case '/api/sheets/write': return await handleSheetsWrite(request, env);
      case '/api/sheets/delete': return await handleSheetsDelete(request, env);
      default:                  return json({ error: 'Not found' }, 404);
    }
  } catch (err) {
    console.error('Unhandled error', path, err?.stack || err);
    return json({ error: err.message || 'Server error' }, 500);
  }
}

// Upstream (Anthropic/Google) auth failures mean OUR key is wrong, not the user's
// session — don't pass them on as 401, which would log the user out.
function upstreamStatus(status) {
  return status === 401 || status === 403 ? 502 : status;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Login & session tokens ─────────────────────────────────────────────────
// Token = base64url(payload) + "." + base64url(HMAC-SHA256(payload)),
// payload = {"exp": <unix seconds>}. Valid until exp, across midnight.
async function handleLogin(request, env) {
  const { password } = await request.json().catch(() => ({}));

  if (!env.APP_PASSWORD || !await safeEqual(String(password ?? ''), env.APP_PASSWORD, env)) {
    await new Promise(r => setTimeout(r, 500)); // slow down guessing
    return json({ error: 'Invalid password' }, 401);
  }

  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 24 * 3600;
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ exp })));
  const sig = b64url(await hmac(env, payload));
  return json({ token: `${payload}.${sig}` });
}

async function verifyToken(token, env) {
  if (!token || typeof token !== 'string') return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  try {
    const key = await hmacKey(env, ['verify']);
    const ok = await crypto.subtle.verify('HMAC', key, fromB64url(sig), new TextEncoder().encode(payload));
    if (!ok) return false;
    const { exp } = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    return typeof exp === 'number' && exp > Date.now() / 1000;
  } catch {
    return false;
  }
}

function sessionSecret(env) {
  return env.SESSION_SECRET || `${env.APP_PASSWORD}_session_secret`;
}

function hmacKey(env, usages) {
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(sessionSecret(env)),
    { name: 'HMAC', hash: 'SHA-256' }, false, usages
  );
}

async function hmac(env, data) {
  const key = await hmacKey(env, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
}

// Constant-time comparison: compare HMACs of both values, byte by byte.
async function safeEqual(a, b, env) {
  const [x, y] = await Promise.all([hmac(env, a), hmac(env, b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function fromB64url(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

// ── Anthropic API proxy ────────────────────────────────────────────────────
// Model and limits are fixed here; the client only supplies system/messages/
// max_tokens and optionally a JSON schema for the answer.
// The model is DEFAULT_AI_MODEL unless the AI_MODEL Cloudflare variable overrides it
// (change the variable, then redeploy). Do a test scan after any swap: newer models
// can reject request fields (effort, fallbacks) or change the response shape.
const DEFAULT_AI_MODEL = 'claude-sonnet-5-5';
const AI_MAX_TOKENS = 8000;    // hard ceiling; thinking counts toward this too
const AI_DEFAULT_TOKENS = 2000;

async function handleAI(request, env) {
  const { system, messages, max_tokens, schema } = await request.json();
  if (!Array.isArray(messages) || messages.length === 0) {
    return json({ error: { message: 'messages required' } }, 400);
  }
  fixImageTypes(messages);
  const model = (env.AI_MODEL || '').trim() || DEFAULT_AI_MODEL;
  const requested = Number.isInteger(max_tokens) ? max_tokens : AI_DEFAULT_TOKENS;
  const body = {
    model,
    max_tokens: Math.min(Math.max(requested, 1), AI_MAX_TOKENS),
    // Adaptive thinking is on by default; low effort keeps it short (extraction, chat, lists).
    output_config: { effort: 'low' },
    // On a safety decline, let the API retry on a fallback model automatically.
    fallbacks: 'default',
    messages,
  };
  if (system) body.system = system;
  // Structured outputs: the answer is guaranteed to be valid JSON matching the schema.
  if (schema && typeof schema === 'object') {
    body.output_config.format = { type: 'json_schema', schema };
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ error: { message: `AI service error (${res.status})` } }));

  // A retired or mistyped model comes back as 404 not_found_error. Say so plainly
  // in the app, and use 410 (not retried by the app) rather than a generic error.
  if (res.status === 404 && data.error?.type === 'not_found_error') {
    console.error(`MODEL UNAVAILABLE: "${model}" — set AI_MODEL in Cloudflare or update DEFAULT_AI_MODEL.`,
      JSON.stringify(data.error));
    return json({
      error: { message: 'The recipe assistant needs an update — please tell Bert.', code: 'model_unavailable' },
    }, 410);
  }

  if (!res.ok) {
    console.error('Anthropic error', res.status, model, JSON.stringify(data.error || data));
  } else if (data.stop_reason !== 'end_turn') {
    console.warn('Anthropic stop_reason', data.stop_reason, JSON.stringify(data.stop_details || null));
  }
  // The app only needs text. Dropping thinking/fallback blocks also keeps older
  // cached app versions (which read content[0].text) working.
  if (Array.isArray(data.content)) {
    data.content = data.content.filter(b => b.type === 'text');
  }
  return json(data, upstreamStatus(res.status));
}

// The app re-encodes photos as JPEG, but older versions labelled them with the
// original file type (PNG, HEIC…), which the API rejects. Trust the bytes instead.
function fixImageTypes(messages) {
  const SIGNATURES = [['/9j/', 'image/jpeg'], ['iVBOR', 'image/png'], ['R0lG', 'image/gif'], ['UklG', 'image/webp']];
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      const src = block?.type === 'image' ? block.source : null;
      if (src?.type !== 'base64' || typeof src.data !== 'string') continue;
      const match = SIGNATURES.find(([prefix]) => src.data.startsWith(prefix));
      if (match) src.media_type = match[1];
    }
  }
}

// ── Google Sheets ──────────────────────────────────────────────────────────
// Reads and writes both use the service account, so the sheet can be private.
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

async function sheetsFetch(env, path, init = {}) {
  const token = await getServiceAccountToken(env);
  const res = await fetch(`${SHEETS_BASE}/${env.SHEETS_ID}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) console.error('Sheets error', res.status, path, JSON.stringify(data.error || data));
  return { res, data, status: upstreamStatus(res.status) };
}

async function handleSheetsRead(request, env) {
  const { range } = await request.json();
  const { data, status } = await sheetsFetch(env, `/values/${encodeURIComponent(range)}`);
  return json(data, status);
}

// mode 'append': add rows at the end.
// mode 'update': find the row whose column A equals `id` and overwrite it.
//   (Looking the row up here, rather than trusting a row number from the phone,
//   means an edit can never overwrite the wrong recipe.)
async function handleSheetsWrite(request, env) {
  const { range, values, mode, id } = await request.json();
  const body = JSON.stringify({ values });

  if (mode === 'append') {
    const { data, status } = await sheetsFetch(env,
      `/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { method: 'POST', body });
    return json(data, status);
  }

  if (mode === 'update') {
    if (!id) return json({ error: 'id required' }, 400);
    const sheet = String(range).split('!')[0];
    const ids = await sheetsFetch(env, `/values/${encodeURIComponent(`${sheet}!A:A`)}`);
    if (!ids.res.ok) return json(ids.data, ids.status);
    const index = (ids.data.values || []).findIndex(row => row[0] === id);
    if (index < 1) return json({ error: 'Recipe not found in the sheet — refresh and try again' }, 404);
    const row = index + 1;
    const { data, status } = await sheetsFetch(env,
      `/values/${encodeURIComponent(`${sheet}!A${row}:R${row}`)}?valueInputOption=RAW`,
      { method: 'PUT', body });
    return json(data, status);
  }

  return json({ error: 'Unknown mode' }, 400);
}

async function handleSheetsDelete(request, env) {
  const { rowIndex } = await request.json();
  const { data, status } = await sheetsFetch(env, ':batchUpdate', {
    method: 'POST',
    body: JSON.stringify({
      requests: [{
        deleteDimension: {
          range: { sheetId: 0, dimension: 'ROWS', startIndex: rowIndex - 1, endIndex: rowIndex }
        }
      }]
    }),
  });
  return json(data, status);
}

// ── Service account JWT ────────────────────────────────────────────────────
// Access tokens last an hour; reuse one while this worker instance is alive.
let cachedToken = null; // { token, exp }

async function getServiceAccountToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 300 > now) return cachedToken.token;

  const sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };
  const encode = obj => b64url(new TextEncoder().encode(JSON.stringify(obj)));
  const unsigned = `${encode(header)}.${encode(claim)}`;
  const pemContents = sa.private_key
    .replace(/-----BEGIN RSA PRIVATE KEY-----|-----END RSA PRIVATE KEY-----/g, '')
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  const keyData = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyData.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${b64url(new Uint8Array(sig))}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Failed to get Google access token');
  cachedToken = { token: data.access_token, exp: now + (data.expires_in || 3600) };
  return cachedToken.token;
}
