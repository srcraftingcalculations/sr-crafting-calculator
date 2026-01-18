async function loadRecipes() {
  const response = await fetch('data/recipes.json');
  const recipes = await response.json();
  return recipes;
}

let RECIPES = {}; // stored globally after init()

function runCalculator() {
  const item = document.getElementById('itemSelect').value;
  const rate = parseFloat(document.getElementById('rateInput').value);

  const outputArea = document.getElementById('outputArea');
  outputArea.textContent = `Calculating ${rate} units/min of ${item}...`;

  // TODO: Insert full chain logic here
}

async function init() {
  RECIPES = await loadRecipes();

  const itemSelect = document.getElementById('itemSelect');
  Object.keys(RECIPES).forEach(item => {
    const option = document.createElement('option');
    option.value = item;
    option.textContent = item;
    itemSelect.appendChild(option);
  });

  // Step 5: Add event listener instead of inline onclick
  document.getElementById("calcButton").addEventListener("click", runCalculator);
}

init();
