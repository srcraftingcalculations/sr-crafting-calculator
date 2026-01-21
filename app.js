// app.js - Rewritten, complete file
// - loadRecipes: data-only (no DOM mutations)
// - init: canonical initializer, populates UI and wires handlers
// - Full renderGraph and zoom/pan implementations restored from banked code
// - Guards against internal keys starting with "_"
// - Non-invasive safety nets only

'use strict';

/* ===============================
   Configuration & Constants
   =============================== */
const MACHINE_COL_WIDTH = 220;
const GRAPH_ROW_HEIGHT = 120;
const GRAPH_LABEL_OFFSET = 40;
const GRAPH_CONTENT_PAD = 64;

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

const DRAG_THRESHOLD_PX = 8;
const TOUCH_THRESHOLD_PX = 12;
const PULSE_PROPAGATION_DEPTH = 1;
const PULSE_STAGGER_MS = 90;

const FORCED_RAW_ORES = ['Calcium Ore', 'Titanium Ore', 'Wolfram Ore'];
const LEFT_OF_CONSUMER_RAWS = ['Helium-3', 'Sulphur Ore'];
const BBM_ID = 'Basic Building Material';

/* ===============================
   Globals
   =============================== */
let RECIPES = {};
let TIERS = {};

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

/* ===============================
   Theme helpers
   =============================== */
function isDarkMode() {
  if (document.documentElement.classList.contains('dark')) return true;
  if (document.body.classList.contains('dark') || document.body.classList.contains('dark-mode')) return true;
  const saved = localStorage.getItem('darkMode');
  if (saved === 'true') return true;
  if (saved === 'false') return false;
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return true;
  return false;
}

function applyThemeClass(dark) {
  if (dark) {
    document.documentElement.classList.add('dark');
    document.body.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
    document.body.classList.remove('dark');
  }
  if (typeof window._updateGraphThemeVars === 'function') {
    try { window._updateGraphThemeVars(); } catch (e) { /* ignore */ }
  } else {
    const vars = {
      '--line-color': dark ? '#dcdcdc' : '#444444',
      '--spine-color': dark ? '#bdbdbd' : '#666666',
      '--raw-edge-color': '#333333',
      '--label-box-fill': dark ? 'rgba(0,0,0,0.88)' : 'rgba(255,255,255,0.92)',
      '--label-box-stroke': dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
      '--label-text-fill': dark ? '#ffffff' : '#111111',
      '--label-text-stroke': dark ? '#000000' : '#ffffff',
      '--label-text-stroke-width': dark ? '1.0' : '0.6',
      '--anchor-dot-fill': dark ? '#ffffff' : '#2c3e50',
      '--anchor-dot-stroke': dark ? '#000000' : '#ffffff',
      '--bypass-fill': dark ? '#ffffff' : '#2c3e50',
      '--bypass-stroke': dark ? '#000000' : '#ffffff'
    };
    document.querySelectorAll('.graphWrapper').forEach(w => {
      for (const [k, v] of Object.entries(vars)) w.style.setProperty(k, v);
    });
  }
}

function setupDarkMode() {
  const toggle = document.getElementById("darkModeToggle");
  if (!toggle) return;

  const dark = isDarkMode();
  applyThemeClass(dark);
  toggle.textContent = dark ? "☀️ Light Mode" : "🌙 Dark Mode";

  toggle.addEventListener("click", () => {
    const nowDark = !document.documentElement.classList.contains('dark');
    applyThemeClass(nowDark);
    localStorage.setItem('darkMode', nowDark ? 'true' : 'false');
    toggle.textContent = nowDark ? "☀️ Light Mode" : "🌙 Dark Mode";
  });
}

/* ===============================
   Toast helper
   =============================== */
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
   Info bubble behavior
   =============================== */
