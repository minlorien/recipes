import { state } from '../lib/state.js';
import { starsHTML, categoryEmoji, formatTime, icons, toast, shareRecipeText, esc } from '../lib/ui.js';
import { formatAmount } from '../lib/units.js';
import { getSuggestions } from '../lib/ai.js';
import { openEditModal } from './scan.js';

// AI suggestions per recipe id, so re-renders (servings, language, list) don't call the AI again.
const suggestionCache = new Map();

export function renderDetailPage(container) {
  const recipe = state.currentRecipe;
  if (!recipe) {
    // Recipes may still be loading after a refresh; otherwise go back to the list.
    if (state.get('loading')) {
      container.innerHTML = `<div class="page"><div class="empty-state"><div class="spinner" style="margin:0 auto;"></div></div></div>`;
    } else {
      queueMicrotask(() => state.navigate('recipes'));
    }
    return;
  }

  const lang = state.get('displayLang');
  const inShopping = state.get('shoppingList').includes(recipe.id);
  const servings = state.getServings(recipe.id);
  const scale = servings / (recipe.servings || servings);
  const primary = lang === 'de' && recipe.title_de ? recipe.title_de : recipe.title;
  const secondary = lang === 'de' && recipe.title_de ? recipe.title : (recipe.title_de || '');
  const { ingredients, steps } = getDisplayContent(recipe);

  container.innerHTML = `
    <div class="page">
      <div class="flex items-center gap-12 mb-16" style="flex-wrap:wrap;">
        <button class="btn btn-ghost btn-icon" id="back-btn" aria-label="Back">${icons.back}</button>
        <div style="flex:1;"></div>
        <button class="btn btn-ghost btn-icon" id="share-btn" title="Share" aria-label="Share">${icons.share}</button>
        <button class="btn btn-ghost btn-icon" id="edit-btn" title="Edit" aria-label="Edit">${icons.edit}</button>
      </div>

      <div class="recipe-detail">
        <div class="detail-header">
          ${secondary && secondary !== primary ? `<p class="text-sm text-muted mb-8" style="font-style:italic;">${esc(secondary)}</p>` : ''}
          <h1>${esc(primary)}</h1>
          <div class="detail-meta mt-12">
            ${recipe.category ? `<span class="tag tag-green">${categoryEmoji(recipe.category)} ${esc(recipe.category)}</span>` : ''}
            ${recipe.prep_mins ? `<span>Prep: ${formatTime(recipe.prep_mins)}</span>` : ''}
            ${recipe.cook_mins ? `<span>Cook: ${formatTime(recipe.cook_mins)}</span>` : ''}
            ${starsHTML(recipe.rating)}
          </div>
          ${recipe.tags?.length ? `
            <div class="card-tags mt-12">
              ${recipe.tags.map(t => `<span class="tag tag-gray">${esc(t)}</span>`).join('')}
            </div>
          ` : ''}
        </div>

        ${recipe.image_url
          ? `<img src="${esc(recipe.image_url)}" alt="${esc(primary)}" class="detail-img" />`
          : `<div class="detail-img">${categoryEmoji(recipe.category)}</div>`
        }

        <!-- Servings scaler -->
        <div class="card" style="padding:16px;margin-bottom:28px;display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
          <div>
            <div class="text-sm text-muted" style="text-transform:uppercase;letter-spacing:.05em;font-size:.72rem;">Servings</div>
            <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
              <button class="btn btn-outline btn-sm" id="serv-minus" aria-label="Fewer servings" ${servings <= 1 ? 'disabled' : ''}>−</button>
              <span style="font-size:1.2rem;font-weight:500;min-width:24px;text-align:center;">${servings}</span>
              <button class="btn btn-outline btn-sm" id="serv-plus" aria-label="More servings">+</button>
            </div>
          </div>
          <div style="flex:1;"></div>
          <button class="btn ${inShopping ? 'btn-outline' : 'btn-primary'}" id="shopping-btn">
            ${inShopping ? `${icons.check} In shopping list` : `${icons.shopping} Add to list`}
          </button>
        </div>

        ${renderIngredients(ingredients, scale)}
        ${renderSteps(steps)}

        ${recipe.notes ? `
          <div class="detail-section">
            <h3>Notes</h3>
            <p class="text-muted" style="font-size:.92rem;line-height:1.8;white-space:pre-line;">${esc(recipe.notes)}</p>
          </div>
        ` : ''}

        <!-- AI suggestions -->
        <div id="suggestions-area"></div>
      </div>
    </div>
  `;

  document.getElementById('back-btn').addEventListener('click', () => state.navigate('recipes'));
  document.getElementById('share-btn').addEventListener('click', () => shareRecipeText(recipe));
  document.getElementById('edit-btn').addEventListener('click', () => openEditModal(recipe));

  // Servings and shopping list: the state change re-renders this page.
  const updateServings = delta => {
    state.setServings(recipe.id, Math.max(1, state.getServings(recipe.id) + delta));
  };
  document.getElementById('serv-minus').addEventListener('click', () => updateServings(-1));
  document.getElementById('serv-plus').addEventListener('click', () => updateServings(1));

  document.getElementById('shopping-btn').addEventListener('click', () => {
    if (inShopping) {
      state.removeFromShopping(recipe.id);
      toast('Removed from shopping list');
    } else {
      state.addToShopping(recipe.id);
      toast('Added to shopping list! 🛒', 'success');
    }
  });

  loadSuggestions(recipe);
}

