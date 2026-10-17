import { state, loadRecipes } from '../lib/state.js';
import { icons, toast, fileToBase64, starsHTML, esc } from '../lib/ui.js';
import { extractRecipeFromImage } from '../lib/ai.js';
import { appendRecipe, updateRecipe } from '../lib/sheets.js';

const CATEGORIES = ['Breakfast','Soup','Salad','Main','Side','Dessert','Baking','Drink','Snack','Preserve'];

// Survives re-renders (background refresh, EN/DE toggle) so a scan or a
// half-filled form is never lost. Cleared on save or cancel.
let draft = null;       // { recipe, isEdit }
let scanning = false;   // a photo is being read

export async function checkSharedImage() {
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async (launchParams) => {
      if (!launchParams.files?.length) return;
      const file = await launchParams.files[0].getFile();
      if (file.type.startsWith('image/')) {
        state.navigate('scan');
        scanFile(file);
      }
    });
  }
}

// Navigate to the scan page with an existing recipe in the form.
export function openEditModal(recipe) {
  draft = { recipe: structuredClone(recipe), isEdit: true };
  state.navigate('scan');
}

async function scanFile(file) {
  if (!file || scanning) return;
  scanning = true;
  draft = null;
  rerender();
  try {
    const base64 = await fileToBase64(file);
    const recipe = await extractRecipeFromImage(base64);
    recipe.id = crypto.randomUUID();
    draft = { recipe, isEdit: false };
  } catch (err) {
    toast('Could not read recipe: ' + err.message, 'error');
  } finally {
    scanning = false;
    rerender();
  }
}

// Re-draw the scan page if it is the one showing.
function rerender() {
  const container = document.getElementById('page-content');
  if (container && state.get('currentPage') === 'scan') renderScanPage(container);
}

