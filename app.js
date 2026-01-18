// ===============================
// Load Recipes
// ===============================
async function loadRecipes() {
  const response = await fetch('data/recipes.json');
  const recipes = await response.json();
  return recipes;
}

let RECIPES = {}; // Global storage


// ===============================
// Machine Speeds (adjust later if needed)
// ===============================
const MACHINE_SPEED = {
  "Smelter": 1.0,
  "Fabricator": 1.0,
  "Assembler": 1.0,
  "Furnace": 1.0
};


// ===============================
// Helper Functions
// ===============================

// Get recipe for an item
function getRecipe(item) {
  return RECIPES[item] || null;
}

// Determine if an item is raw (no recipe)
function isRawResource(item) {
  return !RECIPES[item] || !RECIPES[item].inputs || Object.keys(RECIPES[item].inputs).length === 0;
}

// Crafts per minute
function craftsPerMinute(recipe) {
  return 60 / recipe.time;
}

// Output per minute
function outputPerMinute(recipe) {
  return craftsPerMinute(recipe) * recipe.output;
}

// Machines needed
function machinesNeeded(recipe, craftsPerMin) {
  const speed = MACHINE_SPEED[recipe.building] || 1.0;
  return craftsPerMin / speed;
}


// ===============================
// Chain Expansion Logic
// ===============================
function expandChain(item, targetRate, chain = {}) {
  const recipe = getRecipe(item);

  // Raw resource
  if (!recipe) {
    chain[item] = chain[item] || { rate: 0, raw: true };
    chain[item].rate += targetRate;
    return chain;
  }

  // Calculate crafts needed
  const opm = outputPerMinute(recipe);
  const craftsNeeded = targetRate / opm;

  // Store item data
  chain[item] = chain[item] || {
    rate: 0,
    raw: false,
    building: recipe.building,
    crafts: 0,
    machines: 0,
    inputs: {}
  };

  chain[item].rate += targetRate;
  chain[item].crafts += craftsNeeded;
  chain[item].machines += machinesNeeded(recipe, craftsNeeded);

  // Expand inputs
  for (const [inputItem, inputAmount] of Object.entries(recipe.inputs)) {
    const inputRate = craftsNeeded * inputAmount;

    chain[item].inputs[inputItem] = (chain[item].inputs[inputItem] || 0) + inputRate;

    expandChain(inputItem, inputRate, chain);
  }

  return chain;
}


// ===============================
// Render Results
// ===============================
function renderResults(chain, rootItem, rate) {
  let text = `Production chain for ${rate} / min of ${rootItem}\n\n`;

  for (const [item, data] of Object.entries(chain)) {
    if (data.raw) {
      text += `${item}: ${data.rate.toFixed(2)} / min (RAW)\n`;
    } else {
      text += `${item}: ${data.rate.toFixed(2)} / min — ${data.crafts.toFixed(2)} crafts/min — ${data.machines.toFixed(2)} ${data.building}(s)\n`;
      for (const [input, amt] of Object.entries(data.inputs)) {
        text += `   - ${input}: ${amt.toFixed(2)} / min\n`;
      }
    }
    text += `\n`;
  }

  document.getElementById('outputArea').textContent = text;
}


// ===============================
// Main Calculator Trigger
// ===============================
function runCalculator() {
  const item = document.getElementById('itemSelect').value;
  const rate = parseFloat(document.getElementById('rateInput').value);

  const chain = expandChain(item, rate);

  renderResults(chain, item, rate);
}


// ===============================
// Initialization
// ===============================
async function init() {
  RECIPES = await loadRecipes();

  const itemSelect = document.getElementById('itemSelect');
  Object.keys(RECIPES).forEach(item => {
    const option = document.createElement('option');
    option.value = item;
    option.textContent = item;
    itemSelect.appendChild(option);
  });

  // Event listener for the button
  document.getElementById("calcButton").addEventListener("click", runCalculator);
}

init();
