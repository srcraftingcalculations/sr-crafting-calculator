// ===============================
// Load Recipes
// ===============================
async function loadRecipes() {
  const url = "https://srcraftingcalculations.github.io/sr-crafting-calculator/data/recipes.json";

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error("Failed to fetch recipes.json");
    return await response.json();
  } catch (err) {
    console.error("Error loading recipes:", err);
    document.getElementById("outputArea").innerHTML =
      `<p style="color:red;">Error loading recipe data. Please try again later.</p>`;
    return {};
  }
}

let RECIPES = {};
let TIERS = {};

const MACHINE_SPEED = {
  "Smelter": 1.0,
  "Fabricator": 1.0,
  "Assembler": 1.0,
  "Furnace": 1.0,
  "Mega Press": 1.0,
  "Refinery": 1.0,
  "Pyro Forge": 1.0
};

const SPECIAL_EXTRACTORS = {
  "Helium-3": 240,
  "Goethite Ore": 400,
  "Sulphur Ore": 240
};

// ===============================
// Helpers
// ===============================
function getRecipe(name) {
  return RECIPES[name] || null;
}

function computeRailsNeeded(inputRates, railSpeed) {
  const total = Object.values(inputRates).reduce((sum, val) => sum + val, 0);
  return Math.ceil(total / railSpeed);
}


// ===============================
// Chain Expansion
// ===============================
function expandChain(item, targetRate) {
  const chain = {};
  const machineTotals = {};
  const extractorTotals = {};

  const pending = {};
  const processed = {};
  const queue = [];

  function trackExtractor(name, rate) {
    if (!extractorTotals[name]) extractorTotals[name] = 0;
    extractorTotals[name] += rate;
  }

  function enqueue(name, rate) {
    const recipe = getRecipe(name);

    // If it's RAW (no recipe), count it immediately every time
    if (!recipe) {
      trackExtractor(name, rate);
      return;
    }

    // For crafted items, accumulate and queue as before
    pending[name] = (pending[name] || 0) + rate;
    if (!processed[name]) queue.push(name);
  }

  enqueue(item, targetRate);

  while (queue.length > 0) {
    queue.sort((a, b) => (TIERS[b] ?? 0) - (TIERS[a] ?? 0));
    const current = queue.shift();
    if (processed[current]) continue;
    processed[current] = true;

    const rate = pending[current];
    const recipe = getRecipe(current);

    // At this point, recipe is guaranteed to exist (RAW handled in enqueue)
    const craftsPerMin = rate / recipe.output;
    const outputPerMinPerMachine = (recipe.output * 60) / recipe.time;
    const machines = Math.ceil(rate / outputPerMinPerMachine);

    chain[current] = {
      rate,
      raw: false,
      building: recipe.building,
      machines,
      inputs: {}
    };

    machineTotals[recipe.building] =
      (machineTotals[recipe.building] || 0) + machines;

    for (const [input, qty] of Object.entries(recipe.inputs)) {
      const inputRate = craftsPerMin * qty;
      chain[current].inputs[input] = inputRate;
      enqueue(input, inputRate);
    }
  }

  return { chain, machineTotals, extractorTotals };
}


