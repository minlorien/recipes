import { CONFIG } from '../config.js';
import { getToken } from './state.js';

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

function authHeaders() {
  return { 'Content-Type': 'application/json', 'x-session-token': getToken() || '' };
}

export async function fetchRecipes() {
  const res = await fetch(`${CONFIG.API_BASE}/sheets/read`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ range: `${CONFIG.SHEET_NAME}!A2:R` }),
  });
  if (!res.ok) throw new Error('Failed to fetch recipes');
  const data = await res.json();
  return (data.values || []).map(rowToRecipe).filter(r => r.id);
}

export async function appendRecipe(recipe) {
  const row = recipeToRow(recipe);
  const res = await fetch(`${CONFIG.API_BASE}/sheets/write`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ range: `${CONFIG.SHEET_NAME}!A:R`, values: [row], mode: 'append' }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error('Failed to save recipe: ' + (err.error?.message || res.status));
  }
  return recipe;
}

export async function updateRecipe(recipe, rowIndex) {
  const row = recipeToRow(recipe);
  const res = await fetch(`${CONFIG.API_BASE}/sheets/write`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ range: `${CONFIG.SHEET_NAME}!A${rowIndex}:R${rowIndex}`, values: [row], mode: 'update' }),
  });
  if (!res.ok) throw new Error('Failed to update recipe');
  return recipe;
}

export async function deleteRecipe(rowIndex) {
  const res = await fetch(`${CONFIG.API_BASE}/sheets/delete`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ rowIndex }),
  });
  if (!res.ok) throw new Error('Failed to delete recipe');
}