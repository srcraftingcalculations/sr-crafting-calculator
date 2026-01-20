// ===============================
// app.js - Merged with raw-left node-to-node wiring
// - Preserves original working file behavior
// - Adds: raw-left nodes hide helper dots and draw direct node->node wires to consumers
// ===============================

/* ===============================
   Configuration & Constants
   =============================== */
const MACHINE_COLORS = {
  "Smelter":      "#e67e22",
  "Furnace":      "#d63031",
  "Fabricator":   "#0984e3",
  "Mega Press":   "#6c5ce7",
  "Assembler":    "#00b894",
  "Refinery":     "#e84393",
  "Compounder":   "#00cec9",
  "Pyro Forge":   "#a55eea"
};

const SPECIAL_EXTRACTORS = {
  "Helium-3": 240,
  "Goethite Ore": 400,
  "Sulphur Ore": 240
};

const GRAPH_COL_WIDTH = 220;
const GRAPH_ROW_HEIGHT = 120;
const GRAPH_LABEL_OFFSET = 40;
const GRAPH_CONTENT_PAD = 64;

const DRAG_THRESHOLD_PX = 8;      // desktop threshold
const TOUCH_THRESHOLD_PX = 12;    // touch threshold
const PULSE_PROPAGATION_DEPTH = 1; // immediate inputs only
const PULSE_STAGGER_MS = 90;      // kept for timing if needed

/* ===============================
   Utilities
   =============================== */
function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function getTextColor(bg) {
  if (!bg || bg[0] !== "#") return "#000000";
  const r = parseInt(bg.substr(1, 2), 16);
  const g = parseInt(bg.substr(3, 2), 16);
  const b = parseInt(bg.substr(5, 2), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b);
  return luminance > 150 ? "#000000" : "#ffffff";
}
function isDarkMode() {
  return document.body.classList.contains('dark') || document.body.classList.contains('dark-mode');
}
function showToast(message) {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

/* ===============================
   Info bubble behavior (unchanged)
   =============================== */
(function () {
  const infoBtn = document.getElementById('infoButton');
  const infoPanel = document.getElementById('infoPanel');
  const infoClose = document.getElementById('infoClose');
  const itemSelect = document.getElementById('itemSelect');

  if (!infoBtn || !infoPanel) return;

  function openPanel() {
    const btnRect = infoBtn.getBoundingClientRect();
    infoPanel.style.top = (window.scrollY + btnRect.bottom + 8) + 'px';
    infoPanel.style.left = (window.scrollX + btnRect.left) + 'px';
    infoPanel.classList.add('open');
    infoPanel.setAttribute('aria-hidden', 'false');
    infoBtn.setAttribute('aria-expanded', 'true');
    infoClose.focus();
  }

  function closePanel() {
    infoPanel.classList.remove('open');
    infoPanel.setAttribute('aria-hidden', 'true');
    infoBtn.setAttribute('aria-expanded', 'false');
    infoBtn.focus();
  }

  infoBtn.addEventListener('click', function (e) {
    const expanded = infoBtn.getAttribute('aria-expanded') === 'true';
    if (expanded) closePanel(); else openPanel();
  });

  infoClose.addEventListener('click', closePanel);

  document.addEventListener('click', function (e) {
    if (!infoPanel.classList.contains('open')) return;
    if (infoPanel.contains(e.target) || infoBtn.contains(e.target)) return;
    closePanel();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && infoPanel.classList.contains('open')) closePanel();
  });

  window.addEventListener('resize', function () {
    if (infoPanel.classList.contains('open')) openPanel();
  });
  window.addEventListener('scroll', function () {
    if (infoPanel.classList.contains('open')) openPanel();
  });
})();

/* ===============================
   Data loading & recipe helpers
   =============================== */
let RECIPES = {};
let TIERS = {};

async function loadRecipes() {
  const url = "https://srcraftingcalculations.github.io/sr-crafting-calculator/data/recipes.json";
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error("Failed to fetch recipes.json");
    RECIPES = await response.json();
    // Optionally compute TIERS if your original code did so; keep empty if not available
    // TIERS = computeTiers(RECIPES); // if you have a tiers function
    return RECIPES;
  } catch (err) {
    console.error("Error loading recipes:", err);
    const out = document.getElementById("outputArea");
    if (out) out.innerHTML = `<p style="color:red;">Error loading recipe data. Please try again later.</p>`;
    RECIPES = {};
    return {};
  }
}

