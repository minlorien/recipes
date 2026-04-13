import { state } from '../lib/state.js';
import { icons, toast, shareRecipeText } from '../lib/ui.js';
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
    document.getElementById('go-recipes-btn').addEventListener('click', () => state.navigate('recipes'));
    return;
  }

  // Checked state persisted locally
  const checked = JSON.parse(sessionStorage.getItem('shopping-checked') || '{}');

  // Build ingredient lists with current servings
  const ingredientLists = shoppingRecipes.map(recipe => ({
    recipe: recipe.title,
    ingredients: recipe.ingredients || [],
    servings: state.getServings(recipe.id),
    baseServings: recipe.servings || 4,
  }));
  const merged = mergeIngredients(ingredientLists);

  container.innerHTML = `
    <div class="page">
      <div class="section-header mb-16">
        <h2 style="font-style:italic;">Shopping List</h2>
        <div class="flex gap-8">
          <button class="btn btn-ghost btn-sm" id="share-list-btn">${icons.share}</button>
          <button class="btn btn-ghost btn-sm" id="clear-checked-btn">Clear checked</button>
        </div>
      </div>

      <!-- Selected recipes -->
      <div class="mb-20">
        <h3 class="mb-12">For these recipes</h3>
        <div class="scroll-x">
          ${shoppingRecipes.map(r => `
            <div class="card" style="padding:12px 14px;min-width:140px;flex-shrink:0;display:flex;flex-direction:column;gap:6px;">
              <div style="font-family:var(--font-display);font-size:.9rem;font-weight:600;line-height:1.3;">${r.title}</div>
              <div style="display:flex;align-items:center;gap:6px;">
                <button class="btn btn-ghost btn-icon" data-id="${r.id}" data-dir="-1" style="padding:2px 6px;font-size:1rem;">−</button>
                <span style="font-size:.88rem;font-weight:500;" id="serv-${r.id}">${state.getServings(r.id)}</span>
                <span class="text-muted text-sm">serv.</span>
                <button class="btn btn-ghost btn-icon" data-id="${r.id}" data-dir="1" style="padding:2px 6px;font-size:1rem;">+</button>
                <button class="btn btn-danger btn-icon" data-remove="${r.id}" style="margin-left:auto;" title="Remove">${icons.trash}</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <hr class="divider">

      <!-- Merged shopping list -->
      <div class="section-header mb-8">
        <h3>${merged.length} items</h3>
        <span class="text-sm text-muted">${Object.values(checked).filter(Boolean).length} checked</span>
      </div>
      <ul class="shopping-list" id="shopping-items">
        ${merged.map((item, i) => {
          const key = item.name.toLowerCase();
          const isChecked = !!checked[key];
          return `
            <li class="shopping-item" data-key="${key}">
              <input type="checkbox" ${isChecked ? 'checked' : ''} data-key="${key}" />
              <div style="flex:1;">
                <span class="item-text ${isChecked ? 'checked' : ''}">${item.name}</span>
                <span class="item-recipe">${item.recipes.join(', ')}</span>
              </div>
              <div style="text-align:right;">
                <span class="item-amount">${item.metric}</span>
                ${item.imperial ? `<br><span class="text-sm text-muted">${item.imperial}</span>` : ''}
              </div>
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

  // Check/uncheck
  container.querySelectorAll('.shopping-item input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const key = cb.dataset.key;
      checked[key] = cb.checked;
      sessionStorage.setItem('shopping-checked', JSON.stringify(checked));
      const textEl = cb.closest('.shopping-item').querySelector('.item-text');
      if (textEl) textEl.className = `item-text ${cb.checked ? 'checked' : ''}`;
      // update count
      const checkedCount = Object.values(checked).filter(Boolean).length;
      container.querySelector('.text-sm.text-muted').textContent = `${checkedCount} checked`;
    });
  });

  // Servings adjust
  container.querySelectorAll('[data-dir]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const dir = parseInt(btn.dataset.dir);
      const current = state.getServings(id);
      const next = Math.max(1, current + dir);
      state.setServings(id, next);
      renderShoppingPage(container);
    });
  });

  // Remove recipe
  container.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.removeFromShopping(btn.dataset.remove);
      renderShoppingPage(container);
    });
  });

  // Clear checked
  document.getElementById('clear-checked-btn').addEventListener('click', () => {
    Object.keys(checked).forEach(k => delete checked[k]);
    sessionStorage.setItem('shopping-checked', '{}');
    renderShoppingPage(container);
  });

  // Clear all
  document.getElementById('clear-all-btn').addEventListener('click', () => {
    if (window.confirm('Clear the entire shopping list?')) {
      shoppingRecipes.forEach(r => state.removeFromShopping(r.id));
      sessionStorage.setItem('shopping-checked', '{}');
      renderShoppingPage(container);
    }
  });

  // Share list
  document.getElementById('share-list-btn').addEventListener('click', () => {
    const text = `🛒 Shopping List\n\n` +
      `For: ${shoppingRecipes.map(r => r.title).join(', ')}\n\n` +
      merged.map(item => `• ${item.name}: ${item.metric}${item.imperial ? ` (${item.imperial})` : ''}`).join('\n') +
      `\n\nFrom our family recipe book 📖`;

    if (navigator.share) {
      navigator.share({ title: 'Shopping List', text }).catch(() => {});
    } else {
      navigator.clipboard.writeText(text).then(() => toast('List copied to clipboard! 📋', 'success'));
    }
  });
}
