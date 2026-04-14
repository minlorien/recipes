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
- Tags should be descriptive: e.g. vegetarian, quick, family-favourite, Christmas, etc.
- Always provide both ingredients and ingredients_de, and both steps and steps_de.
- If the recipe is already in German, ingredients_de and steps_de are the originals; ingredients and steps are the English translations.
- If the recipe is in English, ingredients and steps are the originals; ingredients_de and steps_de are German translations.
- The image may be rotated — always orient it correctly before reading.
- For handwritten recipes, read each word carefully. The title is the most important field to get right.
- If a letter-grade rating is visible (e.g. A, B+, A-) in the image, convert it to stars: A=5, B+=4, B=3, C=2.
- The image may be rotated — always orient it correctly before reading.
- For handwritten recipes, read each word carefully. The title is the most important field to get right.
- If a letter-grade rating is visible (e.g. A, B+, A-) in the image, convert it: A=5, B+=4, B=3, C=2.`;

  const text = await callClaude([{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Image } },
      { type: 'text', text: `Extract this recipe into JSON format.

Important: The image may be rotated (sideways or upside down) — mentally rotate it to read correctly before extracting.
This may be a handwritten recipe in German or English. Read handwriting carefully character by character.
The recipe title is usually the largest or most prominent text. Double-check you are reading it correctly.
German words to watch for: Kalter=Cold, Hund=Dog, Kuchen=Cake, Brot=Bread, Torte=Tart, Suppe=Soup, Salat=Salad.
Do not confuse visually similar letters in handwriting (e.g. K vs W, H vs B, u vs n).` }
    ]
  }], system, 3000);

  // Strip any accidental markdown fences or surrounding text
  let clean = text.replace(/```json\n?|\n?```/g, '').trim();
  // Extract just the JSON object if there's surrounding text
  const jsonMatch = clean.match(/\{[\s\S]*\}/);
  if (jsonMatch) clean = jsonMatch[0];
  try {
    return JSON.parse(clean);
  } catch (e) {
    console.error('Failed to parse AI response:', clean);
    throw new Error('Could not parse recipe: ' + e.message);
  }
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