function getRecipe(name) {
  return RECIPES[name] || null;
}

/* ===============================
   Expand production chain (original)
   =============================== */
function expandChain(item, targetRate) {
  const chain = {};
  const machineTotals = {};
  const extractorTotals = {};
  const pending = {};
  const processed = {};
  const queue = [];

  function trackExtractor(name, rate) {
    extractorTotals[name] = (extractorTotals[name] || 0) + rate;
  }

  function enqueue(name, rate) {
    const recipe = getRecipe(name);
    if (!recipe) {
      trackExtractor(name, rate);
      if (!chain[name]) {
        chain[name] = { rate, raw: true, building: "RAW", machines: 0, inputs: {} };
      } else {
        chain[name].rate += rate;
      }
      return;
    }
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
    if (!recipe) {
      trackExtractor(current, rate);
      continue;
    }

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

    machineTotals[recipe.building] = (machineTotals[recipe.building] || 0) + machines;

    for (const [input, qty] of Object.entries(recipe.inputs)) {
      const inputRate = craftsPerMin * qty;
      chain[current].inputs[input] = inputRate;
      enqueue(input, inputRate);
    }
  }

  return { chain, machineTotals, extractorTotals };
}

/* ===============================
   Depth computation & graph data
   =============================== */
function computeDepths(chain, rootItem) {
  const consumers = {};
  const depths = {};

  for (const [item, data] of Object.entries(chain)) {
    for (const input of Object.keys(data.inputs || {})) {
      if (!consumers[input]) consumers[input] = [];
      consumers[input].push(item);
    }
  }

  depths[rootItem] = 999;

  let changed = true;
  while (changed) {
    changed = false;
    for (const item of Object.keys(chain)) {
      const cons = consumers[item];
      if (!cons || cons.length === 0) continue;
      const minConsumerDepth = Math.min(...cons.map(c => depths[c] ?? 999));
      const newDepth = minConsumerDepth - 1;
      if (depths[item] !== newDepth) {
        depths[item] = newDepth;
        changed = true;
      }
    }
  }

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

  const minDepth = Math.min(...Object.values(depths));
  for (const item of Object.keys(depths)) depths[item] -= minDepth;
  return depths;
}

/* ===============================
   buildGraphData (adds anchor flags and smelter special case)
   =============================== */
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
      raw: !!data.raw,
      building: data.building,
      machines: data.machines,
      inputs: data.inputs,
      // anchor flags (set below)
      hasInputAnchor: true,
      hasOutputAnchor: true
    };
    nodes.push(node);
    nodeMap.set(item, node);
  }

  // links (consumer -> input)
  for (const [item, data] of Object.entries(chain)) {
    for (const input of Object.keys(data.inputs || {})) {
      if (nodeMap.has(input)) links.push({ from: item, to: input });
    }
  }

  // Determine anchor rules:
  // - Raw nodes (no recipe) have no left/input anchor
  // - Nodes at maximum depth (furthest from root) have no right/output anchor
  const maxDepth = nodes.length ? Math.max(...nodes.map(n => n.depth)) : 0;
  for (const node of nodes) {
    node.hasInputAnchor = !node.raw;                // raw resources: no left anchor by default
    node.hasOutputAnchor = (node.depth < maxDepth); // final outputs: no right anchor
  }

  // --- special anchor rules for raw -> smelter direct connections ---
  // Helper to check if an item in the chain is a raw extractor
  function isExtractorItem(itemName) {
    const entry = chain[itemName];
    return !!(entry && entry.raw);
  }

  for (const node of nodes) {
    // Ensure raw sources always expose an output anchor (they produce something)
    if (node.raw) {
      node.hasInputAnchor = false;
      node.hasOutputAnchor = true;
    }

    // Special case: smelters that only consume raw resources
    // If this node's building is "Smelter" and every input is a raw extractor,
    // hide the left anchor so the raw node can connect directly to the smelter body.
    if (node.building === 'Smelter') {
      const inputNames = Object.keys(node.inputs || {});
      if (inputNames.length > 0 && inputNames.every(inName => isExtractorItem(inName))) {
        node.hasInputAnchor = false;
      }
      // ensure smelter still exposes its output anchor so it can feed rails
      node.hasOutputAnchor = true;
    }
  }

  return { nodes, links };
}

/* ===============================
   Inject minimal pulse CSS via JS (optional)
   =============================== */