// ===============================
// Table Rendering
// ===============================
function renderTable(chainObj, rootItem, rate) {
  const { chain, machineTotals, extractorTotals } = chainObj;
  const railSpeed = parseInt(document.getElementById("railSelect").value);

  let html = `
    <h2>Production chain for ${rate} / min of ${rootItem}</h2>
    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th>Qty/min</th>
          <th>Output/machine</th>
          <th>Machines</th>
          <th>Machine Type</th>
          <th>Inputs</th>
          <th>Rails Needed</th>
        </tr>
      </thead>
      <tbody>
  `;

  const tierGroups = {};
  for (const [item, data] of Object.entries(chain)) {
    const tier = TIERS[item] ?? 0;
    if (!tierGroups[tier]) tierGroups[tier] = [];
    tierGroups[tier].push([item, data]);
  }

  const sortedTiers = Object.keys(tierGroups)
    .map(Number)
    .sort((a, b) => b - a);

  for (const tier of sortedTiers) {
  html += `<tr><td colspan="7"><strong>--- Level ${tier} ---</strong></td></tr>`;
  const rows = tierGroups[tier].sort((a, b) => a[0].localeCompare(b[0]));

  for (const [item, data] of rows) {
    if (data.raw) continue; // ⛔ Skip RAW items

    let outputPerMachine = "—";
    let machines = "—";
    let railsNeeded = "—";

    if (!data.raw) {
      const recipe = getRecipe(item);
      if (recipe) {
        outputPerMachine = Math.ceil((recipe.output * 60) / recipe.time); // ✅ integer-safe formula
      }
      machines = Math.ceil(data.machines);
      railsNeeded = computeRailsNeeded(data.inputs, railSpeed);
    }

    const inputs = Object.entries(data.inputs || {})
      .map(([i, amt]) => `${i}: ${Math.ceil(amt)}/min`)
      .join("<br>");

    html += `
      <tr>
        <td>${item}</td>
        <td>${Math.ceil(data.rate)}</td>
        <td>${outputPerMachine}</td>
        <td>${machines}</td>
        <td>${data.building}</td>
        <td>${inputs || "—"}</td>
        <td>${railsNeeded}</td>
      </tr>
    `;
  }
}

html += `</tbody></table>`;

  // ===============================
  // MACHINES REQUIRED (total)
  // ===============================
  html += `
    <h3>MACHINES REQUIRED (total)</h3>
    <table>
      <thead>
        <tr><th>Machine Type</th><th>Count</th></tr>
      </thead>
      <tbody>
        ${Object.entries(machineTotals)
          .sort((a, b) => b[1] - a[1])
          .map(([type, count]) => `
            <tr>
              <td>${type}</td>
              <td>${Math.ceil(count)}</td>
            </tr>
          `).join("")}
      </tbody>
    </table>
  `;

  // ===============================
  // EXTRACTION REQUIRED
  // ===============================
  html += `
    <h3>EXTRACTION REQUIRED</h3>
    <table>
      <thead>
        <tr>
          <th>Resource</th>
          <th>Impure</th>
          <th>Normal</th>
          <th>Pure</th>
          <th>Qty/min</th>
        </tr>
      </thead>
      <tbody>
  `;

  const sortedExtractors = Object.entries(extractorTotals)
    .filter(([_, qty]) => qty > 0)
    .sort((a, b) => b[1] - a[1]);

  for (const [resource, qty] of sortedExtractors) {
    const rounded = Math.ceil(qty);

    if (SPECIAL_EXTRACTORS[resource]) {
      const normal = Math.ceil(rounded / SPECIAL_EXTRACTORS[resource]);
      html += `
        <tr>
          <td>${resource}</td>
          <td>—</td>
          <td>${normal}</td>
          <td>—</td>
          <td>${rounded}</td>
        </tr>
      `;
    } else {
      const impure = Math.ceil(rounded / 60);
      const normal = Math.ceil(rounded / 120);
      const pure = Math.ceil(rounded / 240);

      html += `
        <tr>
          <td>${resource}</td>
          <td>${impure}</td>
          <td>${normal}</td>
          <td>${pure}</td>
          <td>${rounded}</td>
        </tr>
      `;
    }
  }

  html += `</tbody></table>`;
  document.getElementById("outputArea").innerHTML = html;
}


// ===============================
// Graph Rendering
// ===============================
function buildGraphData(chain, rootItem) {
  const nodes = [];
  const links = [];
  const nodeMap = new Map();

  for (const [item, data] of Object.entries(chain)) {
    const node = {
      id: item,
      label: item,
      depth: TIERS[item] ?? 0,
      raw: data.raw,
      building: data.building,
      rate: data.rate,
      machines: data.machines
    };
    nodes.push(node);
    nodeMap.set(item, node);
  }

  for (const [item, data] of Object.entries(chain)) {
    if (!data.raw) {
      for (const inputItem of Object.keys(data.inputs || {})) {
        if (nodeMap.has(inputItem)) {
          links.push({ from: item, to: inputItem });
        }
      }
    }
  }

  return { nodes, links };
}

