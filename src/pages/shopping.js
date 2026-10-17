import { state } from '../lib/state.js';
import { icons, toast, esc } from '../lib/ui.js';
import { mergeIngredients } from '../lib/units.js';

export function renderShoppingPage(container) {
  const shoppingRecipes = state.shoppingRecipes;

  if (shoppingRecipes.length === 0) {
    container.innerHTML = `
      <div class="page">
        <h2 style="font-style:italic;margin-bottom:6px;">Shopping List</h2>
        <div class="empty-state" style="padding:48px 0;">
          <div class="empty-icon">🛒</div>
          <h2>List is empty</h2>
          <p>Open a recipe and tap "Add to list" to build your shopping list.</p>
          <button class="btn btn-primary" id="go-recipes-btn">${icons.home} Browse Recipes</button>
        </div>
      </div>
    `;
    container.querySelector('#go-recipes-btn').addEventListener('click', () => state.navigate('recipes'));
    return;
  }

  const useDE = state.get('displayLang') === 'de';
  const titleOf = r => (useDE && r.title_de ? r.title_de : r.title);
  const checked = state.get('shoppingChecked');

  // Build ingredient lists with current servings, in the display language
  const merged = mergeIngredients(shoppingRecipes.map(recipe => ({
    recipe: titleOf(recipe),
    ingredients: (useDE && recipe.ingredients_de?.length ? recipe.ingredients_de : recipe.ingredients) || [],
    servings: state.getServings(recipe.id),
    baseServings: recipe.servings || 4,
  })));
  const checkedCount = () => merged.filter(m => checked[m.key]).length;

  container.innerHTML = `
    <div class="page">
      <div class="section-header mb-16">
        <h2 style="font-style:italic;">Shopping List</h2>
        <div class="flex gap-8">
          <button class="btn btn-ghost btn-sm" id="share-list-btn" aria-label="Share list">${icons.share}</button>
          <button class="btn btn-ghost btn-sm" id="clear-checked-btn">Untick all</button>
        </div>
      </div>

      <!-- Selected recipes -->
      <div class="mb-20">
        <h3 class="mb-12">For these recipes</h3>
        <div class="scroll-x">
          ${shoppingRecipes.map(r => `
            <div class="card" style="padding:12px 14px;min-width:150px;flex-shrink:0;display:flex;flex-direction:column;gap:6px;">
              <div style="font-family:var(--font-display);font-size:.9rem;font-weight:600;line-height:1.3;">${esc(titleOf(r))}</div>
              <div style="display:flex;align-items:center;gap:6px;">
                <button class="btn btn-ghost btn-icon" data-id="${esc(r.id)}" data-dir="-1" aria-label="Fewer servings" style="padding:6px 10px;font-size:1.1rem;">−</button>
                <span style="font-size:.88rem;font-weight:500;">${state.getServings(r.id)}</span>
                <span class="text-muted text-sm">serv.</span>
                <button class="btn btn-ghost btn-icon" data-id="${esc(r.id)}" data-dir="1" aria-label="More servings" style="padding:6px 10px;font-size:1.1rem;">+</button>
                <button class="btn btn-danger btn-icon" data-remove="${esc(r.id)}" style="margin-left:auto;" title="Remove" aria-label="Remove recipe from list">${icons.trash}</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <hr class="divider">

      <!-- Merged shopping list -->
      <div class="section-header mb-8">
        <h3>${merged.length} items</h3>
        <span class="text-sm text-muted" id="checked-count">${checkedCount()} ticked</span>
      </div>
      <ul class="shopping-list">
        ${merged.map(item => {
          const isChecked = !!checked[item.key];
          return `
            <li class="shopping-item">
              <label style="display:flex;align-items:center;gap:12px;flex:1;cursor:pointer;">
                <input type="checkbox" ${isChecked ? 'checked' : ''} data-key="${esc(item.key)}" />
                <div style="flex:1;">
                  <span class="item-text ${isChecked ? 'checked' : ''}">${esc(item.name)}</span>
                  <span class="item-recipe">${esc(item.recipes.join(', '))}</span>
                </div>
                <div style="text-align:right;">
                  ${item.totalAmount ? `
                    <span class="item-amount">${esc(item.metric)}</span>
                    ${item.imperial ? `<br><span class="text-sm text-muted">${esc(item.imperial)}</span>` : ''}
                  ` : ''}
                </div>
              </label>
            </li>
          `;
        }).join('')}
      </ul>

      <hr class="divider">
      <button class="btn btn-danger w-full mt-12" id="clear-all-btn">
        ${icons.trash} Clear entire list
      </button>
    </div>
  `;

  // Tick / untick (no re-render, so the list doesn't jump)
  container.querySelectorAll('.shopping-item input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      state.setChecked(cb.dataset.key, cb.checked);
      checked[cb.dataset.key] = cb.checked;
      cb.closest('.shopping-item').querySelector('.item-text').classList.toggle('checked', cb.checked);
      container.querySelector('#checked-count').textContent = `${checkedCount()} ticked`;
    });
  });

  // Servings (the state change re-renders this page)
  container.querySelectorAll('[data-dir]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      state.setServings(id, Math.max(1, state.getServings(id) + parseInt(btn.dataset.dir)));
    });
  });

  container.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', () => state.removeFromShopping(btn.dataset.remove));
  });

  container.querySelector('#clear-checked-btn').addEventListener('click', () => state.clearChecked());

  container.querySelector('#clear-all-btn').addEventListener('click', () => {
    if (window.confirm('Clear the entire shopping list?')) state.clearShopping();
  });

  container.querySelector('#share-list-btn').addEventListener('click', () => {
    const text = `🛒 Shopping List\n\n` +
      `For: ${shoppingRecipes.map(titleOf).join(', ')}\n\n` +
      merged.map(item => `• ${item.name}${item.totalAmount ? `: ${item.metric}${item.imperial ? ` (${item.imperial})` : ''}` : ''}`).join('\n') +
      `\n\nFrom our family recipe book 📖`;

    if (navigator.share) {
      navigator.share({ title: 'Shopping List', text }).catch(() => {});
    } else {
      navigator.clipboard.writeText(text)
        .then(() => toast('List copied to clipboard! 📋', 'success'))
        .catch(() => toast('Could not copy the list', 'error'));
    }
  });
}
