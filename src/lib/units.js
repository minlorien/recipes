// Amounts are stored as written in the recipe (2 tsp, 1 cup, 200 g, 1 EL).
// Display shows that original as the main amount, plus the equivalent in the
// other system when it's useful: imperial → metric, metric → US kitchen units.

// Spellings the scanner (or a person editing) might use → canonical unit.
const ALIASES = {
  teaspoon: 'tsp', teaspoons: 'tsp', tsps: 'tsp',
  tablespoon: 'tbsp', tablespoons: 'tbsp', tbs: 'tbsp', tbl: 'tbsp', tbsps: 'tbsp',
  cups: 'cup',
  ounce: 'oz', ounces: 'oz',
  pound: 'lb', pounds: 'lb', lbs: 'lb',
  'fl. oz': 'fl oz', 'fl.oz': 'fl oz', floz: 'fl oz', 'fluid ounce': 'fl oz', 'fluid ounces': 'fl oz',
  pints: 'pint', pt: 'pint', quart: 'qt', quarts: 'qt',
  gram: 'g', grams: 'g', gr: 'g', kilogram: 'kg', kilograms: 'kg',
  millilitre: 'ml', milliliter: 'ml', millilitres: 'ml', milliliters: 'ml',
  litre: 'l', liter: 'l', litres: 'l', liters: 'l',
  tl: 'TL', el: 'EL',
  '°f': '°F', '°c': '°C',
};

export function normalizeUnit(unit) {
  const u = String(unit || '').trim().replace(/\.$/, '');
  const lower = u.toLowerCase();
  if (ALIASES[lower]) return ALIASES[lower];
  if (/^(g|kg|ml|l|tsp|tbsp|cup|oz|lb|qt|pint|fl oz)$/.test(lower)) return lower;
  return u;
}

// Spoon and cup measures read best as fractions: "1½ tsp", "¾ cup".
const FRACTION_UNITS = new Set(['tsp', 'tbsp', 'cup', 'TL', 'EL']);

// Equivalent in the other system: [target unit, factor] (temperatures handled separately).
const TO_METRIC = {
  tsp:  ['ml', 5],      // kitchen convention, as on measuring spoons
  tbsp: ['ml', 15],
  cup:  ['ml', 240],
  'fl oz': ['ml', 29.5735],
  pint: ['ml', 473.176],
  qt:   ['ml', 946.353],
  oz:   ['g', 28.3495],
  lb:   ['g', 453.592],
  in:   ['cm', 2.54],
};

const FRACTIONS = [
  [0, ''], [0.125, '⅛'], [0.25, '¼'], [0.333, '⅓'], [0.5, '½'],
  [0.667, '⅔'], [0.75, '¾'], [1, ''],
];

// 1.5 → "1½", 0.25 → "¼", 2 → "2". Snaps to the nearest kitchen fraction.
function fraction(n) {
  let whole = Math.floor(n);
  let best = FRACTIONS[0];
  for (const f of FRACTIONS) if (Math.abs(n - whole - f[0]) < Math.abs(n - whole - best[0])) best = f;
  if (best[0] === 1) whole += 1;
  if (!best[1]) return String(whole || (n > 0 ? '⅛' : 0));
  return whole ? `${whole}${best[1]}` : best[1];
}

function roundNice(n) {
  if (n >= 100) return Math.round(n / 5) * 5;
  if (n >= 10) return Math.round(n);
  if (n >= 1)  return Math.round(n * 10) / 10;
  return Math.round(n * 100) / 100;
}

function cupWord(n, unit) {
  return unit === 'cup' && n > 1.0625 ? 'cups' : unit;
}

// The amount in the recipe's own unit.
function formatOriginal(amount, unit) {
  if (FRACTION_UNITS.has(unit)) return `${fraction(amount)} ${cupWord(amount, unit)}`;
  return `${roundNice(amount)}${unit ? ' ' + unit : ''}`;
}

// Metric (ml) → the US kitchen measure a cook would actually use.
function mlToKitchen(ml) {
  const cups = ml / 236.588;
  if (cups > 4) return `${roundNice(ml / 946.353)} qt`;
  if (cups >= 0.25) return `${fraction(cups)} ${cupWord(cups, 'cup')}`;
  const tbsp = ml / 14.7868;
  if (tbsp >= 1) return `${fraction(tbsp)} tbsp`;
  return `${fraction(ml / 4.92892)} tsp`;
}

// The equivalent in the other system, or null when there isn't a useful one.
function formatOther(amount, unit) {
  // Oven dials go in steps of 5 (or more), so round to 5.
  if (unit === '°F') return `${Math.round((amount - 32) * 5 / 9 / 5) * 5} °C`;
  if (unit === '°C') return `${Math.round((amount * 9 / 5 + 32) / 5) * 5} °F`;

  // German spoons are the same size as US ones: show ml.
  if (unit === 'TL') return `${roundNice(amount * 5)} ml`;
  if (unit === 'EL') return `${roundNice(amount * 15)} ml`;

  if (TO_METRIC[unit]) {
    const [to, factor] = TO_METRIC[unit];
    const v = amount * factor;
    if (to === 'g' && v >= 1000) return `${roundNice(v / 1000)} kg`;
    if (to === 'ml' && v >= 1000) return `${roundNice(v / 1000)} l`;
    return `${roundNice(v)} ${to}`;
  }

  switch (unit) {
    case 'ml': return mlToKitchen(amount);
    case 'l':  return mlToKitchen(amount * 1000);
    // Under ½ oz an ounce figure is useless to a cook ("0.18 oz"), so leave it out.
    case 'g':  return amount < 14 ? null : amount >= 450 ? `${roundNice(amount / 453.592)} lb` : `${fraction(amount / 28.3495)} oz`;
    case 'kg': return `${roundNice(amount * 2.20462)} lb`;
    case 'cm': return `${roundNice(amount / 2.54)} in`;
    case 'mm': return `${roundNice(amount / 25.4)} in`;
    default:   return null;
  }
}

// { main: "1½ tsp", other: "7.4 ml" } — `other` may be null.
export function formatAmount(amount, unit) {
  const u = normalizeUnit(unit);
  return { main: formatOriginal(amount, u), other: formatOther(amount, u) };
}

// Merge duplicate ingredients across recipes for the shopping list
export function mergeIngredients(recipeIngredientLists) {
  const merged = {};
  for (const { recipe, ingredients, servings, baseServings } of recipeIngredientLists) {
    const scale = servings / (baseServings || servings);
    for (const ing of ingredients) {
      // Only add up amounts that share a unit ("2 pcs" + "100 g" eggs stay separate).
      const unit = normalizeUnit(ing.unit);
      const key = `${ing.name.toLowerCase().trim()}|${unit.toLowerCase()}`;
      if (!merged[key]) {
        merged[key] = { name: ing.name, unit, totalAmount: 0, recipes: [] };
      }
      merged[key].totalAmount += (ing.amount || 0) * scale;
      if (!merged[key].recipes.includes(recipe)) {
        merged[key].recipes.push(recipe);
      }
    }
  }
  return Object.entries(merged).map(([key, m]) => ({
    ...m,
    key,
    ...formatAmount(m.totalAmount, m.unit),
  }));
}
