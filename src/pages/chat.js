import { state } from '../lib/state.js';
import { icons, toast } from '../lib/ui.js';
import { chatAboutRecipes, suggestWeeklyMenu, findRecipesFromIngredients } from '../lib/ai.js';

export function renderChatPage(container) {
  let messages = [];
  let fridgeMode = false;

  container.innerHTML = `
    <div class="page" style="display:flex;flex-direction:column;height:calc(100dvh - var(--nav-height) - var(--bottom-nav-height));padding-bottom:0;">
      <div class="section-header mb-12" style="flex-shrink:0;">
        <h2 style="font-style:italic;">${icons.spark} Recipe Assistant</h2>
      </div>

      <!-- Quick actions -->
      <div class="scroll-x mb-16" style="flex-shrink:0;">
        <button class="chip" id="btn-week">Plan my week 📅</button>
        <button class="chip" id="btn-fridge">What can I make? 🧅</button>
        <button class="chip" id="btn-suggest">Surprise me ✨</button>
      </div>

      <!-- Fridge input (hidden) -->
      <div id="fridge-area" class="hidden mb-12" style="flex-shrink:0;">
        <div class="form-group">
          <label>What ingredients do you have?</label>
          <input type="text" id="fridge-input" placeholder="e.g. chicken, tomatoes, garlic, pasta" />
        </div>
        <button class="btn btn-primary btn-sm mt-8" id="fridge-search-btn">${icons.search} Find recipes</button>
      </div>

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
      <div style="flex-shrink:0;padding:12px 0;border-top:1px solid var(--border);display:flex;gap:8px;">
        <input type="text" id="chat-input" placeholder="Ask about a recipe…" style="flex:1;border-radius:999px;" />
        <button class="btn btn-primary btn-icon" id="send-btn" style="border-radius:50%;width:42px;height:42px;padding:0;display:flex;align-items:center;justify-content:center;">${icons.spark}</button>
      </div>
    </div>
  `;

  const messagesEl = document.getElementById('chat-messages');
  const input = document.getElementById('chat-input');

  function addMessage(role, text) {
    const isUser = role === 'user';
    const div = document.createElement('div');
    div.style.cssText = `display:flex;justify-content:${isUser ? 'flex-end' : 'flex-start'};`;

    // Process [[recipe links]]
    const html = text.replace(/\[\[(.+?)\]\]/g, (_, title) => {
      const recipe = state.get('recipes').find(r => r.title.toLowerCase() === title.toLowerCase());
      if (!recipe) return `<strong>${title}</strong>`;
      return `<a href="#" data-id="${recipe.id}" style="color:var(--forest);font-weight:500;text-decoration:underline;">${title}</a>`;
    });

    div.innerHTML = `
      <div style="max-width:85%;padding:12px 16px;border-radius:${isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px'};
        background:${isUser ? 'var(--forest)' : 'var(--cream-dark)'};
        color:${isUser ? '#fff' : 'var(--ink)'};font-size:.92rem;line-height:1.6;">
        ${html}
      </div>
    `;

    // Recipe link clicks
    div.querySelectorAll('[data-id]').forEach(a => {
      a.addEventListener('click', e => { e.preventDefault(); state.navigate('detail', a.dataset.id); });
    });

    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addTyping() {
    const div = document.createElement('div');
    div.id = 'typing';
    div.style.cssText = 'display:flex;';
    div.innerHTML = `
      <div style="padding:12px 16px;border-radius:18px 18px 18px 4px;background:var(--cream-dark);">
        <div style="display:flex;gap:4px;align-items:center;">
          ${[0,1,2].map(i => `<div style="width:6px;height:6px;border-radius:50%;background:var(--ink-faint);animation:bounce .8s ${i*0.15}s infinite;"></div>`).join('')}
        </div>
      </div>
    `;
    if (!document.querySelector('#bounce-style')) {
      const style = document.createElement('style');
      style.id = 'bounce-style';
      style.textContent = '@keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}';
      document.head.appendChild(style);
    }
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  async function sendMessage(userText) {
    if (!userText.trim()) return;
    input.value = '';
    addMessage('user', userText);
    messages.push({ role: 'user', content: userText });

    const typing = addTyping();
    document.getElementById('send-btn').disabled = true;

    try {
      const reply = await chatAboutRecipes(messages, state.get('recipes'));
      typing.remove();
      addMessage('assistant', reply);
      messages.push({ role: 'assistant', content: reply });
    } catch (err) {
      typing.remove();
      addMessage('assistant', 'Sorry, I had trouble thinking that through. Please try again.');
      toast('AI error: ' + err.message, 'error');
    } finally {
      document.getElementById('send-btn').disabled = false;
    }
  }

  input.addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage(input.value); });
  document.getElementById('send-btn').addEventListener('click', () => sendMessage(input.value));

  // Weekly plan
  document.getElementById('btn-week').addEventListener('click', async () => {
    addMessage('user', 'Suggest a weekly dinner menu from my recipe collection');
    messages.push({ role: 'user', content: 'Suggest a weekly dinner menu from my recipe collection' });
    const typing = addTyping();
    try {
      const plan = await suggestWeeklyMenu(state.get('recipes'));
      typing.remove();
      let reply = '**Here\'s your week:**\n\n';
      plan.menu.forEach(({ day, title, reason }) => {
        reply += `**${day}:** ${title} — ${reason}\n`;
      });
      if (plan.note) reply += `\n💡 ${plan.note}`;

      // Format nicely
      const html = reply
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');

      const div = document.createElement('div');
      div.style.cssText = 'display:flex;';
      div.innerHTML = `<div style="max-width:85%;padding:12px 16px;border-radius:18px 18px 18px 4px;background:var(--cream-dark);color:var(--ink);font-size:.92rem;line-height:1.8;">${html}</div>`;

      // Link recipe titles
      if (plan.menu) {
        plan.menu.forEach(({ title }) => {
          const recipe = state.get('recipes').find(r => r.title.toLowerCase() === title.toLowerCase());
          if (recipe) {
            div.innerHTML = div.innerHTML.replace(
              new RegExp(title, 'g'),
              `<a href="#" data-id="${recipe.id}" style="color:var(--forest);font-weight:500;text-decoration:underline;">${title}</a>`
            );
          }
        });
        div.querySelectorAll('[data-id]').forEach(a => {
          a.addEventListener('click', e => { e.preventDefault(); state.navigate('detail', a.dataset.id); });
        });
      }

      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      messages.push({ role: 'assistant', content: reply });
    } catch (err) {
      typing.remove();
      toast('Could not generate menu', 'error');
    }
  });

  // Fridge mode
  document.getElementById('btn-fridge').addEventListener('click', () => {
    fridgeMode = !fridgeMode;
    document.getElementById('fridge-area').classList.toggle('hidden', !fridgeMode);
    if (fridgeMode) document.getElementById('fridge-input').focus();
  });

  document.getElementById('fridge-search-btn').addEventListener('click', async () => {
    const ingredients = document.getElementById('fridge-input').value.split(',').map(s => s.trim()).filter(Boolean);
    if (!ingredients.length) return;
    document.getElementById('fridge-area').classList.add('hidden');
    fridgeMode = false;

    addMessage('user', `What can I make with: ${ingredients.join(', ')}?`);
    const typing = addTyping();
    try {
      const result = await findRecipesFromIngredients(ingredients, state.get('recipes'));
      typing.remove();
      if (!result.matches?.length) {
        addMessage('assistant', "I couldn't find any close matches in your collection for those ingredients. Try adding more of your staples!");
      } else {
        let reply = result.matches.map(m => {
          const missing = m.missing?.length ? ` (missing: ${m.missing.join(', ')})` : '';
          return `**${m.title}** — ${m.match} match${missing}`;
        }).join('\n');
        if (result.suggestion) reply += `\n\n💡 ${result.suggestion}`;

        const html = reply.replace(/\*\*(.+?)\*\*/g, (_, t) => {
          const recipe = state.get('recipes').find(r => r.title.toLowerCase() === t.toLowerCase());
          return recipe
            ? `<a href="#" data-id="${recipe.id}" style="color:var(--forest);font-weight:500;text-decoration:underline;">${t}</a>`
            : `<strong>${t}</strong>`;
        }).replace(/\n/g, '<br>');

        const div = document.createElement('div');
        div.style.cssText = 'display:flex;';
        div.innerHTML = `<div style="max-width:85%;padding:12px 16px;border-radius:18px 18px 18px 4px;background:var(--cream-dark);color:var(--ink);font-size:.92rem;line-height:1.8;">${html}</div>`;
        div.querySelectorAll('[data-id]').forEach(a => {
          a.addEventListener('click', e => { e.preventDefault(); state.navigate('detail', a.dataset.id); });
        });
        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        messages.push({ role: 'assistant', content: reply });
      }
    } catch (err) {
      typing.remove();
      toast('Search failed', 'error');
    }
  });

  // Surprise me
  document.getElementById('btn-suggest').addEventListener('click', () => {
    const recipes = state.get('recipes');
    const top = recipes.filter(r => r.rating >= 4);
    const pool = top.length ? top : recipes;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick) {
      sendMessage(`Tell me about ${pick.title} and why I should make it tonight.`);
    }
  });
}
