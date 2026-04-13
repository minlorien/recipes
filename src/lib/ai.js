import { CONFIG } from '../config.js';

const API = 'https://api.anthropic.com/v1/messages';

async function callClaude(messages, system, maxTokens = 2000) {
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CONFIG.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system,
      messages,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || 'AI request failed');
  }
  const data = await res.json();
  return data.content[0].text;
}

// ── Extract recipe from photo ──────────────────────────────────────────────
export async function extractRecipeFromImage(base64Image, mimeType = 'image/jpeg') {
  const system = `You are a recipe extraction assistant. Extract all recipe information from the image and return ONLY valid JSON with no extra text or markdown.

Return this exact structure:
{
  "title": "Recipe name in English",
  "title_de": "Recipe name in German (translate if needed, or original if German)",
  "language": "en or de (detected language of the original)",
  "category": "one of: Breakfast, Soup, Salad, Main, Side, Dessert, Baking, Drink, Snack, Preserve",
  "servings": 4,
  "prep_mins": 15,
  "cook_mins": 30,
  "rating": 0,
  "tags": ["tag1", "tag2"],
  "notes": "any notes or tips",
  "ingredients": [
    {
      "name": "ingredient name in English",
      "amount": 250,
      "unit": "g",
      "notes": "optional prep note e.g. chopped"
    }
  ],
  "steps": [
    "Step 1 text",
    "Step 2 text"
  ]
}

Important rules:
- Convert ALL amounts to metric (g, ml, kg, l, °C, cm). Store only metric.
- If the recipe is in German, keep original names but also translate to English for title.
- For uncountable items (e.g. "salt to taste"), use amount: 0 and unit: "".
- For items measured in pieces (eggs, cloves), use unit: "pcs".
- Infer category from the recipe type.
- Tags should be descriptive: e.g. vegetarian, quick, family-favourite, Christmas, etc.`;

  const text = await callClaude([{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Image } },
      { type: 'text', text: 'Extract this recipe into JSON format.' }
    ]
  }], system, 3000);

  // Strip any accidental markdown fences
  const clean = text.replace(/```json\n?|\n?```/g, '').trim();
  return JSON.parse(clean);
}

// ── Get AI recipe suggestions ──────────────────────────────────────────────
export async function getSuggestions(currentRecipe, allRecipes) {
  const titles = allRecipes
    .filter(r => r.id !== currentRecipe.id)
    .map(r => `${r.title} (${r.category}, rated ${r.rating}/5, tags: ${r.tags?.join(', ')})`)
    .slice(0, 60)
    .join('\n');

  const system = 'You are a helpful recipe assistant. Return ONLY valid JSON, no markdown.';
  const prompt = `Given this recipe:
Title: ${currentRecipe.title}
Category: ${currentRecipe.category}
Tags: ${currentRecipe.tags?.join(', ')}
Ingredients: ${currentRecipe.ingredients?.map(i => i.name).join(', ')}

From this collection:
${titles}

Return JSON: { "suggestions": ["title1", "title2", "title3"], "reason": "brief friendly explanation why these pair well" }

Pick 3 recipes that complement or are similar to this one.`;

  const text = await callClaude([{ role: 'user', content: prompt }], system, 500);
  const clean = text.replace(/```json\n?|\n?```/g, '').trim();
  return JSON.parse(clean);
}

// ── Weekly menu suggestion ─────────────────────────────────────────────────
export async function suggestWeeklyMenu(recipes) {
  const options = recipes
    .filter(r => r.category === 'Main' || r.category === 'Soup' || r.category === 'Salad')
    .map(r => `${r.title} (${r.category}, rated ${r.rating}/5, tags: ${r.tags?.join(', ')})`)
    .join('\n');

  const system = 'You are a helpful meal planning assistant. Return ONLY valid JSON, no markdown.';
  const prompt = `From this recipe collection, suggest a balanced weekly dinner menu (7 meals).
Prioritize high-rated recipes and variety across categories and cooking styles.

Available recipes:
${options}

Return JSON: {
  "menu": [
    { "day": "Monday", "title": "recipe title", "reason": "brief reason" },
    ...7 days...
  ],
  "note": "a friendly tip about this week's menu"
}`;

  const text = await callClaude([{ role: 'user', content: prompt }], system, 1000);
  const clean = text.replace(/```json\n?|\n?```/g, '').trim();
  return JSON.parse(clean);
}

// ── Fridge → recipes ──────────────────────────────────────────────────────
export async function findRecipesFromIngredients(haveIngredients, recipes) {
  const catalog = recipes.map(r => ({
    title: r.title,
    ingredients: r.ingredients?.map(i => i.name).join(', ')
  }));

  const system = 'You are a helpful cooking assistant. Return ONLY valid JSON, no markdown.';
  const prompt = `I have these ingredients: ${haveIngredients.join(', ')}

From this recipe collection:
${catalog.map(r => `- ${r.title}: needs ${r.ingredients}`).join('\n')}

Which recipes can I make (fully or mostly)? Return JSON:
{
  "matches": [
    { "title": "recipe title", "match": "full or partial", "missing": ["ingredient1"] }
  ],
  "suggestion": "friendly tip"
}

Sort by best match first. Include up to 6 results.`;

  const text = await callClaude([{ role: 'user', content: prompt }], system, 800);
  const clean = text.replace(/```json\n?|\n?```/g, '').trim();
  return JSON.parse(clean);
}

// ── Conversational chat about recipes ─────────────────────────────────────
export async function chatAboutRecipes(messages, recipes) {
  const catalog = recipes.map(r =>
    `${r.title} | ${r.category} | Rating: ${r.rating}/5 | Tags: ${r.tags?.join(', ')} | Ingredients: ${r.ingredients?.map(i=>i.name).join(', ')}`
  ).join('\n');

  const system = `You are a warm, knowledgeable cooking assistant for a family recipe collection. You help find recipes, suggest modifications, answer cooking questions, and give advice. Keep responses concise and friendly. The family recipe collection contains:

${catalog}

When referring to a specific recipe from the collection, wrap its title in [[double brackets]] so the app can link to it.`;

  return callClaude(messages, system, 600);
}
