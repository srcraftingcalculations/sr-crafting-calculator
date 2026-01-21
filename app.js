// app.js - Rewritten, complete file (pulse mechanics removed)
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
  const MAX_PASSES = 6;

  // Helper: initialize base depths from TIERS (no +1)
  function initBaseDepths() {
    for (const item of Object.keys(chain || {})) {
      const tableLevel = Number(TIERS?.[item] ?? 0);
      depths[item] = Number.isFinite(tableLevel) ? Math.floor(tableLevel) : 0;
    }

    // Raw defaults
    for (const item of Object.keys(chain || {})) {
      if (chain[item].raw) {
        if (FORCED_RAW_ORES.includes(item)) depths[item] = 0;
        else if (!(item in TIERS)) depths[item] = 0;
      }
    }

    // Heuristic: items whose inputs are all raw -> depth 0
    for (const [item, data] of Object.entries(chain || {})) {
      const inputs = data.inputs || {};
      const inputNames = Object.keys(inputs);
      if (inputNames.length > 0) {
        const allInputsRaw = inputNames.every(inName => {
          const inNode = chain[inName];
          return !!(inNode && inNode.raw);
        });
        if (allInputsRaw) depths[item] = 0;
      }
    }

    // Normalize
    for (const k of Object.keys(depths)) {
      let v = Number(depths[k]);
      if (!Number.isFinite(v) || isNaN(v)) v = 0;
      depths[k] = Math.max(0, Math.floor(v));
    }
  }

  // Helper: compute earliest consumer depth for a given raw name
  function earliestConsumerDepth(rawName) {
    let min = Infinity;
    for (const [consumerName, consumerData] of Object.entries(chain || {})) {
      const inputs = consumerData.inputs || {};
      if (Object.prototype.hasOwnProperty.call(inputs, rawName)) {
        const d = Number(depths[consumerName] ?? (Number(TIERS?.[consumerName] ?? 0)));
        if (Number.isFinite(d) && d < min) min = d;
      }
    }
    return min;
  }

  // Start with base depths
  initBaseDepths();

  // Iteratively apply raw-placement and optional shifting until stable or max passes
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const prev = {};
    for (const k of Object.keys(depths)) prev[k] = depths[k];

    // 1) Place LEFT_OF_CONSUMER_RAWS one column left of earliest consumer (if any)
    for (const rawName of LEFT_OF_CONSUMER_RAWS) {
      if (!(rawName in chain)) continue;
      const minConsumer = earliestConsumerDepth(rawName);
      if (minConsumer === Infinity) {
        // no consumer in this chain — keep existing or default 0
        depths[rawName] = Math.max(0, depths[rawName] ?? 0);
      } else {
        // place raw immediately left of earliest consumer
        const target = Math.max(0, Math.floor(minConsumer) - 1);
        depths[rawName] = target;
      }
    }

    // 2) For any raw that exists only because it's an input (i.e., present but not a table item),
    //    ensure it sits immediately left of its earliest consumer as well.
    for (const item of Object.keys(chain || {})) {
      if (!chain[item].raw) continue;
      // If this raw has consumers, place it left of earliest consumer
      const minConsumer = earliestConsumerDepth(item);
      if (minConsumer !== Infinity) {
        depths[item] = Math.max(0, Math.floor(minConsumer) - 1);
      } else {
        // otherwise keep current/default
        depths[item] = Math.max(0, depths[item] ?? 0);
      }
    }

    // 3) Normalize before deciding shift
    for (const k of Object.keys(depths)) {
      let v = Number(depths[k]);
      if (!Number.isFinite(v) || isNaN(v)) v = 0;
      depths[k] = Math.max(0, Math.floor(v));
    }

    // 4) If any raw is at depth 0, enforce raw-left rule: set all raws to 0 and shift non-raw +1
    const rawItems = Object.keys(chain || {}).filter(i => chain[i] && chain[i].raw);
    const anyRawAtZero = rawItems.length > 0 && rawItems.some(r => depths[r] === 0);
    if (anyRawAtZero) {
      for (const r of rawItems) depths[r] = 0;
      for (const k of Object.keys(depths)) {
        if (!(chain[k] && chain[k].raw)) depths[k] = Math.max(0, Math.floor(depths[k]) + 1);
      }
    }

    // 5) Final normalization for this pass
    for (const k of Object.keys(depths)) {
      let v = Number(depths[k]);
      if (!Number.isFinite(v) || isNaN(v)) v = 0;
      depths[k] = Math.max(0, Math.floor(v));
    }

    // 6) If stable, break early
    let stable = true;
    for (const k of Object.keys(depths)) {
      if (prev[k] !== depths[k]) { stable = false; break; }
    }
    if (stable) break;
  }

  // Final clamp and return
  for (const k of Object.keys(depths)) {
    let v = Number(depths[k]);
    if (!Number.isFinite(v) || isNaN(v)) v = 0;
    depths[k] = Math.max(0, Math.floor(v));
  }

  return depths;
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
    const bbox = getContentBBox();           // SVG coords
    const view = getViewSizeInSvgCoords();   // SVG coords

    // Fixed visible buffer (independent of zoom)
    const buffer = Math.max(12, Math.min(view.width, view.height) * 0.04);

    // Compute min/max allowed translation in SVG coords
    const minTx = buffer - (bbox.x + bbox.width) * proposedScale;
    const maxTx = view.width - buffer - bbox.x * proposedScale;

    const minTy = buffer - (bbox.y + bbox.height) * proposedScale;
    const maxTy = view.height - buffer - bbox.y * proposedScale;

    return {
      tx: Math.min(maxTx, Math.max(minTx, proposedTx)),
      ty: Math.min(maxTy, Math.max(minTy, proposedTy))
    };
  }

  function applyTransform() {
    const clamped = clampTranslation(tx, ty, scale);
    tx = clamped.tx;
    ty = clamped.ty;
    zoomLayer.setAttribute('transform', `scale(${scale}) translate(${tx},${ty})`);
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

// Build graph nodes and logical links from the expanded chain
function buildGraphData(chain, rootItem) {
  const nodes = [];
  const links = [];
  const nodeMap = new Map();

  // Create node objects for every item in the chain
  for (const [item, data] of Object.entries(chain || {})) {
    const node = {
      id: item,
      label: item,
      raw: !!data.raw,
      building: data.building || null,
      machines: data.machines || 0,
      inputs: Object.assign({}, data.inputs || {})
    };
    nodes.push(node);
    nodeMap.set(item, node);
  }

  // Create logical links: consumer -> input
  for (const [consumer, data] of Object.entries(chain || {})) {
    const inputs = data.inputs || {};
    for (const inputName of Object.keys(inputs)) {
      // Only add links when both ends exist in the node set
      if (nodeMap.has(consumer) && nodeMap.has(inputName)) {
        links.push({ from: consumer, to: inputName });
      }
    }
  }

  // Compute depths (columns) using existing tier logic
  const depths = typeof computeDepthsFromTiers === 'function'
    ? computeDepthsFromTiers(chain, rootItem || null)
    : {};

  // Attach depth to nodes (default to 0)
  for (const n of nodes) {
    n.depth = Number.isFinite(Number(depths[n.id])) ? Number(depths[n.id]) : 0;
  }

  return { nodes, links };
}

// Updated renderGraph: draws direct center→center lines for raw→consumer links,
// and also handles the common case where the link is reversed in the data
// (consumer -> raw) by flipping it so a visible raw->consumer center line is emitted.
// Also ensures no left helper/anchor is created for raw nodes in the far-left column.
function renderGraph(nodes, links, rootItem) {
  const nodeRadius = 22;
  const ANCHOR_RADIUS = 5;
  const ANCHOR_OFFSET = 18;

  const ARROW_HALF_WIDTH = 5;
  const ARROW_HEIGHT = 8;
  const ARROW_CENTER_ADJUST = ARROW_HEIGHT / 3;
  const ARROW_GAP_FROM_LABEL = 6;
  const UP_ARROW_EXTRA_LIFT = 4;

  const H_ARROW_HALF_HEIGHT = 5;
  const H_ARROW_WIDTH = 8;

  const LABEL_OFFSET = 6;

  function roundCoord(v) { return Math.round(v * 100) / 100; }

  function anchorRightPos(node) {
    return {
      x: roundCoord(node.x + nodeRadius + ANCHOR_OFFSET),
      y: roundCoord(node.y)
    };
  }

  function anchorLeftPos(node) {
    return {
      x: roundCoord(node.x - nodeRadius - ANCHOR_OFFSET),
      y: roundCoord(node.y)
    };
  }

  // ---------------------------------
  // Defaults
  // ---------------------------------
  for (const n of nodes) {
    if (typeof n.hasInputAnchor === 'undefined') n.hasInputAnchor = true;
    if (typeof n.hasOutputAnchor === 'undefined') n.hasOutputAnchor = true;
    if (typeof n.depth === 'undefined') n.depth = 0;
    if (typeof n.machines === 'undefined') n.machines = 0;
  }

  // ---------------------------------
  // Normalize depths
  // ---------------------------------
  const uniqueDepths = [...new Set(nodes.map(n => Number(n.depth) || 0))].sort((a,b)=>a-b);
  const depthMap = new Map(uniqueDepths.map((d,i)=>[d,i]));
  nodes.forEach(n => n.depth = depthMap.get(Number(n.depth)) ?? 0);

  const columns = {};
  for (const n of nodes) {
    if (!columns[n.depth]) columns[n.depth] = [];
    columns[n.depth].push(n);
  }

  const depthsSorted = Object.keys(columns).map(Number).sort((a,b)=>a-b);
  const depthIndex = new Map(depthsSorted.map((d,i)=>[d,i]));

  for (const [depth, colNodes] of Object.entries(columns)) {
    const idx = depthIndex.get(Number(depth)) ?? 0;
    colNodes.sort((a,b)=>String(a.label||a.id).localeCompare(String(b.label||b.id)));
    colNodes.forEach((node,i)=>{
      node.x = roundCoord(idx * MACHINE_COL_WIDTH + 100);
      node.y = roundCoord(i * GRAPH_ROW_HEIGHT + 100);
    });
  }

  // ---------------------------------
  // ViewBox
  // ---------------------------------
  const xs = nodes.map(n=>n.x), ys = nodes.map(n=>n.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);

  const contentX = minX - nodeRadius - GRAPH_CONTENT_PAD;
  const contentY = minY - nodeRadius - GRAPH_CONTENT_PAD;
  const contentW = (maxX - minX) + nodeRadius*2 + GRAPH_CONTENT_PAD*2;
  const contentH = (maxY - minY) + nodeRadius*2 + GRAPH_CONTENT_PAD*2;

  const defaultLineColor = isDarkMode() ? '#dcdcdc' : '#444';

  let inner = '';

  // ---------------------------------
  // Helper anchors
  // ---------------------------------
  const rightHelpers = [];
  const leftHelpers = [];

  for (const node of nodes) {
    const minDepth = Math.min(...nodes.map(n=>n.depth));
    const maxDepth = Math.max(...nodes.map(n=>n.depth));

    if (node.hasOutputAnchor && node.depth !== maxDepth) {
      const a = anchorRightPos(node);
      rightHelpers.push({ ...a, depth: node.depth });

      inner += `
        <line x1="${node.x + nodeRadius}" y1="${node.y}"
              x2="${a.x}" y2="${a.y}"
              stroke="${defaultLineColor}" stroke-width="1.2" />
        <circle cx="${a.x}" cy="${a.y}"
                r="${ANCHOR_RADIUS}"
                fill="var(--bypass-fill)"
                stroke="var(--bypass-stroke)"
                stroke-width="1.2"/>
      `;
    }

    if (node.hasInputAnchor && node.depth !== minDepth) {
      const a = anchorLeftPos(node);
      leftHelpers.push({ ...a, depth: node.depth });

      inner += `
        <line x1="${node.x - nodeRadius}" y1="${node.y}"
              x2="${a.x}" y2="${a.y}"
              stroke="${defaultLineColor}" stroke-width="1.2" />
        <circle cx="${a.x}" cy="${a.y}"
                r="${ANCHOR_RADIUS}"
                fill="var(--bypass-fill)"
                stroke="var(--bypass-stroke)"
                stroke-width="1.2"/>
      `;
    }
  }

    // ---------------------------------
    // Bypass detection (DOTS ONLY)
    // ---------------------------------
    const bypassOutputDepths = new Set();
    const bypassInputDepths = new Set();

    for (const link of links) {
      const from = nodes.find(n => n.id === link.source);
      const to   = nodes.find(n => n.id === link.target);
      if (!from || !to) continue;

      if (to.depth - from.depth > 1) {
        bypassOutputDepths.add(from.depth);
        bypassInputDepths.add(to.depth);
      }
    }

    // top-most node per column
    const topBypassNodeByDepth = {};

    // outputs
    for (const link of links) {
      const from = nodes.find(n => n.id === link.source);
      const to   = nodes.find(n => n.id === link.target);
      if (!from || !to) continue;

      if (to.depth - from.depth > 1) {
        const dOut = from.depth;
        const dIn  = to.depth;

        if (!topBypassNodeByDepth[dOut] || from.y < topBypassNodeByDepth[dOut].y) {
          topBypassNodeByDepth[dOut] = from;
        }

        if (!topBypassNodeByDepth[dIn] || to.y < topBypassNodeByDepth[dIn].y) {
          topBypassNodeByDepth[dIn] = to;
        }
      }
    }

  // ---------------------------------
  // Vertical output spines
  // ---------------------------------
  const byX = {};
  for (const h of rightHelpers) {
    if (!byX[h.x]) byX[h.x] = [];
    byX[h.x].push(h);
  }

  for (const helpers of Object.values(byX)) {
    if (helpers.length < 2) continue;
    helpers.sort((a,b)=>a.y - b.y);

    for (let i = 0; i < helpers.length - 1; i++) {
      const x = helpers[i].x;
      const y1 = helpers[i].y;
      const y2 = helpers[i + 1].y;

      inner += `
        <line x1="${x}" y1="${y1}"
              x2="${x}" y2="${y2}"
              stroke="${defaultLineColor}" stroke-width="1.6" />
      `;

      const midY = (y1 + y2) / 2;
      const arrowY =
        midY +
        ARROW_GAP_FROM_LABEL -
        ARROW_CENTER_ADJUST -
        UP_ARROW_EXTRA_LIFT;

      inner += `
        <polygon
          points="
            ${x},${arrowY - ARROW_HEIGHT}
            ${x - ARROW_HALF_WIDTH},${arrowY}
            ${x + ARROW_HALF_WIDTH},${arrowY}
          "
          fill="${defaultLineColor}" />
      `;
    }
  }

  // ---------------------------------
  // Vertical input spines
  // ---------------------------------
  const byXInput = {};
  for (const h of leftHelpers) {
    if (!byXInput[h.x]) byXInput[h.x] = [];
    byXInput[h.x].push(h);
  }

  for (const helpers of Object.values(byXInput)) {
    if (helpers.length < 2) continue;
    helpers.sort((a,b)=>a.y - b.y);

    for (let i = 0; i < helpers.length - 1; i++) {
      const x = helpers[i].x;
      const y1 = helpers[i].y;
      const y2 = helpers[i + 1].y;

      inner += `
        <line x1="${x}" y1="${y1}"
              x2="${x}" y2="${y2}"
              stroke="${defaultLineColor}" stroke-width="1.6" />
      `;

      const midY = (y1 + y2) / 2;
      const arrowY =
        midY -
        ARROW_CENTER_ADJUST -
        ARROW_GAP_FROM_LABEL;

      inner += `
        <polygon
          points="
            ${x},${arrowY + ARROW_HEIGHT}
            ${x - ARROW_HALF_WIDTH},${arrowY}
            ${x + ARROW_HALF_WIDTH},${arrowY}
          "
          fill="${defaultLineColor}" />
      `;
    }
  }

  // ---------------------------------
  // HORIZONTAL TOP CONNECTIONS (RIGHT → LEFT)
  // ---------------------------------
  const rightTopByDepth = {};
  const leftTopByDepth = {};

  for (const h of rightHelpers) {
    if (!rightTopByDepth[h.depth] || h.y < rightTopByDepth[h.depth].y) {
      rightTopByDepth[h.depth] = h;
    }
  }

  for (const h of leftHelpers) {
    if (!leftTopByDepth[h.depth] || h.y < leftTopByDepth[h.depth].y) {
      leftTopByDepth[h.depth] = h;
    }
  }

  for (const d of Object.keys(rightTopByDepth).map(Number)) {
    const from = rightTopByDepth[d];
    const to = leftTopByDepth[d + 1];
    if (!from || !to) continue;

    const y = from.y;
    const midX = (from.x + to.x) / 2;

    inner += `
      <line
        x1="${from.x}" y1="${y}"
        x2="${to.x}"   y2="${y}"
        stroke="${defaultLineColor}"
        stroke-width="1.6" />
      <polygon
        points="
          ${midX + H_ARROW_WIDTH},${y}
          ${midX},${y - H_ARROW_HALF_HEIGHT}
          ${midX},${y + H_ARROW_HALF_HEIGHT}
        "
        fill="${defaultLineColor}" />
    `;
  }

    // ---------------------------------
    // Bypass helper dots (NO LINES)
    // ---------------------------------
    const BYPASS_RADIUS = 5;
    const BYPASS_Y_OFFSET = 34;
    const BYPASS_X_INSET = 10;

    // Output-side bypass dots (above right helpers)
    for (const depth of bypassOutputDepths) {
      const node = topBypassNodeByDepth[depth];
      if (!node) continue;

      const x = node.x + nodeRadius + ANCHOR_OFFSET - BYPASS_X_INSET;
      const y = node.y - BYPASS_Y_OFFSET;

      inner += `
        <circle
          cx="${x}"
          cy="${y}"
          r="${BYPASS_RADIUS}"
          fill="var(--bypass-fill)"
          stroke="var(--bypass-stroke)"
          stroke-width="1.4"
        />
      `;
    }

    // Input-side bypass dots (above left helpers)
    for (const depth of bypassInputDepths) {
      const node = topBypassNodeByDepth[depth];
      if (!node) continue;

      const x = node.x - nodeRadius - ANCHOR_OFFSET + BYPASS_X_INSET;
      const y = node.y - BYPASS_Y_OFFSET;

      inner += `
        <circle
          cx="${x}"
          cy="${y}"
          r="${BYPASS_RADIUS}"
          fill="var(--bypass-fill)"
          stroke="var(--bypass-stroke)"
          stroke-width="1.4"
        />
      `;
    }

  // ---------------------------------
  // Nodes
  // ---------------------------------
  for (const node of nodes) {
    const fillColor = node.raw
      ? "#f4d03f"
      : MACHINE_COLORS[node.building] || "#95a5a6";

    const label = String(node.label || node.id);

    const fontSize = 13;
    const padX = 10, padY = 6;
    const width = Math.max(48, label.length * 7 + padX * 2);
    const height = fontSize + padY * 2;

    // Machine count shown inside node
    const machineCount =
      Number.isFinite(Number(node.machines)) && node.machines > 0
        ? Math.ceil(node.machines)
        : "";

    inner += `
      <g class="graph-node" data-id="${escapeHtml(node.id)}" tabindex="0">
        <!-- label box -->
        <rect
          x="${node.x - width / 2}"
          y="${node.y - nodeRadius - LABEL_OFFSET - height}"
          width="${width}"
          height="${height}"
          rx="6"
          fill="var(--label-box-fill)"
          stroke="var(--label-box-stroke)" />

        <text
          x="${node.x}"
          y="${node.y - nodeRadius - LABEL_OFFSET - height / 2}"
          text-anchor="middle"
          dy="0.35em"
          font-size="${fontSize}"
          font-weight="700"
          fill="var(--label-text-fill)">
          ${label}
        </text>

        <!-- node circle -->
        <circle
          cx="${node.x}"
          cy="${node.y}"
          r="${nodeRadius}"
          fill="${fillColor}"
          stroke="#2c3e50"
          stroke-width="2"/>

        <!-- machine count inside node -->
        ${
          machineCount !== ""
            ? `
            <text
              x="${node.x}"
              y="${node.y}"
              class="nodeNumber">
              ${machineCount}
            </text>
            `
            : ""
        }
      </g>
    `;
  }

  return `
    <div class="graphWrapper">
      <svg class="graphSVG" viewBox="${contentX} ${contentY} ${contentW} ${contentH}">
        <g id="zoomLayer">
          ${inner}
        </g>
      </svg>
    </div>
  `;
}

// Minimal guarded attachNodePointerHandlers that does not trigger pulses
function attachNodePointerHandlers(wrapper) {
  if (!wrapper) return;
  if (wrapper._nodePointerHandlersInstalled) return;
  wrapper._nodePointerHandlersInstalled = true;

  const svg = wrapper.querySelector('svg.graphSVG');
  if (!svg) return;

  // Keyboard accessibility only
  svg.querySelectorAll('g.graph-node[data-id]').forEach(group => {
    group.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        // reserved for future actions
      }
    });
  });
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

  // Build graph data (nodes + links) and ensure depths are attached
  const graph = buildGraphData(chain, rootItem);
  const nodes = graph.nodes || [];
  const links = graph.links || [];

  // Compute depths using existing helper
  const depths = typeof computeDepthsFromTiers === 'function'
    ? computeDepthsFromTiers(chain, rootItem)
    : {};

  // Collect non-raw items grouped by their computed depth
  const levelGroups = {};
  for (const [item, data] of Object.entries(chain || {})) {
    if (data && data.raw) continue; // skip raw items entirely
    const depth = Number.isFinite(Number(depths[item])) ? Number(depths[item]) : 0;
    if (!levelGroups[depth]) levelGroups[depth] = [];
    levelGroups[depth].push([item, data]);
  }

  // If there are no non-raw items, ensure we still render something sensible
  const uniqueDepths = Object.keys(levelGroups).map(Number);
  if (uniqueDepths.length === 0) {
    // Nothing to show in table (all raw or empty chain)
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

    const out = document.getElementById("outputArea");
    if (out) out.innerHTML = `<h2>Production chain for ${escapeHtml(String(rate))} / min of ${escapeHtml(rootItem)}</h2><p>No non-raw items to display in the table.</p>`;
    return;
  }

  // Normalize depths to sequential level numbers starting at 0 (lowest depth -> Level 0)
  const depthsAsc = uniqueDepths.slice().sort((a,b) => a - b); // ascending
  const depthToLevelIndex = {};
  depthsAsc.forEach((d, idx) => { depthToLevelIndex[d] = idx; });

  // Render order: visually show highest depth first (descending)
  const sortedDepthsDesc = depthsAsc.slice().sort((a,b) => b - a);

  // Build graph HTML area first (so graph renders above/beside table as before)
  const graphHTML = renderGraph(nodes, links, rootItem);

  const graphArea = document.getElementById("graphArea");
  if (!graphArea) return;

  // Teardown previous zoom if present
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

  // Build table HTML
  let html = `
    <h2>Production chain for ${escapeHtml(String(rate))} / min of ${escapeHtml(rootItem)}</h2>
    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th>Qty/min</th>
          <th>Output/machine</th>
          <th>Machines</th>
          <th>Machine Type</th>
          <th>Inputs (per min)</th>
          <th>Rails Needed</th>
        </tr>
      </thead>
      <tbody>
  `;

  // Render levels from highest to lowest, but label them using normalized Level indices
  for (const depth of sortedDepthsDesc) {
    const rows = levelGroups[depth] || [];
    if (!rows.length) continue;

    const levelLabel = depthToLevelIndex[depth] ?? 0;
    html += `<tr><td colspan="7"><strong>--- Level ${levelLabel} ---</strong></td></tr>`;

    // Sort items alphabetically within the level for stable ordering
    rows.sort((a,b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }));

    for (const [item, data] of rows) {
      // data.raw already filtered out above
      let outputPerMachine = "—";
      let machines = "—";
      let railsNeeded = "—";
      const fillColor = MACHINE_COLORS[data.building] || "#ecf0f1";
      const textColor = getTextColor(fillColor);

      const recipe = getRecipe(item);
      if (recipe && recipe.output && recipe.time) {
        outputPerMachine = Math.ceil((recipe.output * 60) / recipe.time);
      }
      machines = Number.isFinite(Number(data.machines)) ? Math.ceil(data.machines) : "—";
      const railSpeed = parseInt(document.getElementById("railSelect")?.value || 0);
      railsNeeded = computeRailsNeeded(data.inputs || {}, railSpeed);

      // Inputs: list each input as "Name: X/min" sorted by name; include raw inputs if present
      const inputsList = Object.entries(data.inputs || {})
        .sort((a,b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }))
        .map(([iname, amt]) => `${escapeHtml(iname)}: ${Math.ceil(amt)}/min`)
        .join("<br>") || "—";

      html += `
        <tr>
          <td>${escapeHtml(item)}</td>
          <td>${Math.ceil(data.rate || 0)}</td>
          <td>${outputPerMachine}</td>
          <td>${machines}</td>
          <td style="background-color:${fillColor}; color:${textColor};">${escapeHtml(data.building || "—")}</td>
          <td>${inputsList}</td>
          <td>${railsNeeded}</td>
        </tr>
      `;
    }
  }

  html += `</tbody></table>`;

  // Machines required summary (unchanged)
  html += `
    <h3>MACHINES REQUIRED (total)</h3>
    <table>
      <thead><tr><th>Machine Type</th><th>Count</th></tr></thead>
      <tbody>
        ${Object.entries(machineTotals || {}).sort((a, b) => b[1] - a[1]).map(([type, count]) => `
          <tr><td>${escapeHtml(type)}</td><td>${Math.ceil(count)}</td></tr>
        `).join("")}
      </tbody>
    </table>
  `;

  // Extraction summary (unchanged)
  html += `
    <h3>EXTRACTION REQUIRED</h3>
    <table>
      <thead>
        <tr><th>Resource</th><th>Impure</th><th>Normal</th><th>Pure</th><th>Qty/min</th></tr>
      </thead>
      <tbody>
  `;

  const sortedExtractors = Object.entries(extractorTotals || {}).filter(([_, qty]) => qty > 0).sort((a, b) => b[1] - a[1]);
  for (const [resource, qty] of sortedExtractors) {
    const rounded = Math.ceil(qty);
    if (SPECIAL_EXTRACTORS[resource]) {
      const normal = Math.ceil(rounded / SPECIAL_EXTRACTORS[resource]);
      html += `<tr><td>${escapeHtml(resource)}</td><td>—</td><td>${normal}</td><td>—</td><td>${rounded}</td></tr>`;
    } else {
      const impure = Math.ceil(rounded / 60);
      const normal = Math.ceil(rounded / 120);
      const pure = Math.ceil(rounded / 240);
      html += `<tr><td>${escapeHtml(resource)}</td><td>${impure}</td><td>${normal}</td><td>${pure}</td><td>${rounded}</td></tr>`;
    }
  }

  html += `</tbody></table>`;

  // Inject into output area
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
