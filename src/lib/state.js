import { fetchRecipes } from './sheets.js';

// ── Simple reactive state ──────────────────────────────────────────────────
class State {
  constructor() {
    this._data = {
      authenticated: false,
      recipes: [],
      loading: true,
      error: null,
      currentPage: 'recipes', // recipes | detail | scan | shopping | menu | chat
      currentRecipeId: null,
      searchQuery: '',
      filterCategory: '',
      filterRating: 0,
      displayLang: localStorage.getItem('displayLang') || 'en',
      shoppingList: JSON.parse(localStorage.getItem('shoppingList') || '[]'),
      shoppingServings: JSON.parse(localStorage.getItem('shoppingServings') || '{}'),
    };
    this._listeners = new Set();
  }

  get(key) { return this._data[key]; }

  set(updates) {
    Object.assign(this._data, updates);
    this._notify();
  }

  _notify() { this._listeners.forEach(fn => fn(this._data)); }
  subscribe(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }

  // ── Shopping list helpers ──
  addToShopping(recipeId) {
    const list = this._data.shoppingList;
    if (!list.includes(recipeId)) {
      const updated = [...list, recipeId];
      this.set({ shoppingList: updated });
      localStorage.setItem('shoppingList', JSON.stringify(updated));
    }
  }

  removeFromShopping(recipeId) {
    const updated = this._data.shoppingList.filter(id => id !== recipeId);
    this.set({ shoppingList: updated });
    localStorage.setItem('shoppingList', JSON.stringify(updated));
  }

  setServings(recipeId, servings) {
    const updated = { ...this._data.shoppingServings, [recipeId]: servings };
    this.set({ shoppingServings: updated });
    localStorage.setItem('shoppingServings', JSON.stringify(updated));
  }

  getServings(recipeId) {
    const recipe = this._data.recipes.find(r => r.id === recipeId);
    return this._data.shoppingServings[recipeId] || recipe?.servings || 4;
  }

  // ── Derived ──
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

  toggleLang() {
    const next = this._data.displayLang === 'en' ? 'de' : 'en';
    this._data.displayLang = next;
    localStorage.setItem('displayLang', next);
    this._notify();
  }

  navigate(page, recipeId = null) {
    this.set({ currentPage: page, currentRecipeId: recipeId });
    window.scrollTo(0, 0);
  }
}

export const state = new State();

// ── Auth ───────────────────────────────────────────────────────────────────
import { CONFIG } from '../config.js';

export function checkAuth() {
  return sessionStorage.getItem('auth') === 'ok';
}

export function login(password) {
  if (password === CONFIG.APP_PASSWORD) {
    sessionStorage.setItem('auth', 'ok');
    state.set({ authenticated: true });
    loadRecipes();
    return true;
  }
  return false;
}

export function logout() {
  sessionStorage.removeItem('auth');
  state.set({ authenticated: false, recipes: [] });
}

// ── Data loading ───────────────────────────────────────────────────────────
export async function loadRecipes() {
  state.set({ loading: true, error: null });
  try {
    const recipes = await fetchRecipes();
    state.set({ recipes, loading: false });
  } catch (err) {
    console.error(err);
    state.set({ loading: false, error: err.message });
  }
}
