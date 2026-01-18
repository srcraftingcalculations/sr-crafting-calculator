// ===============================
// Load Recipes (Live GitHub Fetch)
// ===============================
async function loadRecipes() {
  const url = "https://srcraftingcalculations.github.io/sr-crafting-calculator/data/recipes.json";

  try {
    const response = await fetch(url, { cache: "no-store" });

    if (!response.ok) {
      throw new Error("Failed to fetch recipes.json");
    }

    const recipes = await response.json();
    return recipes;

  } catch (err) {
    console.error("Error loading recipes:", err);
    document.getElementById("outputArea").innerHTML =
      `<p style="color:red;">Error loading recipe data. Please try again later.</p>`;
    return {};
  }
}

let RECIPES = {};     // All recipe data
let TIERS = {};       // Tier map from spreadsheet


// ===============================
// Machine Speeds
// ===============================
const MACHINE_SPEED = {
  "Smelter": 1.0,
  "Fabricator": 1.0,
  "Assembler": 1.0,
  "Furnace": 1.0,
  "Mega Press": 1.0,
  "Refinery": 1.0,
  "Pyro Forge": 1.0
};


// ===============================
// Helper Functions
// ===============================
function getRecipe(item) {
  return RECIPES[item] || null;
}

function craftsPerMinute(recipe) {
  return 60 / recipe.time;
}

function outputPerMinute(recipe) {
  return craftsPerMinute(recipe) * recipe.output;
}

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
    chain[item] = chain[item] || {
      rate: 0,
      raw: true,
      building: "RAW",
      crafts: 0,
      machines: 0,
      inputs: {}
    };
    chain[item].rate += targetRate;
    return chain;
  }

  const opm = outputPerMinute(recipe);
  const craftsNeeded = targetRate / opm;

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

  for (const [inputItem, inputAmount] of Object.entries(recipe.inputs)) {
    const inputRate = craftsNeeded * inputAmount;

    chain[item].inputs[inputItem] =
      (chain[item].inputs[inputItem] || 0) + inputRate;

    expandChain(inputItem, inputRate, chain);
  }

  return chain;
}


// ===============================
// Graph Data Construction
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
      for (const inputItem of Object.keys(data.inputs)) {
        if (nodeMap.has(inputItem)) {
          links.push({ from: item, to: inputItem });
        }
      }
    }
  }

  return { nodes, links };
}


// ===============================
// Graph Rendering
// ===============================
function renderGraph(graphData, rootItem) {
  const container = document.getElementById('graphArea');
  if (!container) return;

  const width = 900;
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

  let svg = `<svg width="${width}" height="${Math.max(300, nodes.length * rowHeight)}" xmlns="http://www.w3.org/2000/svg">`;

  links.forEach(link => {
    const fromNode = nodes.find(n => n.id === link.from);
    const toNode = nodes.find(n => n.id === link.to);
    if (!fromNode || !toNode) return;

    svg += `
      <line x1="${fromNode.x}" y1="${fromNode.y}" x2="${toNode.x}" y2="${toNode.y}"
            stroke="#999" stroke-width="2" marker-end="url(#arrow)" />
    `;
  });

  svg += `
    <defs>
      <marker id="arrow" markerWidth="10" markerHeight="10" refX="10" refY="3" orient="auto" markerUnits="strokeWidth">
        <path d="M0,0 L0,6 L9,3 z" fill="#999" />
      </marker>
    </defs>
  `;

  nodes.forEach(node => {
    const fill = node.raw ? "#f4d03f" : "#3498db";
    const stroke = node.id === rootItem ? "#e74c3c" : "#2c3e50";

    svg += `
      <g>
        <circle cx="${node.x}" cy="${node.y}" r="${nodeRadius}" fill="${fill}" stroke="${stroke}" stroke-width="2" />
        <text x="${node.x}" y="${node.y - 30}" text-anchor="middle" font-size="12">${node.label}</text>
        <text x="${node.x}" y="${node.y + 4}" text-anchor="middle" font-size="10">${node.rate.toFixed(1)}/m</text>
        <text x="${node.x}" y="${node.y + 18}" text-anchor="middle" font-size="9">${node.machines.toFixed(2)}x</text>
      </g>
    `;
  });

  svg += `</svg>`;
  container.innerHTML = svg;
}


// ===============================
// MACHINE TOTALS (rounded UP)
// ===============================
function computeMachineTotals(chain) {
  const totals = {};

  for (const data of Object.values(chain)) {
    if (!data.raw && data.machines > 0) {
      const type = data.building;
      totals[type] = (totals[type] || 0) + data.machines;
    }
  }

  return Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ type, count: Math.ceil(count) }));
}


