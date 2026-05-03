import { CONFIG } from '../config.js';
import { getToken } from './state.js';

async function callClaude(messages, system, maxTokens = 2000) {
  const res = await fetch(`${CONFIG.API_BASE}/ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-token': getToken() || '' },
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
    { "name": "ingredient name in English", "amount": 250, "unit": "g", "notes": "optional prep note" }
  ],
  "ingredients_de": [
    { "name": "Zutatenname auf Deutsch", "amount": 250, "unit": "g", "notes": "optionale Notiz" }
  ],
  "steps": ["Step 1 text in English", "Step 2 text in English"],
  "steps_de": ["Schritt 1 auf Deutsch", "Schritt 2 auf Deutsch"]
}

Important rules:
- Convert ALL amounts to metric (g, ml, kg, l, C, cm). Store only metric.
- For uncountable items use amount: 0 and unit: "".
- For items measured in pieces use unit: "pcs".
- Infer category from the recipe type.
- Tags should be descriptive: e.g. vegetarian, quick, family-favourite, Christmas, etc.
- CRITICAL: Always provide BOTH ingredients AND ingredients_de, and BOTH steps AND steps_de. Never leave these empty.
- If recipe is in German, ingredients_de/steps_de are originals; ingredients/steps are English translations.
- If recipe is in English, ingredients/steps are originals; ingredients_de/steps_de are German translations.
- The image may be rotated or upside down - carefully orient it correctly before reading.
- Steps must be in correct sequential order. Step 1 comes first.
- For handwritten recipes, read each word carefully.
- If a letter-grade rating is visible (A, B+, A-), convert to stars: A=5, B+=4, B=3, C=2.`;

  const text = await callClaude([{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Image } },
      { type: 'text', text: `Extract this recipe into JSON format.

IMPORTANT BEFORE YOU START:
1. Determine correct orientation - may be rotated 90, 180 degrees or upside down.
2. Extract steps in correct sequential order (step 1 first).
3. Always provide German translations in ingredients_de and steps_de - mandatory.
4. For handwritten recipes, read carefully character by character.
5. Do not confuse similar letters (K vs W, H vs B, u vs n).` }
    ]
  }], system, 4000);

  let clean = text.replace(/\`\`\`json\n?|\n?\`\`\`/g, '').trim();
  const jsonMatch = clean.match(/\{[\s\S]*\}/);
  if (jsonMatch) clean = jsonMatch[0];
  try {
    return JSON.parse(clean);
  } catch (e) {
    console.error('Failed to parse AI response:', clean);
    throw new Error('Could not parse recipe: ' + e.message);
  }
}

export async function getSuggestions(currentRecipe, allRecipes) {
  const titles = allRecipes
    .filter(r => r.id !== currentRecipe.id)
    .map(r => `${r.title} (${r.category}, rated ${r.rating}/5, tags: ${r.tags?.join(', ')})`)
    .slice(0, 60).join('\n');

  const system = 'You are a helpful recipe assistant. Return ONLY valid JSON, no markdown.';
  const prompt = `Given this recipe:
Title: ${currentRecipe.title}
Category: ${currentRecipe.category}
Tags: ${currentRecipe.tags?.join(', ')}
Ingredients: ${currentRecipe.ingredients?.map(i => i.name).join(', ')}

From this collection:
${titles}

Return JSON: { "suggestions": ["title1", "title2", "title3"], "reason": "brief friendly explanation" }`;

  const text = await callClaude([{ role: 'user', content: prompt }], system, 500);
  const clean = text.replace(/\`\`\`json\n?|\n?\`\`\`/g, '').trim();
  return JSON.parse(clean);
}

export async function suggestWeeklyMenu(recipes) {
  const options = recipes
    .filter(r => r.category === 'Main' || r.category === 'Soup' || r.category === 'Salad')
    .map(r => `${r.title} (${r.category}, rated ${r.rating}/5, tags: ${r.tags?.join(', ')})`).join('\n');

  const system = 'You are a helpful meal planning assistant. Return ONLY valid JSON, no markdown.';
  const prompt = `Suggest a balanced weekly dinner menu (7 meals) from this collection.
Prioritize high-rated recipes and variety.

Available recipes:
${options}

Return JSON: { "menu": [{ "day": "Monday", "title": "recipe title", "reason": "brief reason" }], "note": "tip" }`;

  const text = await callClaude([{ role: 'user', content: prompt }], system, 1000);
  const clean = text.replace(/\`\`\`json\n?|\n?\`\`\`/g, '').trim();
  return JSON.parse(clean);
}

export async function findRecipesFromIngredients(haveIngredients, recipes) {
  const catalog = recipes.map(r => ({
    title: r.title,
    ingredients: r.ingredients?.map(i => i.name).join(', ')
  }));

  const system = 'You are a helpful cooking assistant. Return ONLY valid JSON, no markdown.';
  const prompt = `I have: ${haveIngredients.join(', ')}

Recipes:
${catalog.map(r => `- ${r.title}: needs ${r.ingredients}`).join('\n')}

Which can I make? Return JSON: { "matches": [{ "title": "title", "match": "full or partial", "missing": ["item"] }], "suggestion": "tip" }
Sort by best match. Max 6 results.`;

  const text = await callClaude([{ role: 'user', content: prompt }], system, 800);
  const clean = text.replace(/\`\`\`json\n?|\n?\`\`\`/g, '').trim();
  return JSON.parse(clean);
}

export async function chatAboutRecipes(messages, recipes) {
  const catalog = recipes.map(r =>
    `${r.title} | ${r.category} | Rating: ${r.rating}/5 | Tags: ${r.tags?.join(', ')} | Ingredients: ${r.ingredients?.map(i=>i.name).join(', ')}`
  ).join('\n');

  const system = `You are a warm, knowledgeable cooking assistant for a family recipe collection. Help find recipes, suggest modifications, answer cooking questions. Keep responses concise and friendly.

Collection:
${catalog}

When referring to a recipe, wrap its title in [[double brackets]].`;

  return callClaude(messages, system, 600);
}