(function injectPulseStylesIfMissing() {
  if (document.getElementById('graphPulseStyles')) return;
  const style = document.createElement('style');
  style.id = 'graphPulseStyles';
  style.textContent = `
    @keyframes nodePulse {
      0% { stroke-width: 2; filter: drop-shadow(0 0 0 rgba(0,0,0,0)); }
      50% { stroke-width: 6; filter: drop-shadow(0 0 10px rgba(255,200,50,0.9)); }
      100% { stroke-width: 2; filter: drop-shadow(0 0 0 rgba(0,0,0,0)); }
    }
    @keyframes edgePulse {
      0% { stroke-opacity: 0.6; stroke-width: 2; }
      50% { stroke-opacity: 1; stroke-width: 4; }
      100% { stroke-opacity: 0.6; stroke-width: 2; }
    }
    circle.pulse-origin { animation: nodePulse 900ms ease-in-out infinite; stroke: #ffd27a !important; }
    circle.pulse-node { animation: nodePulse 900ms ease-in-out infinite; stroke: #ffcc66 !important; }
    line.pulse-edge { animation: edgePulse 900ms ease-in-out infinite; stroke: #ffcc66 !important; }
    @media (prefers-reduced-motion: reduce) {
      circle.pulse-origin, circle.pulse-node { animation: none !important; stroke-width: 4 !important; stroke: #ffd27a !important; }
      line.pulse-edge { animation: none !important; stroke-width: 3 !important; stroke-opacity: 1 !important; }
    }
  `;
  document.head.appendChild(style);
})();

/* ===============================
   renderGraph (left->right layout)
   - Draws direct node-to-node wires for raw sources on the far-left (no helper dot)
   - Draws regular edges for other links (lighter)
   - Hides anchors for leftmost raw nodes
   =============================== */
