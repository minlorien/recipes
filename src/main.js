import { state, checkAuth, login, logout, loadRecipes } from './lib/state.js';
import { icons, toast } from './lib/ui.js';
import { renderRecipesPage } from './pages/recipes.js';
import { renderDetailPage } from './pages/detail.js';
import { renderScanPage, checkSharedImage } from './pages/scan.js';
import { renderShoppingPage } from './pages/shopping.js';
import { renderChatPage } from './pages/chat.js';

// ── Service Worker (PWA) ───────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  // When a new worker takes over, reload once so the page runs the new code.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });
  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {});
}

// ── Session expiry (any API call that gets a 401) ──────────────────────────
window.addEventListener('auth-expired', () => {
  if (!state.get('authenticated')) return;
  logout();
  toast('Please sign in again.', 'error');
});

// ── Router ─────────────────────────────────────────────────────────────────
function render() {
  const app = document.getElementById('app');
  const authenticated = state.get('authenticated');

  if (!authenticated) {
    // Don't wipe the login form (and what's typed in it) on unrelated state changes.
    if (!app.querySelector('.login-page')) renderLogin(app);
    return;
  }

  const page = state.get('currentPage');
  const shoppingCount = state.get('shoppingList').length;

  app.innerHTML = `
    <nav class="top-nav">
      <a class="logo" href="#" id="logo-link">Recipes</a>
      <div class="nav-actions">
        ${page === 'detail' || page === 'scan' ? '' : `
          <button class="btn btn-ghost btn-sm" id="refresh-btn" title="Refresh" aria-label="Refresh recipes">${icons.refresh}</button>
        `}
        <button class="btn btn-outline btn-sm" id="lang-btn" title="Toggle language" style="font-weight:500;min-width:36px;">
          ${state.get('displayLang') === 'en' ? 'DE' : 'EN'}
        </button>
        <button class="btn btn-ghost btn-sm" id="logout-btn" title="Sign out" aria-label="Sign out" style="font-size:1.1rem;">⎋</button>
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
  `;

  // Nav
  app.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', () => state.navigate(btn.dataset.page));
  });
  app.querySelector('#logo-link')?.addEventListener('click', e => {
    e.preventDefault();
    state.navigate('recipes');
  });
  app.querySelector('#lang-btn')?.addEventListener('click', () => {
    state.toggleLang();
  });

  app.querySelector('#logout-btn')?.addEventListener('click', () => {
    if (window.confirm('Sign out?')) logout();
  });
  app.querySelector('#refresh-btn')?.addEventListener('click', async () => {
    if (await loadRecipes()) toast('Recipes refreshed', 'success');
    else toast('Could not refresh — check your connection', 'error');
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
      <form class="login-card" id="login-form">
        <div class="login-logo">Recipes</div>
        <div class="login-sub">Our family recipe collection</div>
        <div class="form-group mb-16">
          <label for="pw-input">Password</label>
          <input type="password" id="pw-input" placeholder="Enter family password" autocomplete="current-password" />
        </div>
        <button type="submit" class="btn btn-primary w-full btn-lg" id="login-btn">Enter Kitchen</button>
        <p class="text-center text-muted text-sm mt-16" style="font-style:italic;">
          recipes.minlorien.net
        </p>
      </form>
    </div>
  `;

  const form = document.getElementById('login-form');
  const input = document.getElementById('pw-input');
  const btn = document.getElementById('login-btn');

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (btn.disabled || !input.value) return;
    btn.disabled = true;
    btn.textContent = 'Checking…';
    const result = await login(input.value);
    if (result === 'ok') return; // state change renders the app
    btn.disabled = false;
    btn.textContent = 'Enter Kitchen';
    if (result === 'wrong-password') {
      toast('Incorrect password', 'error');
      input.value = '';
    } else {
      toast('Could not connect — check your internet and try again', 'error');
    }
    input.focus();
  });
  input.focus();
}

// ── Boot ───────────────────────────────────────────────────────────────────
if (checkAuth()) {
  state.set({ authenticated: true });
  loadRecipes();
}

state.subscribe(() => render());
render();
checkSharedImage();

// Tell the self-repair check in index.html that the app started fine.
window.__appStarted = true;
try { sessionStorage.removeItem('recovery-reload'); } catch {}
