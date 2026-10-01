import './style.css';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { NUTRIENTS, EMPTY_NUTRITION, calculateNutritionForWeight, sumNutrition, calculateNutritionPer100g, calculatePortionNutrition, calculateNetWeight, formatNutrition, isValidNutrition, normalizeNutrition, roundToTwo } from './nutrition.js';
import { getProducts, saveProduct, getProductByBarcode, productNutrition, getRecipes, saveRecipe, deleteRecipe, getDailyLog, saveDailyLog, getAllDailyLogs, getMonthlyArchives, saveMonthlyArchive, undoMonthlyArchive, createBackupData, restoreBackupData } from './storage.js';

const $ = (selector) => document.querySelector(selector);
const nutrientLabels = { calories: 'Calories', protein: 'Protein', carbs: 'Carbs', fat: 'Fat', fiber: 'Fiber', sugar: 'Sugar' };
let scannerControls;
let snackScannerControls;
let activeProduct;
let activeRecipe;
let activeDayLog;
let addingMealId = null;
let editingMealId = null;
let selectedArchiveMonth = null;
let editingManualItemId = null;

export const cleanBarcode = (value) => String(value).replace(/\D/g, '');
export const isValidBarcode = (value) => /^\d{8,14}$/.test(cleanBarcode(value));

export function normalizeProduct(product, barcode) {
  const n = product.nutriments ?? {};
  return { id: barcode, barcode, name: product.product_name || product.generic_name || 'Unnamed product', brand: product.brands || 'Brand not listed', image: product.image_front_small_url || product.image_front_url || '', nutritionPer100g: { calories: n['energy-kcal_100g'] ?? 0, protein: n.proteins_100g ?? 0, carbs: n.carbohydrates_100g ?? 0, fat: n.fat_100g ?? 0, fiber: n.fiber_100g ?? 0, sugar: n.sugars_100g ?? 0 }, source: 'Open Food Facts' };
}

