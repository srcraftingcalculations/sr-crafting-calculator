// app.js — Complete script (integrated fixes, preserves recipes.json loader, theme wiring, full renderGraph, UI wiring)
// - Restores local/remote recipes.json loader
// - Theme helpers + automatic graph CSS var updates
// - renderGraph uses CSS variables and centers labels in a blurred backdrop
// - Anchors: raw materials off far-left get right-only helper; helper dots connect to nodes
// - Click a node to highlight immediate inputs (toggle); panning-safe click threshold
// - Minimal pan/zoom and keyboard accessibility for nodes
// - Exposes window._updateGraphThemeVars() and reloadRecipes() for dev convenience

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

/* ===============================
   Theme helpers and dark-mode wiring
   =============================== */
function isDarkMode() {
  if (document.documentElement.classList.contains('dark') || document.body.classList.contains('dark')) return true;
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
    return;
  }

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

document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('darkModeToggle');
  const dark = isDarkMode();
  applyThemeClass(dark);
  if (toggle) toggle.textContent = dark ? '☀️ Light Mode' : '🌙 Dark Mode';

  if (!toggle) return;
  toggle.addEventListener('click', () => {
    const nowDark = !document.documentElement.classList.contains('dark');
    applyThemeClass(nowDark);
    toggle.textContent = nowDark ? '☀️ Light Mode' : '🌙 Dark Mode';
  });
});

