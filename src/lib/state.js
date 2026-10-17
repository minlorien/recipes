import { fetchRecipes } from './sheets.js';
import { getToken, setToken } from './api.js';

// localStorage can be unavailable or hold corrupted data; never let that break startup.
function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

class State {
  constructor() {
    const lang = load('displayLang', 'en');
    this._data = {
      authenticated: false,
      recipes: [],
      loading: true,
      error: null,
      currentPage: 'recipes',
      currentRecipeId: null,
      searchQuery: '',
      filterCategory: '',
      filterRating: 0,
      displayLang: lang === 'de' ? 'de' : 'en',
      shoppingList: asArray(load('shoppingList', [])),
      shoppingServings: asObject(load('shoppingServings', {})),
      shoppingChecked: asObject(load('shoppingChecked', {})),
    };
    this._listeners = new Set();
  }

  get(key) { return this._data[key]; }

  set(updates) {
    Object.assign(this._data, updates);
    this._notify();
  }

  // Update without re-rendering (e.g. while typing in the search box).
  setQuiet(updates) {
    Object.assign(this._data, updates);
  }

  _notify() { this._listeners.forEach(fn => fn(this._data)); }
  subscribe(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }

  toggleLang() {
    const next = this._data.displayLang === 'en' ? 'de' : 'en';
    save('displayLang', next);
    this.set({ displayLang: next });
  }

  addToShopping(recipeId) {
    const list = this._data.shoppingList;
    if (!list.includes(recipeId)) {
      const updated = [...list, recipeId];
      save('shoppingList', updated);
      this.set({ shoppingList: updated });
    }
  }

  removeFromShopping(recipeId) {
    const updated = this._data.shoppingList.filter(id => id !== recipeId);
    save('shoppingList', updated);
    this.set({ shoppingList: updated });
  }

  clearShopping() {
    save('shoppingList', []);
    save('shoppingChecked', {});
    this.set({ shoppingList: [], shoppingChecked: {} });
  }

  // Ticked-off items survive closing the app (handy in the supermarket).
  setChecked(key, checked) {
    const updated = { ...this._data.shoppingChecked, [key]: checked };
    if (!checked) delete updated[key];
    save('shoppingChecked', updated);
    this.setQuiet({ shoppingChecked: updated });
  }

  clearChecked() {
    save('shoppingChecked', {});
    this.set({ shoppingChecked: {} });
  }

  setServings(recipeId, servings) {
    const updated = { ...this._data.shoppingServings, [recipeId]: servings };
    save('shoppingServings', updated);
    this.set({ shoppingServings: updated });
  }

  getServings(recipeId) {
    const recipe = this._data.recipes.find(r => r.id === recipeId);
    return this._data.shoppingServings[recipeId] || recipe?.servings || 4;
  }

  get filteredRecipes() {
    let recipes = this._data.recipes;
    const q = this._data.searchQuery.toLowerCase().trim();
    const cat = this._data.filterCategory;
    const minRating = this._data.filterRating;
    if (q) {
      recipes = recipes.filter(r =>
        r.title?.toLowerCase().includes(q) ||
        r.title_de?.toLowerCase().includes(q) ||
        r.tags?.some(t => t.toLowerCase().includes(q)) ||
        r.ingredients?.some(i => i.name?.toLowerCase().includes(q)) ||
        r.ingredients_de?.some(i => i.name?.toLowerCase().includes(q)) ||
        r.category?.toLowerCase().includes(q)
      );
    }
    if (cat) recipes = recipes.filter(r => r.category === cat);
    if (minRating) recipes = recipes.filter(r => r.rating >= minRating);
    return recipes;
  }

  get currentRecipe() {
    return this._data.recipes.find(r => r.id === this._data.currentRecipeId) || null;
  }

  get shoppingRecipes() {
    return this._data.shoppingList
      .map(id => this._data.recipes.find(r => r.id === id))
      .filter(Boolean);
  }

  navigate(page, recipeId = null) {
    this.set({ currentPage: page, currentRecipeId: recipeId });
    window.scrollTo(0, 0);
  }
}

function asArray(v) { return Array.isArray(v) ? v : []; }
function asObject(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }

export const state = new State();

// ── Session (the token is stored, never the password) ──────────────────────
export function checkAuth() {
  return !!getToken();
}

// Resolves to 'ok', 'wrong-password' or 'offline'.
export async function login(password) {
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.status === 401) return 'wrong-password';
    if (!res.ok) return 'offline';
    const { token } = await res.json();
    setToken(token);
    state.set({ authenticated: true });
    loadRecipes();
    return 'ok';
  } catch {
    return 'offline';
  }
}

export function logout() {
  setToken(null);
  state.set({ authenticated: false, recipes: [], currentPage: 'recipes', currentRecipeId: null });
}

// Resolves to true on success, false on failure (the error is shown on the recipes page).
export async function loadRecipes() {
  state.set({ loading: true, error: null });
  try {
    const recipes = await fetchRecipes();
    state.set({ recipes, loading: false });
    return true;
  } catch (err) {
    console.error(err);
    state.set({ loading: false, error: err.message });
    return false;
  }
}