function renderGraph(nodes, links, rootItem) {
  const nodeRadius = 22;
  const anchorRadius = 5;
  const anchorHitRadius = 12;
  const isDark = isDarkMode();

  // Group nodes by depth
  const columns = {};
  for (const node of nodes) {
    if (!columns[node.depth]) columns[node.depth] = [];
    columns[node.depth].push(node);
  }

  // Layout nodes (left -> right: depth -> x, index -> y)
  for (const [depth, colNodes] of Object.entries(columns)) {
    colNodes.sort((a, b) => {
      const aOut = links.filter(l => l.to === a.id).length;
      const bOut = links.filter(l => l.to === b.id).length;
      if (bOut !== aOut) return bOut - aOut;
      return (a.label || a.id).localeCompare(b.label || b.id);
    });
    colNodes.forEach((node, i) => {
      node.x = Number(depth) * GRAPH_COL_WIDTH + 100;   // horizontal spacing per depth (columns)
      node.y = i * GRAPH_ROW_HEIGHT + 100;              // vertical spacing per index (rows)
    });
  }

  const xs = nodes.map(n => n.x);
  const ys = nodes.map(n => n.y);
  const minX = nodes.length ? Math.min(...xs) : 0;
  const maxX = nodes.length ? Math.max(...xs) : 0;
  const minY = nodes.length ? Math.min(...ys) : 0;
  const maxY = nodes.length ? Math.max(...ys) : 0;

  const contentX = minX - nodeRadius - GRAPH_CONTENT_PAD;
  const contentY = minY - nodeRadius - GRAPH_CONTENT_PAD;
  const contentW = (maxX - minX) + (nodeRadius * 2) + GRAPH_CONTENT_PAD * 2;
  const contentH = (maxY - minY) + (nodeRadius * 2) + GRAPH_CONTENT_PAD * 2;

  // Build inner SVG
  let inner = '';

  // Spine placeholders (one per depth column) - faint vertical guide and helper placeholder area
  for (const depthKey of Object.keys(columns)) {
    const depth = Number(depthKey);
    const spineX = depth * GRAPH_COL_WIDTH + 100 + nodeRadius + 36; // slightly right of nodes
    const topY = minY - GRAPH_ROW_HEIGHT;
    const bottomY = maxY + GRAPH_ROW_HEIGHT;
    inner += `
      <g class="spine-placeholder" data-depth="${depth}">
        <line x1="${spineX}" y1="${topY}" x2="${spineX}" y2="${bottomY}"
              stroke="${isDark ? '#2b2b2b' : '#e9e9e9'}" stroke-width="1" stroke-dasharray="4 6" opacity="0.35" pointer-events="none" />
        <!-- helper placeholder area (above nodes) -->
        <rect x="${spineX - 18}" y="${topY - 44}" width="36" height="28" rx="6" ry="6"
              fill="${isDark ? '#222' : '#fff'}" stroke="${isDark ? '#444' : '#ddd'}" stroke-width="1" opacity="0.6" pointer-events="none" />
      </g>
    `;
  }

  // Determine leftmost depth (minDepth)
  const minDepth = nodes.length ? Math.min(...nodes.map(n => n.depth)) : 0;

  // --- Edges: draw direct node-to-node wires for raw sources on the far left ---
  // We'll track which links we've drawn as raw-direct so we don't duplicate them in the regular edges pass.
  const drawnRawDirect = new Set();

  for (const link of links) {
    // links are consumer -> input (consumer consumes input)
    const rawSource = nodes.find(n => n.id === link.to);
    const consumer = nodes.find(n => n.id === link.from);
    if (!rawSource || !consumer) continue;

    // Only draw if the source is a raw extractor and is displayed on the far left
    if (rawSource.raw && rawSource.depth === minDepth) {
      // Start at raw node center (node-to-node)
      const startX = rawSource.x;
      const startY = rawSource.y;

      // End at consumer center OR at consumer left anchor if present
      const endX = consumer.hasInputAnchor ? (consumer.x - nodeRadius - 10) : consumer.x;
      const endY = consumer.y;

      inner += `
        <line class="graph-edge graph-edge-raw" data-from="${escapeHtml(rawSource.id)}" data-to="${escapeHtml(consumer.id)}"
              x1="${startX}" y1="${startY}"
              x2="${endX}" y2="${endY}"
              stroke="#333" stroke-width="2.6" stroke-linecap="round" />
      `;
      drawnRawDirect.add(`${link.from}::${link.to}`);
    }
  }

  // --- Regular edges (lighter) for all other links (skip those already drawn) ---
  for (const link of links) {
    const key = `${link.from}::${link.to}`;
    if (drawnRawDirect.has(key)) continue; // skip duplicates

    const from = nodes.find(n => n.id === link.from);
    const to = nodes.find(n => n.id === link.to);
    if (!from || !to) continue;

    inner += `
      <line class="graph-edge" data-from="${escapeHtml(from.id)}" data-to="${escapeHtml(to.id)}"
            x1="${from.x}" y1="${from.y}"
            x2="${to.x}" y2="${to.y}"
            stroke="#999" stroke-width="1.6" stroke-linecap="round" opacity="0.85" />
    `;
  }

  // Nodes + anchors
  for (const node of nodes) {
    const fillColor = node.raw ? "#f4d03f" : MACHINE_COLORS[node.building] || "#95a5a6";
    const strokeColor = "#2c3e50";
    const textColor = getTextColor(fillColor);
    const labelY = node.y - GRAPH_LABEL_OFFSET;

    // Decide whether to render anchors for this node.
    // RULE: if node is raw AND node.depth === minDepth, render NO helper dots at all.
    const hideAllAnchors = (node.raw && node.depth === minDepth);

    inner += `
      <g class="graph-node" data-id="${escapeHtml(node.id)}" tabindex="0" role="button" aria-label="${escapeHtml(node.label)}" style="outline:none;">
        <text class="nodeLabel" x="${node.x}" y="${labelY}"
              text-anchor="middle" font-size="13" font-weight="700"
              fill="${textColor}"
              stroke="${isDark ? '#000' : '#fff'}" stroke-width="0.6" paint-order="stroke"
              pointer-events="none">
          ${escapeHtml(node.label)}
        </text>

        <circle class="graph-node-circle" data-id="${escapeHtml(node.id)}" cx="${node.x}" cy="${node.y}" r="${nodeRadius}"
                fill="${fillColor}" stroke="${strokeColor}" stroke-width="2" />

        ${node.raw ? "" : `<rect x="${node.x - 14}" y="${node.y - 10}" width="28" height="20" fill="${fillColor}" rx="4" ry="4" pointer-events="none" />`}

        <text class="nodeNumber" x="${node.x}" y="${node.y}"
              text-anchor="middle" font-size="13" font-weight="700"
              fill="${textColor}"
              stroke="${isDark ? '#000' : '#fff'}" stroke-width="0.6" paint-order="stroke"
              pointer-events="none">
          ${node.raw ? "" : Math.ceil(node.machines)}
        </text>
    `;

    // Left input anchor (if present and not hidden)
    if (!hideAllAnchors && node.hasInputAnchor) {
      const ax = node.x - nodeRadius - 10;
      const ay = node.y;
      inner += `
        <g class="anchor anchor-left" data-node="${escapeHtml(node.id)}" data-side="left" transform="translate(${ax},${ay})" tabindex="0" role="button" aria-label="Input anchor for ${escapeHtml(node.label)}">
          <circle class="anchor-hit" cx="0" cy="0" r="${anchorHitRadius}" fill="transparent" pointer-events="all" />
          <circle class="anchor-dot" cx="0" cy="0" r="${anchorRadius}" fill="${isDark ? '#ffffff' : '#2c3e50'}" stroke="${isDark ? '#000' : '#fff'}" stroke-width="1.2" />
        </g>
      `;
    }

    // Right output anchor (if present and not hidden)
    if (!hideAllAnchors && node.hasOutputAnchor) {
      const bx = node.x + nodeRadius + 10;
      const by = node.y;
      inner += `
        <g class="anchor anchor-right" data-node="${escapeHtml(node.id)}" data-side="right" transform="translate(${bx},${by})" tabindex="0" role="button" aria-label="Output anchor for ${escapeHtml(node.label)}">
          <circle class="anchor-hit" cx="0" cy="0" r="${anchorHitRadius}" fill="transparent" pointer-events="all" />
          <circle class="anchor-dot" cx="0" cy="0" r="${anchorRadius}" fill="${isDark ? '#ffffff' : '#2c3e50'}" stroke="${isDark ? '#000' : '#fff'}" stroke-width="1.2" />
        </g>
      `;
    }

    inner += `</g>`;
  }

  const viewBoxX = Math.floor(contentX);
  const viewBoxY = Math.floor(contentY);
  const viewBoxW = Math.ceil(contentW);
  const viewBoxH = Math.ceil(contentH);

  const svg = `
    <div class="graphWrapper" data-vb="${viewBoxX},${viewBoxY},${viewBoxW},${viewBoxH}">
      <div class="graphViewport">
        <svg xmlns="http://www.w3.org/2000/svg"
             class="graphSVG"
             viewBox="${viewBoxX} ${viewBoxY} ${viewBoxW} ${viewBoxH}"
             preserveAspectRatio="xMidYMid meet">
          <g id="zoomLayer">
            ${inner}
          </g>
        </svg>
      </div>
    </div>
  `;
  return svg;
}