/* Install observer once to update wrappers when theme toggles elsewhere */
(function installThemeObserverOnce() {
  if (window._graphThemeObserverInstalled) return;
  window._graphThemeObserverInstalled = true;

  function computeVarsFromTheme() {
    const darkNow = isDarkMode();
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
    mo.observe(target, { attributes: true, attributeFilter: ['class', 'data-theme', 'theme'] });

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
   Data loading & recipe helpers (restored)
   =============================== */
let RECIPES = {};
let TIERS = {};

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
      return;
    }
  }

  if (!data || typeof data !== "object") {
    console.error("Invalid recipe data format");
    return;
  }

  RECIPES = data;

  TIERS = {};
  for (const [name, recipe] of Object.entries(RECIPES)) {
    if (typeof recipe.tier === "number") {
      TIERS[name] = recipe.tier;
      continue;
    }
    TIERS[name] = 0;
  }

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

  const select = document.getElementById("itemSelect");
  if (select) {
    const items = Object.keys(RECIPES).sort((a,b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const prev = select.value;
    select.innerHTML = items.map(it => `<option value="${escapeHtml(it)}">${escapeHtml(it)}</option>`).join("");
    if (prev && items.includes(prev)) select.value = prev;
  }

  window.RECIPES = RECIPES;
  window.TIERS = TIERS;
  console.info("Recipes loaded:", Object.keys(RECIPES).length, "items");
  return RECIPES;
}

async function reloadRecipes() {
  RECIPES = {};
  TIERS = {};
  await loadRecipes();
  if (window._lastSelectedItem) {
    const rate = window._lastSelectedRate || 60;
    const { chain } = expandChain(window._lastSelectedItem, rate);
    const graph = buildGraphData(chain, window._lastSelectedItem);
    document.getElementById('graphArea').innerHTML = renderGraph(graph.nodes, graph.links, window._lastSelectedItem);
    attachGraphInteractions();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadRecipes().catch(err => console.error("loadRecipes error:", err));
});

/* ===============================
   Expand production chain & graph data
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
      if (nodeMap.has(input)) links.push({ from: item, to: input });
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
   renderGraph (full)
   - Uses CSS variables for colors and label box
   - Connects visible helper dots to their node via short lines
   - Implements rule: any raw material listed in any column except far-left gets right helper only
   =============================== */
function renderGraph(nodes, links, rootItem) {
  const nodeRadius = 22;
  const ANCHOR_RADIUS = 5;
  const ANCHOR_HIT_RADIUS = 12;
  const ANCHOR_OFFSET = 18;
  const BBM_ID = 'Basic Building Material';

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
      node.x = roundCoord(Number(depth) * MACHINE_COL_WIDTH + 100);
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

  // decide anchors (raw nodes not in far-left => right-only)
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

  // build spines
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
      spineSvg += `<line class="graph-spine-vertical" x1="${spineX}" y1="${bottomAnchorY}" x2="${spineX}" y2="${topAnchorY}" stroke="var(--spine-color)" stroke-width="2" stroke-linecap="round" opacity="0.95" />`;
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
          spineSvg += `<line class="graph-spine-horizontal" x1="${spineX}" y1="${topAnchorY}" x2="${nextSpineX}" y2="${topAnchorY}" stroke="var(--spine-color)" stroke-width="2" stroke-linecap="round" opacity="0.95" />`;
          spineSvg += `<line class="graph-spine-horizontal" x1="${nextSpineX}" y1="${topAnchorY}" x2="${nextSpineX}" y2="${topInY}" stroke="var(--spine-color)" stroke-width="2" stroke-linecap="round" opacity="0.95" />`;
          spineSvg += `<line class="graph-spine-vertical" x1="${nextSpineX}" y1="${topInY}" x2="${nextSpineX}" y2="${Math.max(...nextInputs.map(p=>p.y))}" stroke="var(--spine-color)" stroke-width="2" stroke-linecap="round" opacity="0.95" />`;
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

  // raw->smelter edges
  for (const link of links) {
    const rawSource = nodeById.get(link.to);
    const consumer = nodeById.get(link.from);
    if (!rawSource || !consumer) continue;
    const consumerIsBBM = (consumer.id === BBM_ID || consumer.label === BBM_ID);
    if (rawSource.raw && rawSource.depth === minDepth && (consumer.building === 'Smelter' || consumerIsBBM)) {
      inner += `<line class="graph-edge graph-edge-raw" data-from="${escapeHtml(rawSource.id)}" data-to="${escapeHtml(consumer.id)}" x1="${rawSource.x}" y1="${rawSource.y}" x2="${consumer.x}" y2="${consumer.y}" stroke="var(--raw-edge-color)" stroke-width="2.6" stroke-linecap="round" />`;
    }
  }

  // bypass connectors
  for (const [depth, info] of needsOutputBypass.entries()) {
    inner += `<line class="bypass-to-spine bypass-output-connector" data-depth="${depth}" x1="${info.x}" y1="${info.y}" x2="${info.x}" y2="${info.helperCenter.y}" stroke="var(--line-color)" stroke-width="1.4" stroke-linecap="butt" opacity="0.95" />`;
  }
  for (const [consumerDepth, pos] of needsInputBypass.entries()) {
    inner += `<line class="bypass-to-spine bypass-input-connector" data-depth="${consumerDepth}" x1="${pos.x}" y1="${pos.helperCenter.y}" x2="${pos.x}" y2="${pos.y}" stroke="var(--line-color)" stroke-width="1.4" stroke-linecap="butt" opacity="0.95" />`;
  }
  for (const [outDepth, outInfo] of needsOutputBypass.entries()) {
    for (const consumerDepth of outInfo.causingConsumers) {
      const inPos = needsInputBypass.get(consumerDepth);
      if (!inPos) continue;
      inner += `<line class="bypass-connector" data-from-depth="${outDepth}" data-to-depth="${consumerDepth}" x1="${outInfo.x}" y1="${outInfo.y}" x2="${inPos.x}" y2="${inPos.y}" stroke="var(--line-color)" stroke-width="1.6" stroke-linecap="round" opacity="0.95" />`;
    }
  }

  // node->anchor short connectors
  for (const node of nodes) {
    const hideAllAnchors = (node.raw && node.depth === minDepth);
    const isSmelter = (node.building === 'Smelter');
    const isBBM = (node.id === BBM_ID || node.label === BBM_ID);
    const rawRightOnly = !!(node.raw && node.depth !== minDepth);
    const showLeftAnchor = !hideAllAnchors && !rawRightOnly && node.hasInputAnchor && !isSmelter && !isBBM;
    const showRightAnchor = !hideAllAnchors && (node.hasOutputAnchor || rawRightOnly || isBBM) && (node.depth !== maxDepth);

    if (showLeftAnchor) {
      const a = anchorLeftPos(node);
      inner += `<line class="node-to-anchor node-to-left" data-node="${escapeHtml(node.id)}" x1="${roundCoord(node.x - nodeRadius)}" y1="${node.y}" x2="${a.x}" y2="${a.y}" stroke="var(--line-color)" stroke-width="1.4" stroke-linecap="butt" opacity="0.95" />`;
    }
    if (showRightAnchor) {
      const a = anchorRightPos(node);
      inner += `<line class="node-to-anchor node-to-right" data-node="${escapeHtml(node.id)}" x1="${roundCoord(node.x + nodeRadius)}" y1="${node.y}" x2="${a.x}" y2="${a.y}" stroke="var(--line-color)" stroke-width="1.4" stroke-linecap="butt" opacity="0.95" />`;
    }
  }

  // nodes, labels, anchors
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

  // bypass dots
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

  // install observer once to update CSS vars on theme change
  (function installThemeObserverOnceLocal(){
    if (window._graphThemeObserverInstalledLocal) return;
    window._graphThemeObserverInstalledLocal = true;

    function computeVarsFromThemeLocal() {
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

    function updateAllGraphWrappersLocal() {
      const vars = computeVarsFromThemeLocal();
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
            updateAllGraphWrappersLocal();
            return;
          }
        }
      });
      mo.observe(target, { attributes: true, attributeFilter: ['class', 'data-theme', 'theme'] });

      if (window.matchMedia) {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        if (typeof mq.addEventListener === 'function') mq.addEventListener('change', updateAllGraphWrappersLocal);
        else if (typeof mq.addListener === 'function') mq.addListener(updateAllGraphWrappersLocal);
      }

      window._updateGraphThemeVars = updateAllGraphWrappersLocal;
    } catch (e) {
      window._updateGraphThemeVars = updateAllGraphWrappersLocal;
    }
  })();

  return html;
}

