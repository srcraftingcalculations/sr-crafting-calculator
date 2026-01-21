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

    // small buffer in SVG coords
    const marginSvgY = Math.max(8, view.height * 0.03);

    const minTxLarge = view.width - layerW - bbox.x * proposedScale;
    const maxTxLarge = -bbox.x * proposedScale;
    // Correct vertical bounds: use content bottom explicitly and add a small margin
    const minTyLarge = view.height - (bbox.y + bbox.height) * proposedScale - marginSvgY;
    const maxTyLarge = -bbox.y * proposedScale + marginSvgY;

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
      const minTySmall = centerTy - allowedExtraY / 2 - marginSvgY;
      const maxTySmall = centerTy + allowedExtraY / 2 + marginSvgY;
      clampedTy = Math.min(maxTySmall, Math.max(minTySmall, proposedTy));
    }

    return { tx: clampedTx, ty: clampedTy };
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
