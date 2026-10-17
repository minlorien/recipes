import { postJSON } from './api.js';

// The model is chosen server-side in functions/api/[[route]].js.
// Pass `schema` to get an answer that is guaranteed to be JSON matching it.
async function callClaude(messages, system, maxTokens = 2000, schema = null) {
  const body = { max_tokens: maxTokens, system, messages };
  if (schema) body.schema = schema;
  const data = await postJSON('/ai', body, { retry: true });

  if (data.stop_reason === 'refusal') {
    throw new Error('The assistant could not help with this request.');
  }
  if (data.stop_reason === 'max_tokens') {
    throw new Error('The answer was too long and got cut off. Please try again.');
  }
  // Only text blocks are useful here (the server already drops the rest).
  const text = (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');
  if (!text) throw new Error('The assistant returned an empty answer. Please try again.');
  return text;
}

async function callClaudeJSON(messages, system, maxTokens, schema) {
  const text = await callClaude(messages, system, maxTokens, schema);
  try {
    return JSON.parse(text);
  } catch {
    console.error('Failed to parse AI response:', text);
    throw new Error('The assistant gave an unreadable answer. Please try again.');
  }
}

// ── JSON schemas (structured outputs: every object needs additionalProperties:false) ──
const str = { type: 'string' };
const strList = { type: 'array', items: str };

function obj(properties) {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

const INGREDIENT = obj({ name: str, amount: { type: 'number' }, unit: str, notes: str });

const RECIPE_SCHEMA = obj({
  title: str,
  title_de: str,
  language: { type: 'string', enum: ['en', 'de'] },
  category: { type: 'string', enum: ['Breakfast', 'Soup', 'Salad', 'Main', 'Side', 'Dessert', 'Baking', 'Drink', 'Snack', 'Preserve'] },
  servings: { type: 'integer' },
  prep_mins: { type: 'integer' },
  cook_mins: { type: 'integer' },
  rating: { type: 'number' },
  tags: strList,
  notes: str,
  ingredients: { type: 'array', items: INGREDIENT },
  ingredients_de: { type: 'array', items: INGREDIENT },
  steps: strList,
  steps_de: strList,
});

const SUGGESTIONS_SCHEMA = obj({ suggestions: strList, reason: str });

const MENU_SCHEMA = obj({
  menu: { type: 'array', items: obj({ day: str, title: str, reason: str }) },
  note: str,
});

const FRIDGE_SCHEMA = obj({
  matches: { type: 'array', items: obj({ title: str, match: { type: 'string', enum: ['full', 'partial'] }, missing: strList }) },
  suggestion: str,
});

// ── Photo → recipe ─────────────────────────────────────────────────────────
export async function extractRecipeFromImage(base64Image) {
  const system = `You are a recipe extraction assistant. Extract all recipe information from the photo of a recipe.

Field guide:
- title / title_de: recipe name in English / German (translate if needed, or the original if already in that language).
- language: "en" or "de", the language of the original.
- category: infer from the recipe type.
- rating: 0 unless a rating is visible. Convert letter grades to stars: A=5, B+=4, B=3, C=2.
- tags: descriptive, e.g. vegetarian, quick, family-favourite, Christmas.
- notes: any notes or tips on the page, otherwise "".

Rules:
- Convert ALL amounts to metric (g, ml, kg, l, °C, cm). Store only metric.
- For uncountable items (e.g. "salt to taste") use amount 0 and unit "".
- For items counted in pieces use unit "pcs".
- Ingredient notes hold preparation hints such as "finely chopped", otherwise "".
- Always fill BOTH ingredients and ingredients_de, and BOTH steps and steps_de, with the same items in the same order.
- If the recipe is in German, ingredients_de/steps_de are the originals and ingredients/steps are English translations; if it is in English, the other way round.
- The photo may be rotated or upside down: work out the correct orientation before reading.
- Steps must be in their original order, step 1 first.
- For handwriting, read each word carefully and don't confuse similar letters (K/W, H/B, u/n).`;

  return callClaudeJSON([{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64Image } },
      { type: 'text', text: 'Extract this recipe.' },
    ],
  }], system, 8000, RECIPE_SCHEMA);
}

// ── "You might also like" ──────────────────────────────────────────────────
export async function getSuggestions(currentRecipe, allRecipes) {
  const titles = allRecipes
    .filter(r => r.id !== currentRecipe.id)
    .map(r => `${r.title} (${r.category}, rated ${r.rating}/5, tags: ${r.tags?.join(', ')})`)
    .slice(0, 60).join('\n');

  const system = 'You are a helpful recipe assistant.';
  const prompt = `Given this recipe:
Title: ${currentRecipe.title}
Category: ${currentRecipe.category}
Tags: ${currentRecipe.tags?.join(', ')}
Ingredients: ${currentRecipe.ingredients?.map(i => i.name).join(', ')}

From this collection:
${titles}

Pick up to 3 recipes from the collection that go well with it or that someone who likes it would enjoy. Use the exact titles from the collection. "reason" is one brief, friendly sentence.`;

  return callClaudeJSON([{ role: 'user', content: prompt }], system, 1000, SUGGESTIONS_SCHEMA);
}

// ── Weekly menu ────────────────────────────────────────────────────────────
export async function suggestWeeklyMenu(recipes) {
  const options = recipes
    .filter(r => r.category === 'Main' || r.category === 'Soup' || r.category === 'Salad')
    .map(r => `${r.title} (${r.category}, rated ${r.rating}/5, tags: ${r.tags?.join(', ')})`).join('\n');

  const system = 'You are a helpful meal planning assistant.';
  const prompt = `Suggest a balanced weekly dinner menu (Monday to Sunday, 7 meals) from this collection.
Prioritize high-rated recipes and variety. Use the exact titles from the collection.
"reason" is a few words per day; "note" is one practical tip.

Available recipes:
${options}`;

  return callClaudeJSON([{ role: 'user', content: prompt }], system, 2000, MENU_SCHEMA);
}

// ── Fridge mode ────────────────────────────────────────────────────────────
export async function findRecipesFromIngredients(haveIngredients, recipes) {
  const catalog = recipes.map(r => ({
    title: r.title,
    ingredients: r.ingredients?.map(i => i.name).join(', ')
  }));

  const system = 'You are a helpful cooking assistant.';
  const prompt = `I have: ${haveIngredients.join(', ')}

Recipes:
${catalog.map(r => `- ${r.title}: needs ${r.ingredients}`).join('\n')}

Which of these recipes can I make? Assume basic pantry staples (salt, pepper, oil, water) are available.
Sort by best match, at most 6 results, exact titles from the list. "suggestion" is one short tip.`;

  return callClaudeJSON([{ role: 'user', content: prompt }], system, 1500, FRIDGE_SCHEMA);
}

// ── Chat ───────────────────────────────────────────────────────────────────
export async function chatAboutRecipes(messages, recipes) {
  const catalog = recipes.map(r =>
    `${r.title} | ${r.category} | Rating: ${r.rating}/5 | Tags: ${r.tags?.join(', ')} | Ingredients: ${r.ingredients?.map(i=>i.name).join(', ')}`
  ).join('\n');

  const system = `You are a warm, knowledgeable cooking assistant for a family recipe collection. Help find recipes, suggest modifications, answer cooking questions. Keep responses concise and friendly, in plain text (no markdown headings or tables; **bold** is fine).

Collection:
${catalog}

When referring to a recipe from the collection, wrap its exact title in [[double brackets]].`;

  return callClaude(messages, system, 1500);
}