// ===============================
// EXTRACTION REQUIRED (rounded UP)
// ===============================
function computeExtractionBreakdown(chain) {
  const railRate = 240;
  const breakdown = [];

  for (const [item, data] of Object.entries(chain)) {
    if (data.raw && data.rate > 0) {
      const qty = Math.ceil(data.rate);

      breakdown.push({
        item,
        qty,
        impure: Math.ceil(qty / (railRate * 0.5)),
        normal: Math.ceil(qty / railRate),
        pure: Math.ceil(qty / (railRate * 2))
      });
    }
  }

  return breakdown.sort((a, b) => b.qty - a.qty);
}


// ===============================
// Table Rendering (Tier-Based)
// ===============================
function renderTable(chain, rootItem, rate) {
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
        </tr>
      </thead>
      <tbody>
  `;

  // Group by tier
  const tierGroups = {};
  for (const [item, data] of Object.entries(chain)) {
    const tier = TIERS[item] ?? 0;
    if (!tierGroups[tier]) tierGroups[tier] = [];
    tierGroups[tier].push([item, data]);
  }

  // Sort highest → lowest
  const sortedTiers = Object.keys(tierGroups)
    .map(Number)
    .sort((a, b) => b - a);

  for (const tier of sortedTiers) {
    html += `
      <tr><td colspan="6"><strong>--- Level ${tier} ---</strong></td></tr>
    `;

    const rows = tierGroups[tier].sort((a, b) => a[0].localeCompare(b[0]));

    for (const [item, data] of rows) {
      if (data.raw) {
        html += `
          <tr>
            <td>${item}</td>
            <td>${Math.ceil(data.rate)}</td>
            <td>—</td>
            <td>—</td>
            <td>RAW</td>
            <td>—</td>
          </tr>
        `;
      } else {
        const outputPerMachine = outputPerMinute(getRecipe(item));
        const inputList = Object.entries(data.inputs)
          .map(([input, amt]) => `${input}: ${amt.toFixed(2)}/min`)
          .join("<br>");

        html += `
          <tr>
            <td>${item}</td>
            <td>${Math.ceil(data.rate)}</td>
            <td>${outputPerMachine.toFixed(2)}</td>
            <td>${Math.ceil(data.machines)}</td>
            <td>${data.building}</td>
            <td>${inputList}</td>
          </tr>
        `;
      }
    }
  }

  html += `
      </tbody>
    </table>
  `;

  // ===============================
  // MACHINES REQUIRED SUMMARY
  // ===============================
  const machineTotals = computeMachineTotals(chain);
  html += `
    <h3>MACHINES REQUIRED (total)</h3>
    <table>
      <thead>
        <tr><th>Machine Type</th><th>Count</th></tr>
      </thead>
      <tbody>
        ${machineTotals.map(m => `
          <tr>
            <td>${m.type}</td>
            <td>${m.count}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  // ===============================
  // EXTRACTION REQUIRED SUMMARY
  // ===============================
  const extraction = computeExtractionBreakdown(chain);
  html += `
    <h3>EXTRACTION REQUIRED (v2 rails @ 240/min)</h3>
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
        ${extraction.map(e => `
          <tr>
            <td>${e.item}</td>
            <td>${e.impure}</td>
            <td>${e.normal}</td>
            <td>${e.pure}</td>
            <td>${e.qty}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  document.getElementById('outputArea').innerHTML = html;
}


// ===============================
// Calculator Trigger
// ===============================
function runCalculator() {
  const item = document.getElementById('itemSelect').value;
  const rate = parseFloat(document.getElementById('rateInput').value);

  const chain = expandChain(item, rate);

  renderTable(chain, item, rate);

  const graphData = buildGraphData(chain, item);
  renderGraph(graphData, item);
}


// ===============================
// Dark Mode Toggle
// ===============================
function setupDarkMode() {
  const toggle = document.getElementById("darkModeToggle");

  const saved = localStorage.getItem("darkMode");
  if (saved === "true") {
    document.body.classList.add("dark");
    toggle.textContent = "☀️ Light Mode";
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
  Object.keys(RECIPES)
    .filter(k => k !== "_tiers")
    .sort()
    .forEach(item => {
      const option = document.createElement('option');
      option.value = item;
      option.textContent = item;
      itemSelect.appendChild(option);
    });

  document.getElementById("calcButton").addEventListener("click", runCalculator);
}

init();
