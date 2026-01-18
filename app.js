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
// Render Results (TABLE VERSION)
// ===============================
function renderResults(chain, rootItem, rate) {
  let html = `
    <h2>Production chain for ${rate} / min of ${rootItem}</h2>
    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th>Rate (/min)</th>
          <th>Crafts (/min)</th>
          <th>Machines</th>
          <th>Building</th>
          <th>Inputs</th>
        </tr>
      </thead>
      <tbody>
  `;

  for (const [item, data] of Object.entries(chain)) {
    if (data.raw) {
      html += `
        <tr>
          <td>${item}</td>
          <td>${data.rate.toFixed(2)}</td>
          <td>—</td>
          <td>—</td>
          <td>RAW</td>
          <td>—</td>
        </tr>
      `;
    } else {
      let inputList = Object.entries(data.inputs)
        .map(([input, amt]) => `${input}: ${amt.toFixed(2)}/min`)
        .join("<br>");

      html += `
        <tr>
          <td>${item}</td>
          <td>${data.rate.toFixed(2)}</td>
          <td>${data.crafts.toFixed(2)}</td>
          <td>${data.machines.toFixed(2)}</td>
          <td>${data.building}</td>
          <td>${inputList}</td>
        </tr>
      `;
    }
  }

  html += `
      </tbody>
    </table>
  `;

  document.getElementById('outputArea').innerHTML = html;
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