/* ===============================
   Highlighting (unchanged)
   =============================== */
function clearPulses(svg) {
  if (!svg) return;
  svg.querySelectorAll('circle.pulse-origin, circle.pulse-node, line.pulse-edge').forEach(el => {
    el.classList.remove('pulse-origin', 'pulse-node', 'pulse-edge');
  });
}

function highlightOutgoing(nodeId, svg) {
  if (!svg || !nodeId) return;

  const originCircle = svg.querySelector(`circle.graph-node-circle[data-id="${CSS.escape(nodeId)}"]`);
  if (originCircle && originCircle.classList.contains('pulse-origin')) {
    clearPulses(svg);
    return;
  }

  clearPulses(svg);

  if (originCircle) originCircle.classList.add('pulse-origin');

  // Outgoing edges are lines with data-from = nodeId
  const outgoing = Array.from(svg.querySelectorAll(`line.graph-edge[data-from="${CSS.escape(nodeId)}"]`));

  outgoing.forEach(edgeEl => {
    edgeEl.classList.add('pulse-edge');
    const toId = edgeEl.getAttribute('data-to');
    const targetCircle = svg.querySelector(`circle.graph-node-circle[data-id="${CSS.escape(toId)}"]`);
    if (targetCircle) targetCircle.classList.add('pulse-node');
  });
}

/* ===============================
   Pointer handling (unchanged)
   =============================== */