function getDisplayContent(recipe) {
  const useDE = state.get('displayLang') === 'de';
  const ingredients = useDE && recipe.ingredients_de?.length ? recipe.ingredients_de : recipe.ingredients;
  const steps = useDE && recipe.steps_de?.length ? recipe.steps_de : recipe.steps;
  return { ingredients: ingredients || [], steps: steps || [] };
}

function renderIngredients(ingredients, scale) {
  return `
    <div class="detail-section">
      <h3>Ingredients</h3>
      <ul class="ingredient-list">
        ${ingredients.map(ing => {
          const scaled = ing.amount ? ing.amount * scale : 0;
          const { main, other } = formatAmount(scaled, ing.unit);
          return `
            <li>
              <span class="ing-name">${esc(ing.name)}${ing.notes ? `<span class="text-muted text-sm"> — ${esc(ing.notes)}</span>` : ''}</span>
              ${scaled ? `
                <span style="text-align:right;">
                  <span class="ing-amount">${esc(main)}</span>
                  ${other ? `<span class="ing-amount-imperial"> / ${esc(other)}</span>` : ''}
                </span>
              ` : '<span class="text-muted text-sm">to taste</span>'}
            </li>
          `;
        }).join('')}
      </ul>
    </div>
  `;
}

function renderSteps(steps) {
  return `
    <div class="detail-section">
      <h3>Method</h3>
      <ol class="steps-list">
        ${steps.map(step => `<li><span>${esc(step)}</span></li>`).join('')}
      </ol>
    </div>
  `;
}

async function loadSuggestions(recipe) {
  const allRecipes = state.get('recipes');
  if (allRecipes.length < 3) return;

  let pending = suggestionCache.get(recipe.id);
  if (!pending) {
    pending = getSuggestions(recipe, allRecipes).catch(() => null); // non-critical
    suggestionCache.set(recipe.id, pending);
  }
  const result = await pending;

  // The page may have been re-rendered or left while waiting.
  const area = document.getElementById('suggestions-area');
  if (!area || state.get('currentRecipeId') !== recipe.id || !result?.suggestions?.length) return;

  const matches = result.suggestions
    .map(title => allRecipes.find(r => r.title.toLowerCase() === String(title).toLowerCase()))
    .filter(r => r && r.id !== recipe.id);
  if (!matches.length) return;

  const lang = state.get('displayLang');
  area.innerHTML = `
    <hr class="divider">
    <div class="detail-section">
      <h3>You might also like</h3>
      <div class="ai-card mb-12">
        <span class="ai-icon">✨</span>
        <div class="ai-text">${esc(result.reason)}</div>
      </div>
      <div class="scroll-x">
        ${matches.map(r => `
          <div class="card" data-id="${esc(r.id)}" role="button" tabindex="0" style="min-width:180px;cursor:pointer;padding:14px;flex-shrink:0;">
            <div style="font-size:1.8rem;margin-bottom:8px;">${categoryEmoji(r.category)}</div>
            <div style="font-family:var(--font-display);font-size:.95rem;font-weight:600;line-height:1.3;">${esc(lang === 'de' && r.title_de ? r.title_de : r.title)}</div>
            <div class="text-sm text-muted mt-8">${esc(r.category)}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  area.querySelectorAll('[data-id]').forEach(card => {
    card.addEventListener('click', () => state.navigate('detail', card.dataset.id));
  });
}