(function () {
  const infoBtn = document.getElementById('infoButton');
  const infoPanel = document.getElementById('infoPanel');
  const infoClose = document.getElementById('infoClose');

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

  infoBtn.addEventListener('click', function () {
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
   - loadRecipes: data-only, returns RECIPES and TIERS
   =============================== */
async function fetchJson(url) {
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) throw new Error(`Fetch failed: ${url} (${resp.status})`);
  return resp.json();
}

async function loadRecipes() {
  const localPath = "data/recipes.json";
  const remotePath = "https://srcraftingcalculations.github.io/sr-crafting-calculator/data/recipes.json";

  let data = null;
  try {
    data = await fetchJson(localPath);
    console.info("Loaded recipes from local data/recipes.json");
  } catch (localErr) {
    console.warn("Local recipes.json not found or failed to load, falling back to remote:", localErr);
    try {
      data = await fetchJson(remotePath);
      console.info("Loaded recipes from remote URL");
    } catch (remoteErr) {
      console.error("Failed to load recipes from remote URL as well:", remoteErr);
      const out = document.getElementById("outputArea");
      if (out) out.innerHTML = `<p style="color:red;">Error loading recipe data. Please try again later.</p>`;
      return {};
    }
  }

  if (!data || typeof data !== "object") {
    console.error("Invalid recipe data format");
    return {};
  }

  // Assign RECIPES and compute TIERS purely in memory
  RECIPES = data;
  TIERS = {};

  for (const [name, recipe] of Object.entries(RECIPES)) {
    if (typeof recipe?.tier === "number") TIERS[name] = recipe.tier;
    else TIERS[name] = 0;
  }

  // propagate tiers until stable (bounded passes)
  let changed = true;
  for (let pass = 0; pass < 50 && changed; pass++) {
    changed = false;
    for (const [name, recipe] of Object.entries(RECIPES)) {
      if (!recipe || !recipe.inputs) continue;
      let maxInputTier = -1;
      for (const inputName of Object.keys(recipe.inputs)) {
        const t = TIERS[inputName] ?? 0;
        if (t > maxInputTier) maxInputTier = t;
      }
      const newTier = (maxInputTier >= 0) ? (maxInputTier + 1) : 1;
      if (TIERS[name] !== newTier) {
        TIERS[name] = newTier;
        changed = true;
      }
    }
  }

  // Ensure BBM exists and is at least 0
  TIERS[BBM_ID] = TIERS[BBM_ID] ?? 0;

  window.RECIPES = RECIPES;
  window.TIERS = TIERS;
  console.info("Recipes loaded:", Object.keys(RECIPES).length, "items");
  return RECIPES;
}

/* ===============================
   Expand production chain
   =============================== */
function getRecipe(name) {
  return RECIPES[name] || null;
}

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
function computeDepthsFromTiers(chain, rootItem) {
  const depths = {};

  // 1) Base assignment: table level + 1 (so table level 0 -> graph column 1)
  for (const item of Object.keys(chain)) {
    const tableLevel = Number(TIERS?.[item] ?? 0);
    depths[item] = tableLevel + 1;
  }

  // 2) Ensure raw items default to column 0 if they don't have a table level
  for (const item of Object.keys(chain)) {
    if (chain[item].raw) {
      if (FORCED_RAW_ORES.includes(item)) {
        depths[item] = 0;
      } else {
        if (!(item in TIERS)) depths[item] = 0;
      }
    }
  }

  // 3) Force BBM into graph column 1
  if (depths[BBM_ID] !== undefined) depths[BBM_ID] = 1;

  // 4) Place Helium-3 and Sulphur one column left of their earliest consumer
  for (const rawName of LEFT_OF_CONSUMER_RAWS) {
    if (!(rawName in chain)) continue;
    let minConsumerDepth = Infinity;
    for (const [consumerName, consumerData] of Object.entries(chain)) {
      const inputs = consumerData.inputs || {};
      if (Object.prototype.hasOwnProperty.call(inputs, rawName)) {
        const d = Number(depths[consumerName] ?? (Number(TIERS?.[consumerName] ?? 0) + 1));
        if (Number.isFinite(d) && d < minConsumerDepth) minConsumerDepth = d;
      }
    }
    if (minConsumerDepth === Infinity) {
      depths[rawName] = Math.max(0, depths[rawName] ?? 0);
    } else {
      depths[rawName] = Math.max(0, Math.floor(minConsumerDepth) - 1);
    }
  }

  // 5) Final clamp and integer normalization
  for (const k of Object.keys(depths)) {
    let v = Number(depths[k]);
    if (!Number.isFinite(v) || isNaN(v)) v = 0;
    v = Math.max(0, Math.floor(v));
    depths[k] = v;
  }

  return depths;
}

function buildGraphData(chain, rootItem) {
  const nodes = [];
  const links = [];
  const nodeMap = new Map();

  for (const [item, data] of Object.entries(chain)) {
    const node = {
      id: item,
      label: item,
      raw: !!data.raw,
      building: data.building,
      machines: data.machines,
      inputs: data.inputs || {}
    };
    nodes.push(node);
    nodeMap.set(item, node);
  }

  for (const [consumer, data] of Object.entries(chain)) {
    for (const inputName of Object.keys(data.inputs || {})) {
      links.push({ from: consumer, to: inputName });
    }
  }

  const computed = computeDepthsFromTiers(chain, rootItem);

  for (const n of nodes) {
    n.depth = Number.isFinite(Number(computed[n.id])) ? Number(computed[n.id]) : 0;
  }

  return { nodes, links };
}

/* ===============================
   Graph rendering (full)
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

    .graphSVG line { stroke-linecap: round; stroke-opacity: 0.95; }
    .graph-edge, .node-to-anchor, .bypass-connector { stroke: var(--line-color); stroke-width: 1.6; stroke-linecap: round; stroke-opacity: 0.95; }
    .graph-spine-vertical, .graph-spine-horizontal { stroke: var(--spine-color); stroke-width: 2; stroke-linecap: round; stroke-opacity: 0.95; }
    .graph-edge-raw { stroke: var(--raw-edge-color); stroke-width: 2.6; stroke-linecap: round; stroke-opacity: 1; }
    .bypass-to-spine, .bypass-input-connector, .bypass-output-connector { stroke: var(--line-color); stroke-width: 1.4; stroke-linecap: butt; stroke-opacity: 0.95; }
  `;
  document.head.appendChild(style);
})();

function renderGraph(nodes, links, rootItem) {
  const nodeRadius = 22;
  const ANCHOR_RADIUS = 5;
  const ANCHOR_HIT_RADIUS = 12;
  const ANCHOR_OFFSET = 18;

  function roundCoord(v) { return Math.round(v * 100) / 100; }
  function anchorRightPos(node) { return { x: roundCoord(node.x + nodeRadius + ANCHOR_OFFSET), y: roundCoord(node.y) }; }
  function anchorLeftPos(node)  { return { x: roundCoord(node.x - nodeRadius - ANCHOR_OFFSET), y: roundCoord(node.y) }; }

  for (const n of nodes) {
    if (typeof n.hasInputAnchor === 'undefined') n.hasInputAnchor = true;
    if (typeof n.hasOutputAnchor === 'undefined') n.hasOutputAnchor = true;
    if (typeof n.depth === 'undefined') n.depth = 0;
  }

  const bbmNode = nodes.find(n => n.id === BBM_ID || n.label === BBM_ID);
  if (bbmNode) {
    const smelterDepths = nodes.filter(n => n.building === 'Smelter').map(n => n.depth);
    const fallbackDepths = nodes.filter(n => ['Calcium Block','Titanium Bar','Wolfram Bar'].includes(n.id)).map(n => n.depth);
    const candidateDepths = smelterDepths.length ? smelterDepths : fallbackDepths;
    if (candidateDepths.length) {
      const counts = {};
      candidateDepths.forEach(d => counts[d] = (counts[d] || 0) + 1);
      const chosenDepth = Number(Object.keys(counts).sort((a,b) => counts[b] - counts[a])[0]);
      bbmNode.depth = chosenDepth;
    }
  }

  const nodeById = new Map(nodes.map(n => [n.id, n]));

  const columns = {};
  for (const node of nodes) {
    if (!columns[node.depth]) columns[node.depth] = [];
    columns[node.depth].push(node);
  }
  for (const [depth, colNodes] of Object.entries(columns)) {
    colNodes.sort((a,b) => (String(a.label||a.id)).localeCompare(String(b.label||b.id), undefined, {sensitivity:'base'}));
      colNodes.forEach((node,i) => {
      const depthIndex = depthsSorted.indexOf(Number(depth));
      node.x = roundCoord(depthIndex * MACHINE_COL_WIDTH + 100); 
      node.y = roundCoord(i * GRAPH_ROW_HEIGHT + 100);
    });
  }

  const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
  const minX = nodes.length ? Math.min(...xs) : 0;
  const maxX = nodes.length ? Math.max(...xs) : 0;
  const minY = nodes.length ? Math.min(...ys) : 0;
  const maxY = nodes.length ? Math.max(...ys) : 0;
  const contentX = minX - nodeRadius - GRAPH_CONTENT_PAD;
  const contentY = minY - nodeRadius - GRAPH_CONTENT_PAD;
  const contentW = (maxX - minX) + (nodeRadius*2) + GRAPH_CONTENT_PAD*2;
  const contentH = (maxY - minY) + (nodeRadius*2) + GRAPH_CONTENT_PAD*2;

  const minDepth = nodes.length ? Math.min(...nodes.map(n => n.depth)) : 0;
  const maxDepth = nodes.length ? Math.max(...nodes.map(n => n.depth)) : 0;

  const willRenderAnchors = [];
  for (const node of nodes) {
    const hideAllAnchors = (node.raw && node.depth === minDepth);
    const isSmelter = (node.building === 'Smelter');
    const isBBM = (node.id === BBM_ID || node.label === BBM_ID);
    const rawRightOnly = !!(node.raw && node.depth !== minDepth);

    if (!hideAllAnchors && !rawRightOnly && node.hasInputAnchor && !isSmelter && !isBBM) {
      willRenderAnchors.push({ side:'left', node, pos: anchorLeftPos(node) });
    }
    if (!hideAllAnchors && (node.hasOutputAnchor || rawRightOnly || isBBM) && node.depth !== maxDepth) {
      willRenderAnchors.push({ side:'right', node, pos: anchorRightPos(node) });
    }
  }

  const uniqueYs = Array.from(new Set(willRenderAnchors.map(a => a.pos.y))).sort((a,b)=>a-b);
  let shortestGap = nodeRadius + ANCHOR_OFFSET;
  if (uniqueYs.length >= 2) {
    let sg = Infinity;
    for (let i=1;i<uniqueYs.length;i++){
      const gap = Math.abs(uniqueYs[i]-uniqueYs[i-1]);
      if (gap>0 && gap<sg) sg = gap;
    }
    if (isFinite(sg)) shortestGap = sg;
  }
  shortestGap = roundCoord(shortestGap);

  const depthsSorted = Object.keys(columns).map(d=>Number(d)).sort((a,b)=>a-b);
  const needsOutputBypass = new Map();
  for (const depth of depthsSorted) {
    const colNodes = columns[depth] || [];
    const outputs = colNodes.filter(n => !(n.raw && n.depth === minDepth) && (n.hasOutputAnchor || (n.id === BBM_ID || n.label === BBM_ID)) && n.depth !== maxDepth);
    if (!outputs.length) continue;
    const consumerDepths = new Set();
    for (const outNode of outputs) {
      for (const link of links) {
        if (link.to !== outNode.id) continue;
        const consumer = nodeById.get(link.from);
        if (!consumer || typeof consumer.depth !== 'number') continue;
        if ((consumer.depth - outNode.depth) > 1) consumerDepths.add(consumer.depth);
      }
    }
    if (!consumerDepths.size) continue;
    const topOutputNode = outputs.reduce((a,b)=> a.y < b.y ? a : b);
    const helperCenter = anchorRightPos(topOutputNode);
    const bypassCenterY = roundCoord(helperCenter.y - shortestGap);
    needsOutputBypass.set(depth, { x: helperCenter.x, y: bypassCenterY, helperCenter, causingConsumers: consumerDepths });
  }

  const needsInputBypass = new Map();
  for (const [outDepth, info] of needsOutputBypass.entries()) {
    for (const consumerDepth of info.causingConsumers) {
      const consumerCol = columns[consumerDepth] || [];
      const inputNodes = consumerCol.filter(n => !(n.raw && n.depth === minDepth) && n.hasInputAnchor);
      if (!inputNodes.length) continue;
      const topInputNode = inputNodes.reduce((a,b)=> a.y < b.y ? a : b);
      const topInputHelperCenter = anchorLeftPos(topInputNode);
      if (!needsInputBypass.has(consumerDepth)) {
        needsInputBypass.set(consumerDepth, { x: topInputHelperCenter.x, y: info.y, helperCenter: topInputHelperCenter });
      }
    }
  }

  window._needsOutputBypass = needsOutputBypass;
  window._needsInputBypass = needsInputBypass;
  window._graphNodes = nodes;

  let spineSvg = '';
  (function buildSpines(){
    for (let i=0;i<depthsSorted.length;i++){
      const depth = depthsSorted[i];
      const colNodes = columns[depth] || [];
      const outputAnchors = [];
      for (const n of colNodes) {
        if (n.raw && n.depth === minDepth) continue;
        if ((n.hasOutputAnchor || (n.id === BBM_ID || n.label === BBM_ID)) && n.depth !== maxDepth) {
          outputAnchors.push(anchorRightPos(n));
        }
      }
      if (!outputAnchors.length) continue;
      const ysAnch = outputAnchors.map(p=>p.y);
      const topAnchorY = Math.min(...ysAnch);
      const bottomAnchorY = Math.max(...ysAnch);
      const spineX = outputAnchors[0].x;
      spineSvg += `<line class="graph-spine-vertical" x1="${spineX}" y1="${bottomAnchorY}" x2="${spineX}" y2="${topAnchorY}" />`;
      if (i+1 < depthsSorted.length) {
        const nextDepth = depthsSorted[i+1];
        const nextColNodes = columns[nextDepth] || [];
        const nextInputs = [];
        for (const n of nextColNodes) {
          if (n.raw && n.depth === minDepth) continue;
          if (n.hasInputAnchor && n.building !== 'Smelter') nextInputs.push(anchorLeftPos(n));
        }
        if (nextInputs.length) {
          const topInY = Math.min(...nextInputs.map(p=>p.y));
          const nextSpineX = nextInputs[0].x;
          spineSvg += `<line class="graph-spine-horizontal" x1="${spineX}" y1="${topAnchorY}" x2="${nextSpineX}" y2="${topAnchorY}" />`;
          spineSvg += `<line class="graph-spine-horizontal" x1="${nextSpineX}" y1="${topAnchorY}" x2="${nextSpineX}" y2="${topInY}" />`;
          spineSvg += `<line class="graph-spine-vertical" x1="${nextSpineX}" y1="${topInY}" x2="${nextSpineX}" y2="${Math.max(...nextInputs.map(p=>p.y))}" />`;
        }
      }
    }
  })();

  let inner = `
    <defs>
      <filter id="labelBackdrop" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blurred" />
        <feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-color="#000" flood-opacity="0.25" />
        <feComposite in="blurred" in2="SourceGraphic" operator="over" />
      </filter>
    </defs>
    ${spineSvg}
  `;

  for (const link of links) {
    const rawSource = nodeById.get(link.to);
    const consumer = nodeById.get(link.from);
    if (!rawSource || !consumer) continue;
    const consumerIsBBM = (consumer.id === BBM_ID || consumer.label === BBM_ID);
    if (rawSource.raw && rawSource.depth === minDepth && (consumer.building === 'Smelter' || consumerIsBBM)) {
      inner += `<line class="graph-edge graph-edge-raw" data-from="${escapeHtml(rawSource.id)}" data-to="${escapeHtml(consumer.id)}" x1="${rawSource.x}" y1="${rawSource.y}" x2="${consumer.x}" y2="${consumer.y}" />`;
    }
  }

  for (const [depth, info] of needsOutputBypass.entries()) {
    inner += `<line class="bypass-to-spine bypass-output-connector" data-depth="${depth}" x1="${info.x}" y1="${info.y}" x2="${info.x}" y2="${info.helperCenter.y}" />`;
  }
  for (const [consumerDepth, pos] of needsInputBypass.entries()) {
    inner += `<line class="bypass-to-spine bypass-input-connector" data-depth="${consumerDepth}" x1="${pos.x}" y1="${pos.helperCenter.y}" x2="${pos.x}" y2="${pos.y}" />`;
  }
  for (const [outDepth, outInfo] of needsOutputBypass.entries()) {
    for (const consumerDepth of outInfo.causingConsumers) {
      const inPos = needsInputBypass.get(consumerDepth);
      if (!inPos) continue;
      inner += `<line class="bypass-connector" data-from-depth="${outDepth}" data-to-depth="${consumerDepth}" x1="${outInfo.x}" y1="${outInfo.y}" x2="${inPos.x}" y2="${inPos.y}" />`;
    }
  }

  for (const node of nodes) {
    const hideAllAnchors = (node.raw && node.depth === minDepth);
    const isSmelter = (node.building === 'Smelter');
    const isBBM = (node.id === BBM_ID || node.label === BBM_ID);
    const rawRightOnly = !!(node.raw && node.depth !== minDepth);
    const showLeftAnchor = !hideAllAnchors && !rawRightOnly && node.hasInputAnchor && !isSmelter && !isBBM;
    const showRightAnchor = !hideAllAnchors && (node.hasOutputAnchor || rawRightOnly || isBBM) && (node.depth !== maxDepth);

    if (showLeftAnchor) {
      const a = anchorLeftPos(node);
      inner += `<line class="node-to-anchor node-to-left" data-node="${escapeHtml(node.id)}" x1="${roundCoord(node.x - nodeRadius)}" y1="${node.y}" x2="${a.x}" y2="${a.y}" />`;
    }
    if (showRightAnchor) {
      const a = anchorRightPos(node);
      inner += `<line class="node-to-anchor node-to-right" data-node="${escapeHtml(node.id)}" x1="${roundCoord(node.x + nodeRadius)}" y1="${node.y}" x2="${a.x}" y2="${a.y}" />`;
    }
  }

  for (const node of nodes) {
    const fillColor = node.raw ? "#f4d03f" : MACHINE_COLORS[node.building] || "#95a5a6";
    const strokeColor = "#2c3e50";
    const labelText = String(node.label || node.id).trim();
    const labelFontSize = 13;
    const labelPaddingX = 10;
    const labelPaddingY = 8;

    const hideAllAnchors = (node.raw && node.depth === minDepth);
    const isSmelter = (node.building === 'Smelter');
    const isBBM = (node.id === BBM_ID || node.label === BBM_ID);
    const rawRightOnly = !!(node.raw && node.depth !== minDepth);
    const showLeftAnchor = !hideAllAnchors && !rawRightOnly && node.hasInputAnchor && !isSmelter && !isBBM;
    const showRightAnchor = !hideAllAnchors && (node.hasOutputAnchor || rawRightOnly || isBBM) && (node.depth !== maxDepth);

    const approxCharWidth = 7;
    const labelBoxWidth = Math.max(48, Math.ceil(labelText.length * approxCharWidth) + labelPaddingX * 2);
    const labelBoxHeight = labelFontSize + labelPaddingY * 2;
    const labelBoxX = roundCoord(node.x - labelBoxWidth / 2);
    const labelBoxY = roundCoord((node.y - GRAPH_LABEL_OFFSET) - labelBoxHeight / 2);
    const labelCenterY = roundCoord(labelBoxY + labelBoxHeight / 2);

    inner += `<g class="graph-node" data-id="${escapeHtml(node.id)}" tabindex="0" role="button" aria-label="${escapeHtml(node.label)}" style="outline:none;">`;
    inner += `<rect class="label-box" x="${labelBoxX}" y="${labelBoxY}" width="${labelBoxWidth}" height="${labelBoxHeight}" rx="6" ry="6" fill="var(--label-box-fill)" stroke="var(--label-box-stroke)" stroke-width="0.8" filter="url(#labelBackdrop)" pointer-events="none" />`;
    inner += `<text class="nodeLabel" x="${node.x}" y="${labelCenterY}" text-anchor="middle" dominant-baseline="middle" font-size="${labelFontSize}" font-weight="700" fill="var(--label-text-fill)" stroke="var(--label-text-stroke)" stroke-width="var(--label-text-stroke-width)" paint-order="stroke" pointer-events="none">${escapeHtml(labelText)}</text>`;
    inner += `<circle class="graph-node-circle" data-id="${escapeHtml(node.id)}" cx="${node.x}" cy="${node.y}" r="${nodeRadius}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="2" />`;
    inner += node.raw ? '' : `<rect x="${node.x - 14}" y="${node.y - 10}" width="28" height="20" fill="${fillColor}" rx="4" ry="4" pointer-events="none" />`;
    inner += `<text class="nodeNumber" x="${node.x}" y="${node.y}" text-anchor="middle" font-size="13" font-weight="700" fill="var(--label-text-fill)" stroke="var(--label-text-stroke)" stroke-width="0.6" paint-order="stroke" pointer-events="none">${node.raw ? '' : Math.ceil(node.machines)}</text>`;

    if (showLeftAnchor) {
      const a = anchorLeftPos(node);
      inner += `<g class="anchor anchor-left" data-node="${escapeHtml(node.id)}" data-side="left" transform="translate(${a.x},${a.y})" tabindex="0" role="button" aria-label="Input anchor for ${escapeHtml(node.label)}"><circle class="anchor-hit" cx="0" cy="0" r="${ANCHOR_HIT_RADIUS}" fill="transparent" pointer-events="all" /><circle class="anchor-dot" cx="0" cy="0" r="${ANCHOR_RADIUS}" fill="var(--anchor-dot-fill)" stroke="var(--anchor-dot-stroke)" stroke-width="1.2" /></g>`;
    }
    if (showRightAnchor) {
      const a = anchorRightPos(node);
      inner += `<g class="anchor anchor-right" data-node="${escapeHtml(node.id)}" data-side="right" transform="translate(${a.x},${a.y})" tabindex="0" role="button" aria-label="Output anchor for ${escapeHtml(node.label)}"><circle class="anchor-hit" cx="0" cy="0" r="${ANCHOR_HIT_RADIUS}" fill="transparent" pointer-events="all" /><circle class="anchor-dot" cx="0" cy="0" r="${ANCHOR_RADIUS}" fill="var(--anchor-dot-fill)" stroke="var(--anchor-dot-stroke)" stroke-width="1.2" /></g>`;
    }

    inner += `</g>`;
  }

  for (const [depth, info] of needsOutputBypass.entries()) {
    inner += `<g class="bypass-dot bypass-output" data-depth="${depth}" transform="translate(${info.x},${info.y})" aria-hidden="false"><circle cx="0" cy="0" r="${ANCHOR_RADIUS}" fill="var(--bypass-fill)" stroke="var(--bypass-stroke)" stroke-width="1.2" /></g>`;
  }
  for (const [consumerDepth, pos] of needsInputBypass.entries()) {
    inner += `<g class="bypass-dot bypass-input" data-depth="${consumerDepth}" transform="translate(${pos.x},${pos.y})" aria-hidden="false"><circle cx="0" cy="0" r="${ANCHOR_RADIUS}" fill="var(--bypass-fill)" stroke="var(--bypass-stroke)" stroke-width="1.2" /></g>`;
  }

  const dark = !!(typeof isDarkMode === 'function' ? isDarkMode() : false);
  const initialVars = {
    '--line-color': dark ? '#dcdcdc' : '#444444',
    '--spine-color': dark ? '#bdbdbd' : '#666666',
    '--raw-edge-color': '#333333',
    '--label-box-fill': dark ? 'rgba(0,0,0,0.88)' : 'rgba(255,255,255,0.92)',
    '--label-box-stroke': dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
    '--label-text-fill': dark ? '#ffffff' : '#111111',
    '--label-text-stroke': dark ? '#000000' : '#ffffff',
    '--label-text-stroke-width': dark ? '1.0' : '0.6',
    '--anchor-dot-fill': dark ? '#ffffff' : '#2c3e50',
    '--anchor-dot-stroke': dark ? '#000000' : '#ffffff',
    '--bypass-fill': dark ? '#ffffff' : '#2c3e50',
    '--bypass-stroke': dark ? '#000000' : '#ffffff'
  };
  const wrapperStyle = Object.entries(initialVars).map(([k,v]) => `${k}:${v}`).join(';');

  const viewBoxX = Math.floor(contentX);
  const viewBoxY = Math.floor(contentY);
  const viewBoxW = Math.ceil(contentW);
  const viewBoxH = Math.ceil(contentH);

  const html = `<div class="graphWrapper" data-vb="${viewBoxX},${viewBoxY},${viewBoxW},${viewBoxH}" style="${wrapperStyle}"><div class="graphViewport"><svg xmlns="http://www.w3.org/2000/svg" class="graphSVG" viewBox="${viewBoxX} ${viewBoxY} ${viewBoxW} ${viewBoxH}" preserveAspectRatio="xMidYMid meet"><g id="zoomLayer">${inner}</g></svg></div></div>`;

  (function installThemeObserverOnce(){
    if (window._graphThemeObserverInstalled) return;
    window._graphThemeObserverInstalled = true;

    function computeVarsFromTheme() {
      const darkNow = !!(typeof isDarkMode === 'function' ? isDarkMode() : false);
      return {
        '--line-color': darkNow ? '#dcdcdc' : '#444444',
        '--spine-color': darkNow ? '#bdbdbd' : '#666666',
        '--raw-edge-color': '#333333',
        '--label-box-fill': darkNow ? 'rgba(0,0,0,0.88)' : 'rgba(255,255,255,0.92)',
        '--label-box-stroke': darkNow ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
        '--label-text-fill': darkNow ? '#ffffff' : '#111111',
        '--label-text-stroke': darkNow ? '#000000' : '#ffffff',
        '--label-text-stroke-width': darkNow ? '1.0' : '0.6',
        '--anchor-dot-fill': darkNow ? '#ffffff' : '#2c3e50',
        '--anchor-dot-stroke': darkNow ? '#000000' : '#ffffff',
        '--bypass-fill': darkNow ? '#ffffff' : '#2c3e50',
        '--bypass-stroke': darkNow ? '#000000' : '#ffffff'
      };
    }

    function updateAllGraphWrappers() {
      const vars = computeVarsFromTheme();
      const wrappers = document.querySelectorAll('.graphWrapper');
      wrappers.forEach(w => {
        for (const [k, v] of Object.entries(vars)) w.style.setProperty(k, v);
      });
    }

    const target = document.documentElement || document.body;
    try {
      const mo = new MutationObserver(mutations => {
        for (const m of mutations) {
          if (m.type === 'attributes' && (m.attributeName === 'class' || m.attributeName === 'data-theme' || m.attributeName === 'theme')) {
            updateAllGraphWrappers();
            return;
          }
        }
      });
      mo.observe(target, { attributes: true, attributeFilter: ['class','data-theme','theme'] });

      if (window.matchMedia) {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        if (typeof mq.addEventListener === 'function') mq.addEventListener('change', updateAllGraphWrappers);
        else if (typeof mq.addListener === 'function') mq.addListener(updateAllGraphWrappers);
      }

      window._updateGraphThemeVars = updateAllGraphWrappers;
    } catch (e) {
      window._updateGraphThemeVars = updateAllGraphWrappers;
    }
  })();

  return html;
}

/* ===============================
   Highlighting (strict immediate-only, toggle)
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

  const outgoing = Array.from(svg.querySelectorAll(`line.graph-edge[data-from="${CSS.escape(nodeId)}"]`));

  outgoing.forEach(edgeEl => {
    edgeEl.classList.add('pulse-edge');
    const toId = edgeEl.getAttribute('data-to');
    const targetCircle = svg.querySelector(`circle.graph-node-circle[data-id="${CSS.escape(toId)}"]`);
    if (targetCircle) targetCircle.classList.add('pulse-node');
  });
}

/* ===============================
   Pointer handling (centralized on wrapper)
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
   Zoom / pan utilities (pointer-based)
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
   Render table + graph
   =============================== */
function computeRailsNeeded(inputRates, railSpeed) {
  const total = Object.values(inputRates).reduce((sum, val) => sum + val, 0);
  return railSpeed && railSpeed > 0 ? Math.ceil(total / railSpeed) : "—";
}

function renderTable(chainObj, rootItem, rate) {
  const { chain, machineTotals, extractorTotals } = chainObj;
  const { nodes, links } = buildGraphData(chain, rootItem);
  const graphHTML = renderGraph(nodes, links, rootItem);

  const graphArea = document.getElementById("graphArea");
  if (!graphArea) return;

  const prevWrapper = graphArea.querySelector(".graphWrapper");
  if (prevWrapper && prevWrapper._teardownGraphZoom) {
    try { prevWrapper._teardownGraphZoom(); } catch (e) { /* ignore */ }
  }

  ensureResetButton();
  graphArea.innerHTML = graphHTML;
  const wrapper = graphArea.querySelector(".graphWrapper");
  const resetBtn = document.querySelector('#resetViewBtn');
  setupGraphZoom(wrapper, { autoFit: true, resetButtonEl: resetBtn });

  attachNodePointerHandlers(wrapper);

  const railSpeed = parseInt(document.getElementById("railSelect").value) || 0;

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

  const sortedTiers = Object.keys(tierGroups).map(Number).sort((a, b) => b - a);

  for (const tier of sortedTiers) {
    html += `<tr><td colspan="7"><strong>--- Level ${tier} ---</strong></td></tr>`;
    const rows = tierGroups[tier].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [item, data] of rows) {
      if (data.raw) continue;
      let outputPerMachine = "—";
      let machines = "—";
      let railsNeeded = "—";
      const fillColor = MACHINE_COLORS[data.building] || "#ecf0f1";
      const textColor = getTextColor(fillColor);
      if (!data.raw) {
        const recipe = getRecipe(item);
        if (recipe) outputPerMachine = Math.ceil((recipe.output * 60) / recipe.time);
        machines = Math.ceil(data.machines);
        railsNeeded = computeRailsNeeded(data.inputs, railSpeed);
      }
      const inputs = Object.entries(data.inputs || {}).map(([i, amt]) => `${i}: ${Math.ceil(amt)}/min`).join("<br>");
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

  html += `
    <h3>MACHINES REQUIRED (total)</h3>
    <table>
      <thead><tr><th>Machine Type</th><th>Count</th></tr></thead>
      <tbody>
        ${Object.entries(machineTotals).sort((a, b) => b[1] - a[1]).map(([type, count]) => `
          <tr><td>${type}</td><td>${Math.ceil(count)}</td></tr>
        `).join("")}
      </tbody>
    </table>
  `;

  html += `
    <h3>EXTRACTION REQUIRED</h3>
    <table>
      <thead>
        <tr><th>Resource</th><th>Impure</th><th>Normal</th><th>Pure</th><th>Qty/min</th></tr>
      </thead>
      <tbody>
  `;

  const sortedExtractors = Object.entries(extractorTotals).filter(([_, qty]) => qty > 0).sort((a, b) => b[1] - a[1]);
  for (const [resource, qty] of sortedExtractors) {
    const rounded = Math.ceil(qty);
    if (SPECIAL_EXTRACTORS[resource]) {
      const normal = Math.ceil(rounded / SPECIAL_EXTRACTORS[resource]);
      html += `<tr><td>${resource}</td><td>—</td><td>${normal}</td><td>—</td><td>${rounded}</td></tr>`;
    } else {
      const impure = Math.ceil(rounded / 60);
      const normal = Math.ceil(rounded / 120);
      const pure = Math.ceil(rounded / 240);
      html += `<tr><td>${resource}</td><td>${impure}</td><td>${normal}</td><td>${pure}</td><td>${rounded}</td></tr>`;
    }
  }

  html += `</tbody></table>`;
  const out = document.getElementById("outputArea");
  if (out) out.innerHTML = html;
}

/* ===============================
   Run calculator & UI wiring
   =============================== */
function runCalculator() {
  const item = document.getElementById('itemSelect').value;
  const rateRaw = document.getElementById('rateInput').value;
  const rate = parseFloat(rateRaw);

  if (!item || isNaN(rate) || rate <= 0) {
    document.getElementById("outputArea").innerHTML = "<p style='color:red;'>Please select an item and enter a valid rate.</p>";
    return;
  }

  const chainObj = expandChain(item, rate);
  renderTable(chainObj, item, rate);

  const rail = document.getElementById("railSelect").value;
  const params = new URLSearchParams({ item, rate, rail });
  history.replaceState(null, "", "?" + params.toString());
}

/* ===============================
   Initialization
   - init() is the single canonical initializer
   =============================== */
async function init() {
  if (window._initHasRun) return;
  window._initHasRun = true;

  setupDarkMode();

  // Load data (data-only)
  await loadRecipes();

  // Ensure RECIPES/TIERS are available
  RECIPES = RECIPES || {};
  TIERS = TIERS || {};
  TIERS[BBM_ID] = TIERS[BBM_ID] ?? 0;

  // UI elements
  const itemSelect = document.getElementById('itemSelect');
  const rateInput = document.getElementById("rateInput");
  const railSelect = document.getElementById("railSelect");

  // Populate rail select
  if (railSelect) railSelect.innerHTML = `
    <option value="120">v1 (120/min)</option>
    <option value="240">v2 (240/min)</option>
    <option value="480">v3 (480/min)</option>
  `;

  // Reset rate input
  if (rateInput) { rateInput.value = ""; rateInput.dataset.manual = ""; rateInput.placeholder = "Rate (/min)"; }

  // Populate item select with placeholder + filtered items
  if (itemSelect) {
    const items = Object.keys(RECIPES || {}).filter(k => typeof k === 'string' && !k.startsWith('_')).sort((a,b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    // Build options preserving placeholder
    itemSelect.innerHTML = `<option value="" disabled selected>Select Item Here</option>` +
      items.map(it => `<option value="${escapeHtml(it)}">${escapeHtml(it)}</option>`).join("");
  }

  // Helper: compute natural/base rate for the currently selected item
  function getNaturalPerMinForSelected() {
    const slug = itemSelect?.value;
    const recipe = RECIPES[slug];
    if (!recipe || !recipe.output || !recipe.time) return null;
    return Math.round((recipe.output / recipe.time) * 60);
  }

  // Rate input behavior
  if (itemSelect && rateInput) {
    itemSelect.addEventListener("change", () => {
      const naturalPerMin = getNaturalPerMinForSelected();
      if (!rateInput.dataset.manual) {
        rateInput.value = naturalPerMin !== null ? naturalPerMin : "";
      }
      if (rateInput.value.trim() === "") {
        rateInput.dataset.manual = "";
        rateInput.value = naturalPerMin !== null ? naturalPerMin : "";
      }
    });

    rateInput.addEventListener("input", () => {
      const rawVal = rateInput.value;
      if (rawVal.trim() === "") return;
      const numeric = Number(rawVal);
      if (!Number.isNaN(numeric)) rateInput.dataset.manual = "true";
    });

    rateInput.addEventListener("blur", () => {
      if (rateInput.value.trim() === "") {
        rateInput.dataset.manual = "";
        const naturalPerMin = getNaturalPerMinForSelected();
        rateInput.value = naturalPerMin !== null ? naturalPerMin : "";
      } else {
        rateInput.dataset.manual = "true";
      }
    });

    rateInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        if (rateInput.value.trim() === "") {
          rateInput.dataset.manual = "";
          const naturalPerMin = getNaturalPerMinForSelected();
          rateInput.value = naturalPerMin !== null ? naturalPerMin : "";
        } else {
          rateInput.dataset.manual = "true";
        }
      } else if (e.key === "Escape") {
        rateInput.dataset.manual = "";
        const naturalPerMin = getNaturalPerMinForSelected();
        rateInput.value = naturalPerMin !== null ? naturalPerMin : "";
        rateInput.focus();
      }
    });
  }

  // Read shared params from URL and apply safely (guard internal keys)
  const params = new URLSearchParams(window.location.search);
  const sharedItem = params.get("item");
  const sharedRate = params.get("rate");
  const sharedRail = params.get("rail");

  if (sharedItem && itemSelect && !sharedItem.startsWith('_')) {
    // Only set if the option exists; otherwise leave placeholder
    const opt = Array.from(itemSelect.options).find(o => o.value === sharedItem);
    if (opt) itemSelect.value = sharedItem;
  }
  if (sharedRate && rateInput) { rateInput.value = sharedRate; rateInput.dataset.manual = "true"; }
  if (sharedRail && railSelect) railSelect.value = sharedRail;
  if (sharedItem && sharedRate && !sharedItem.startsWith('_')) runCalculator();

  // Buttons wiring
  const calcButton = document.getElementById("calcButton");
  if (calcButton) calcButton.addEventListener("click", () => {
    runCalculator();
    const item = itemSelect?.value || "";
    const rate = rateInput?.value || "";
    const rail = railSelect?.value || "";
    const newParams = new URLSearchParams({ item, rate, rail });
    history.replaceState(null, "", "?" + newParams.toString());
  });

  const clearBtn = document.getElementById("clearStateBtn");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (rateInput) rateInput.dataset.manual = "";
      const base = window.location.origin;
      if (base.includes("localhost")) { window.location.href = "http://localhost:8000"; return; }
      window.location.href = "https://srcraftingcalculations.github.io/sr-crafting-calculator/";
    });
  }

  const shareButton = document.getElementById("shareButton");
  if (shareButton) {
    shareButton.addEventListener("click", () => {
      const url = window.location.href;
      navigator.clipboard.writeText(url).then(() => showToast("Shareable link copied!")).catch(() => {
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

  // Safety net: remove any internal-key options that somehow appeared (non-invasive)
  if (itemSelect) {
    Array.from(itemSelect.options).forEach(o => { if (o.value && o.value.startsWith('_')) o.remove(); });
    // Ensure placeholder remains selected if nothing else selected
    if (!itemSelect.value) itemSelect.value = "";
  }
}

/* ===============================
   Expose reloadRecipes for runtime refresh
   =============================== */
async function reloadRecipes() {
  RECIPES = {};
  TIERS = {};
  await loadRecipes();
  // Re-populate select if present
  const itemSelect = document.getElementById('itemSelect');
  if (itemSelect) {
    const items = Object.keys(RECIPES || {}).filter(k => typeof k === 'string' && !k.startsWith('_')).sort((a,b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const prev = itemSelect.value;
    itemSelect.innerHTML = `<option value="" disabled>Select Item Here</option>` +
      items.map(it => `<option value="${escapeHtml(it)}">${escapeHtml(it)}</option>`).join("");
    if (prev && items.includes(prev)) itemSelect.value = prev;
  }

  if (window._lastSelectedItem) {
    const rate = window._lastSelectedRate || 60;
    const { chain } = expandChain(window._lastSelectedItem, rate);
    const graph = buildGraphData(chain, window._lastSelectedItem);
    document.getElementById('graphArea').innerHTML = renderGraph(graph.nodes, graph.links, window._lastSelectedItem);
    attachNodePointerHandlers(document.querySelector('.graphWrapper'));
  }
}

/* ===============================
   Boot
   - Only call init() here; do not call loadRecipes() elsewhere
   =============================== */
init().catch(err => console.error("init error:", err));
