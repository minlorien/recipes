import { state } from '../lib/state.js';
import { icons, toast, esc } from '../lib/ui.js';
import { chatAboutRecipes, suggestWeeklyMenu, findRecipesFromIngredients } from '../lib/ai.js';

// Kept at module level so the conversation survives re-renders (EN/DE toggle,
// refresh, visiting another tab and coming back). Cleared when the app closes.
const history = [];   // API messages: { role, content }
const bubbles = [];   // what's on screen: { role, html }
let busy = false;

export function renderChatPage(container) {
  container.innerHTML = `
    <div class="page" style="display:flex;flex-direction:column;height:calc(100dvh - var(--nav-height) - var(--bottom-nav-height));padding-bottom:0;">
      <div class="section-header mb-12" style="flex-shrink:0;">
        <h2 style="font-style:italic;">${icons.spark} Recipe Assistant</h2>
        ${bubbles.length ? `<button class="btn btn-ghost btn-sm" id="new-chat-btn">New chat</button>` : ''}
      </div>

      <!-- Quick actions -->
      <div class="scroll-x mb-16" style="flex-shrink:0;">
        <button class="chip" id="btn-week">Plan my week 📅</button>
        <button class="chip" id="btn-fridge">What can I make? 🧅</button>
        <button class="chip" id="btn-suggest">Surprise me ✨</button>
      </div>

      <!-- Fridge input (hidden) -->
      <form id="fridge-area" class="hidden mb-12" style="flex-shrink:0;">
        <div class="form-group">
          <label for="fridge-input">What ingredients do you have?</label>
          <input type="text" id="fridge-input" placeholder="e.g. chicken, tomatoes, garlic, pasta" enterkeyhint="search" />
        </div>
        <button type="submit" class="btn btn-primary btn-sm mt-8">${icons.search} Find recipes</button>
      </form>

      <!-- Chat messages -->
      <div id="chat-messages" style="flex:1;overflow-y:auto;padding:4px 0 16px;display:flex;flex-direction:column;gap:12px;">
        <div class="ai-card">
          <span class="ai-icon">👩‍🍳</span>
          <div class="ai-text">
            <strong>Hello!</strong> I know all ${state.get('recipes').length} recipes in your collection.
            Ask me anything — I can help you find a recipe, suggest what to cook tonight, plan your week, or answer cooking questions.
          </div>
        </div>
      </div>

      <!-- Input -->
      <form id="chat-form" style="flex-shrink:0;padding:12px 0;border-top:1px solid var(--border);display:flex;gap:8px;">
        <input type="text" id="chat-input" placeholder="Ask about a recipe…" style="flex:1;border-radius:999px;" enterkeyhint="send" />
        <button type="submit" class="btn btn-primary btn-icon" id="send-btn" aria-label="Send" style="border-radius:50%;width:44px;height:44px;padding:0;display:flex;align-items:center;justify-content:center;">${icons.spark}</button>
      </form>
    </div>
  `;

  const messagesEl = container.querySelector('#chat-messages');
  const input = container.querySelector('#chat-input');
  const fridgeArea = container.querySelector('#fridge-area');

  // Clicks on [[recipe links]] in any bubble
  messagesEl.addEventListener('click', e => {
    const link = e.target.closest('[data-id]');
    if (!link) return;
    e.preventDefault();
    state.navigate('detail', link.dataset.id);
  });

  bubbles.forEach(b => appendBubble(messagesEl, b));
  if (busy) appendTyping(messagesEl);
  scrollToEnd(messagesEl);

  // Run one AI request: show the user's text, a typing indicator, then the reply.
  async function ask(userText, run) {
    if (busy) return;
    busy = true;
    addBubble({ role: 'user', html: esc(userText) });
    history.push({ role: 'user', content: userText });
    rerender();
    try {
      const { replyText, html } = await run();
      history.push({ role: 'assistant', content: replyText });
      bubbles.push({ role: 'assistant', html });
    } catch (err) {
      history.pop(); // keep user/assistant turns paired for the next request
      bubbles.push({ role: 'assistant', html: 'Sorry, I had trouble with that. Please try again.' });
      toast(err.message, 'error');
    } finally {
      busy = false;
      rerender();
    }
  }

  container.querySelector('#chat-form').addEventListener('submit', e => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    ask(text, async () => {
      const reply = await chatAboutRecipes([...history], state.get('recipes'));
      return { replyText: reply, html: formatReply(reply) };
    });
  });

  container.querySelector('#new-chat-btn')?.addEventListener('click', () => {
    history.length = 0;
    bubbles.length = 0;
    rerender();
  });

  // Weekly plan
  container.querySelector('#btn-week').addEventListener('click', () => {
    ask('Suggest a weekly dinner menu from my recipe collection', async () => {
      const plan = await suggestWeeklyMenu(state.get('recipes'));
      let reply = 'Here\'s your week:\n\n';
      let html = '<strong>Here\'s your week:</strong><br><br>';
      for (const { day, title, reason } of plan.menu || []) {
        reply += `${day}: ${title} — ${reason}\n`;
        html += `<strong>${esc(day)}:</strong> ${recipeLink(title)} — ${esc(reason)}<br>`;
      }
      if (plan.note) {
        reply += `\n💡 ${plan.note}`;
        html += `<br>💡 ${esc(plan.note)}`;
      }
      return { replyText: reply, html };
    });
  });

  // Fridge mode
  container.querySelector('#btn-fridge').addEventListener('click', () => {
    fridgeArea.classList.toggle('hidden');
    if (!fridgeArea.classList.contains('hidden')) container.querySelector('#fridge-input').focus();
  });

  fridgeArea.addEventListener('submit', e => {
    e.preventDefault();
    const ingredients = container.querySelector('#fridge-input').value.split(',').map(s => s.trim()).filter(Boolean);
    if (!ingredients.length) return;
    ask(`What can I make with: ${ingredients.join(', ')}?`, async () => {
      const result = await findRecipesFromIngredients(ingredients, state.get('recipes'));
      if (!result.matches?.length) {
        const msg = "I couldn't find any close matches in your collection for those ingredients. Try adding more of your staples!";
        return { replyText: msg, html: esc(msg) };
      }
      const lines = result.matches.map(m => {
        const missing = m.missing?.length ? ` (missing: ${m.missing.join(', ')})` : '';
        return { text: `${m.title} — ${m.match} match${missing}`, html: `${recipeLink(m.title)} — ${esc(m.match)} match${esc(missing)}` };
      });
      let reply = lines.map(l => l.text).join('\n');
      let html = lines.map(l => l.html).join('<br>');
      if (result.suggestion) {
        reply += `\n\n💡 ${result.suggestion}`;
        html += `<br><br>💡 ${esc(result.suggestion)}`;
      }
      return { replyText: reply, html };
    });
  });

  // Surprise me
  container.querySelector('#btn-suggest').addEventListener('click', () => {
    const recipes = state.get('recipes');
    const top = recipes.filter(r => r.rating >= 4);
    const pool = top.length ? top : recipes;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (!pick) return;
    const text = `Tell me about ${pick.title} and why I should make it tonight.`;
    ask(text, async () => {
      const reply = await chatAboutRecipes([...history], state.get('recipes'));
      return { replyText: reply, html: formatReply(reply) };
    });
  });
}

