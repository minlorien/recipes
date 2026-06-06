// Metric → Imperial conversion utilities
// All amounts stored internally in metric; displayed in both
const CONVERSIONS = {
  // Volume
  ml:    { to: 'fl oz', factor: 0.033814 },
  l:     { to: 'qt',   factor: 1.05669 },
  // Cooking volume (already imperial-ish, show ml equivalent)
  tsp:   { to: 'ml',   factor: 4.92892 },
  tbsp:  { to: 'ml',   factor: 14.7868 },
  cup:   { to: 'ml',   factor: 236.588 },
  // Weight
  g:     { to: 'oz',   factor: 0.035274, threshold: 500, above: { from: 'g', to: 'lb', factor: 0.00220462 } },
  kg:    { to: 'lb',   factor: 2.20462 },
  oz:    { to: 'g',    factor: 28.3495 },
  lb:    { to: 'g',    factor: 453.592 },
  // Temperature
  '°c':  { to: '°F',   convert: (c) => Math.round(c * 9/5 + 32) },
  '°C':  { to: '°F',   convert: (c) => Math.round(c * 9/5 + 32) },
  // Length
  cm:    { to: 'in',   factor: 0.393701 },
  mm:    { to: 'in',   factor: 0.0393701 },
};

// Cup fractions for nice display
const CUP_FRACTIONS = [
  [1, '1 cup'], [0.75, '¾ cup'], [0.667, '⅔ cup'], [0.5, '½ cup'],
  [0.333, '⅓ cup'], [0.25, '¼ cup'], [0.125, '⅛ cup'],
];

function nearestCupFraction(val) {
  for (const [frac, label] of CUP_FRACTIONS) {
    if (Math.abs(val - frac) < 0.07) return label;
  }
  return null;
}

export function toImperial(amount, unit) {
  if (!amount || !unit) return null;
  const conv = CONVERSIONS[unit.toLowerCase()];
  if (!conv) return null;

  // Temperature
  if (conv.convert) {
    return `${conv.convert(amount)}${conv.to}`;
  }

  // Weight: g → oz, with g → lb above 500g
  if (conv.threshold && amount >= conv.threshold && conv.above) {
    const a = conv.above;
    return `${roundNice(amount * a.factor)} ${a.to}`;
  }

  const converted = amount * conv.factor;

  // Volume: use the full cooking ladder, never fl oz
  if (conv.to === 'fl oz') {
    const tsp  = amount / 4.92892;
    const tbsp = amount / 14.7868;
    const cups = amount / 236.588;
    const qt   = amount / 946.353;

    // > 4 cups → quarts
    if (cups > 4) {
      return `${roundNice(qt)} qt`;
    }
    // ¼ cup to 4 cups → cup fractions
    if (cups >= 0.25) {
      const whole   = Math.floor(cups);
      const frac    = cups - whole;
      const fracStr = nearestCupFraction(frac);
      if (whole === 0 && fracStr) return fracStr;
      if (whole > 0  && fracStr) return `${whole} ${fracStr}`;
      // fallback if fraction doesn't snap to a standard value
      return `${roundNice(cups)} cups`;
    }
    // 1 tbsp to < ¼ cup → tablespoons
    if (tbsp >= 1) {
      return `${roundNice(tbsp)} tbsp`;
    }
    // < 1 tbsp → teaspoons
    return `${roundNice(tsp)} tsp`;
  }

  // Litres → quarts (already sensible for large volumes)
  return `${roundNice(converted)} ${conv.to}`;
}

function roundNice(n) {
  if (n >= 10) return Math.round(n);
  if (n >= 1)  return Math.round(n * 10) / 10;
  return Math.round(n * 100) / 100;
}

export function formatAmount(amount, unit, scale = 1) {
  const scaled   = amount * scale;
  const metric   = `${roundNice(scaled)}${unit ? ' ' + unit : ''}`;
  const imperial = toImperial(scaled, unit);
  return { metric, imperial };
}

export function scaleIngredients(ingredients, servings, baseServings) {
  const scale = servings / baseServings;
  return ingredients.map(ing => ({
    ...ing,
    ...formatAmount(ing.amount, ing.unit, scale),
    scaledAmount: ing.amount * scale,
  }));
}

// Temperature helper
export function formatTemp(celsius) {
  return `${celsius}°C (${Math.round(celsius * 9/5 + 32)}°F)`;
}

// Merge duplicate ingredients across recipes for shopping list
export function mergeIngredients(recipeIngredientLists) {
  const merged = {};
  for (const { recipe, ingredients, servings, baseServings } of recipeIngredientLists) {
    const scale = servings / (baseServings || servings);
    for (const ing of ingredients) {
      const key = ing.name.toLowerCase().trim();
      if (!merged[key]) {
        merged[key] = { name: ing.name, unit: ing.unit, totalAmount: 0, recipes: [] };
      }
      merged[key].totalAmount += (ing.amount || 0) * scale;
      if (!merged[key].recipes.includes(recipe)) {
        merged[key].recipes.push(recipe);
      }
    }
  }
  return Object.values(merged).map(m => ({
    ...m,
    ...formatAmount(m.totalAmount, m.unit),
  }));
}