function attachNodePointerHandlers(wrapper) {
  if (!wrapper) return;
  const svg = wrapper.querySelector('svg.graphSVG');
  if (!svg) return;

  const pointerMap = new Map();

  function getThreshold(ev) {
    return (ev && ev.pointerType === 'touch') ? TOUCH_THRESHOLD_PX : DRAG_THRESHOLD_PX;
  }

  wrapper.addEventListener('pointerdown', (ev) => {
    const nodeGroup = ev.target.closest && ev.target.closest('g.graph-node[data-id]');
    if (!nodeGroup) return;
    ev.stopPropagation();
    try { nodeGroup.setPointerCapture?.(ev.pointerId); } catch (e) {}
    const nodeId = nodeGroup.getAttribute('data-id');
    pointerMap.set(ev.pointerId, { nodeId, startX: ev.clientX, startY: ev.clientY, isDragging: false });
  }, { passive: false });

  window.addEventListener('pointermove', (ev) => {
    const entry = pointerMap.get(ev.pointerId);
    if (!entry) return;
    if (entry.isDragging) return;
    const dx = ev.clientX - entry.startX;
    const dy = ev.clientY - entry.startY;
    if (Math.hypot(dx, dy) > getThreshold(ev)) {
      entry.isDragging = true;
      pointerMap.set(ev.pointerId, entry);
    }
  }, { passive: true });

  wrapper.addEventListener('pointerup', (ev) => {
    const entry = pointerMap.get(ev.pointerId);
    if (!entry) return;
    try {
      const nodeGroup = document.querySelector(`g.graph-node[data-id="${CSS.escape(entry.nodeId)}"]`);
      nodeGroup && nodeGroup.releasePointerCapture?.(ev.pointerId);
    } catch (e) {}
    if (!entry.isDragging) {
      highlightOutgoing(entry.nodeId, svg);
    }
    pointerMap.delete(ev.pointerId);
    ev.stopPropagation();
  }, { passive: false });

  wrapper.addEventListener('pointercancel', (ev) => {
    pointerMap.delete(ev.pointerId);
  });

  svg.querySelectorAll('g.graph-node[data-id]').forEach(group => {
    group.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        const nodeId = group.getAttribute('data-id');
        highlightOutgoing(nodeId, svg);
      }
    });
  });

  function onDocClick(e) {
    if (!svg.contains(e.target)) clearPulses(svg);
  }
  document.removeEventListener('click', onDocClick);
  document.addEventListener('click', onDocClick);
}

/* ===============================
   Helper: detect if pointer target is a node
   =============================== */
function pointerIsOnNode(ev) {
  return !!(ev.target && ev.target.closest && ev.target.closest('g.graph-node[data-id]'));
}

/* ===============================
   Zoom / pan utilities (unchanged)
   =============================== */
function ensureResetButton() {
  let btn = document.querySelector('.graphResetButton');
  const graphArea = document.getElementById('graphArea');
  if (!graphArea) return null;

  if (btn && btn.nextElementSibling !== graphArea) {
    btn.remove();
    btn = null;
  }

  if (!btn) {
    btn = document.createElement('div');
    btn.className = 'graphResetButton';
    btn.innerHTML = `<button id="resetViewBtn" type="button">Reset view</button>`;
    graphArea.parentNode.insertBefore(btn, graphArea);
    btn.style.display = 'flex';
    btn.style.justifyContent = 'center';
    btn.style.alignItems = 'center';
    btn.style.padding = '8px 12px';
    btn.style.boxSizing = 'border-box';
    btn.style.background = 'transparent';
    btn.style.zIndex = '20';
    btn.style.pointerEvents = 'auto';
  }

  function adjustGraphTopPadding() {
    if (!btn || !graphArea) return;
    const h = Math.max(0, btn.offsetHeight || 0);
    const gap = 8;
    graphArea.style.paddingTop = (h + gap) + 'px';
  }

  requestAnimationFrame(() => adjustGraphTopPadding());

  let resizeTimer = null;
  function onResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => adjustGraphTopPadding(), 80);
  }
  window.removeEventListener('resize', onResize);
  window.addEventListener('resize', onResize);

  return btn;
}

