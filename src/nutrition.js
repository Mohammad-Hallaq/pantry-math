export const NUTRIENTS = ['calories', 'protein', 'carbs', 'fat', 'fiber', 'salt'];
export const EMPTY_NUTRITION = Object.freeze({ calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, salt: 0 });

export function roundToTwo(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

export function normalizeNutrition(value = {}) {
  return Object.fromEntries(NUTRIENTS.map((key) => {
    const number = Number(value[key] ?? 0);
    return [key, Number.isFinite(number) && number >= 0 ? number : 0];
  }));
}

export function isValidNutrition(value) {
  return NUTRIENTS.every((key) => Number.isFinite(Number(value?.[key])) && Number(value[key]) >= 0);
}

export function calculateNutritionForWeight(nutritionPer100g, weightG) {
  const weight = Number(weightG);
  if (!Number.isFinite(weight) || weight < 0) return { ...EMPTY_NUTRITION };
  const nutrition = normalizeNutrition(nutritionPer100g);
  return Object.fromEntries(NUTRIENTS.map((key) => [key, nutrition[key] * weight / 100]));
}

export function sumNutrition(items) {
  return items.reduce((total, item) => {
    const nutrition = normalizeNutrition(item);
    NUTRIENTS.forEach((key) => { total[key] += nutrition[key]; });
    return total;
  }, { ...EMPTY_NUTRITION });
}

export function calculateNutritionPer100g(totalNutrition, totalWeightG) {
  const weight = Number(totalWeightG);
  if (!Number.isFinite(weight) || weight <= 0) return { ...EMPTY_NUTRITION };
  return calculateNutritionForWeight(totalNutrition, 10000 / weight);
}

export function calculatePortionNutrition(totalNutrition, cookedWeightG, portionWeightG) {
  const cooked = Number(cookedWeightG);
  const portion = Number(portionWeightG);
  if (!Number.isFinite(cooked) || cooked <= 0 || !Number.isFinite(portion) || portion <= 0 || portion > cooked) {
    return { ...EMPTY_NUTRITION };
  }
  const total = normalizeNutrition(totalNutrition);
  return Object.fromEntries(NUTRIENTS.map((key) => [key, total[key] * portion / cooked]));
}

export function formatNutrition(value, key) {
  if (!Number.isFinite(value)) return '0';
  return key === 'calories' ? Math.round(value).toLocaleString() : value.toFixed(value >= 100 ? 0 : 1);
}

