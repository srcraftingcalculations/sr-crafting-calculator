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
  "Smelter":      "#e67e22", // vivid orange
  "Furnace":      "#d63031", // bright red (distinct from Smelter)
  "Fabricator":   "#0984e3", // strong blue (more saturated than before)
  "Mega Press":   "#6c5ce7", // bright violet (separated from Pyro Forge)
  "Assembler":    "#00b894", // emerald green (clean, readable)
  "Refinery":     "#e84393", // hot pink (far from Furnace/Smelter)
  "Compounder":   "#00cec9", // aqua cyan (distinct from Fabricator blue)
  "Pyro Forge":   "#a55eea"  // lavender purple (lighter than Mega Press)
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
// Toast Notification System
// ===============================
function showToast(message) {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;

  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add("show");
  });

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
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

      const fillColor = MACHINE_COLORS[data.building] || "#ecf0f1";

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
// ===============================
// Graph Rendering (updated: scrollable + zoom/pan controls)
// ===============================
function renderGraph(nodes, links, rootItem) {
  const nodeRadius = 22;
  const isDark = document.body.classList.contains("dark-mode");

  const columns = {};
  for (const node of nodes) {
    if (!columns[node.depth]) columns[node.depth] = [];
    columns[node.depth].push(node);
  }

  const colWidth = 200;
  const rowHeight = 90;

  for (const [depth, colNodes] of Object.entries(columns)) {
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

  const maxX = nodes.length ? Math.max(...nodes.map(n => n.x)) : 0;
  const maxY = nodes.length ? Math.max(...nodes.map(n => n.y)) : 0;

  const svgWidth = Math.max(800, maxX + 200);
  const svgHeight = Math.max(300, maxY + 200);

  // Build inner SVG content
  let inner = '';

  for (const link of links) {
    const from = nodes.find(n => n.id === link.from);
    const to = nodes.find(n => n.id === link.to);
    if (!from || !to) continue;

    inner += `
      <line x1="${from.x}" y1="${from.y}"
            x2="${to.x}" y2="${to.y}"
            stroke="#999" stroke-width="2" />
    `;
  }

  for (const node of nodes) {
    const fillColor = node.raw
      ? "#f4d03f"
      : MACHINE_COLORS[node.building] || "#95a5a6";

    const strokeColor = "#2c3e50";
    const textColor = getTextColor(fillColor);

    inner += `
      <g>
        <text x="${node.x}" y="${node.y - 30}"
              text-anchor="middle" font-size="12" font-weight="600"
              fill="${textColor}"
              stroke="${isDark ? '#000' : '#fff'}" stroke-width="0.6"
              paint-order="stroke">
          ${node.label}
        </text>

        <circle cx="${node.x}" cy="${node.y}" r="${nodeRadius}"
                fill="${fillColor}" stroke="${strokeColor}" stroke-width="2" />

        ${node.raw ? "" : (
          `<rect x="${node.x - 12}" y="${node.y - 8}" width="24" height="16"
                 fill="${fillColor}" rx="3" ry="3" />`
        )}

        <text x="${node.x}" y="${node.y + 4}"
              text-anchor="middle" font-size="12" font-weight="600"
              fill="${textColor}"
              stroke="${isDark ? '#000' : '#fff'}" stroke-width="0.6"
              paint-order="stroke">
          ${node.raw ? "" : Math.ceil(node.machines)}
        </text>
      </g>
    `;
  }

  // Controls (zoom in/out/reset + slider)
  const controlsHtml = `
    <div class="graphControls">
      <button class="zoomBtn" data-action="zoomOut">−</button>
      <input type="range" class="zoomSlider" min="0.25" max="2.5" step="0.05" value="1" />
      <button class="zoomBtn" data-action="zoomIn">+</button>
      <button class="zoomBtn" data-action="reset">Reset</button>
    </div>
  `;

  // Full SVG with a named group that will be transformed for zoom/pan
  const svg = `
    <div class="graphWrapper">
      ${controlsHtml}
      <div class="graphViewport">
        <svg xmlns="http://www.w3.org/2000/svg"
             width="${svgWidth}" height="${svgHeight}"
             viewBox="0 0 ${svgWidth} ${svgHeight}"
             preserveAspectRatio="xMinYMid meet"
             class="graphSVG">
          <g id="zoomLayer">
            ${inner}
          </g>
        </svg>
      </div>
    </div>
  `;

  return svg;
}


// ===============================
// Graph Zoom / Pan Setup
// ===============================
function setupGraphZoom(containerEl, { autoFit = true } = {}) {
  if (!containerEl) return;

  const svg = containerEl.querySelector('svg.graphSVG');
  const zoomLayer = svg.querySelector('#zoomLayer');
  const slider = containerEl.querySelector('.zoomSlider');
  const btns = containerEl.querySelectorAll('.zoomBtn');
  const controlsEl = containerEl.querySelector('.graphControls');

  // Pin controls to center of viewport horizontally and near the graph vertically
  function pinControls() {
    if (!controlsEl) return;
    controlsEl.style.position = 'fixed';
    controlsEl.style.left = '50%';
    controlsEl.style.transform = 'translateX(-50%)';
    controlsEl.style.zIndex = 9999;
    controlsEl.style.pointerEvents = 'auto';
    const wrapperRect = containerEl.getBoundingClientRect();
    const desiredTop = Math.max(12, wrapperRect.top + 8);
    controlsEl.style.top = `${desiredTop}px`;
  }
  function unpinControls() {
    if (!controlsEl) return;
    controlsEl.style.position = '';
    controlsEl.style.left = '';
    controlsEl.style.transform = '';
    controlsEl.style.top = '';
    controlsEl.style.zIndex = '';
  }
  function updatePinnedControls() {
    if (!controlsEl) return;
    const wrapperRect = containerEl.getBoundingClientRect();
    const desiredTop = Math.max(12, wrapperRect.top + 8);
    controlsEl.style.top = `${desiredTop}px`;
  }

  // State
  let scale = 1;
  let tx = 0;
  let ty = 0;
  let isPanning = false;
  let startX = 0;
  let startY = 0;

  // Helpers
  function getViewportRect() {
    return svg.getBoundingClientRect();
  }
  function getLayerBBox() {
    try {
      return zoomLayer.getBBox();
    } catch (e) {
      return { x: 0, y: 0, width: svg.viewBox.baseVal.width || svg.clientWidth, height: svg.viewBox.baseVal.height || svg.clientHeight };
    }
  }

  // Improved clamping:
  // - If layer is larger than view, clamp so edges can't go fully off-screen.
  // - If layer is smaller than view, allow panning within a reasonable range
  //   (so user can nudge the small graph left/right) but keep it at least partially visible.
  function clampTranslation(proposedTx, proposedTy, proposedScale) {
    const bbox = getLayerBBox();
    const view = getViewportRect();

    // Convert view size to SVG coordinates
    const ptTL = svg.createSVGPoint(); ptTL.x = 0; ptTL.y = 0;
    const ptBR = svg.createSVGPoint(); ptBR.x = view.width; ptBR.y = view.height;
    const svgTL = ptTL.matrixTransform(svg.getScreenCTM().inverse());
    const svgBR = ptBR.matrixTransform(svg.getScreenCTM().inverse());
    const viewW = svgBR.x - svgTL.x;
    const viewH = svgBR.y - svgTL.y;

    const layerW = bbox.width * proposedScale;
    const layerH = bbox.height * proposedScale;

    // When layer is larger than view: ensure edges remain visible
    const minTxLarge = viewW - layerW - bbox.x * proposedScale;
    const maxTxLarge = -bbox.x * proposedScale;
    const minTyLarge = viewH - layerH - bbox.y * proposedScale;
    const maxTyLarge = -bbox.y * proposedScale;

    // When layer is smaller than view: allow panning but keep at least 20% of view overlap
    const overlapFraction = 0.2; // keep at least 20% overlap
    const allowedExtraX = Math.max( (viewW - layerW) * (1 - overlapFraction), 0 );
    const allowedExtraY = Math.max( (viewH - layerH) * (1 - overlapFraction), 0 );

    let clampedTx = proposedTx;
    let clampedTy = proposedTy;

    if (layerW > viewW) {
      clampedTx = Math.min(maxTxLarge, Math.max(minTxLarge, proposedTx));
    } else {
      // center baseline
      const centerTx = (viewW - layerW) / 2 - bbox.x * proposedScale;
      // allow +/- allowedExtraX/2 around center
      const minTxSmall = centerTx - allowedExtraX / 2;
      const maxTxSmall = centerTx + allowedExtraX / 2;
      clampedTx = Math.min(maxTxSmall, Math.max(minTxSmall, proposedTx));
    }

    if (layerH > viewH) {
      clampedTy = Math.min(maxTyLarge, Math.max(minTyLarge, proposedTy));
    } else {
      const centerTy = (viewH - layerH) / 2 - bbox.y * proposedScale;
      const minTySmall = centerTy - allowedExtraY / 2;
      const maxTySmall = centerTy + allowedExtraY / 2;
      clampedTy = Math.min(maxTySmall, Math.max(minTySmall, proposedTy));
    }

    return { tx: clampedTx, ty: clampedTy };
  }

  function applyTransform() {
    const clamped = clampTranslation(tx, ty, scale);
    tx = clamped.tx;
    ty = clamped.ty;
    zoomLayer.setAttribute('transform', `translate(${tx},${ty}) scale(${scale})`);
    if (slider) slider.value = scale;
  }

  // Zoom around a screen point (cx, cy)
  function zoomAt(newScale, cx, cy) {
    const pt = svg.createSVGPoint();
    pt.x = cx; pt.y = cy;
    const svgP = pt.matrixTransform(svg.getScreenCTM().inverse());

    const localX = (svgP.x - tx) / scale;
    const localY = (svgP.y - ty) / scale;

    const newTx = svgP.x - newScale * localX;
    const newTy = svgP.y - newScale * localY;

    scale = newScale;
    tx = newTx;
    ty = newTy;

    applyTransform();
  }

  // Buttons
  btns.forEach(b => {
    b.addEventListener('click', () => {
      const action = b.dataset.action;
      const rect = svg.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      if (action === 'zoomIn') {
        const newScale = Math.min(2.5, +(scale + 0.1).toFixed(3));
        zoomAt(newScale, centerX, centerY);
      } else if (action === 'zoomOut') {
        const newScale = Math.max(0.25, +(scale - 0.1).toFixed(3));
        zoomAt(newScale, centerX, centerY);
      } else if (action === 'reset') {
        if (autoFit) {
          computeAutoFit();
        } else {
          scale = 1; tx = 0; ty = 0; applyTransform();
        }
      }
    });
  });

  if (slider) {
    slider.addEventListener('input', () => {
      const newScale = parseFloat(slider.value);
      const rect = svg.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      zoomAt(newScale, centerX, centerY);
    });
  }

  // Wheel zoom
  svg.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const delta = -ev.deltaY;
    const factor = delta > 0 ? 1.08 : 0.92;
    const newScale = Math.min(2.5, Math.max(0.25, +(scale * factor).toFixed(3)));
    zoomAt(newScale, ev.clientX, ev.clientY);
  }, { passive: false });

  // Pan (mouse) — left click should always pan
  svg.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0) return;
    isPanning = true;
    startX = ev.clientX;
    startY = ev.clientY;
    svg.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', (ev) => {
    if (!isPanning) return;
    const dxScreen = ev.clientX - startX;
    const dyScreen = ev.clientY - startY;
    startX = ev.clientX;
    startY = ev.clientY;

    // convert screen delta to svg delta
    const p0 = svg.createSVGPoint(); p0.x = 0; p0.y = 0;
    const p1 = svg.createSVGPoint(); p1.x = dxScreen; p1.y = dyScreen;
    const svg0 = p0.matrixTransform(svg.getScreenCTM().inverse());
    const svg1 = p1.matrixTransform(svg.getScreenCTM().inverse());
    const dxSvg = svg1.x - svg0.x;
    const dySvg = svg1.y - svg0.y;

    tx += dxSvg;
    ty += dySvg;
    applyTransform();
  });

  window.addEventListener('mouseup', () => {
    if (!isPanning) return;
    isPanning = false;
    svg.style.cursor = 'grab';
  });

  // Touch: pinch to zoom + pan
  let lastTouchDist = null;
  let lastTouchCenter = null;

  svg.addEventListener('touchstart', (ev) => {
    if (ev.touches.length === 2) {
      ev.preventDefault();
      const t0 = ev.touches[0], t1 = ev.touches[1];
      lastTouchDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      lastTouchCenter = { x: (t0.clientX + t1.clientX) / 2, y: (t0.clientY + t1.clientY) / 2 };
    } else if (ev.touches.length === 1) {
      startX = ev.touches[0].clientX;
      startY = ev.touches[0].clientY;
      isPanning = true;
    }
  }, { passive: false });

  svg.addEventListener('touchmove', (ev) => {
    if (ev.touches.length === 2 && lastTouchDist !== null) {
      ev.preventDefault();
      const t0 = ev.touches[0], t1 = ev.touches[1];
      const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      const center = { x: (t0.clientX + t1.clientX) / 2, y: (t0.clientY + t1.clientY) / 2 };
      const factor = dist / lastTouchDist;
      const newScale = Math.min(2.5, Math.max(0.25, +(scale * factor).toFixed(3)));
      zoomAt(newScale, center.x, center.y);
      lastTouchDist = dist;
      lastTouchCenter = center;
    } else if (ev.touches.length === 1 && isPanning) {
      ev.preventDefault();
      const dx = ev.touches[0].clientX - startX;
      const dy = ev.touches[0].clientY - startY;
      startX = ev.touches[0].clientX;
      startY = ev.touches[0].clientY;

      const p0 = svg.createSVGPoint(); p0.x = 0; p0.y = 0;
      const p1 = svg.createSVGPoint(); p1.x = dx; p1.y = dy;
      const svg0 = p0.matrixTransform(svg.getScreenCTM().inverse());
      const svg1 = p1.matrixTransform(svg.getScreenCTM().inverse());
      tx += svg1.x - svg0.x;
      ty += svg1.y - svg0.y;
      applyTransform();
    }
  }, { passive: false });

  svg.addEventListener('touchend', () => {
    lastTouchDist = null;
    lastTouchCenter = null;
    isPanning = false;
  });

  svg.style.cursor = 'grab';

  // Auto-fit and center
  function computeAutoFit() {
    const bbox = getLayerBBox();
    const view = getViewportRect();

    const ptTL = svg.createSVGPoint(); ptTL.x = 0; ptTL.y = 0;
    const ptBR = svg.createSVGPoint(); ptBR.x = view.width; ptBR.y = view.height;
    const svgTL = ptTL.matrixTransform(svg.getScreenCTM().inverse());
    const svgBR = ptBR.matrixTransform(svg.getScreenCTM().inverse());
    const viewW = svgBR.x - svgTL.x;
    const viewH = svgBR.y - svgTL.y;

    if (bbox.width === 0 || bbox.height === 0) {
      scale = 1; tx = 0; ty = 0;
      applyTransform();
      return;
    }

    const pad = 0.9;
    const scaleX = (viewW * pad) / bbox.width;
    const scaleY = (viewH * pad) / bbox.height;
    const fitScale = Math.min(scaleX, scaleY);

    scale = Math.min(2.5, Math.max(0.25, fitScale));

    const layerW = bbox.width * scale;
    const layerH = bbox.height * scale;
    tx = (viewW - layerW) / 2 - bbox.x * scale;
    ty = (viewH - layerH) / 2 - bbox.y * scale;

    applyTransform();
    pinControls();
  }

  // Keep pinned controls updated on scroll/resize
  const onScrollOrResize = () => updatePinnedControls();
  window.addEventListener('scroll', onScrollOrResize, { passive: true });
  window.addEventListener('resize', onScrollOrResize);

  if (autoFit) {
    requestAnimationFrame(() => {
      computeAutoFit();
    });
  } else {
    applyTransform();
    pinControls();
  }

  // Expose teardown so callers can remove listeners before re-render
  containerEl._teardownGraphZoom = () => {
    window.removeEventListener('scroll', onScrollOrResize);
    window.removeEventListener('resize', onScrollOrResize);
    unpinControls();
  };
}