export function renderScanPage(container) {
  if (draft) {
    container.innerHTML = `<div class="page" id="recipe-form-area"></div>`;
    showRecipeForm(container.querySelector('#recipe-form-area'));
    return;
  }

  if (scanning) {
    container.innerHTML = `
      <div class="page">
        <div style="text-align:center;padding:48px 0;">
          <div class="spinner" style="margin:0 auto 16px;width:36px;height:36px;border-width:3px;"></div>
          <h2 style="font-style:italic;">Reading recipe…</h2>
          <p class="text-muted mt-8">This can take up to a minute.</p>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="page">
      <h2 style="font-style:italic;margin-bottom:6px;">Add a Recipe</h2>
      <p class="text-muted text-sm mb-20">Scan a photo or enter details manually.</p>

      <div class="upload-zone" id="upload-zone">
        <input type="file" id="file-input" accept="image/*" capture="environment" style="display:none;" />
        <div class="upload-icon">📷</div>
        <p><strong>Take a photo</strong> of the recipe page<br>
        or tap to choose an image from your library</p>
        <p class="text-muted text-sm mt-8">Tip: hold the phone straight above the page,<br>page the right way up, in good light.</p>
        <br>
        <button class="btn btn-primary" id="camera-btn">${icons.scan} Scan Recipe</button>
      </div>

      <div class="flex items-center gap-12 mt-20 mb-20">
        <hr style="flex:1;border-top:1px solid var(--border);">
        <span class="text-muted text-sm">or enter manually</span>
        <hr style="flex:1;border-top:1px solid var(--border);">
      </div>

      <button class="btn btn-outline w-full" id="manual-btn">
        ${icons.edit} Enter Recipe Manually
      </button>
    </div>
  `;

  const zone = container.querySelector('#upload-zone');
  const fileInput = container.querySelector('#file-input');

  zone.addEventListener('click', e => {
    if (e.target !== fileInput) fileInput.click();
  });

  // Drag & drop (desktop)
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag-over'); scanFile(e.dataTransfer.files[0]); });

  fileInput.addEventListener('change', e => scanFile(e.target.files[0]));
  container.querySelector('#manual-btn').addEventListener('click', () => {
    draft = { recipe: emptyRecipe(), isEdit: false };
    rerender();
  });
}

function emptyRecipe() {
  return {
    id: crypto.randomUUID(), title: '', title_de: '', category: '', servings: 4, prep_mins: 0,
    cook_mins: 0, rating: 0, tags: [], ingredients: [], steps: [], notes: '', language: 'en',
  };
}

function showRecipeForm(formArea) {
  const { recipe: r, isEdit } = draft;
  const hasGerman = r.ingredients_de?.length || r.steps_de?.length;

  formArea.innerHTML = `
    <h2 style="font-style:italic;margin-bottom:20px;">${isEdit ? 'Edit Recipe' : 'Review & Save'}</h2>

    <div class="flex flex-col gap-16" id="recipe-form">
      <div class="form-group">
        <label for="f-title">Title (English)</label>
        <input type="text" id="f-title" value="${esc(r.title)}" placeholder="Recipe name" />
      </div>

      <div class="form-group">
        <label for="f-title-de">Title (German)</label>
        <input type="text" id="f-title-de" value="${esc(r.title_de)}" placeholder="Rezeptname" />
      </div>

      <div class="form-row">
        <div class="form-group">
          <label for="f-category">Category</label>
          <select id="f-category">
            <option value="">— select —</option>
            ${CATEGORIES.map(c => `<option value="${c}" ${r.category === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label for="f-language">Language</label>
          <select id="f-language">
            <option value="en" ${r.language !== 'de' ? 'selected' : ''}>English</option>
            <option value="de" ${r.language === 'de' ? 'selected' : ''}>German</option>
          </select>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label for="f-servings">Servings</label>
          <input type="number" id="f-servings" value="${r.servings || 4}" min="1" inputmode="numeric" />
        </div>
        <div class="form-group">
          <label for="f-prep">Prep time (mins)</label>
          <input type="number" id="f-prep" value="${r.prep_mins || 0}" min="0" inputmode="numeric" />
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label for="f-cook">Cook time (mins)</label>
          <input type="number" id="f-cook" value="${r.cook_mins || 0}" min="0" inputmode="numeric" />
        </div>
        <div class="form-group">
          <label>Family rating</label>
          ${starsHTML(r.rating, true, 'star-rating')}
        </div>
      </div>

      <div class="form-group">
        <label for="f-tags">Tags (comma separated)</label>
        <input type="text" id="f-tags" value="${esc(Array.isArray(r.tags) ? r.tags.join(', ') : (r.tags || ''))}"
          placeholder="e.g. vegetarian, quick, family-favourite" />
      </div>

      <!-- Ingredients -->
      <div>
        <div class="section-header">
          <h3>Ingredients</h3>
          <button class="btn btn-outline btn-sm" id="add-ing-btn">${icons.plus} Add</button>
        </div>
        <p class="text-muted text-sm mb-8">Amounts as written in the recipe, e.g. 1.5 tsp, 1 cup, 200 g. Leave the amount empty for "to taste".</p>
        <div id="ingredients-list">
          ${(r.ingredients || []).map(ingredientRowHTML).join('')}
        </div>
      </div>

      <!-- Steps -->
      <div>
        <div class="section-header">
          <h3>Steps</h3>
          <button class="btn btn-outline btn-sm" id="add-step-btn">${icons.plus} Add</button>
        </div>
        <div id="steps-list">
          ${(r.steps || []).map(stepRowHTML).join('')}
        </div>
      </div>

      ${isEdit && hasGerman ? `
        <p class="text-muted text-sm">Note: changes to ingredients and steps here don't update the German version.</p>
      ` : ''}

      <div class="form-group">
        <label for="f-notes">Notes & Tips</label>
        <textarea id="f-notes" rows="3" placeholder="Any tips, variations, or notes…">${esc(r.notes)}</textarea>
      </div>

      <div class="flex gap-12" style="flex-wrap:wrap;">
        <button class="btn btn-primary btn-lg" id="save-btn" style="flex:1;">
          ${icons.check} ${isEdit ? 'Save Changes' : 'Save Recipe'}
        </button>
        <button class="btn btn-ghost" id="cancel-btn">Cancel</button>
      </div>
    </div>
  `;

  const form = formArea.querySelector('#recipe-form');
  // Keep the draft in sync with what's typed, so a re-render restores it.
  const syncDraft = () => { draft.recipe = collectForm(form, draft.recipe); };
  form.addEventListener('input', syncDraft);
  form.addEventListener('change', syncDraft);

  // Star rating
  const starContainer = form.querySelector('#star-rating');
  starContainer.style.cssText = 'display:flex;gap:4px;margin-top:4px;';
  starContainer.querySelectorAll('.star').forEach(star => {
    star.addEventListener('click', () => {
      const rating = parseInt(star.dataset.val);
      draft.recipe.rating = draft.recipe.rating === rating ? 0 : rating; // tap again to clear
      starContainer.querySelectorAll('.star').forEach((s, i) => {
        s.className = `star ${i < draft.recipe.rating ? 'filled' : 'empty'}`;
      });
    });
  });

  // Add rows
  form.querySelector('#add-ing-btn').addEventListener('click', () => {
    const list = form.querySelector('#ingredients-list');
    list.insertAdjacentHTML('beforeend', ingredientRowHTML({}));
    list.lastElementChild.querySelector('.ing-name').focus();
    syncDraft();
  });
  form.querySelector('#add-step-btn').addEventListener('click', () => {
    const list = form.querySelector('#steps-list');
    list.insertAdjacentHTML('beforeend', stepRowHTML('', list.children.length));
    list.lastElementChild.querySelector('textarea').focus();
    syncDraft();
  });

  // Delete rows (delegated)
  form.querySelector('#ingredients-list').addEventListener('click', e => {
    if (e.target.closest('.del-ing')) { e.target.closest('.ing-row').remove(); syncDraft(); }
  });
  form.querySelector('#steps-list').addEventListener('click', e => {
    if (e.target.closest('.del-step')) {
      e.target.closest('.step-row').remove();
      form.querySelectorAll('.step-num').forEach((n, i) => { n.textContent = i + 1; });
      syncDraft();
    }
  });

  form.querySelector('#cancel-btn').addEventListener('click', () => {
    const wasEdit = draft.isEdit;
    const id = draft.recipe.id;
    draft = null;
    if (wasEdit) state.navigate('detail', id);
    else rerender();
  });

  form.querySelector('#save-btn').addEventListener('click', async () => {
    const btn = form.querySelector('#save-btn');
    const recipe = collectForm(form, draft.recipe);
    if (!recipe.title && !recipe.title_de) {
      toast('Please give the recipe a title', 'error');
      form.querySelector('#f-title').focus();
      return;
    }
    const isEditNow = draft.isEdit;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Saving…';

    try {
      if (isEditNow) await updateRecipe(recipe);
      else await appendRecipe(recipe);
      draft = null;
      await loadRecipes();
      toast(isEditNow ? 'Changes saved ✓' : 'Recipe saved! 🎉', 'success');
      state.navigate('detail', recipe.id);
    } catch (err) {
      toast('Save failed: ' + err.message, 'error');
      btn.disabled = false;
      btn.innerHTML = `${icons.check} ${isEditNow ? 'Save Changes' : 'Save Recipe'}`;
    }
  });
}

function collectForm(form, existing) {
  const val = sel => form.querySelector(sel)?.value?.trim() || '';
  const tags = val('#f-tags').split(',').map(t => t.trim()).filter(Boolean);

  const ingredients = [];
  form.querySelectorAll('.ing-row').forEach(row => {
    const name = row.querySelector('.ing-name').value.trim();
    if (!name) return;
    ingredients.push({
      name,
      amount: parseFloat(String(row.querySelector('.ing-amount-val').value).replace(',', '.')) || 0,
      unit: row.querySelector('.ing-unit').value.trim(),
      notes: row.querySelector('.ing-notes').value.trim(),
    });
  });

  const steps = [];
  form.querySelectorAll('.step-row textarea').forEach(ta => {
    const s = ta.value.trim();
    if (s) steps.push(s);
  });

  return {
    ...existing,
    title: val('#f-title'),
    title_de: val('#f-title-de'),
    category: val('#f-category'),
    language: val('#f-language') || 'en',
    servings: parseInt(val('#f-servings')) || 4,
    prep_mins: parseInt(val('#f-prep')) || 0,
    cook_mins: parseInt(val('#f-cook')) || 0,
    rating: existing.rating || 0,
    tags,
    ingredients,
    steps,
    notes: val('#f-notes'),
    image_url: existing.image_url || '',
    created_at: existing.created_at || new Date().toISOString(),
    ingredients_de: existing.ingredients_de || [],
    steps_de: existing.steps_de || [],
  };
}

function ingredientRowHTML(ing) {
  return `
    <div class="ing-row" style="display:grid;grid-template-columns:1fr 72px 64px auto;gap:6px;margin-bottom:10px;align-items:center;">
      <input class="ing-name" type="text" value="${esc(ing.name)}" placeholder="Ingredient" aria-label="Ingredient" />
      <input class="ing-amount-val" type="text" inputmode="decimal" value="${ing.amount ? esc(ing.amount) : ''}" placeholder="Amt" aria-label="Amount" />
      <input class="ing-unit" type="text" value="${esc(ing.unit)}" placeholder="Unit" aria-label="Unit" />
      <button class="btn btn-ghost btn-icon del-ing" title="Remove" aria-label="Remove ingredient" style="color:var(--rust);">${icons.trash}</button>
      <input class="ing-notes" type="text" value="${esc(ing.notes)}" placeholder="Note, e.g. finely chopped (optional)"
        aria-label="Note" style="grid-column:1 / 4;font-size:.85rem;padding-top:6px;padding-bottom:6px;" />
    </div>
  `;
}

function stepRowHTML(step, i) {
  return `
    <div class="step-row" style="display:flex;gap:8px;margin-bottom:8px;align-items:flex-start;">
      <span class="step-num" style="min-width:24px;height:24px;background:var(--forest);color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.75rem;font-weight:500;margin-top:10px;flex-shrink:0;">${i + 1}</span>
      <textarea rows="2" style="flex:1;resize:vertical;" aria-label="Step ${i + 1}">${esc(step)}</textarea>
      <button class="btn btn-ghost btn-icon del-step" title="Remove" aria-label="Remove step" style="color:var(--rust);margin-top:6px;">${icons.trash}</button>
    </div>
  `;
}
