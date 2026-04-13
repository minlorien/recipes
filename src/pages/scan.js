import { state, loadRecipes } from '../lib/state.js';
import { icons, toast, fileToBase64, starsHTML } from '../lib/ui.js';
import { extractRecipeFromImage } from '../lib/ai.js';
import { appendRecipe, updateRecipe } from '../lib/sheets.js';

const CATEGORIES = ['Breakfast','Soup','Salad','Main','Side','Dessert','Baking','Drink','Snack','Preserve'];

export function renderScanPage(container) {
  container.innerHTML = `
    <div class="page">
      <h2 style="font-style:italic;margin-bottom:6px;">Add a Recipe</h2>
      <p class="text-muted text-sm mb-20">Scan a photo or enter details manually.</p>

      <div class="upload-zone" id="upload-zone">
        <input type="file" id="file-input" accept="image/*" capture="environment" style="display:none;" />
        <div class="upload-icon">📷</div>
        <p><strong>Take a photo</strong> of the recipe page<br>
        or tap to choose an image from your library</p>
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

      <!-- Processing overlay -->
      <div id="processing" class="hidden" style="text-align:center;padding:48px 0;">
        <div class="spinner" style="margin:0 auto 16px;width:36px;height:36px;border-width:3px;"></div>
        <h2 style="font-style:italic;">Reading recipe…</h2>
        <p class="text-muted mt-8">AI is extracting ingredients and steps</p>
      </div>

      <!-- Edit form (hidden until recipe loaded) -->
      <div id="recipe-form-area" class="hidden mt-20"></div>
    </div>
  `;

  const zone = document.getElementById('upload-zone');
  const fileInput = document.getElementById('file-input');

  document.getElementById('camera-btn').addEventListener('click', () => fileInput.click());
  zone.addEventListener('click', e => { if (e.target !== document.getElementById('camera-btn')) fileInput.click(); });

  // Drag & drop
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag-over'); handleFile(e.dataTransfer.files[0]); });

  fileInput.addEventListener('change', e => handleFile(e.target.files[0]));
  document.getElementById('manual-btn').addEventListener('click', () => showRecipeForm(null, container));

  async function handleFile(file) {
    if (!file) return;
    zone.classList.add('hidden');
    document.getElementById('manual-btn').closest('.flex')?.classList.add('hidden');
    document.getElementById('manual-btn').classList.add('hidden');
    document.getElementById('processing').classList.remove('hidden');

    try {
      const base64 = await fileToBase64(file);
      const recipe = await extractRecipeFromImage(base64, file.type);
      recipe.id = crypto.randomUUID();
      document.getElementById('processing').classList.add('hidden');
      showRecipeForm(recipe, container);
    } catch (err) {
      document.getElementById('processing').classList.add('hidden');
      zone.classList.remove('hidden');
      document.getElementById('manual-btn').classList.remove('hidden');
      toast('Could not read recipe: ' + err.message, 'error');
    }
  }
}

export function openEditModal(recipe) {
  // Navigate to scan page in edit mode
  state.navigate('scan');
  setTimeout(() => {
    const area = document.getElementById('recipe-form-area');
    const zone = document.getElementById('upload-zone');
    const manualBtn = document.getElementById('manual-btn');
    if (area && zone && manualBtn) {
      zone.classList.add('hidden');
      manualBtn.closest('.flex')?.classList.add('hidden');
      manualBtn.classList.add('hidden');
      area.classList.remove('hidden');
      showRecipeForm(recipe, document.querySelector('.page')?.parentElement);
    }
  }, 100);
}