function renderGraph(graphData, rootItem) {
  const container = document.getElementById('graphArea');
  if (!container) return;

  const rowHeight = 100;
  const colWidth = 180;
  const nodeRadius = 20;

  const { nodes, links } = graphData;

  const depthMap = new Map();
  nodes.forEach(node => {
    if (!depthMap.has(node.depth)) depthMap.set(node.depth, []);
    depthMap.get(node.depth).push(node);
  });

  depthMap.forEach((nodesAtDepth, depth) => {
    nodesAtDepth.forEach((node, index) => {
      node.x = 100 + depth * colWidth;
      node.y = 80 + index * rowHeight;
    });
  });

  const maxDepth = Math.max(...nodes.map(n => n.depth));
  const width = 100 + (maxDepth + 1) * colWidth;
  const height = Math.max(300, nodes.length * rowHeight);

  let svg = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">`;

  svg += `
    <defs>
      <marker id="arrow" markerWidth="10" markerHeight="10"
              refX="10" refY="3" orient="auto"
              markerUnits="strokeWidth">
        <path d="M0,0 L0,6 L9,3 z" fill="#999" />
      </marker>
    </defs>
  `;

  links.forEach(link => {
    const fromNode = nodes.find(n => n.id === link.from);
    const toNode = nodes.find(n => n.id === link.to);
    if (!fromNode || !toNode) return;

    svg += `
      <line x1="${fromNode.x}" y1="${fromNode.y}"
            x2="${toNode.x}" y2="${toNode.y}"
            stroke="#999" stroke-width="2"
            marker-end="url(#arrow)" />
    `;
  });

  nodes.forEach(node => {
  const fill = node.raw ? "#f4d03f" : "#3498db";
  const stroke = node.id === rootItem ? "#e74c3c" : "#2c3e50";

  svg += `
    <g>
      <text x="${node.x}" y="${node.y - 30}"
            text-anchor="middle" font-size="12">${node.label}</text>
      <circle cx="${node.x}" cy="${node.y}" r="${nodeRadius}"
              fill="${fill}" stroke="${stroke}" stroke-width="2" />
    </g>
  `;
});

  svg += `</svg>`;
  container.innerHTML = svg;
}


// ===============================
// Calculator Trigger
// ===============================
function runCalculator() {
  const item = document.getElementById('itemSelect').value;
  const rate = parseFloat(document.getElementById('rateInput').value);

  if (!item || isNaN(rate) || rate <= 0) {
    document.getElementById("outputArea").innerHTML =
      "<p style='color:red;'>Please select an item and enter a valid rate.</p>";
    return;
  }

  const chainObj = expandChain(item, rate);

  renderTable(chainObj, item, rate);

  const graphData = buildGraphData(chainObj.chain, item);
  renderGraph(graphData, item);
}

// ===============================
// Dark Mode Toggle
// ===============================
function setupDarkMode() {
  const toggle = document.getElementById("darkModeToggle");
  if (!toggle) return;

  const saved = localStorage.getItem("darkMode");
  if (saved === "true") {
    document.body.classList.add("dark");
    toggle.textContent = "☀️ Light Mode";
  } else {
    toggle.textContent = "🌙 Dark Mode";
  }

  toggle.addEventListener("click", () => {
    const isDark = document.body.classList.toggle("dark");
    localStorage.setItem("darkMode", isDark);
    toggle.textContent = isDark ? "☀️ Light Mode" : "🌙 Dark Mode";
  });
}


// ===============================
// Initialization
// ===============================
async function init() {
  setupDarkMode();

  const data = await loadRecipes();
  RECIPES = data;
  TIERS = data._tiers || {};

  const itemSelect = document.getElementById('itemSelect');
  if (itemSelect) {
    Object.keys(RECIPES)
      .filter(k => k !== "_tiers")
      .sort()
      .forEach(item => {
        const option = document.createElement('option');
        option.value = item;
        option.textContent = item;
        itemSelect.appendChild(option);
      });
  }

  const calcButton = document.getElementById("calcButton");
  if (calcButton) {
    calcButton.addEventListener("click", runCalculator);
  }
}

init();