function setupGraphZoom(containerEl, { autoFit = true, resetButtonEl = null } = {}) {
  if (!containerEl) return;

  const svg = containerEl.querySelector('svg.graphSVG');
  const zoomLayer = svg.querySelector('#zoomLayer');
  const resetBtn = resetButtonEl || document.querySelector('#resetViewBtn');

  let scale = 1;
  let tx = 0;
  let ty = 0;
  let isPanning = false;
  let startX = 0;
  let startY = 0;
  let activePointerId = null;

  function getContentBBox() {
    const vb = svg.viewBox.baseVal;
    if (vb && vb.width && vb.height) return { x: vb.x, y: vb.y, width: vb.width, height: vb.height };
    try { return zoomLayer.getBBox(); } catch (e) { return { x: 0, y: 0, width: svg.clientWidth, height: svg.clientHeight }; }
  }

  function getViewSizeInSvgCoords() {
    const rect = svg.getBoundingClientRect();
    const ptTL = svg.createSVGPoint(); ptTL.x = 0; ptTL.y = 0;
    const ptBR = svg.createSVGPoint(); ptBR.x = rect.width; ptBR.y = rect.height;
    const svgTL = ptTL.matrixTransform(svg.getScreenCTM().inverse());
    const svgBR = ptBR.matrixTransform(svg.getScreenCTM().inverse());
    return { width: svgBR.x - svgTL.x, height: svgBR.y - svgTL.y };
  }

  function clampTranslation(proposedTx, proposedTy, proposedScale) {
    const bbox = getContentBBox();
    const view = getViewSizeInSvgCoords();
    const layerW = bbox.width * proposedScale;
    const layerH = bbox.height * proposedScale;

    const minTxLarge = view.width - layerW - bbox.x * proposedScale;
    const maxTxLarge = -bbox.x * proposedScale;
    const minTyLarge = view.height - layerH - bbox.y * proposedScale;
    const maxTyLarge = -bbox.y * proposedScale;

    const overlapFraction = 0.12;
    const allowedExtraX = Math.max((view.width - layerW) * (1 - overlapFraction), 0);
    const allowedExtraY = Math.max((view.height - layerH) * (1 - overlapFraction), 0);

    let clampedTx = proposedTx;
    let clampedTy = proposedTy;

    if (layerW > view.width) {
      clampedTx = Math.min(maxTxLarge, Math.max(minTxLarge, proposedTx));
    } else {
      const centerTx = (view.width - layerW) / 2 - bbox.x * proposedScale;
      const minTxSmall = centerTx - allowedExtraX / 2;
      const maxTxSmall = centerTx + allowedExtraX / 2;
      clampedTx = Math.min(maxTxSmall, Math.max(minTxSmall, proposedTx));
    }

    if (layerH > view.height) {
      clampedTy = Math.min(maxTyLarge, Math.max(minTyLarge, proposedTy));
    } else {
      const centerTy = (view.height - layerH) / 2 - bbox.y * proposedScale;
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
  }

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

  svg.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const delta = -ev.deltaY;
    const factor = delta > 0 ? 1.08 : 0.92;
    const newScale = Math.min(3, Math.max(0.25, +(scale * factor).toFixed(3)));
    zoomAt(newScale, ev.clientX, ev.clientY);
  }, { passive: false });

  svg.addEventListener('pointerdown', (ev) => {
    if (pointerIsOnNode(ev)) return;
    if (ev.button !== 0) return;
    isPanning = true;
    activePointerId = ev.pointerId;
    startX = ev.clientX;
    startY = ev.clientY;
    try { svg.setPointerCapture(ev.pointerId); } catch (e) {}
    svg.style.cursor = 'grabbing';
  });

  window.addEventListener('pointermove', (ev) => {
    if (!isPanning || ev.pointerId !== activePointerId) return;
    const dxScreen = ev.clientX - startX;
    const dyScreen = ev.clientY - startY;
    startX = ev.clientX;
    startY = ev.clientY;

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

  window.addEventListener('pointerup', (ev) => {
    if (!isPanning || ev.pointerId !== activePointerId) return;
    isPanning = false;
    activePointerId = null;
    try { svg.releasePointerCapture(ev.pointerId); } catch (e) {}
    svg.style.cursor = 'grab';
  });

  svg.style.cursor = 'grab';

  function computeAutoFit() {
    const bbox = getContentBBox();
    const view = getViewSizeInSvgCoords();
    if (bbox.width === 0 || bbox.height === 0) {
      scale = 1; tx = 0; ty = 0; applyTransform(); return;
    }

    const pad = 0.92;
    const scaleX = (view.width * pad) / bbox.width;
    const scaleY = (view.height * pad) / bbox.height;
    const fitScale = Math.min(scaleX, scaleY);

    scale = Math.min(3, Math.max(0.25, fitScale));

    const layerW = bbox.width * scale;
    const layerH = bbox.height * scale;
    tx = (view.width - layerW) / 2 - bbox.x * scale;
    ty = (view.height - layerH) / 2 - bbox.y * scale;

    applyTransform();
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      computeAutoFit();
      showToast("View reset");
    });
  }

  if (autoFit) requestAnimationFrame(() => computeAutoFit());
  else applyTransform();

  containerEl._teardownGraphZoom = () => { /* no-op */ };

  function getContentBBox() {
    try { return zoomLayer.getBBox(); } catch (e) { return { x: 0, y: 0, width: svg.clientWidth, height: svg.clientHeight }; }
  }
  function getViewSizeInSvgCoords() {
    const rect = svg.getBoundingClientRect();
    const ptTL = svg.createSVGPoint(); ptTL.x = 0; ptTL.y = 0;
    const ptBR = svg.createSVGPoint(); ptBR.x = rect.width; ptBR.y = rect.height;
    const svgTL = ptTL.matrixTransform(svg.getScreenCTM().inverse());
    const svgBR = ptBR.matrixTransform(svg.getScreenCTM().inverse());
    return { width: svgBR.x - svgTL.x, height: svgBR.y - svgTL.y };
  }
}

