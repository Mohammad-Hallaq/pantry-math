import './style.css';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { NUTRIENTS, EMPTY_NUTRITION, calculateNutritionForWeight, sumNutrition, calculateNutritionPer100g, calculatePortionNutrition, formatNutrition, isValidNutrition } from './nutrition.js';
import { getProducts, saveProduct, getProductByBarcode, productNutrition, getRecipes, saveRecipe, deleteRecipe } from './storage.js';

const $ = (selector) => document.querySelector(selector);
const nutrientLabels = { calories: 'Calories', protein: 'Protein', carbs: 'Carbs', fat: 'Fat', fiber: 'Fiber', salt: 'Salt' };
let scannerControls;
let activeProduct;
let activeRecipe;

export const cleanBarcode = (value) => String(value).replace(/\D/g, '');
export const isValidBarcode = (value) => /^\d{8,14}$/.test(cleanBarcode(value));

export function normalizeProduct(product, barcode) {
  const n = product.nutriments ?? {};
  return { id: barcode, barcode, name: product.product_name || product.generic_name || 'Unnamed product', brand: product.brands || 'Brand not listed', image: product.image_front_small_url || product.image_front_url || '', nutritionPer100g: { calories: n['energy-kcal_100g'] ?? 0, protein: n.proteins_100g ?? 0, carbs: n.carbohydrates_100g ?? 0, fat: n.fat_100g ?? 0, fiber: n.fiber_100g ?? 0, salt: n.salt_100g ?? 0 }, source: 'Open Food Facts' };
}

function setView(view) {
  stopScanner();
  document.querySelectorAll('.view').forEach((element) => { element.hidden = element.id !== `${view}-view`; });
  document.querySelectorAll('.nav-button').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  if (view === 'products') renderProducts(); else renderRecipes();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setStatus(message = '', tone = 'info') {
  $('#status').hidden = !message; $('#status').className = `status ${tone}`; $('#status').textContent = message;
}

function nutritionInputs(container, nutrition = EMPTY_NUTRITION) {
  container.innerHTML = NUTRIENTS.map((key) => `<label>${nutrientLabels[key]}<span><input id="product-${key}" data-nutrient="${key}" type="number" min="0" step="0.01" value="${nutrition[key] ?? 0}"><b>${key === 'calories' ? 'kcal' : 'g'}</b></span></label>`).join('');
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
  return NUTRIENTS.map((key) => `<div class="macro ${key === 'fiber' || key === 'salt' ? 'minor' : ''}"><span>${nutrientLabels[key]}</span><strong>${formatNutrition(nutrition[key], key)}</strong><small>${key === 'calories' ? 'kcal' : 'g'}</small></div>`).join('');
}

function renderRecipe() {
  const products = getProducts();
  $('#ingredients-list').innerHTML = activeRecipe.ingredients.length ? activeRecipe.ingredients.map((ingredient) => `<div class="ingredient-row" data-ingredient="${ingredient.id}"><div><strong>${escapeHtml(ingredient.productName)}</strong><small>${formatNutrition(ingredient.nutritionPer100g.calories, 'calories')} kcal / 100 g</small></div><label>Weight used<div class="mini-unit"><input class="ingredient-weight" type="number" min="0" step="0.1" inputmode="decimal" value="${ingredient.weightG || ''}"><b>g</b></div></label><div class="ingredient-energy"><strong>${formatNutrition(calculateNutritionForWeight(ingredient.nutritionPer100g, ingredient.weightG).calories, 'calories')}</strong><small>kcal</small></div><button class="remove-ingredient icon-button" aria-label="Remove ${escapeHtml(ingredient.productName)}">×</button></div>`).join('') : `<div class="empty-state">Add every ingredient you expect to consume, including oils and small additions.${products.length ? '' : ' Save a product first or create one manually.'}</div>`;
  updateCalculations();
}

function updateCalculations() {
  if (!activeRecipe) return;
  const total = recipeTotal(); $('#recipe-totals').innerHTML = macroMarkup(total);
  const cooked = Number($('#cooked-weight').value); const portion = Number($('#portion-weight').value);
  const cookedValid = Number.isFinite(cooked) && cooked > 0;
  $('#cooked-error').textContent = $('#cooked-weight').value && !cookedValid ? 'Cooked weight must be greater than 0.' : '';
  $('#cooked-totals').innerHTML = macroMarkup(cookedValid ? calculateNutritionPer100g(total, cooked) : EMPTY_NUTRITION);
  const portionValid = cookedValid && Number.isFinite(portion) && portion > 0 && portion <= cooked;
  $('#portion-error').textContent = !$('#portion-weight').value ? '' : !cookedValid ? 'Enter the final cooked weight first.' : portion <= 0 ? 'Portion weight must be greater than 0.' : portion > cooked ? 'Portion cannot be greater than the cooked batch.' : '';
  $('#portion-totals').innerHTML = macroMarkup(portionValid ? calculatePortionNutrition(total, cooked, portion) : EMPTY_NUTRITION);
  $('#breakdown-body').innerHTML = activeRecipe.ingredients.map((ingredient) => { const n = calculateNutritionForWeight(ingredient.nutritionPer100g, ingredient.weightG); return `<tr><td>${escapeHtml(ingredient.productName)}</td><td>${Number(ingredient.weightG) || 0} g</td><td>${formatNutrition(n.calories, 'calories')} kcal</td><td>${formatNutrition(n.protein, 'protein')} g</td><td>${formatNutrition(n.carbs, 'carbs')} g</td><td>${formatNutrition(n.fat, 'fat')} g</td></tr>`; }).join('');
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
  if (cooked !== '' && (!Number.isFinite(Number(cooked)) || Number(cooked) <= 0)) { $('#recipe-status').textContent = 'Cooked weight must be greater than 0.'; return; }
  activeRecipe = { ...activeRecipe, name, cookedWeightG: cooked === '' ? '' : Number(cooked), updatedAt: new Date().toISOString() };
  saveRecipe(activeRecipe); $('#recipe-status').textContent = 'Recipe saved locally.';
}

function stopScanner() { scannerControls?.stop(); scannerControls = undefined; $('#scanner').hidden = true; $('#open-camera').hidden = false; }
function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value ?? ''; return div.innerHTML; }