function setView(view) {
  stopScanner();
  document.querySelectorAll('.view').forEach((element) => { element.hidden = element.id !== `${view}-view`; });
  document.querySelectorAll('.nav-button').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  if (view === 'products') renderProducts();
  else if (view === 'recipes') renderRecipes();
  else if (view === 'today') renderDailyLog();
  else renderHistory();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setStatus(message = '', tone = 'info') {
  $('#status').hidden = !message; $('#status').className = `status ${tone}`; $('#status').textContent = message;
}

function nutritionInputs(container, nutrition = EMPTY_NUTRITION) {
  container.innerHTML = NUTRIENTS.map((key) => `<label>${nutrientLabels[key]}<span><input id="product-${key}" data-nutrient="${key}" data-round type="number" min="0" step="any" value="${nutrition[key] ?? 0}"><b>${key === 'calories' ? 'kcal' : 'g'}</b></span></label>`).join('');
}

function showProduct(product) {
  activeProduct = product;
  $('#product-brand').textContent = product.brand || (product.barcode ? 'Packaged product' : 'Manual ingredient');
  $('#product-name-input').value = product.name || '';
  $('#product-code').textContent = product.barcode ? `Barcode ${product.barcode}` : 'No barcode';
  $('#source').textContent = product.source || 'Manual';
  $('#image-wrap').hidden = !product.image;
  if (product.image) { $('#product-image').src = product.image; $('#product-image').alt = `${product.name} package`; }
  nutritionInputs($('#product-nutrients'), productNutrition(product));
  $('#product-card').hidden = false;
  $('#product-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function newManualProduct() {
  showProduct({ id: crypto.randomUUID(), name: '', brand: '', image: '', nutritionPer100g: { ...EMPTY_NUTRITION }, source: 'Manual' });
  setStatus('Enter the food name and nutrition shown per 100 g.', 'info');
  $('#product-name-input').focus();
}

async function lookupBarcode(value) {
  const barcode = cleanBarcode(value); $('#barcode').value = barcode;
  if (!isValidBarcode(barcode)) { setStatus('Enter a barcode containing 8 to 14 digits.', 'error'); return; }
  const local = getProductByBarcode(barcode);
  if (local) { setStatus('Found your locally verified version.', 'success'); showProduct(local); return; }
  setStatus('Looking up the product…', 'loading');
  try {
    const fields = 'code,product_name,generic_name,brands,image_front_small_url,image_front_url,nutriments';
    const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json?fields=${fields}`);
    const data = response.ok ? await response.json() : null;
    if (!data || data.status !== 1) { setStatus('This product was not found. You can create it manually.', 'error'); return; }
    setStatus('Product found. Check the values against the package.', 'success'); showProduct(normalizeProduct(data.product, barcode));
  } catch { setStatus('The product database could not be reached. Check your connection.', 'error'); }
}

function renderProducts() {
  const products = getProducts(); $('#product-count').textContent = `${products.length} saved`;
  $('#products-list').innerHTML = products.length ? products.map((product) => `<button class="saved-card" data-product="${product.id}"><span class="card-kicker">${product.barcode ? 'Scanned product' : 'Manual food'}</span><strong>${escapeHtml(product.name)}</strong><small>${formatNutrition(productNutrition(product).calories, 'calories')} kcal / 100 g</small></button>`).join('') : '<div class="empty-state">No saved products yet. Scan a barcode or create one manually.</div>';
}

function newRecipe() {
  const now = new Date().toISOString();
  activeRecipe = { id: crypto.randomUUID(), name: '', ingredients: [], cookedWeightG: '', createdAt: now, updatedAt: now };
  openRecipeEditor();
}

function openRecipeEditor() {
  $('#recipes-home').hidden = true; $('#recipe-editor').hidden = false;
  $('#recipe-name').value = activeRecipe.name; $('#cooked-weight').value = activeRecipe.cookedWeightG || ''; $('#portion-weight').value = '';
  $('#cooking-container').value = activeRecipe.weighingContainer || 'none'; $('#gross-cooked-weight').value = activeRecipe.grossCookedWeightG || '';
  setCookingWeightMode(false);
  $('#recipe-status').textContent = ''; renderRecipe();
}

function closeRecipeEditor() { $('#recipe-editor').hidden = true; $('#recipes-home').hidden = false; activeRecipe = null; renderRecipes(); }

function renderRecipes() {
  if (!$('#recipe-editor').hidden && activeRecipe) return;
  const recipes = getRecipes();
  $('#recipes-list').innerHTML = recipes.length ? recipes.map((recipe) => { const total = recipeTotal(recipe); return `<button class="saved-card recipe-card" data-recipe="${recipe.id}"><span class="card-kicker">${recipe.ingredients.length} ingredient${recipe.ingredients.length === 1 ? '' : 's'}</span><strong>${escapeHtml(recipe.name)}</strong><small>${formatNutrition(total.calories, 'calories')} kcal total${recipe.cookedWeightG ? ` · ${recipe.cookedWeightG} g cooked` : ''}</small></button>`; }).join('') : '<div class="empty-state">No recipes yet. Create one to calculate a cooked batch and portion.</div>';
}

function recipeTotal(recipe = activeRecipe) {
  return sumNutrition(recipe.ingredients.map((ingredient) => calculateNutritionForWeight(ingredient.nutritionPer100g, ingredient.weightG)));
}

function macroMarkup(nutrition) {
  return NUTRIENTS.map((key) => `<div class="macro ${key === 'fiber' || key === 'sugar' ? 'minor' : ''}"><span>${nutrientLabels[key]}</span><strong>${formatNutrition(nutrition[key], key)}</strong><small>${key === 'calories' ? 'kcal' : 'g'}</small></div>`).join('');
}

function renderRecipe() {
  const products = getProducts();
  $('#ingredients-list').innerHTML = activeRecipe.ingredients.length ? activeRecipe.ingredients.map((ingredient) => `<div class="ingredient-row" data-ingredient="${ingredient.id}"><div><strong>${escapeHtml(ingredient.productName)}</strong><small>${formatNutrition(ingredient.nutritionPer100g.calories, 'calories')} kcal / 100 g</small></div><label>Weight used<div class="mini-unit"><input class="ingredient-weight" data-round type="number" min="0" step="any" inputmode="decimal" value="${ingredient.weightG || ''}"><b>g</b></div></label><div class="ingredient-energy"><strong>${formatNutrition(calculateNutritionForWeight(ingredient.nutritionPer100g, ingredient.weightG).calories, 'calories')}</strong><small>kcal</small></div><button class="remove-ingredient icon-button" aria-label="Remove ${escapeHtml(ingredient.productName)}">×</button></div>`).join('') : `<div class="empty-state">Add every ingredient you expect to consume, including oils and small additions.${products.length ? '' : ' Save a product first or create one manually.'}</div>`;
  updateCalculations();
}

function updateCalculations() {
  if (!activeRecipe) return;
  const total = recipeTotal(); $('#recipe-totals').innerHTML = macroMarkup(total);
  const cooked = Number($('#cooked-weight').value); const portion = Number($('#portion-weight').value);
  const cookedValid = Number.isFinite(cooked) && cooked > 0;
  const invalidContainerReading = $('#cooking-container').value !== 'none' && $('#gross-cooked-weight').value !== '' && !cookedValid;
  $('#cooked-error').textContent = invalidContainerReading ? 'The scale reading must be greater than the container weight.' : $('#cooked-weight').value && !cookedValid ? 'Cooked weight must be greater than 0.' : '';
  $('#cooked-totals').innerHTML = macroMarkup(cookedValid ? calculateNutritionPer100g(total, cooked) : EMPTY_NUTRITION);
  const portionValid = cookedValid && Number.isFinite(portion) && portion > 0 && portion <= cooked;
  $('#portion-error').textContent = !$('#portion-weight').value ? '' : !cookedValid ? 'Enter the final cooked weight first.' : portion <= 0 ? 'Portion weight must be greater than 0.' : portion > cooked ? 'Portion cannot be greater than the cooked batch.' : '';
  $('#portion-totals').innerHTML = macroMarkup(portionValid ? calculatePortionNutrition(total, cooked, portion) : EMPTY_NUTRITION);
  $('#breakdown-body').innerHTML = activeRecipe.ingredients.map((ingredient) => { const n = calculateNutritionForWeight(ingredient.nutritionPer100g, ingredient.weightG); return `<tr><td>${escapeHtml(ingredient.productName)}</td><td>${Number(ingredient.weightG) || 0} g</td><td>${formatNutrition(n.calories, 'calories')} kcal</td><td>${formatNutrition(n.protein, 'protein')} g</td><td>${formatNutrition(n.carbs, 'carbs')} g</td><td>${formatNutrition(n.fat, 'fat')} g</td></tr>`; }).join('');
}

function selectedContainerWeight() {
  return Number($('#cooking-container').selectedOptions[0]?.dataset.weight || 0);
}

function setCookingWeightMode(preserveNet = true) {
  const usesContainer = $('#cooking-container').value !== 'none';
  const currentNet = Number($('#cooked-weight').value);
  $('#net-weight-entry').hidden = usesContainer; $('#gross-weight-entry').hidden = !usesContainer;
  if (usesContainer && preserveNet && !$('#gross-cooked-weight').value && currentNet > 0) $('#gross-cooked-weight').value = roundToTwo(currentNet + selectedContainerWeight());
  $('#weight-help').textContent = usesContainer ? `The selected container weighs ${selectedContainerWeight()} g and is subtracted automatically.` : 'Enter the edible food weight after cooking.';
  updateCookingWeight();
}

function updateCookingWeight() {
  if ($('#cooking-container').value !== 'none') {
    const gross = $('#gross-cooked-weight').value;
    const net = gross === '' ? 0 : calculateNetWeight(gross, selectedContainerWeight());
    $('#cooked-weight').value = net || '';
    $('#calculated-net-weight').textContent = `${net || 0} g`;
    $('#cooked-error').textContent = gross !== '' && !net ? 'The scale reading must be greater than the container weight.' : '';
  }
  updateCalculations();
}

function addProductToRecipe(product) {
  activeRecipe.ingredients.push({ id: crypto.randomUUID(), productId: product.id, productName: product.name, nutritionPer100g: productNutrition(product), weightG: '' });
  $('#ingredient-dialog').close(); renderRecipe();
}

function renderIngredientChoices(query = '') {
  const products = getProducts().filter((product) => product.name.toLowerCase().includes(query.toLowerCase()));
  $('#ingredient-products').innerHTML = products.length ? products.map((product) => `<button type="button" data-select-product="${product.id}"><span><strong>${escapeHtml(product.name)}</strong><small>${formatNutrition(productNutrition(product).calories, 'calories')} kcal / 100 g</small></span><b>+</b></button>`).join('') : '<p class="empty-state small">No matching saved products.</p>';
}

function saveActiveRecipe() {
  const name = $('#recipe-name').value.trim(); const cooked = $('#cooked-weight').value;
  if (!name) { $('#recipe-status').textContent = 'Give the recipe a name before saving.'; $('#recipe-name').focus(); return; }
  if (!activeRecipe.ingredients.length) { $('#recipe-status').textContent = 'Add at least one ingredient.'; return; }
  if (activeRecipe.ingredients.some((item) => !Number.isFinite(Number(item.weightG)) || Number(item.weightG) < 0 || !isValidNutrition(item.nutritionPer100g))) { $('#recipe-status').textContent = 'Check ingredient weights and nutrition values.'; return; }
  if ($('#cooking-container').value !== 'none' && $('#gross-cooked-weight').value !== '' && !calculateNetWeight($('#gross-cooked-weight').value, selectedContainerWeight())) { $('#recipe-status').textContent = 'The scale reading must be greater than the selected container weight.'; return; }
  if (cooked !== '' && (!Number.isFinite(Number(cooked)) || Number(cooked) <= 0)) { $('#recipe-status').textContent = 'Cooked weight must be greater than 0.'; return; }
  activeRecipe.ingredients.forEach((ingredient) => { ingredient.weightG = roundToTwo(ingredient.weightG); });
  activeRecipe = { ...activeRecipe, name, cookedWeightG: cooked === '' ? '' : roundToTwo(cooked), weighingContainer: $('#cooking-container').value, grossCookedWeightG: $('#cooking-container').value === 'none' || $('#gross-cooked-weight').value === '' ? '' : roundToTwo($('#gross-cooked-weight').value), updatedAt: new Date().toISOString() };
  saveRecipe(activeRecipe); $('#recipe-status').textContent = 'Recipe saved locally.';
}

function localDateKey(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function setLogDate(date) {
  $('#log-date').value = date;
  activeDayLog = normalizeDailyLog(getDailyLog(date));
  renderDailyLog();
}

function normalizeDailyLog(log) {
  if (Array.isArray(log.meals)) return log;
  const names = [...new Set(log.items.map((item) => item.meal).filter(Boolean))];
  log.meals = names.map((name) => ({ id: crypto.randomUUID(), name }));
  log.items.forEach((item) => {
    const meal = log.meals.find((entry) => entry.name === item.meal);
    item.mealId = meal?.id ?? null;
    delete item.meal;
  });
  saveDailyLog(log);
  return log;
}

function dailyItemNutrition(item) {
  if (item.entryMode === 'manual-total') return normalizeNutrition(item.nutritionTotal);
  return calculateNutritionForWeight(item.nutritionPer100g, item.weightG);
}

function dailyTotal() {
  return sumNutrition((activeDayLog?.items ?? []).map(dailyItemNutrition));
}

function renderDailyLog() {
  const date = $('#log-date').value || localDateKey();
  if (!activeDayLog || activeDayLog.date !== date) activeDayLog = normalizeDailyLog(getDailyLog(date));
  $('#log-date').value = date;
  const isToday = date === localDateKey();
  const displayDate = new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  $('#day-heading').textContent = isToday ? `Today · ${displayDate}` : displayDate;
  $('#daily-totals').innerHTML = macroMarkup(dailyTotal());
  $('#meal-sections').innerHTML = activeDayLog.meals.length ? activeDayLog.meals.map((meal) => {
    const items = activeDayLog.items.filter((item) => item.mealId === meal.id);
    const total = sumNutrition(items.map(dailyItemNutrition));
    const rows = items.length ? items.map((item) => {
      const n = dailyItemNutrition(item);
      if (item.entryMode === 'manual-total') return `<div class="daily-item manual-daily-item" data-daily-item="${item.id}"><div><span class="card-kicker">Manual entry</span><strong>${escapeHtml(item.name)}</strong><small>${formatNutrition(n.calories, 'calories')} kcal · ${formatNutrition(n.protein, 'protein')} g protein</small></div><button class="edit-manual-item secondary">Edit</button><button class="remove-daily-item icon-button" aria-label="Remove ${escapeHtml(item.name)}">×</button></div>`;
      return `<div class="daily-item" data-daily-item="${item.id}"><div><span class="card-kicker">${item.sourceType}</span><strong>${escapeHtml(item.name)}</strong><small>${formatNutrition(n.calories, 'calories')} kcal · ${formatNutrition(n.protein, 'protein')} g protein</small></div><label>Amount<div class="mini-unit"><input class="daily-weight" data-round type="number" min="0" step="any" inputmode="decimal" value="${item.weightG || ''}"><b>g</b></div></label><button class="remove-daily-item icon-button" aria-label="Remove ${escapeHtml(item.name)}">×</button></div>`;
    }).join('') : '<p class="meal-empty">Nothing logged yet.</p>';
    return `<section class="meal-card" data-meal-id="${meal.id}"><header><div><p class="kicker">Meal</p><h2>${escapeHtml(meal.name)}</h2><strong>${formatNutrition(total.calories, 'calories')} kcal</strong></div><div class="meal-actions"><button class="rename-meal secondary" aria-label="Rename ${escapeHtml(meal.name)}">Rename</button><button class="delete-meal icon-button" aria-label="Delete ${escapeHtml(meal.name)}">×</button><button class="add-daily-food primary">+ Add food</button></div></header>${rows}</section>`;
  }).join('') : '<div class="empty-state meals-empty"><strong>No meals yet.</strong><br>Create your first meal and name it however you like.</div>';
  updateArchiveReminder();
}

function renderFoodChoices(query = '') {
  const search = query.trim().toLowerCase();
  const products = getProducts().filter((product) => product.name.toLowerCase().includes(search)).map((product) => ({ id: product.id, name: product.name, type: 'Product', nutritionPer100g: productNutrition(product), available: true }));
  const recipes = getRecipes().filter((recipe) => recipe.name.toLowerCase().includes(search)).map((recipe) => ({ id: recipe.id, name: recipe.name, type: 'Recipe', nutritionPer100g: recipe.cookedWeightG > 0 ? calculateNutritionPer100g(recipeTotal(recipe), recipe.cookedWeightG) : EMPTY_NUTRITION, available: recipe.cookedWeightG > 0 }));
  const choices = [...recipes, ...products];
  $('#food-choices').innerHTML = choices.length ? choices.map((choice) => `<button type="button" data-food-id="${choice.id}" data-food-type="${choice.type}" ${choice.available ? '' : 'disabled'}><span><strong>${escapeHtml(choice.name)}</strong><small>${choice.type}${choice.available ? ` · ${formatNutrition(choice.nutritionPer100g.calories, 'calories')} kcal / 100 g` : ' · Add cooked weight first'}</small></span><b>${choice.available ? '+' : '!'}</b></button>`).join('') : '<p class="empty-state small">No matching saved foods.</p>';
}

function addFoodToDay(sourceId, sourceType) {
  let source;
  if (sourceType === 'Recipe') {
    const recipe = getRecipes().find((item) => item.id === sourceId);
    if (!recipe?.cookedWeightG) return;
    source = { name: recipe.name, nutritionPer100g: calculateNutritionPer100g(recipeTotal(recipe), recipe.cookedWeightG) };
  } else {
    const product = getProducts().find((item) => item.id === sourceId);
    if (!product) return;
    source = { name: product.name, nutritionPer100g: productNutrition(product) };
  }
  activeDayLog.items.push({ id: crypto.randomUUID(), sourceId, sourceType, name: source.name, nutritionPer100g: source.nutritionPer100g, weightG: '', mealId: addingMealId });
  saveDailyLog(activeDayLog); $('#food-dialog').close(); renderDailyLog();
  requestAnimationFrame(() => $(`[data-daily-item]:last-of-type .daily-weight`)?.focus());
}

function openManualFoodDialog(item = null) {
  stopSnackScanner();
  editingManualItemId = item?.id ?? null;
  $('#manual-food-title').textContent = item ? 'Edit manual food' : 'Enter food manually';
  $('#manual-food-name').value = item?.name ?? '';
  NUTRIENTS.forEach((key) => { $(`#manual-${key}`).value = item?.nutritionTotal?.[key] ?? ''; });
  $('#manual-food-error').textContent = '';
  $('#snack-barcode-tools').hidden = Boolean(item);
  $('#snack-barcode').value = '';
  $('#snack-lookup-status').textContent = 'The scanned item is used only for this daily entry.';
  $('#manual-food-dialog').showModal();
  requestAnimationFrame(() => $('#manual-food-name').focus());
}

function stopSnackScanner() {
  snackScannerControls?.stop();
  snackScannerControls = undefined;
  $('#snack-scanner').hidden = true;
  $('#snack-open-camera').hidden = false;
}

async function lookupSnackBarcode(value) {
  const barcode = cleanBarcode(value);
  $('#snack-barcode').value = barcode;
  const status = $('#snack-lookup-status');
  if (!isValidBarcode(barcode)) { status.textContent = 'Enter a barcode containing 8 to 14 digits.'; return; }
  status.textContent = 'Looking up the snack…';
  try {
    const fields = 'code,product_name,generic_name,brands,nutriments,serving_quantity,serving_size';
    const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json?fields=${fields}`);
    const data = response.ok ? await response.json() : null;
    if (!data || data.status !== 1) { status.textContent = 'This barcode was not found. You can still enter the label values manually.'; return; }
    const product = normalizeProduct(data.product, barcode);
    const servingQuantity = Number(data.product.serving_quantity);
    const usesServing = Number.isFinite(servingQuantity) && servingQuantity > 0;
    const nutrition = usesServing ? calculateNutritionForWeight(product.nutritionPer100g, servingQuantity) : product.nutritionPer100g;
    $('#manual-food-name').value = product.name;
    NUTRIENTS.forEach((key) => { $(`#manual-${key}`).value = roundToTwo(nutrition[key]); });
    status.textContent = usesServing
      ? `Filled for one serving (${data.product.serving_size || `${roundToTwo(servingQuantity)} g`}). Check the package before saving.`
      : 'Serving size was unavailable, so values are per 100 g. Adjust them to the amount you ate.';
  } catch {
    status.textContent = 'The lookup could not be completed. Check your connection or enter the label values manually.';
  }
}

async function startSnackScanner() {
  $('#snack-lookup-status').textContent = 'Starting camera…';
  $('#snack-open-camera').hidden = true;
  $('#snack-scanner').hidden = false;
  try {
    const reader = new BrowserMultiFormatReader();
    snackScannerControls = await reader.decodeFromVideoDevice(undefined, $('#snack-scanner-video'), (result) => {
      if (result && isValidBarcode(result.getText())) { stopSnackScanner(); lookupSnackBarcode(result.getText()); }
    });
  } catch (error) {
    stopSnackScanner();
    $('#snack-lookup-status').textContent = error?.name === 'NotAllowedError' ? 'Camera permission was denied. Enter the barcode digits instead.' : 'The camera could not start. Enter the barcode digits instead.';
  }
}

function saveManualFood() {
  const name = $('#manual-food-name').value.trim();
  const rawCalories = $('#manual-calories').value;
  const nutritionTotal = Object.fromEntries(NUTRIENTS.map((key) => [key, $(`#manual-${key}`).value === '' ? 0 : roundToTwo($(`#manual-${key}`).value)]));
  if (!name || rawCalories === '' || !isValidNutrition(nutritionTotal)) { $('#manual-food-error').textContent = 'Enter a name, calories, and valid non-negative optional macros.'; return; }
  if (editingManualItemId) {
    const item = activeDayLog.items.find((entry) => entry.id === editingManualItemId);
    Object.assign(item, { name, nutritionTotal });
  } else {
    activeDayLog.items.push({ id: crypto.randomUUID(), sourceType: 'Manual', entryMode: 'manual-total', name, nutritionTotal, mealId: addingMealId });
  }
  saveDailyLog(activeDayLog); $('#manual-food-dialog').close(); renderDailyLog();
}

function shiftLogDate(days) {
  const date = new Date(`${$('#log-date').value}T12:00:00`);
  date.setDate(date.getDate() + days);
  setLogDate(localDateKey(date));
}

function openMealDialog(meal = null) {
  editingMealId = meal?.id ?? null;
  $('#meal-dialog-title').textContent = meal ? 'Rename meal' : 'Add a meal';
  $('#meal-name').value = meal?.name ?? '';
  $('#meal-dialog').showModal();
  requestAnimationFrame(() => $('#meal-name').focus());
}

function previousMonthKey() {
  const date = new Date();
  date.setDate(1); date.setMonth(date.getMonth() - 1);
  return localDateKey(date).slice(0, 7);
}

function divideNutrition(nutrition, divisor) {
  if (!divisor) return { ...EMPTY_NUTRITION };
  return Object.fromEntries(NUTRIENTS.map((key) => [key, nutrition[key] / divisor]));
}

function buildMonthlyArchive(month) {
  const sourceLogs = Object.fromEntries(Object.entries(getAllDailyLogs()).filter(([date, log]) => date.startsWith(`${month}-`) && log.items?.length));
  const dailyTotals = Object.entries(sourceLogs).sort(([a], [b]) => a.localeCompare(b)).map(([date, rawLog]) => {
    const log = normalizeDailyLog(structuredClone(rawLog));
    return { date, nutrition: sumNutrition(log.items.map(dailyItemNutrition)) };
  });
  const totals = sumNutrition(dailyTotals.map((day) => day.nutrition));
  const [year, monthNumber] = month.split('-').map(Number);
  const calendarDays = new Date(year, monthNumber, 0).getDate();
  const foodCounts = {};
  Object.values(sourceLogs).flatMap((log) => log.items ?? []).forEach((item) => {
    const key = `${item.sourceType}:${item.name}`;
    foodCounts[key] ??= { name: item.name, sourceType: item.sourceType, timesLogged: 0, totalWeightG: 0 };
    foodCounts[key].timesLogged += 1; foodCounts[key].totalWeightG += Number(item.weightG) || 0;
  });
  return {
    month, createdAt: new Date().toISOString(), trackedDays: dailyTotals.length, calendarDays, totals,
    averageTrackedDay: divideNutrition(totals, dailyTotals.length), averageCalendarDay: divideNutrition(totals, calendarDays), dailyTotals,
    topFoods: Object.values(foodCounts).sort((a, b) => b.timesLogged - a.timesLogged).slice(0, 8)
  };
}

function downloadBackup() {
  const data = createBackupData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = `pantry-math-backup-${localDateKey()}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function calorieChart(archive) {
  const width = 720; const height = 250; const pad = 38;
  const values = Array.from({ length: archive.calendarDays }, (_, index) => archive.dailyTotals.find((day) => Number(day.date.slice(-2)) === index + 1)?.nutrition.calories ?? 0);
  const max = Math.max(...values, 1); const x = (index) => pad + index * (width - pad * 2) / Math.max(values.length - 1, 1); const y = (value) => height - pad - value / max * (height - pad * 2);
  const points = values.map((value, index) => `${x(index)},${y(value)}`).join(' ');
  const dots = values.map((value, index) => value ? `<circle cx="${x(index)}" cy="${y(value)}" r="4"><title>Day ${index + 1}: ${Math.round(value)} kcal</title></circle>` : '').join('');
  return `<svg class="calorie-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily calorie plot"><line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}"/><line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}"/><text x="${pad - 8}" y="${pad + 4}" text-anchor="end">${Math.round(max)}</text><text x="${pad - 8}" y="${height - pad + 4}" text-anchor="end">0</text><text x="${pad}" y="${height - 12}">1</text><text x="${width - pad}" y="${height - 12}" text-anchor="end">${values.length}</text><polyline points="${points}"/>${dots}</svg>`;
}

function renderArchiveDetail(archive) {
  if (!archive) { $('#archive-detail').innerHTML = '<div class="empty-state">Close a completed month to see its results here.</div>'; return; }
  const title = new Date(`${archive.month}-01T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const days = archive.dailyTotals.map((day) => `<div><span>${new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span><strong>${formatNutrition(day.nutrition.calories, 'calories')} kcal</strong></div>`).join('');
  const foods = archive.topFoods?.map((food) => `<li><span>${escapeHtml(food.name)} <small>${food.sourceType}</small></span><strong>${food.timesLogged}×</strong></li>`).join('') || '<li>No food breakdown available.</li>';
  $('#archive-detail').innerHTML = `<header><div><p class="kicker">Monthly archive</p><h2>${title}</h2><p>${archive.trackedDays} of ${archive.calendarDays} days tracked</p></div>${archive.sourceLogs ? '<button id="undo-archive" class="secondary">Undo close</button>' : ''}</header><div class="archive-totals">${macroMarkup(archive.totals)}</div><div class="averages"><div><span>Average per tracked day</span><strong>${formatNutrition(archive.averageTrackedDay.calories, 'calories')} kcal</strong></div><div><span>Average across calendar month</span><strong>${formatNutrition(archive.averageCalendarDay.calories, 'calories')} kcal</strong></div></div><section class="plot-card"><h3>Daily calories</h3>${calorieChart(archive)}</section><div class="archive-columns"><section><h3>Daily totals</h3><div class="daily-history">${days}</div></section><section><h3>Most logged foods</h3><ol class="top-foods">${foods}</ol></section></div>`;
}

function renderHistory() {
  const archives = getMonthlyArchives();
  $('#archive-month').max = previousMonthKey();
  if (!$('#archive-month').value) $('#archive-month').value = previousMonthKey();
  if (!selectedArchiveMonth && archives.length) selectedArchiveMonth = archives[0].month;
  $('#archive-list').innerHTML = archives.length ? archives.map((archive) => { const title = new Date(`${archive.month}-01T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }); return `<button data-archive="${archive.month}" class="archive-card ${archive.month === selectedArchiveMonth ? 'active' : ''}"><span>${title}</span><strong>${formatNutrition(archive.totals.calories, 'calories')} kcal</strong><small>${archive.trackedDays} days tracked</small></button>`; }).join('') : '<div class="empty-state">No closed months yet.</div>';
  renderArchiveDetail(archives.find((archive) => archive.month === selectedArchiveMonth));
}

function updateArchiveReminder() {
  const archived = new Set(getMonthlyArchives().map((item) => item.month));
  const currentMonth = localDateKey().slice(0, 7);
  const available = Object.entries(getAllDailyLogs()).filter(([date, log]) => date.slice(0, 7) < currentMonth && log.items?.length).map(([date]) => date.slice(0, 7)).sort()[0];
  const reminder = $('#archive-reminder');
  reminder.hidden = !available || archived.has(available);
  if (!reminder.hidden) { const title = new Date(`${available}-01T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }); reminder.textContent = `${title} is complete — review and close the month →`; reminder.dataset.month = available; }
}

function stopScanner() { scannerControls?.stop(); scannerControls = undefined; $('#scanner').hidden = true; $('#open-camera').hidden = false; }
function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value ?? ''; return div.innerHTML; }

document.querySelectorAll('.nav-button').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
$('#lookup-form').addEventListener('submit', (event) => { event.preventDefault(); lookupBarcode($('#barcode').value); });
$('#manual-product').addEventListener('click', newManualProduct);
$('#new-search').addEventListener('click', () => { $('#product-card').hidden = true; setStatus(); $('#barcode').value = ''; });
$('#nutrition-form').addEventListener('submit', (event) => { event.preventDefault(); const name = $('#product-name-input').value.trim(); const nutrition = Object.fromEntries(NUTRIENTS.map((key) => [key, roundToTwo($(`[data-nutrient="${key}"]`).value)])); if (!name || !isValidNutrition(nutrition)) { setStatus('Enter a name and valid non-negative nutrition values.', 'error'); return; } activeProduct = saveProduct({ ...activeProduct, name, nutritionPer100g: nutrition, source: 'Saved locally' }); $('#source').textContent = activeProduct.source; nutritionInputs($('#product-nutrients'), nutrition); setStatus('Product saved and ready for recipes.', 'success'); renderProducts(); });
$('#products-list').addEventListener('click', (event) => { const card = event.target.closest('[data-product]'); if (card) showProduct(getProducts().find((product) => product.id === card.dataset.product)); });
$('#open-camera').addEventListener('click', async () => { setStatus(); $('#open-camera').hidden = true; $('#scanner').hidden = false; try { const reader = new BrowserMultiFormatReader(); scannerControls = await reader.decodeFromVideoDevice(undefined, $('#scanner-video'), (result) => { if (result && isValidBarcode(result.getText())) { stopScanner(); lookupBarcode(result.getText()); } }); } catch (error) { stopScanner(); setStatus(error?.name === 'NotAllowedError' ? 'Camera permission was denied. Type the barcode instead.' : 'The camera could not start. Type the barcode instead.', 'error'); } });
$('#close-camera').addEventListener('click', stopScanner);
$('#new-recipe').addEventListener('click', newRecipe); $('#back-recipes').addEventListener('click', closeRecipeEditor);
$('#recipes-list').addEventListener('click', (event) => { const card = event.target.closest('[data-recipe]'); if (!card) return; activeRecipe = structuredClone(getRecipes().find((recipe) => recipe.id === card.dataset.recipe)); openRecipeEditor(); });
$('#add-ingredient').addEventListener('click', () => { renderIngredientChoices(); $('#product-search').value = ''; $('#ingredient-dialog').showModal(); });
$('#product-search').addEventListener('input', (event) => renderIngredientChoices(event.target.value));
$('#ingredient-products').addEventListener('click', (event) => { const button = event.target.closest('[data-select-product]'); if (button) addProductToRecipe(getProducts().find((product) => product.id === button.dataset.selectProduct)); });
$('#ingredient-scan').addEventListener('click', () => setView('products')); $('#ingredient-manual').addEventListener('click', () => { setView('products'); newManualProduct(); });
$('#ingredients-list').addEventListener('input', (event) => { if (!event.target.classList.contains('ingredient-weight')) return; const ingredient = activeRecipe.ingredients.find((item) => item.id === event.target.closest('.ingredient-row').dataset.ingredient); ingredient.weightG = event.target.value; updateCalculations(); });
$('#ingredients-list').addEventListener('click', (event) => { if (!event.target.classList.contains('remove-ingredient')) return; activeRecipe.ingredients = activeRecipe.ingredients.filter((item) => item.id !== event.target.closest('.ingredient-row').dataset.ingredient); renderRecipe(); });
$('#cooked-weight').addEventListener('input', updateCalculations); $('#gross-cooked-weight').addEventListener('input', updateCookingWeight); $('#cooking-container').addEventListener('change', () => setCookingWeightMode()); $('#portion-weight').addEventListener('input', updateCalculations); $('#save-recipe').addEventListener('click', saveActiveRecipe);
document.addEventListener('focusout', (event) => { if (!event.target.matches('input[data-round]') || event.target.value === '') return; event.target.value = roundToTwo(event.target.value); event.target.dispatchEvent(new Event('input', { bubbles: true })); });
$('#duplicate-recipe').addEventListener('click', () => { const now = new Date().toISOString(); activeRecipe = { ...structuredClone(activeRecipe), id: crypto.randomUUID(), name: `${$('#recipe-name').value || activeRecipe.name} (copy)`, createdAt: now, updatedAt: now }; $('#recipe-name').value = activeRecipe.name; $('#recipe-status').textContent = 'Copy created. Save when ready.'; });
$('#delete-recipe').addEventListener('click', () => { if (activeRecipe && confirm(`Delete “${activeRecipe.name || 'this recipe'}”?`)) { deleteRecipe(activeRecipe.id); closeRecipeEditor(); } });

$('#meal-sections').addEventListener('click', (event) => {
  const add = event.target.closest('.add-daily-food');
  if (add) { addingMealId = add.closest('[data-meal-id]').dataset.mealId; $('#food-search').value = ''; renderFoodChoices(); $('#food-dialog').showModal(); return; }
  const rename = event.target.closest('.rename-meal');
  if (rename) { const meal = activeDayLog.meals.find((entry) => entry.id === rename.closest('[data-meal-id]').dataset.mealId); openMealDialog(meal); return; }
  const deleteButton = event.target.closest('.delete-meal');
  if (deleteButton) { const mealId = deleteButton.closest('[data-meal-id]').dataset.mealId; const meal = activeDayLog.meals.find((entry) => entry.id === mealId); if (confirm(`Delete “${meal.name}” and everything logged in it?`)) { activeDayLog.meals = activeDayLog.meals.filter((entry) => entry.id !== mealId); activeDayLog.items = activeDayLog.items.filter((item) => item.mealId !== mealId); saveDailyLog(activeDayLog); renderDailyLog(); } return; }
  const editManual = event.target.closest('.edit-manual-item');
  if (editManual) { const item = activeDayLog.items.find((entry) => entry.id === editManual.closest('[data-daily-item]').dataset.dailyItem); openManualFoodDialog(item); return; }
  const remove = event.target.closest('.remove-daily-item');
  if (remove) { const id = remove.closest('[data-daily-item]').dataset.dailyItem; activeDayLog.items = activeDayLog.items.filter((item) => item.id !== id); saveDailyLog(activeDayLog); renderDailyLog(); }
});
$('#meal-sections').addEventListener('change', (event) => {
  if (!event.target.classList.contains('daily-weight')) return;
  const item = activeDayLog.items.find((entry) => entry.id === event.target.closest('[data-daily-item]').dataset.dailyItem);
  item.weightG = roundToTwo(event.target.value); saveDailyLog(activeDayLog); renderDailyLog();
});
$('#food-search').addEventListener('input', (event) => renderFoodChoices(event.target.value));
$('#food-choices').addEventListener('click', (event) => { const choice = event.target.closest('[data-food-id]'); if (choice && !choice.disabled) addFoodToDay(choice.dataset.foodId, choice.dataset.foodType); });
$('#manual-daily-food').addEventListener('click', () => setTimeout(() => openManualFoodDialog(), 0));
$('#close-manual-food').addEventListener('click', () => { stopSnackScanner(); $('#manual-food-dialog').close(); });
$('#snack-open-camera').addEventListener('click', startSnackScanner);
$('#snack-close-camera').addEventListener('click', stopSnackScanner);
$('#snack-lookup').addEventListener('click', () => lookupSnackBarcode($('#snack-barcode').value));
$('#snack-barcode').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); lookupSnackBarcode(event.currentTarget.value); } });
$('#manual-food-form').addEventListener('submit', (event) => { event.preventDefault(); saveManualFood(); });
$('#log-date').addEventListener('change', (event) => setLogDate(event.target.value));
$('#previous-day').addEventListener('click', () => shiftLogDate(-1));
$('#next-day').addEventListener('click', () => shiftLogDate(1));
$('#today-button').addEventListener('click', () => setLogDate(localDateKey()));
$('#add-meal').addEventListener('click', () => openMealDialog());
$('#close-meal-dialog').addEventListener('click', () => $('#meal-dialog').close());
$('#meal-form').addEventListener('submit', (event) => {
  event.preventDefault(); const name = $('#meal-name').value.trim(); if (!name) return;
  if (editingMealId) activeDayLog.meals.find((meal) => meal.id === editingMealId).name = name;
  else activeDayLog.meals.push({ id: crypto.randomUUID(), name });
  saveDailyLog(activeDayLog); $('#meal-dialog').close(); renderDailyLog();
});
$('#archive-reminder').addEventListener('click', (event) => { setView('history'); $('#archive-month').value = event.currentTarget.dataset.month; });
$('#export-backup').addEventListener('click', downloadBackup);
$('#import-backup').addEventListener('click', () => $('#backup-file').click());
$('#backup-file').addEventListener('change', async (event) => {
  const file = event.target.files[0]; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!confirm('Restore this backup? Current Pantry Math data on this device will be replaced.')) return;
    restoreBackupData(data); activeDayLog = null; activeRecipe = null; selectedArchiveMonth = null;
    renderProducts(); renderRecipes(); setLogDate(localDateKey()); renderHistory();
    $('#archive-status').textContent = 'Backup restored successfully.';
  } catch (error) { $('#archive-status').textContent = error.message || 'The backup could not be restored.'; }
  event.target.value = '';
});
$('#close-month').addEventListener('click', () => {
  const month = $('#archive-month').value; const status = $('#archive-status'); status.textContent = '';
  if (!month || month > previousMonthKey()) { status.textContent = 'Choose a completed month.'; return; }
  if (getMonthlyArchives().some((archive) => archive.month === month)) { status.textContent = 'That month is already archived.'; return; }
  const archive = buildMonthlyArchive(month);
  if (!archive.trackedDays) { status.textContent = 'There are no logged days in that month.'; return; }
  downloadBackup();
  if (!confirm(`Your backup has been downloaded. Close ${month} and remove its detailed meal entries?`)) { status.textContent = 'Month closing cancelled; no history was removed.'; return; }
  const sourceLogs = Object.fromEntries(Object.entries(getAllDailyLogs()).filter(([date, log]) => date.startsWith(`${month}-`) && log.items?.length));
  saveMonthlyArchive(archive, sourceLogs); selectedArchiveMonth = month; activeDayLog = null; renderHistory(); updateArchiveReminder();
  status.textContent = 'Month closed and archived successfully.';
});
$('#archive-list').addEventListener('click', (event) => { const card = event.target.closest('[data-archive]'); if (card) { selectedArchiveMonth = card.dataset.archive; renderHistory(); } });
$('#archive-detail').addEventListener('click', (event) => {
  if (event.target.id !== 'undo-archive') return;
  if (confirm('Restore the detailed daily records for this month and remove its archive?')) { undoMonthlyArchive(selectedArchiveMonth); selectedArchiveMonth = null; renderHistory(); updateArchiveReminder(); }
});

renderProducts(); renderRecipes(); setLogDate(localDateKey()); renderHistory();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  });
}