/* ===============================
   Render table + graph helpers (left as in original)
   =============================== */
function computeRailsNeeded(inputRates, railSpeed) {
  const total = Object.values(inputRates).reduce((sum, val) => sum + val, 0);
  return railSpeed && railSpeed > 0 ? Math.ceil(total / railSpeed) : 0;
}

/* ===============================
   Anchor API + handlers (unchanged)
   =============================== */
function createAnchor(nodeId, side) {
  const nodes = window._lastGraphNodes || [];
  const node = nodes.find(n => n.id === nodeId);
  if (!node) return false;
  if (side === 'left') node.hasInputAnchor = true;
  if (side === 'right') node.hasOutputAnchor = true;
  return true;
}

function removeAnchor(nodeId, side) {
  const nodes = window._lastGraphNodes || [];
  const node = nodes.find(n => n.id === nodeId);
  if (!node) return false;
  if (side === 'left') node.hasInputAnchor = false;
  if (side === 'right') node.hasOutputAnchor = false;
  return true;
}

function getAnchorPosition(nodeId, side) {
  const svg = document.querySelector('svg.graphSVG');
  if (!svg) return null;
  const anchorEl = svg.querySelector(`g.anchor[data-node="${CSS.escape(nodeId)}"][data-side="${side}"]`);
  if (!anchorEl) return null;
  const transform = anchorEl.getAttribute('transform') || '';
  const m = transform.match(/translate\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)/);
  if (!m) return null;
  return { x: Number(m[1]), y: Number(m[2]) };
}

function attachAnchorHandlers(wrapper) {
  if (!wrapper) return;
  const svg = wrapper.querySelector('svg.graphSVG');
  if (!svg) return;

  svg.querySelectorAll('g.anchor').forEach(anchor => {
    anchor.addEventListener('mouseenter', (ev) => {
      const nodeId = anchor.getAttribute('data-node');
      const side = anchor.getAttribute('data-side');
      const evt = new CustomEvent('anchorHover', { detail: { nodeId, side } });
      wrapper.dispatchEvent(evt);
      anchor.querySelector('.anchor-dot')?.classList.add('anchor-hover');
    });
    anchor.addEventListener('mouseleave', (ev) => {
      const nodeId = anchor.getAttribute('data-node');
      const side = anchor.getAttribute('data-side');
      const evt = new CustomEvent('anchorHoverEnd', { detail: { nodeId, side } });
      wrapper.dispatchEvent(evt);
      anchor.querySelector('.anchor-dot')?.classList.remove('anchor-hover');
    });

    anchor.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const nodeId = anchor.getAttribute('data-node');
      const side = anchor.getAttribute('data-side');
      const evt = new CustomEvent('anchorClick', { detail: { nodeId, side } });
      wrapper.dispatchEvent(evt);
    });

    anchor.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        const nodeId = anchor.getAttribute('data-node');
        const side = anchor.getAttribute('data-side');
        const evt = new CustomEvent('anchorClick', { detail: { nodeId, side } });
        wrapper.dispatchEvent(evt);
      }
    });
  });
}

/* ===============================
   Integration note
   - After you call renderGraph(...) and insert the returned HTML into the DOM,
     set window._lastGraphNodes = nodes; then call attachAnchorHandlers(wrapperEl)
   Example:
     const html = renderGraph(nodes, links, rootItem);
     document.getElementById('graphArea').innerHTML = html;
     window._lastGraphNodes = nodes;
     attachAnchorHandlers(document.querySelector('.graphWrapper'));
     attachNodePointerHandlers(document.querySelector('.graphWrapper'));
     setupGraphZoom(document.querySelector('.graphWrapper'), { autoFit: true, resetButtonEl: ensureResetButton() });
   =============================== */

/* ===============================
   End of file
   =============================== */
