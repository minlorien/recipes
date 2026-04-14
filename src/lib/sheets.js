import { CONFIG } from '../config.js';

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

export const COLUMNS = ['id','title','title_de','category','servings','prep_mins',
  'cook_mins','rating','language','tags','ingredients','steps','notes','image_url',
  'created_at','updated_at','ingredients_de','steps_de'];

function rowToRecipe(row) {
  const r = {};
  COLUMNS.forEach((col, i) => r[col] = row[i] || '');
  try { r.ingredients = JSON.parse(r.ingredients || '[]'); } catch { r.ingredients = []; }
  try { r.steps = JSON.parse(r.steps || '[]'); } catch { r.steps = []; }
  try { r.ingredients_de = JSON.parse(r.ingredients_de || '[]'); } catch { r.ingredients_de = []; }
  try { r.steps_de = JSON.parse(r.steps_de || '[]'); } catch { r.steps_de = []; }
  try { r.tags = r.tags ? r.tags.split(',').map(t => t.trim()).filter(Boolean) : []; } catch { r.tags = []; }
  r.rating = parseFloat(r.rating) || 0;
  r.servings = parseInt(r.servings) || 4;
  r.prep_mins = parseInt(r.prep_mins) || 0;
  r.cook_mins = parseInt(r.cook_mins) || 0;
  return r;
}

function recipeToRow(recipe) {
  return [
    recipe.id || crypto.randomUUID(),
    recipe.title || '',
    recipe.title_de || '',
    recipe.category || '',
    recipe.servings || 4,
    recipe.prep_mins || 0,
    recipe.cook_mins || 0,
    recipe.rating || 0,
    recipe.language || 'en',
    Array.isArray(recipe.tags) ? recipe.tags.join(', ') : (recipe.tags || ''),
    JSON.stringify(recipe.ingredients || []),
    JSON.stringify(recipe.steps || []),
    recipe.notes || '',
    recipe.image_url || '',
    recipe.created_at || new Date().toISOString(),
    new Date().toISOString(),
    JSON.stringify(recipe.ingredients_de || []),
    JSON.stringify(recipe.steps_de || []),
  ];
}

// ── Google Service Account OAuth token ────────────────────────────────────
let _cachedToken = null;
let _tokenExpiry = 0;

async function getAccessToken() {
  if (_cachedToken && Date.now() < _tokenExpiry) return _cachedToken;

  const sa = JSON.parse(CONFIG.GOOGLE_SERVICE_ACCOUNT_JSON);
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

  // Import private key
  const pemContents = sa.private_key.replace(/-----BEGIN RSA PRIVATE KEY-----/g,'').replace(/-----END RSA PRIVATE KEY-----/g,'').replace(/-----BEGIN PRIVATE KEY-----/g,'').replace(/-----END PRIVATE KEY-----/g,'').replace(/\s/g,'');
  const keyData = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyData.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );

  // Sign
  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, encoder.encode(unsigned));
  const sig = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  const jwt = `${unsigned}.${sig}`;

  // Exchange for access token
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Failed to get access token: ' + JSON.stringify(data));

  _cachedToken = data.access_token;
  _tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return _cachedToken;
}

// ── Read (uses API key — public read) ─────────────────────────────────────
export async function fetchRecipes() {
  const url = `${BASE}/${CONFIG.SHEETS_ID}/values/${CONFIG.SHEET_NAME}!A2:R?key=${CONFIG.SHEETS_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch recipes from Google Sheets');
  const data = await res.json();
  return (data.values || []).map(rowToRecipe).filter(r => r.id);
}

// ── Write (uses service account OAuth) ────────────────────────────────────
export async function appendRecipe(recipe) {
  console.log('Saving recipe, ingredients_de:', recipe.ingredients_de?.length, 'steps_de:', recipe.steps_de?.length);
  console.log('Row length will be:', recipeToRow(recipe).length);
  const token = await getAccessToken();
  const row = recipeToRow(recipe);
  console.log('Row[16] ingredients_de:', row[16]);
  console.log('Row[17] steps_de:', row[17]);
  const url = `${BASE}/${CONFIG.SHEETS_ID}/values/${CONFIG.SHEET_NAME}!A:R:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ values: [row] }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error('Failed to save recipe: ' + (err.error?.message || res.status));
  }
  return recipe;
}

export async function updateRecipe(recipe, rowIndex) {
  const token = await getAccessToken();
  const row = recipeToRow(recipe);
  const range = `${CONFIG.SHEET_NAME}!A${rowIndex}:P${rowIndex}`;
  const url = `${BASE}/${CONFIG.SHEETS_ID}/values/${range}?valueInputOption=RAW`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ values: [row] }),
  });
  if (!res.ok) throw new Error('Failed to update recipe');
  return recipe;
}

export async function deleteRecipe(rowIndex) {
  const token = await getAccessToken();
  const url = `${BASE}/${CONFIG.SHEETS_ID}:batchUpdate`;
  const sheetId = 0;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      requests: [{
        deleteDimension: {
          range: { sheetId, dimension: 'ROWS', startIndex: rowIndex - 1, endIndex: rowIndex }
        }
      }]
    }),
  });
  if (!res.ok) throw new Error('Failed to delete recipe');
}

export async function ensureHeaderRow() {
  const url = `${BASE}/${CONFIG.SHEETS_ID}/values/${CONFIG.SHEET_NAME}!A1:R1?key=${CONFIG.SHEETS_API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.values || !data.values[0] || data.values[0][0] !== 'id') {
    const token = await getAccessToken();
    const writeUrl = `${BASE}/${CONFIG.SHEETS_ID}/values/${CONFIG.SHEET_NAME}!A1:R1?valueInputOption=RAW`;
    await fetch(writeUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ values: [COLUMNS] }),
    });
  }
}