function showRecipeForm(recipe, container) {
  const formArea = document.getElementById('recipe-form-area');
  if (!formArea) return;
  formArea.classList.remove('hidden');

  const isEdit = !!(recipe?.id && state.get('recipes').find(r => r.id === recipe.id));
  const r = recipe || { title: '', category: '', servings: 4, prep_mins: 0, cook_mins: 0, rating: 0, tags: [], ingredients: [], steps: [], notes: '', language: 'en' };

  formArea.innerHTML = `
    <h2 style="font-style:italic;margin-bottom:20px;">${isEdit ? 'Edit Recipe' : 'Review & Save'}</h2>

    <div class="flex flex-col gap-16">
      <div class="form-group">
        <label>Title (English)</label>
        <input type="text" id="f-title" value="${esc(r.title)}" placeholder="Recipe name" />
      </div>

      ${r.language === 'de' || r.title_de ? `
        <div class="form-group">
          <label>Title (German)</label>
          <input type="text" id="f-title-de" value="${esc(r.title_de || '')}" placeholder="Rezeptname" />
        </div>
      ` : ''}

      <div class="form-row">
        <div class="form-group">
          <label>Category</label>
          <select id="f-category">
            <option value="">— select —</option>
            ${CATEGORIES.map(c => `<option value="${c}" ${r.category === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Language</label>
          <select id="f-language">
            <option value="en" ${r.language !== 'de' ? 'selected' : ''}>English</option>
            <option value="de" ${r.language === 'de' ? 'selected' : ''}>German</option>
          </select>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label>Servings</label>
          <input type="number" id="f-servings" value="${r.servings || 4}" min="1" />
        </div>
        <div class="form-group">
          <label>Prep time (mins)</label>
          <input type="number" id="f-prep" value="${r.prep_mins || 0}" min="0" />
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label>Cook time (mins)</label>
          <input type="number" id="f-cook" value="${r.cook_mins || 0}" min="0" />
        </div>
        <div class="form-group">
          <label>Family rating</label>
          ${starsHTML(r.rating, true, 'star-rating')}
        </div>
      </div>

      <div class="form-group">
        <label>Tags (comma separated)</label>
        <input type="text" id="f-tags" value="${Array.isArray(r.tags) ? r.tags.join(', ') : (r.tags || '')}"
          placeholder="e.g. vegetarian, quick, family-favourite" />
      </div>

      <!-- Ingredients -->
      <div>
        <div class="section-header">
          <h3>Ingredients</h3>
          <button class="btn btn-outline btn-sm" id="add-ing-btn">${icons.plus} Add</button>
        </div>
        <div id="ingredients-list">
          ${(r.ingredients || []).map((ing, i) => ingredientRowHTML(ing, i)).join('')}
        </div>
      </div>

      <!-- Steps -->
      <div>
        <div class="section-header">
          <h3>Steps</h3>
          <button class="btn btn-outline btn-sm" id="add-step-btn">${icons.plus} Add</button>
        </div>
        <div id="steps-list">
          ${(r.steps || []).map((step, i) => stepRowHTML(step, i)).join('')}
        </div>
      </div>

      <div class="form-group">
        <label>Notes & Tips</label>
        <textarea id="f-notes" rows="3" placeholder="Any tips, variations, or notes…">${esc(r.notes || '')}</textarea>
      </div>

      <div class="flex gap-12" style="flex-wrap:wrap;">
        <button class="btn btn-primary btn-lg" id="save-btn" style="flex:1;">
          ${isEdit ? `${icons.check} Save Changes` : `${icons.check} Save Recipe`}
        </button>
        <button class="btn btn-ghost" id="cancel-btn">Cancel</button>
      </div>
    </div>
  `;

  // Star rating interaction
  let currentRating = r.rating || 0;
  const starContainer = document.getElementById('star-rating');
  if (starContainer) {
    starContainer.style.cssText = 'display:flex;gap:4px;margin-top:4px;';
    starContainer.querySelectorAll('.star').forEach(star => {
      star.addEventListener('click', () => {
        currentRating = parseInt(star.dataset.val);
        starContainer.querySelectorAll('.star').forEach((s, i) => {
          s.className = `star ${i < currentRating ? 'filled' : 'empty'}`;
        });
      });
    });
  }

  // Add ingredient
  document.getElementById('add-ing-btn').addEventListener('click', () => {
    const list = document.getElementById('ingredients-list');
    const idx = list.children.length;
    const div = document.createElement('div');
    div.innerHTML = ingredientRowHTML({ name: '', amount: '', unit: '', notes: '' }, idx);
    list.appendChild(div.firstElementChild);
  });

  // Add step
  document.getElementById('add-step-btn').addEventListener('click', () => {
    const list = document.getElementById('steps-list');
    const idx = list.children.length;
    const div = document.createElement('div');
    div.innerHTML = stepRowHTML('', idx);
    list.appendChild(div.firstElementChild);
  });

  // Delete buttons (delegated)
  document.getElementById('ingredients-list').addEventListener('click', e => {
    if (e.target.closest('.del-ing')) e.target.closest('.ing-row').remove();
  });
  document.getElementById('steps-list').addEventListener('click', e => {
    if (e.target.closest('.del-step')) e.target.closest('.step-row').remove();
  });

  // Cancel
  document.getElementById('cancel-btn').addEventListener('click', () => state.navigate('recipes'));

  // Save
  document.getElementById('save-btn').addEventListener('click', async () => {
    const btn = document.getElementById('save-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Saving…';

    try {
      const saved = collectForm(recipe, currentRating);
      await appendRecipe(saved);
      await loadRecipes();
      toast('Recipe saved! 🎉', 'success');
      state.navigate('detail', saved.id);
    } catch (err) {
      toast('Save failed: ' + err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Save Recipe';
    }
  });
}

function collectForm(existing, rating) {
  const tags = document.getElementById('f-tags')?.value.split(',').map(t => t.trim()).filter(Boolean) || [];
  const ingredients = [];
  document.querySelectorAll('.ing-row').forEach(row => {
    const name = row.querySelector('.ing-name')?.value?.trim();
    if (!name) return;
    ingredients.push({
      name,
      amount: parseFloat(row.querySelector('.ing-amount-val')?.value) || 0,
      unit: row.querySelector('.ing-unit')?.value?.trim() || '',
      notes: row.querySelector('.ing-notes')?.value?.trim() || '',
    });
  });
  const steps = [];
  document.querySelectorAll('.step-row textarea').forEach(ta => {
    const s = ta.value.trim();
    if (s) steps.push(s);
  });

  return {
    id: existing?.id || crypto.randomUUID(),
    title: document.getElementById('f-title')?.value?.trim() || '',
    title_de: document.getElementById('f-title-de')?.value?.trim() || '',
    category: document.getElementById('f-category')?.value || '',
    language: document.getElementById('f-language')?.value || 'en',
    servings: parseInt(document.getElementById('f-servings')?.value) || 4,
    prep_mins: parseInt(document.getElementById('f-prep')?.value) || 0,
    cook_mins: parseInt(document.getElementById('f-cook')?.value) || 0,
    rating,
    tags,
    ingredients,
    steps,
    notes: document.getElementById('f-notes')?.value?.trim() || '',
    image_url: existing?.image_url || '',
    created_at: existing?.created_at || new Date().toISOString(),
  };
}

function ingredientRowHTML(ing, i) {
  return `
    <div class="ing-row" style="display:grid;grid-template-columns:1fr 80px 70px auto;gap:6px;margin-bottom:6px;align-items:center;">
      <input class="ing-name" type="text" value="${esc(ing.name || '')}" placeholder="Ingredient" />
      <input class="ing-amount-val" type="number" value="${ing.amount || ''}" placeholder="Amt" step="any" min="0" />
      <input class="ing-unit" type="text" value="${esc(ing.unit || '')}" placeholder="Unit" />
      <button class="btn btn-ghost btn-icon del-ing" title="Remove" style="color:var(--rust);">${icons.trash}</button>
    </div>
  `;
}

function stepRowHTML(step, i) {
  return `
    <div class="step-row" style="display:flex;gap:8px;margin-bottom:8px;align-items:flex-start;">
      <span style="min-width:24px;height:24px;background:var(--forest);color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.75rem;font-weight:500;margin-top:10px;flex-shrink:0;">${i+1}</span>
      <textarea rows="2" style="flex:1;resize:vertical;">${esc(step || '')}</textarea>
      <button class="btn btn-ghost btn-icon del-step" title="Remove" style="color:var(--rust);margin-top:6px;">${icons.trash}</button>
    </div>
  `;
}

function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
