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

function getTextColor(bg) {
  const r = parseInt(bg.substr(1, 2), 16);
  const g = parseInt(bg.substr(3, 2), 16);
  const b = parseInt(bg.substr(5, 2), 16);
  const luminance = (0.299*r + 0.587*g + 0.114*b);
  return luminance > 150 ? "#000000" : "#ffffff";
}

const MACHINE_COLORS = {
  "Smelter": "#3498db",
  "Fabricator": "#9b59b6",
  "Furnace": "#e67e22",
  "Mega Press": "#c0392b",
  "Assembler": "#1abc9c",
  "Refinery": "#2e86de",
  "Pyro Forge": "#d35400",
  "Compounder": "#8e44ad"
};

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

      // Add RAW node to chain if not already present
      if (!chain[name]) {
        chain[name] = {
          rate,
          raw: true,
          building: "RAW",
          machines: 0,
          inputs: {}
        };
      } else {
        chain[name].rate += rate;
      }

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

function computeDepths(chain, rootItem) {
  const consumers = {};
  const depths = {};

  // Build reverse edges: input → list of items that consume it
  for (const [item, data] of Object.entries(chain)) {
    for (const input of Object.keys(data.inputs || {})) {
      if (!consumers[input]) consumers[input] = [];
      consumers[input].push(item);
    }
  }

  // Start by putting the root far right
  depths[rootItem] = 999;

  let changed = true;
  while (changed) {
    changed = false;

    for (const item of Object.keys(chain)) {
      const cons = consumers[item];
      if (!cons || cons.length === 0) continue;

      const minConsumerDepth = Math.min(
        ...cons.map(c => depths[c] ?? 999)
      );

      const newDepth = minConsumerDepth - 1;

      if (depths[item] !== newDepth) {
        depths[item] = newDepth;
        changed = true;
      }
    }
  }

  // Second pass: strictly enforce "inputs are left of outputs"
  let adjusted = true;
  while (adjusted) {
    adjusted = false;

    for (const [item, data] of Object.entries(chain)) {
      const itemDepth = depths[item] ?? 0;

      for (const input of Object.keys(data.inputs || {})) {
        const inputDepth = depths[input] ?? 0;

        if (inputDepth >= itemDepth) {
          depths[input] = itemDepth - 1;
          adjusted = true;
        }
      }
    }
  }

  // Normalize so smallest depth becomes 0
  const minDepth = Math.min(...Object.values(depths));
  for (const item of Object.keys(depths)) {
    depths[item] -= minDepth;
  }

  return depths;
}

function buildGraphData(chain, rootItem) {
  const depths = computeDepths(chain, rootItem);
  const nodes = [];
  const links = [];
  const nodeMap = new Map();

  for (const [item, data] of Object.entries(chain)) {
    const depth = depths[item] ?? 0;

    const node = {
      id: item,
      label: item,
      depth,
      raw: data.raw,
      building: data.building,
      machines: data.machines,
      inputs: data.inputs
    };

    nodes.push(node);
    nodeMap.set(item, node);
  }

  for (const [item, data] of Object.entries(chain)) {
    for (const input of Object.keys(data.inputs || {})) {
      if (nodeMap.has(input)) {
        links.push({ from: item, to: input });
      }
    }
  }

  return { nodes, links };
}


// ===============================
// Table Rendering
// ===============================
function renderTable(chainObj, rootItem, rate) {
  const { chain, machineTotals, extractorTotals } = chainObj;
  const { nodes, links } = buildGraphData(chain, rootItem);
  const graphSVG = renderGraph(nodes, links, rootItem);
  document.getElementById("graphArea").innerHTML = graphSVG;
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

      const fillColor = data.raw
        ? "#f4d03f"
        : MACHINE_COLORS[data.building] || "#ecf0f1";

      const textColor = getTextColor(fillColor);

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
          <td style="background-color:${fillColor}; color:${textColor};">
            ${data.building}
          </td>
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
function renderGraph(nodes, links, rootItem) {
  const nodeRadius = 22;
  // Detect theme for adaptive halo text
  const isDark = document.body.classList.contains("dark-mode");

  const labelFill = isDark ? "#ffffff" : "#000000";   // text color
  const labelStroke = isDark ? "#000000" : "#ffffff"; // halo outline

  const columns = {};
  for (const node of nodes) {
    if (!columns[node.depth]) columns[node.depth] = [];
    columns[node.depth].push(node);
  }

  const colWidth = 200;
  const rowHeight = 90;

  for (const [depth, colNodes] of Object.entries(columns)) {
    // Sort by number of outgoing links (more consumers = higher)
    colNodes.sort((a, b) => {
      const aOut = links.filter(l => l.to === a.id).length;
      const bOut = links.filter(l => l.to === b.id).length;
      return bOut - aOut;
    });

    colNodes.forEach((node, i) => {
      node.x = depth * colWidth + 100;
      node.y = i * rowHeight + 100;
    });
  }

  // Compute dynamic SVG size based on node positions
  const maxX = Math.max(...nodes.map(n => n.x));
  const maxY = Math.max(...nodes.map(n => n.y));

  const svgWidth = maxX + 200;   // padding on the right
  const svgHeight = maxY + 200;  // padding below the lowest node

  let svg = `<svg width="${svgWidth}" height="${svgHeight}" xmlns="http://www.w3.org/2000/svg">`;

  for (const link of links) {
    const from = nodes.find(n => n.id === link.from);
    const to = nodes.find(n => n.id === link.to);

    svg += `
      <line x1="${from.x}" y1="${from.y}"
            x2="${to.x}" y2="${to.y}"
            stroke="#999" stroke-width="2" />
    `;
  }

  for (const node of nodes) {
    const fillColor = node.raw
      ? "#f4d03f"
      : MACHINE_COLORS[node.building] || "#95a5a6";

    const strokeColor = node.id === rootItem
      ? "#27ae60"
      : "#2c3e50";

    const textColor = getTextColor(fillColor);

    svg += `
      <g>
        <!-- Label text with halo -->
        <text x="${node.x}" y="${node.y - 30}"
              text-anchor="middle" font-size="12" font-weight="600"
              fill="#ffffff"
              stroke="#000000" stroke-width="0.6"
              paint-order="stroke">
          ${node.label}
        </text>


        <!-- Node circle -->
        <circle cx="${node.x}" cy="${node.y}" r="${nodeRadius}"
                fill="${fillColor}" stroke="${strokeColor}" stroke-width="2" />

        <!-- Machine count background -->
        ${node.raw ? "" : (
          `<rect x="${node.x - 12}" y="${node.y - 8}" width="24" height="16"
                 fill="${fillColor}" rx="3" ry="3" />`
        )}

        <!-- Machine count text with halo -->
        <text x="${node.x}" y="${node.y + 4}"
              text-anchor="middle" font-size="12" font-weight="600"
              fill="#ffffff"
              stroke="#000000" stroke-width="0.6"
              paint-order="stroke">
          ${node.raw ? "" : Math.ceil(node.machines)}
        </text>
      </g>
    `;
  }

  svg += `</svg>`;
  return svg;
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

  // Manual override: Basic Building Material is crafted from raw ores but should be Tier 0
  TIERS["Basic Building Material"] = 0;

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
