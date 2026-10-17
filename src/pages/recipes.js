import { state, loadRecipes } from '../lib/state.js';
import { starsHTML, categoryEmoji, formatTime, icons, esc } from '../lib/ui.js';

const CATEGORIES = ['Breakfast','Soup','Salad','Main','Side','Dessert','Baking','Drink','Snack','Preserve'];

export function renderRecipesPage(container) {
  const q = state.get('searchQuery');
  const cat = state.get('filterCategory');
  const rating = state.get('filterRating');

  container.innerHTML = `
    <div class="page">
      <div class="section-header" style="margin-bottom:16px;">
        <h1 style="font-style:italic;">Recipes</h1>
        <button class="btn btn-primary btn-sm" id="add-recipe-btn">
          ${icons.plus} Add
        </button>
      </div>

      <div class="search-wrap mb-12">
        ${icons.search}
        <input type="search" placeholder="Search by name, ingredient, or tag…"
          value="${esc(q)}" id="search-input" autocomplete="off" enterkeyhint="search" />
      </div>

      <div class="filter-row">
        <button class="chip ${!cat ? 'active' : ''}" data-cat="">All</button>
        ${CATEGORIES.map(c => `
          <button class="chip ${cat === c ? 'active' : ''}" data-cat="${c}">${c}</button>
        `).join('')}
      </div>

      <div class="filter-row" style="margin-top:0;">
        <button class="chip ${!rating ? 'active' : ''}" data-rating="0">Any rating</button>
        ${[3,4,5].map(r => `
          <button class="chip ${rating === r ? 'active' : ''}" data-rating="${r}">
            ${'★'.repeat(r)} & up
          </button>
        `).join('')}
      </div>

      <div id="recipe-results"></div>
    </div>
  `;

  const results = container.querySelector('#recipe-results');
  renderResults(results);

  // Search: update the list only, so the input keeps focus and the keyboard stays up.
  container.querySelector('#search-input').addEventListener('input', e => {
    state.setQuiet({ searchQuery: e.target.value });
    renderResults(results);
  });

  // Filters (state.set re-renders the page)
  container.querySelectorAll('[data-cat]').forEach(chip => {
    chip.addEventListener('click', () => state.set({ filterCategory: chip.dataset.cat }));
  });
  container.querySelectorAll('[data-rating]').forEach(chip => {
    chip.addEventListener('click', () => state.set({ filterRating: parseInt(chip.dataset.rating) }));
  });

  container.querySelector('#add-recipe-btn').addEventListener('click', () => state.navigate('scan'));
}

function renderResults(el) {
  const recipes = state.filteredRecipes;
  const isLoading = state.get('loading');
  const error = state.get('error');
  const filtering = !!(state.get('searchQuery').trim() || state.get('filterCategory') || state.get('filterRating'));

  el.innerHTML = isLoading ? `
      <div class="empty-state">
        <div class="spinner" style="margin: 0 auto 16px;"></div>
        <p>Loading recipes…</p>
      </div>
    ` : error ? `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <h2>Connection error</h2>
        <p>${esc(error)}</p>
        <button class="btn btn-outline" id="retry-btn">${icons.refresh} Retry</button>
      </div>
    ` : recipes.length === 0 ? `
      <div class="empty-state">
        <div class="empty-icon">📖</div>
        <h2>${filtering ? 'No matches found' : 'No recipes yet'}</h2>
        <p>${filtering
          ? 'Try a different search or filter.'
          : 'Add your first recipe by scanning a photo or entering manually.'}</p>
        ${filtering ? '' : `<button class="btn btn-primary" id="scan-first-btn">${icons.scan} Scan a Recipe</button>`}
      </div>
    ` : `
      <p class="text-muted text-sm mb-12">${recipes.length} recipe${recipes.length !== 1 ? 's' : ''}</p>
      <div class="recipe-grid">
        ${recipes.map(r => recipeCardHTML(r)).join('')}
      </div>
    `;

  el.querySelector('#scan-first-btn')?.addEventListener('click', () => state.navigate('scan'));
  el.querySelector('#retry-btn')?.addEventListener('click', () => loadRecipes());
  el.querySelectorAll('.recipe-card').forEach(card => {
    card.addEventListener('click', () => state.navigate('detail', card.dataset.id));
  });
}

function recipeCardHTML(r) {
  const lang = state.get('displayLang');
  const title = lang === 'de' && r.title_de ? r.title_de : r.title;
  const inShopping = state.get('shoppingList').includes(r.id);
  const totalTime = (r.prep_mins || 0) + (r.cook_mins || 0);
  return `
    <div class="recipe-card" data-id="${esc(r.id)}" role="button" tabindex="0">
      <div class="card-img">
        ${r.image_url
          ? `<img src="${esc(r.image_url)}" alt="${esc(title)}" loading="lazy" />`
          : `<span style="font-size:2.5rem;">${categoryEmoji(r.category)}</span>`
        }
        ${r.language === 'de' ? `<span class="card-lang">DE</span>` : ''}
        ${inShopping ? `<span class="card-lang" style="left:10px;right:auto;background:var(--forest);color:#fff;">🛒</span>` : ''}
      </div>
      <div class="card-body">
        <div class="card-title">${esc(title)}</div>
        <div class="card-meta">
          ${r.category ? `<span class="tag tag-green">${esc(r.category)}</span>` : ''}
          ${totalTime ? `<span>${formatTime(totalTime)}</span>` : ''}
          ${r.servings ? `<span>${r.servings} servings</span>` : ''}
        </div>
        ${r.tags?.length ? `
          <div class="card-tags">
            ${r.tags.slice(0,3).map(t => `<span class="tag tag-gray">${esc(t)}</span>`).join('')}
          </div>
        ` : ''}
      </div>
      <div class="card-footer">
        ${starsHTML(r.rating)}
        <span class="text-sm text-muted">${r.rating ? r.rating.toFixed(1) : 'Unrated'}</span>
      </div>
    </div>
  `;
}
