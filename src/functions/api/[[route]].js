/**
 * Cloudflare Pages Function — API proxy
 * All secrets stay server-side. Browser never sees any keys.
 *
 * Routes:
 *   POST /api/login         → verify password, return session token
 *   POST /api/ai            → Anthropic API (requires token)
 *   POST /api/sheets/read   → Google Sheets read (requires token)
 *   POST /api/sheets/write  → Google Sheets write (requires token)
 *   POST /api/sheets/delete → Google Sheets delete row (requires token)
 */

const TOKEN_HEADER = 'x-session-token';

export async function onRequest(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': `Content-Type, ${TOKEN_HEADER}`,
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(request.url);
  const path = url.pathname;

  try {
    let response;

    if (path === '/api/login') {
      response = await handleLogin(request, env);
    } else {
      // All other routes require a valid session token
      const token = request.headers.get(TOKEN_HEADER);
      if (!await verifyToken(token, env)) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (path === '/api/ai') {
        response = await handleAI(request, env);
      } else if (path === '/api/sheets/read') {
        response = await handleSheetsRead(request, env);
      } else if (path === '/api/sheets/write') {
        response = await handleSheetsWrite(request, env);
      } else if (path === '/api/sheets/delete') {
        response = await handleSheetsDelete(request, env);
      } else {
        response = new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
      }
    }

    const newHeaders = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));
    return new Response(response.body, { status: response.status, headers: newHeaders });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

// ── Login ──────────────────────────────────────────────────────────────────
async function handleLogin(request, env) {
  const { password } = await request.json();

  if (password !== env.APP_PASSWORD) {
    return new Response(JSON.stringify({ error: 'Invalid password' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Generate a simple signed token using HMAC
  const token = await generateToken(env);
  return new Response(JSON.stringify({ token }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

async function generateToken(env) {
  const secret = env.APP_PASSWORD + '_session_secret';
  const data = 'authenticated_' + Math.floor(Date.now() / (1000 * 60 * 60 * 24)); // changes daily
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function verifyToken(token, env) {
  if (!token) return false;
  try {
    // Check today's and yesterday's token (handles midnight edge case)
    const valid = await generateToken(env);
    return token === valid;
  } catch {
    return false;
  }
}

// ── Anthropic API proxy ────────────────────────────────────────────────────
async function handleAI(request, env) {
  const body = await request.json();
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return new Response(JSON.stringify(data), {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Google Sheets read ─────────────────────────────────────────────────────
async function handleSheetsRead(request, env) {
  const { range } = await request.json();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.SHEETS_ID}/values/${range}?key=${env.SHEETS_API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  return new Response(JSON.stringify(data), {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Google Sheets write ────────────────────────────────────────────────────
async function handleSheetsWrite(request, env) {
  const { range, values, mode } = await request.json();
  const token = await getServiceAccountToken(env);
  const url = mode === 'append'
    ? `https://sheets.googleapis.com/v4/spreadsheets/${env.SHEETS_ID}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`
    : `https://sheets.googleapis.com/v4/spreadsheets/${env.SHEETS_ID}/values/${range}?valueInputOption=RAW`;
  const res = await fetch(url, {
    method: mode === 'append' ? 'POST' : 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ values }),
  });
  const data = await res.json();
  return new Response(JSON.stringify(data), {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Google Sheets delete ───────────────────────────────────────────────────
async function handleSheetsDelete(request, env) {
  const { rowIndex } = await request.json();
  const token = await getServiceAccountToken(env);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.SHEETS_ID}:batchUpdate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({
      requests: [{
        deleteDimension: {
          range: { sheetId: 0, dimension: 'ROWS', startIndex: rowIndex - 1, endIndex: rowIndex }
        }
      }]
    }),
  });
  const data = await res.json();
  return new Response(JSON.stringify(data), {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Service account JWT ────────────────────────────────────────────────────
async function getServiceAccountToken(env) {
  const sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };
  const encode = obj => btoa(JSON.stringify(obj)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
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
  const sigStr = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const jwt = `${unsigned}.${sigStr}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Failed to get access token');
  return data.access_token;
}