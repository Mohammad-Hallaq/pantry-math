import { NUTRIENTS, normalizeNutrition } from './nutrition.js';

const PRODUCTS_KEY = 'pantry-math:products';
const RECIPES_KEY = 'pantry-math:recipes';
const DAILY_LOGS_KEY = 'pantry-math:daily-logs';
const ARCHIVES_KEY = 'pantry-math:monthly-archives';

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

export const getAllDailyLogs = () => read(DAILY_LOGS_KEY, {});
export const getMonthlyArchives = () => read(ARCHIVES_KEY, []);

export function saveMonthlyArchive(archive, sourceLogs) {
  const archives = getMonthlyArchives().map((item) => ({ ...item, sourceLogs: undefined }));
  const saved = { ...archive, sourceLogs };
  const index = archives.findIndex((item) => item.month === archive.month);
  if (index >= 0) archives[index] = saved; else archives.unshift(saved);
  archives.sort((a, b) => b.month.localeCompare(a.month));
  localStorage.setItem(ARCHIVES_KEY, JSON.stringify(archives));

  const logs = getAllDailyLogs();
  Object.keys(logs).filter((date) => date.startsWith(`${archive.month}-`)).forEach((date) => delete logs[date]);
  localStorage.setItem(DAILY_LOGS_KEY, JSON.stringify(logs));
  return saved;
}

export function undoMonthlyArchive(month) {
  const archives = getMonthlyArchives();
  const archive = archives.find((item) => item.month === month);
  if (!archive?.sourceLogs) return false;
  localStorage.setItem(DAILY_LOGS_KEY, JSON.stringify({ ...getAllDailyLogs(), ...archive.sourceLogs }));
  localStorage.setItem(ARCHIVES_KEY, JSON.stringify(archives.filter((item) => item.month !== month)));
  return true;
}

export function createBackupData() {
  return {
    format: 'pantry-math-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    products: getProducts(),
    recipes: getRecipes(),
    dailyLogs: getAllDailyLogs(),
    monthlyArchives: getMonthlyArchives()
  };
}

export function restoreBackupData(data) {
  if (data?.format !== 'pantry-math-backup' || data.version !== 1 || !Array.isArray(data.products) || !Array.isArray(data.recipes) || !data.dailyLogs || !Array.isArray(data.monthlyArchives)) {
    throw new Error('This is not a valid Pantry Math backup.');
  }
  localStorage.setItem(PRODUCTS_KEY, JSON.stringify(data.products.map(normalizeStoredProduct)));
  localStorage.setItem(RECIPES_KEY, JSON.stringify(data.recipes));
  localStorage.setItem(DAILY_LOGS_KEY, JSON.stringify(data.dailyLogs));
  localStorage.setItem(ARCHIVES_KEY, JSON.stringify(data.monthlyArchives));
}