/* ===============================
   Graph interaction helpers
   - attachGraphInteractions() should be called after inserting renderGraph output into DOM
   - click a node to highlight its immediate inputs (toggle)
   - short drag threshold prevents accidental activation while panning
   =============================== */
function attachGraphInteractions() {
  const graphArea = document.getElementById('graphArea');
  if (!graphArea) return;

  // remove previous listeners by cloning
  const newGraphArea = graphArea.cloneNode(true);
  graphArea.parentNode.replaceChild(newGraphArea, graphArea);

  // attach click handlers to nodes
  const wrappers = document.querySelectorAll('.graphWrapper');
  wrappers.forEach(wrapper => {
    const svg = wrapper.querySelector('svg.graphSVG');
    if (!svg) return;

    // click/touch handling with drag threshold
    let pointerDown = null;
    svg.addEventListener('pointerdown', (ev) => {
      pointerDown = { x: ev.clientX, y: ev.clientY, time: Date.now() };
    }, { passive: true });

    svg.addEventListener('pointerup', (ev) => {
      if (!pointerDown) return;
      const dx = Math.abs(ev.clientX - pointerDown.x);
      const dy = Math.abs(ev.clientY - pointerDown.y);
      const moved = Math.sqrt(dx*dx + dy*dy);
      pointerDown = null;
      if (moved > DRAG_THRESHOLD_PX) return; // treat as pan, not click

      // find nearest graph-node group ancestor
      let target = ev.target;
      while (target && !target.classList?.contains('graph-node')) target = target.parentNode;
      if (!target) return;

      const nodeId = target.getAttribute('data-id');
      if (!nodeId) return;
      toggleHighlightNode(nodeId, wrapper);
    });

    // keyboard accessibility: Enter/Space on focused .graph-node toggles highlight
    const nodes = svg.querySelectorAll('.graph-node');
    nodes.forEach(n => {
      n.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const id = n.getAttribute('data-id');
          if (id) toggleHighlightNode(id, wrapper);
        }
      });
    });
  });

  // helper: toggle highlight for a node within a wrapper
  function toggleHighlightNode(nodeId, wrapper) {
    const svg = wrapper.querySelector('svg.graphSVG');
    if (!svg) return;
    const allNodes = Array.from(svg.querySelectorAll('.graph-node'));
    const allCircles = Array.from(svg.querySelectorAll('.graph-node-circle'));
    const allLines = Array.from(svg.querySelectorAll('line'));

    // clear any existing pulses if same node clicked
    const active = svg.querySelector('.graph-node.active');
    if (active && active.getAttribute('data-id') === nodeId) {
      // clear
      svg.querySelectorAll('.pulse-origin, .pulse-node, .pulse-edge').forEach(el => {
        el.classList.remove('pulse-origin','pulse-node','pulse-edge');
      });
      svg.querySelectorAll('.graph-node').forEach(g => g.classList.remove('active'));
      return;
    }

    // clear previous
    svg.querySelectorAll('.pulse-origin, .pulse-node, .pulse-edge').forEach(el => {
      el.classList.remove('pulse-origin','pulse-node','pulse-edge');
    });
    svg.querySelectorAll('.graph-node').forEach(g => g.classList.remove('active'));

    // mark origin node
    const originGroup = svg.querySelector(`.graph-node[data-id="${CSS.escape(nodeId)}"]`);
    if (!originGroup) return;
    originGroup.classList.add('active');

    const originCircle = originGroup.querySelector('.graph-node-circle');
    if (originCircle) originCircle.classList.add('pulse-origin');

    // highlight immediate input nodes and connecting edges
    // find links where from = consumer and to = input; our renderGraph used data attributes on lines for raw edges only,
    // but we can infer by proximity: lines with data-from/data-to attributes exist for raw edges; for bypass connectors we used data attributes too.
    // Simpler: highlight nodes that are inputs in the chain by checking rendered positions: find nodes whose x is less than origin.x and that are connected via links array (if available)
    // We'll use window._graphNodes and window._needsInputBypass/_needsOutputBypass to find connections if present.

    // Build quick adjacency from DOM lines that have data-from/data-to
    const inputIds = new Set();
    const lines = Array.from(svg.querySelectorAll('line[data-from][data-to]'));
    lines.forEach(l => {
      const from = l.getAttribute('data-from');
      const to = l.getAttribute('data-to');
      if (from === nodeId && to) inputIds.add(to);
      if (to === nodeId && from) inputIds.add(from);
    });

    // Also consider bypass connectors that have data-from-depth/data-to-depth (we'll not resolve those to ids here)
    // Fallback: highlight nodes that are immediate inputs by checking the original graph data if available
    if (inputIds.size === 0 && window._graphNodes) {
      // find node in _graphNodes
      const node = window._graphNodes.find(n => n.id === nodeId);
      if (node && node.inputs) {
        for (const k of Object.keys(node.inputs || {})) inputIds.add(k);
      }
    }

    // apply pulses to input nodes and edges that connect them
    inputIds.forEach(id => {
      const g = svg.querySelector(`.graph-node[data-id="${CSS.escape(id)}"]`);
      if (g) {
        const c = g.querySelector('.graph-node-circle');
        if (c) c.classList.add('pulse-node');
        g.classList.add('active');
      }
      // highlight any line that connects origin to this input (if present)
      const connecting = svg.querySelectorAll(`line[data-from="${CSS.escape(nodeId)}"][data-to="${CSS.escape(id)}"], line[data-from="${CSS.escape(id)}"][data-to="${CSS.escape(nodeId)}"]`);
      connecting.forEach(l => l.classList.add('pulse-edge'));
    });
  }
}

