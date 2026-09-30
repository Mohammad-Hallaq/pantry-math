import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateNutritionForWeight, sumNutrition, calculateNutritionPer100g, calculatePortionNutrition, calculateNetWeight, normalizeNutrition, roundToTwo } from '../src/nutrition.js';

const nutrition = (calories) => ({ calories, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0 });

test('calculates ingredient nutrition by weight', () => {
  assert.equal(calculateNutritionForWeight(nutrition(120), 650).calories, 780);
});

test('sums recipe nutrition', () => {
  assert.equal(sumNutrition([nutrition(780), nutrition(500)]).calories, 1280);
});

test('calculates cooked nutrition per 100 g', () => {
  assert.ok(Math.abs(calculateNutritionPer100g(nutrition(2450), 1850).calories - 132.432432) < 0.00001);
});

test('calculates an exact portion', () => {
  assert.ok(Math.abs(calculatePortionNutrition(nutrition(2450), 1850, 420).calories - 556.216216) < 0.00001);
});

test('handles zero, invalid and decimal weights safely', () => {
  assert.equal(calculateNutritionForWeight(nutrition(100), 12.5).calories, 12.5);
  assert.equal(calculateNutritionPer100g(nutrition(100), 0).calories, 0);
  assert.equal(calculatePortionNutrition(nutrition(100), 100, 101).calories, 0);
  assert.equal(calculateNutritionForWeight(nutrition(100), -1).calories, 0);
});

test('rounds entered values to two decimal places', () => {
  assert.equal(roundToTwo(12.333333334), 12.33);
  assert.equal(roundToTwo(12.335), 12.34);
});

test('sums product and cooked-recipe portions for a daily log', () => {
  const fruit = calculateNutritionForWeight(nutrition(100), 150);
  const cookedRecipe = calculateNutritionForWeight(nutrition(200), 250);
  assert.equal(sumNutrition([fruit, cookedRecipe]).calories, 650);
});

test('tracks sugar instead of salt', () => {
  const value = normalizeNutrition({ ...nutrition(100), sugar: 12.5, salt: 4 });
  assert.equal(value.sugar, 12.5);
  assert.equal('salt' in value, false);
});

test('supports calories-only manual food totals', () => {
  const manual = normalizeNutrition({ calories: 240 });
  assert.deepEqual(manual, nutrition(240));
});

test('subtracts cooking container weight from the scale reading', () => {
  assert.equal(calculateNetWeight(2500, 1469), 1031);
  assert.equal(calculateNetWeight(1125, 1125), 0);
});