function addBubble(b) { bubbles.push(b); }

function rerender() {
  const container = document.getElementById('page-content');
  if (container && state.get('currentPage') === 'chat') renderChatPage(container);
}

function appendBubble(messagesEl, { role, html }) {
  const isUser = role === 'user';
  const div = document.createElement('div');
  div.style.cssText = `display:flex;justify-content:${isUser ? 'flex-end' : 'flex-start'};`;
  div.innerHTML = `
    <div style="max-width:85%;padding:12px 16px;border-radius:${isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px'};
      background:${isUser ? 'var(--forest)' : 'var(--cream-dark)'};
      color:${isUser ? '#fff' : 'var(--ink)'};font-size:.92rem;line-height:1.6;overflow-wrap:anywhere;">
      ${html}
    </div>
  `;
  messagesEl.appendChild(div);
}

function appendTyping(messagesEl) {
  if (!document.querySelector('#bounce-style')) {
    const style = document.createElement('style');
    style.id = 'bounce-style';
    style.textContent = '@keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}';
    document.head.appendChild(style);
  }
  const div = document.createElement('div');
  div.style.cssText = 'display:flex;';
  div.innerHTML = `
    <div style="padding:12px 16px;border-radius:18px 18px 18px 4px;background:var(--cream-dark);">
      <div style="display:flex;gap:4px;align-items:center;">
        ${[0,1,2].map(i => `<div style="width:6px;height:6px;border-radius:50%;background:var(--ink-faint);animation:bounce .8s ${i*0.15}s infinite;"></div>`).join('')}
      </div>
    </div>
  `;
  messagesEl.appendChild(div);
}

function scrollToEnd(el) { el.scrollTop = el.scrollHeight; }

// A recipe title as a link if it's in the collection (English or German title), else bold text.
function recipeLink(title) {
  const t = String(title).toLowerCase();
  const recipe = state.get('recipes').find(r => r.title.toLowerCase() === t || r.title_de?.toLowerCase() === t);
  if (!recipe) return `<strong>${esc(title)}</strong>`;
  return `<a href="#" data-id="${esc(recipe.id)}" style="color:var(--forest);font-weight:500;text-decoration:underline;">${esc(title)}</a>`;
}

// Escape the AI's text, then allow [[recipe links]], **bold** and line breaks.
function formatReply(text) {
  return esc(text)
    .replace(/\[\[(.+?)\]\]/g, (_, title) => recipeLink(unesc(title)))
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

// Undo esc() for a title captured from already-escaped text (recipeLink escapes it again).
function unesc(s) {
  return s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
}