/* ===============================
   UI wiring: Calculate button, Clear, Share (minimal)
   =============================== */
document.addEventListener('DOMContentLoaded', () => {
  const calcBtn = document.getElementById('calcButton');
  const clearBtn = document.getElementById('clearStateBtn');
  const shareBtn = document.getElementById('shareButton');
  const itemSelect = document.getElementById('itemSelect');
  const rateInput = document.getElementById('rateInput');
  const graphArea = document.getElementById('graphArea');

  if (calcBtn) {
    calcBtn.addEventListener('click', () => {
      const item = itemSelect?.value;
      const rate = Number(rateInput?.value || 60);
      if (!item) {
        showToast('Please select an item first.');
        return;
      }
      window._lastSelectedItem = item;
      window._lastSelectedRate = rate;
      const { chain } = expandChain(item, rate);
      const graph = buildGraphData(chain, item);
      graphArea.innerHTML = renderGraph(graph.nodes, graph.links, item);
      attachGraphInteractions();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      window._lastSelectedItem = null;
      window._lastSelectedRate = null;
      document.getElementById('outputArea').innerHTML = '';
      document.getElementById('graphArea').innerHTML = '';
    });
  }

  if (shareBtn) {
    shareBtn.addEventListener('click', () => {
      const item = itemSelect?.value;
      const rate = Number(rateInput?.value || 60);
      if (!item) { showToast('Select an item to share'); return; }
      const params = new URLSearchParams({ item, rate: String(rate) });
      const url = `${location.origin}${location.pathname}?${params.toString()}`;
      navigator.clipboard?.writeText(url).then(() => showToast('Share link copied to clipboard'), () => showToast('Could not copy link'));
    });
  }

  // If URL contains params, auto-populate and calculate
  (function applyUrlParams() {
    try {
      const params = new URLSearchParams(location.search);
      const item = params.get('item');
      const rate = params.get('rate');
      if (item && itemSelect) itemSelect.value = item;
      if (rate && rateInput) rateInput.value = rate;
      if (item) {
        // auto-calc after a short delay to allow recipes to load
        setTimeout(() => { if (calcBtn) calcBtn.click(); }, 300);
      }
    } catch (e) { /* ignore */ }
  })();
});

/* ===============================
   Small toast helper (reused)
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
   End of app.js
   - If you want the recipes embedded directly into this file (no external fetch), I can paste them in on request.
   - Otherwise keep data/recipes.json in the data/ folder for offline use.
   =============================== */