// ===============================
// Table Rendering (updated to initialize zoom/pan)
// ===============================
function renderTable(chainObj, rootItem, rate) {
  const { chain, machineTotals, extractorTotals } = chainObj;
  const { nodes, links } = buildGraphData(chain, rootItem);
  const graphSVG = renderGraph(nodes, links, rootItem);

  // Inject graph HTML and initialize zoom/pan on the wrapper
  document.getElementById("graphArea").innerHTML = graphSVG;
  const wrapper = document.getElementById("graphArea").querySelector(".graphWrapper");
  setupGraphZoom(wrapper);

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

      const fillColor = MACHINE_COLORS[data.building] || "#ecf0f1";

      const textColor = getTextColor(fillColor);

      if (!data.raw) {
        const recipe = getRecipe(item);
        if (recipe) {
          outputPerMachine = Math.ceil((recipe.output * 60) / recipe.time);
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

  // MACHINES REQUIRED (total)
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

  // EXTRACTION REQUIRED
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

  // ⭐ Update URL with shareable parameters
  const rail = document.getElementById("railSelect").value;

  const params = new URLSearchParams({
    item,
    rate,
    rail
  });

  history.replaceState(null, "", "?" + params.toString());
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
  const rateInput = document.getElementById("rateInput");
  const railSelect = document.getElementById("railSelect");

  // ⭐ Default placeholders on fresh load
  itemSelect.innerHTML = `<option value="" disabled selected>Select Item Here</option>`;
  railSelect.innerHTML = `
    <option value="" disabled selected>Select Rail</option>
    <option value="120">v1 (120/min)</option>
    <option value="240">v2 (240/min)</option>
    <option value="480">v3 (480/min)</option>
  `;
  rateInput.value = "";
  rateInput.dataset.manual = ""; // track manual override

  // ⭐ Populate item dropdown
  Object.keys(RECIPES)
    .filter(k => k !== "_tiers")
    .sort()
    .forEach(item => {
      const option = document.createElement('option');
      option.value = item;
      option.textContent = item;
      itemSelect.appendChild(option);
    });

  // Helper to compute natural per-minute for currently selected item
  function getNaturalPerMinForSelected() {
    const slug = itemSelect.value;
    const recipe = RECIPES[slug];
    if (!recipe || !recipe.output || !recipe.time) return null;
    return Math.round((recipe.output / recipe.time) * 60);
  }

  // ⭐ Auto-fill natural rate when item is selected
  itemSelect.addEventListener("change", () => {
    const naturalPerMin = getNaturalPerMinForSelected();

    // If user hasn't manually overridden, set the natural rate (or blank for RAW)
    if (!rateInput.dataset.manual) {
      rateInput.value = naturalPerMin !== null ? naturalPerMin : "";
    }
  });

  // ⭐ Rate input behavior: manual override vs auto-default on empty/zero
  rateInput.addEventListener("input", () => {
    const rawVal = rateInput.value;
    const numeric = Number(rawVal);

    // If user cleared the field or set it to 0, revert to natural per-minute for the selected item
    if (rawVal === "" || (!isNaN(numeric) && numeric === 0)) {
      rateInput.dataset.manual = ""; // treat as not manually locked
      const naturalPerMin = getNaturalPerMinForSelected();
      if (naturalPerMin !== null) {
        rateInput.value = naturalPerMin;
      } else {
        rateInput.value = "";
      }
      return;
    }

    // Otherwise treat as a manual override
    rateInput.dataset.manual = "true";
  });

  // ⭐ Auto-load shared calculation if URL contains parameters
  const params = new URLSearchParams(window.location.search);

  const sharedItem = params.get("item");
  const sharedRate = params.get("rate");
  const sharedRail = params.get("rail");

  if (sharedItem) itemSelect.value = sharedItem;
  if (sharedRate) {
    rateInput.value = sharedRate;
    rateInput.dataset.manual = "true"; // user-defined
  }
  if (sharedRail) railSelect.value = sharedRail;

  // If item + rate exist, auto-run the calculator
  if (sharedItem && sharedRate) {
    runCalculator();
  }

  // ⭐ Calculate button
  const calcButton = document.getElementById("calcButton");
  if (calcButton) {
    calcButton.addEventListener("click", () => {
      runCalculator();

      const item = itemSelect.value;
      const rate = rateInput.value;
      const rail = railSelect.value;

      const newParams = new URLSearchParams({ item, rate, rail });
      history.replaceState(null, "", "?" + newParams.toString());
    });
  }

  // ⭐ Clear State button
  document.getElementById("clearStateBtn").addEventListener("click", () => {
    const base = window.location.origin;

    // Reset manual override
    rateInput.dataset.manual = "";

    // Local dev
    if (base.includes("localhost")) {
      window.location.href = "http://localhost:8000";
      return;
    }

    // Production
    window.location.href = "https://srcraftingcalculations.github.io/sr-crafting-calculator/";
  });

  // ⭐ Share button
  const shareButton = document.getElementById("shareButton");
  if (shareButton) {
    shareButton.addEventListener("click", () => {
      const url = window.location.href;

      navigator.clipboard.writeText(url).then(() => {
        showToast("Shareable link copied!");
      }).catch(() => {
        const temp = document.createElement("input");
        temp.value = url;
        document.body.appendChild(temp);
        temp.select();
        document.execCommand("copy");
        temp.remove();

        showToast("Shareable link copied!");
      });
    });
  }
}

init();