document.querySelectorAll('.nav-button').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
$('#lookup-form').addEventListener('submit', (event) => { event.preventDefault(); lookupBarcode($('#barcode').value); });
$('#manual-product').addEventListener('click', newManualProduct);
$('#new-search').addEventListener('click', () => { $('#product-card').hidden = true; setStatus(); $('#barcode').value = ''; });
$('#nutrition-form').addEventListener('submit', (event) => { event.preventDefault(); const name = $('#product-name-input').value.trim(); const nutrition = Object.fromEntries(NUTRIENTS.map((key) => [key, Number($(`[data-nutrient="${key}"]`).value)])); if (!name || !isValidNutrition(nutrition)) { setStatus('Enter a name and valid non-negative nutrition values.', 'error'); return; } activeProduct = saveProduct({ ...activeProduct, name, nutritionPer100g: nutrition, source: 'Saved locally' }); $('#source').textContent = activeProduct.source; setStatus('Product saved and ready for recipes.', 'success'); renderProducts(); });
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
$('#cooked-weight').addEventListener('input', updateCalculations); $('#portion-weight').addEventListener('input', updateCalculations); $('#save-recipe').addEventListener('click', saveActiveRecipe);
$('#duplicate-recipe').addEventListener('click', () => { const now = new Date().toISOString(); activeRecipe = { ...structuredClone(activeRecipe), id: crypto.randomUUID(), name: `${$('#recipe-name').value || activeRecipe.name} (copy)`, createdAt: now, updatedAt: now }; $('#recipe-name').value = activeRecipe.name; $('#recipe-status').textContent = 'Copy created. Save when ready.'; });
$('#delete-recipe').addEventListener('click', () => { if (activeRecipe && confirm(`Delete “${activeRecipe.name || 'this recipe'}”?`)) { deleteRecipe(activeRecipe.id); closeRecipeEditor(); } });

renderProducts(); renderRecipes();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  });
}

