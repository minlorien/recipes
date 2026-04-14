import { state, checkAuth, login, logout, loadRecipes } from './lib/state.js';
import { icons, toast } from './lib/ui.js';
import { renderRecipesPage } from './pages/recipes.js';
import { renderDetailPage } from './pages/detail.js';
import { renderScanPage } from './pages/scan.js';
import { renderShoppingPage } from './pages/shopping.js';
import { renderChatPage } from './pages/chat.js';

// ── Service Worker (PWA) ───────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ── Toast container ────────────────────────────────────────────────────────
document.getElementById('app').insertAdjacentHTML('beforeend', `<div id="toast-container"></div>`);

// ── Router ─────────────────────────────────────────────────────────────────
function render() {
  const app = document.getElementById('app');
  const authenticated = state.get('authenticated');

  if (!authenticated) {
    renderLogin(app);
    return;
  }

  const page = state.get('currentPage');
  const shoppingCount = state.get('shoppingList').length;

  app.innerHTML = `
    <nav class="top-nav">
      <a class="logo" href="#">Recipes</a>
      <div class="nav-actions">
        ${page === 'detail' || page === 'scan' ? '' : `
          <button class="btn btn-ghost btn-sm" id="refresh-btn" title="Refresh">${icons.refresh}</button>
        `}
        <button class="btn btn-outline btn-sm" id="lang-btn" title="Toggle language" style="font-weight:500;min-width:36px;">
          ${state.get('displayLang') === 'en' ? 'DE' : 'EN'}
        </button>
        <button class="btn btn-ghost btn-sm" id="logout-btn" title="Sign out" style="font-size:1.1rem;">⎋</button>
      </div>
    </nav>

    <main id="page-content"></main>

    <nav class="bottom-nav">
      <button class="nav-item ${page === 'recipes' || page === 'detail' ? 'active' : ''}" data-page="recipes">
        ${icons.home}
        Recipes
      </button>
      <button class="nav-item ${page === 'scan' ? 'active' : ''}" data-page="scan">
        ${icons.scan}
        Add
      </button>
      <button class="nav-item ${page === 'shopping' ? 'active' : ''}" data-page="shopping">
        ${icons.shopping}
        ${shoppingCount ? `List (${shoppingCount})` : 'List'}
      </button>
      <button class="nav-item ${page === 'chat' ? 'active' : ''}" data-page="chat">
        ${icons.chat}
        Ask AI
      </button>
    </nav>

    <div id="toast-container"></div>
  `;

  // Nav
  app.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', () => state.navigate(btn.dataset.page));
  });
  app.querySelector('#lang-btn')?.addEventListener('click', () => {
    state.toggleLang();
  });

  app.querySelector('#logout-btn')?.addEventListener('click', () => {
    if (window.confirm('Sign out?')) logout();
  });
  app.querySelector('#refresh-btn')?.addEventListener('click', () => {
    loadRecipes().then(() => toast('Recipes refreshed', 'success'));
  });

  // Page content
  const content = document.getElementById('page-content');
  switch (page) {
    case 'recipes': renderRecipesPage(content); break;
    case 'detail':  renderDetailPage(content); break;
    case 'scan':    renderScanPage(content); break;
    case 'shopping': renderShoppingPage(content); break;
    case 'chat':    renderChatPage(content); break;
    default:        renderRecipesPage(content);
  }
}

// ── Login ──────────────────────────────────────────────────────────────────
function renderLogin(app) {
  app.innerHTML = `
    <div class="login-page">
      <div class="login-card">
        <div class="login-logo">Recipes</div>
        <div class="login-sub">Our family recipe collection</div>
        <div class="form-group mb-16">
          <label>Password</label>
          <input type="password" id="pw-input" placeholder="Enter family password" autocomplete="current-password" />
        </div>
        <button class="btn btn-primary w-full btn-lg" id="login-btn">Enter Kitchen</button>
        <p class="text-center text-muted text-sm mt-16" style="font-style:italic;">
          recipes.minlorien.net
        </p>
      </div>
    </div>
    <div id="toast-container"></div>
  `;

  const input = document.getElementById('pw-input');
  const btn = document.getElementById('login-btn');

  const attempt = () => {
    if (!login(input.value)) {
      toast('Incorrect password', 'error');
      input.value = '';
      input.focus();
    }
  };
  btn.addEventListener('click', attempt);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') attempt(); });
  input.focus();
}

// ── Boot ───────────────────────────────────────────────────────────────────
if (checkAuth()) {
  state.set({ authenticated: true });
  loadRecipes();
}

state.subscribe(() => render());
render();
