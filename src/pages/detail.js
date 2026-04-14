import { state } from '../lib/state.js';
import { starsHTML, categoryEmoji, formatTime, icons, toast, shareRecipeText } from '../lib/ui.js';
import { formatAmount } from '../lib/units.js';
import { getSuggestions } from '../lib/ai.js';

export function renderDetailPage(container) {
  const recipe = state.currentRecipe;
  if (!recipe) { state.navigate('recipes'); return; }

  const inShopping = state.get('shoppingList').includes(recipe.id);
  const servings = state.getServings(recipe.id);
  const scale = servings / (recipe.servings || servings);

  container.innerHTML = `
    <div class="page">
      <div class="flex items-center gap-12 mb-16" style="flex-wrap:wrap;">
        <button class="btn btn-ghost btn-icon" id="back-btn">${icons.back}</button>
        <div style="flex:1;"></div>
        <button class="btn btn-ghost btn-icon" id="share-btn" title="Share">${icons.share}</button>
        <button class="btn btn-ghost btn-icon" id="edit-btn" title="Edit">${icons.edit}</button>
      </div>

      <div class="recipe-detail">
        <div class="detail-header">
          ${recipe.language === 'de' && recipe.title_de ? `
            <p class="text-sm text-muted mb-8" style="font-style:italic;">${recipe.title_de}</p>
          ` : ''}
          <h1>${recipe.title}</h1>
          <div class="detail-meta mt-12">
            ${recipe.category ? `<span class="tag tag-green">${categoryEmoji(recipe.category)} ${recipe.category}</span>` : ''}
            ${recipe.prep_mins ? `<span>Prep: ${formatTime(recipe.prep_mins)}</span>` : ''}
            ${recipe.cook_mins ? `<span>Cook: ${formatTime(recipe.cook_mins)}</span>` : ''}
            ${starsHTML(recipe.rating)}
          </div>
          ${recipe.tags?.length ? `
            <div class="card-tags mt-12">
              ${recipe.tags.map(t => `<span class="tag tag-gray">${t}</span>`).join('')}
            </div>
          ` : ''}
        </div>

        ${recipe.image_url
          ? `<img src="${recipe.image_url}" alt="${recipe.title}" class="detail-img" />`
          : `<div class="detail-img">${categoryEmoji(recipe.category)}</div>`
        }

        <!-- Servings scaler -->
        <div class="card" style="padding:16px;margin-bottom:28px;display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
          <div>
            <div class="text-sm text-muted" style="text-transform:uppercase;letter-spacing:.05em;font-size:.72rem;">Servings</div>
            <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
              <button class="btn btn-outline btn-sm" id="serv-minus" ${servings <= 1 ? 'disabled' : ''}>−</button>
              <span style="font-size:1.2rem;font-weight:500;min-width:24px;text-align:center;" id="serv-count">${servings}</span>
              <button class="btn btn-outline btn-sm" id="serv-plus">+</button>
            </div>
          </div>
          <div style="flex:1;"></div>
          <button class="btn ${inShopping ? 'btn-outline' : 'btn-primary'}" id="shopping-btn">
            ${inShopping ? `${icons.check} In shopping list` : `${icons.shopping} Add to list`}
          </button>
        </div>

        <!-- Ingredients -->
        <div class="detail-section">
          <h3>Ingredients</h3>
          <ul class="ingredient-list">
            ${recipe.ingredients.map(ing => {
              const scaled = ing.amount ? ing.amount * scale : 0;
              const { metric, imperial } = formatAmount(scaled, ing.unit);
              return `
                <li>
                  <span class="ing-name">${ing.name}${ing.notes ? `<span class="text-muted text-sm"> — ${ing.notes}</span>` : ''}</span>
                  ${scaled ? `
                    <span style="text-align:right;">
                      <span class="ing-amount">${metric}</span>
                      ${imperial ? `<span class="ing-amount-imperial"> / ${imperial}</span>` : ''}
                    </span>
                  ` : '<span class="text-muted text-sm">to taste</span>'}
                </li>
              `;
            }).join('')}
          </ul>
        </div>

        <!-- Steps -->
        <div class="detail-section">
          <h3>Method</h3>
          <ol class="steps-list">
            ${recipe.steps.map(step => `<li><span>${step}</span></li>`).join('')}
          </ol>
        </div>

        ${recipe.notes ? `
          <div class="detail-section">
            <h3>Notes</h3>
            <p class="text-muted" style="font-size:.92rem;line-height:1.8;">${recipe.notes}</p>
          </div>
        ` : ''}

        <!-- AI suggestions -->
        <div id="suggestions-area"></div>

      </div>
    </div>
  `;

  // Back
  document.getElementById('back-btn').addEventListener('click', () => state.navigate('recipes'));

  // Share
  document.getElementById('share-btn').addEventListener('click', () => shareRecipeText(recipe));

  // Edit
  document.getElementById('edit-btn').addEventListener('click', () => {
    import('./scan.js').then(m => m.openEditModal(recipe));
  });

  // Servings
  const updateServings = (delta) => {
    const current = state.getServings(recipe.id);
    const next = Math.max(1, current + delta);
    state.setServings(recipe.id, next);
    renderDetailPage(container);
  };
  document.getElementById('serv-minus')?.addEventListener('click', () => updateServings(-1));
  document.getElementById('serv-plus')?.addEventListener('click', () => updateServings(1));

  // Shopping
  document.getElementById('shopping-btn').addEventListener('click', () => {
    if (inShopping) {
      state.removeFromShopping(recipe.id);
      toast('Removed from shopping list');
    } else {
      state.addToShopping(recipe.id);
      toast('Added to shopping list! 🛒', 'success');
    }
    renderDetailPage(container);
  });

  // Load AI suggestions quietly
  loadSuggestions(recipe);
}

async function loadSuggestions(recipe) {
  const area = document.getElementById('suggestions-area');
  if (!area) return;
  const allRecipes = state.get('recipes');
  if (allRecipes.length < 3) return;

  try {
    const { suggestions, reason } = await getSuggestions(recipe, allRecipes);
    if (!suggestions?.length) return;
    const matches = suggestions
      .map(title => allRecipes.find(r => r.title.toLowerCase() === title.toLowerCase()))
      .filter(Boolean);
    if (!matches.length) return;

    area.innerHTML = `
      <hr class="divider">
      <div class="detail-section">
        <h3>You might also like</h3>
        <div class="ai-card mb-12">
          <span class="ai-icon">✨</span>
          <div class="ai-text">${reason}</div>
        </div>
        <div class="scroll-x">
          ${matches.map(r => `
            <div class="card" data-id="${r.id}" style="min-width:180px;cursor:pointer;padding:14px;flex-shrink:0;">
              <div style="font-size:1.8rem;margin-bottom:8px;">${categoryEmoji(r.category)}</div>
              <div style="font-family:var(--font-display);font-size:.95rem;font-weight:600;line-height:1.3;">${r.title}</div>
              <div class="text-sm text-muted mt-8">${r.category}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    area.querySelectorAll('[data-id]').forEach(card => {
      card.addEventListener('click', () => state.navigate('detail', card.dataset.id));
    });
  } catch (e) {
    // Silently fail - suggestions are non-critical
  }
}
