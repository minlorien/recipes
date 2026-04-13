import { CONFIG } from '../config.js';

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

// Column layout in the sheet (1-indexed, but we use 0-indexed arrays)
// A: id | B: title | C: title_de | D: category | E: servings | F: prep_mins
// G: cook_mins | H: rating | I: language | J: tags | K: ingredients_json
// L: steps_json | M: notes | N: image_url | O: created_at | P: updated_at

export const COLUMNS = ['id','title','title_de','category','servings','prep_mins',
  'cook_mins','rating','language','tags','ingredients','steps','notes','image_url',
  'created_at','updated_at'];

function rowToRecipe(row) {
  const r = {};
  COLUMNS.forEach((col, i) => r[col] = row[i] || '');
  try { r.ingredients = JSON.parse(r.ingredients || '[]'); } catch { r.ingredients = []; }
  try { r.steps = JSON.parse(r.steps || '[]'); } catch { r.steps = []; }
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
  ];
}

export async function fetchRecipes() {
  const url = `${BASE}/${CONFIG.SHEETS_ID}/values/${CONFIG.SHEET_NAME}!A2:P?key=${CONFIG.SHEETS_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch recipes from Google Sheets');
  const data = await res.json();
  return (data.values || []).map(rowToRecipe).filter(r => r.id);
}

export async function appendRecipe(recipe) {
  const row = recipeToRow(recipe);
  const url = `${BASE}/${CONFIG.SHEETS_ID}/values/${CONFIG.SHEET_NAME}!A:P:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS&key=${CONFIG.SHEETS_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [row] }),
  });
  if (!res.ok) throw new Error('Failed to save recipe');
  return recipe;
}

export async function updateRecipe(recipe, rowIndex) {
  // rowIndex is 1-indexed (row 1 = header, row 2 = first recipe)
  const row = recipeToRow(recipe);
  const range = `${CONFIG.SHEET_NAME}!A${rowIndex}:P${rowIndex}`;
  const url = `${BASE}/${CONFIG.SHEETS_ID}/values/${range}?valueInputOption=RAW&key=${CONFIG.SHEETS_API_KEY}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [row] }),
  });
  if (!res.ok) throw new Error('Failed to update recipe');
  return recipe;
}

export async function deleteRecipe(rowIndex) {
  // Uses Sheets batchUpdate to delete a row
  const url = `${BASE}/${CONFIG.SHEETS_ID}:batchUpdate?key=${CONFIG.SHEETS_API_KEY}`;
  const sheetId = 0; // assumes first sheet tab
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  const url = `${BASE}/${CONFIG.SHEETS_ID}/values/${CONFIG.SHEET_NAME}!A1:P1?key=${CONFIG.SHEETS_API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.values || !data.values[0] || data.values[0][0] !== 'id') {
    // Write header
    const writeUrl = `${BASE}/${CONFIG.SHEETS_ID}/values/${CONFIG.SHEET_NAME}!A1:P1?valueInputOption=RAW&key=${CONFIG.SHEETS_API_KEY}`;
    await fetch(writeUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [COLUMNS] }),
    });
  }
}
