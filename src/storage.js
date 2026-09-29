import { NUTRIENTS, normalizeNutrition } from './nutrition.js';

const PRODUCTS_KEY = 'pantry-math:products';
const RECIPES_KEY = 'pantry-math:recipes';
const DAILY_LOGS_KEY = 'pantry-math:daily-logs';

function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}

export function productNutrition(product) {
  return normalizeNutrition(product.nutritionPer100g ?? Object.fromEntries(NUTRIENTS.map((key) => [key, product[key]])));
}

export function normalizeStoredProduct(product) {
  return { ...product, id: product.id || product.barcode || crypto.randomUUID(), nutritionPer100g: productNutrition(product) };
}

export function getProducts() {
  const products = read(PRODUCTS_KEY, []).map(normalizeStoredProduct);
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!/^pantry-math:\d{8,14}$/.test(key)) continue;
    const legacy = read(key, null);
    if (legacy && !products.some((item) => item.barcode === legacy.barcode)) products.push(normalizeStoredProduct(legacy));
  }
  return products;
}

export function saveProduct(product) {
  const normalized = normalizeStoredProduct(product);
  const products = getProducts();
  const match = products.findIndex((item) => item.id === normalized.id || (normalized.barcode && item.barcode === normalized.barcode));
  if (match >= 0) products[match] = normalized; else products.push(normalized);
  localStorage.setItem(PRODUCTS_KEY, JSON.stringify(products));
  if (normalized.barcode) localStorage.setItem(`pantry-math:${normalized.barcode}`, JSON.stringify({ ...normalized, ...normalized.nutritionPer100g }));
  return normalized;
}

export const getProductByBarcode = (barcode) => getProducts().find((item) => item.barcode === barcode) ?? null;
export const getRecipes = () => read(RECIPES_KEY, []);

export function saveRecipe(recipe) {
  const recipes = getRecipes();
  const index = recipes.findIndex((item) => item.id === recipe.id);
  if (index >= 0) recipes[index] = recipe; else recipes.unshift(recipe);
  localStorage.setItem(RECIPES_KEY, JSON.stringify(recipes));
  return recipe;
}

export function deleteRecipe(id) {
  localStorage.setItem(RECIPES_KEY, JSON.stringify(getRecipes().filter((recipe) => recipe.id !== id)));
}

export function getDailyLog(date) {
  const logs = read(DAILY_LOGS_KEY, {});
  return logs[date] ?? { date, items: [] };
}

export function saveDailyLog(log) {
  const logs = read(DAILY_LOGS_KEY, {});
  logs[log.date] = log;
  localStorage.setItem(DAILY_LOGS_KEY, JSON.stringify(logs));
  return log;
}

