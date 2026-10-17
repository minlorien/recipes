import { CONFIG } from '../config.js';
import { postJSON } from './api.js';

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

export async function fetchRecipes() {
  const data = await postJSON('/sheets/read', { range: `${CONFIG.SHEET_NAME}!A2:R` });
  return (data.values || []).map(rowToRecipe).filter(r => r.id);
}

export async function appendRecipe(recipe) {
  const row = recipeToRow(recipe);
  await postJSON('/sheets/write', { range: `${CONFIG.SHEET_NAME}!A:R`, values: [row], mode: 'append' });
  return recipe;
}

// The server finds the row by recipe id, so a stale row number can't overwrite another recipe.
export async function updateRecipe(recipe) {
  const row = recipeToRow(recipe);
  await postJSON('/sheets/write', { range: `${CONFIG.SHEET_NAME}!A:R`, values: [row], mode: 'update', id: recipe.id });
  return recipe;
}
