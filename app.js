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
  const ANCHOR_HIT_RADIUS = 12;
  const ANCHOR_OFFSET = 18;

  function roundCoord(v) { return Math.round(v * 100) / 100; }
  function anchorRightPos(node) { return { x: roundCoord(node.x + nodeRadius + ANCHOR_OFFSET), y: roundCoord(node.y) }; }
  function anchorLeftPos(node)  { return { x: roundCoord(node.x - nodeRadius - ANCHOR_OFFSET), y: roundCoord(node.y) }; }

  // Ensure defaults
  for (const n of nodes) {
    if (typeof n.hasInputAnchor === 'undefined') n.hasInputAnchor = true;
    if (typeof n.hasOutputAnchor === 'undefined') n.hasOutputAnchor = true;
    if (typeof n.depth === 'undefined') n.depth = 0;
    if (typeof n.machines === 'undefined') n.machines = 0;
  }

  const nodeById = new Map(nodes.map(n => [n.id, n]));

  // Normalize depths
  const uniqueDepths = Array.from(new Set(nodes.map(n => Number.isFinite(Number(n.depth)) ? Number(n.depth) : 0)));
  uniqueDepths.sort((a,b) => a - b);
  const depthMap = new Map(uniqueDepths.map((d, i) => [d, i]));
  nodes.forEach(n => n.depth = depthMap.get(Number(n.depth)) ?? 0);

  const columns = {};
  for (const node of nodes) {
    if (!columns[node.depth]) columns[node.depth] = [];
    columns[node.depth].push(node);
  }

  const depthsSorted = Object.keys(columns).map(Number).sort((a,b)=>a-b);
  const _depthIndex = new Map(depthsSorted.map((d,i)=>[d,i]));

  for (const [depth, colNodes] of Object.entries(columns)) {
    colNodes.sort((a,b) => String(a.label || a.id).localeCompare(String(b.label || b.id)));
    const idx = _depthIndex.get(Number(depth)) ?? 0;
    colNodes.forEach((node, i) => {
      node.x = roundCoord(idx * MACHINE_COL_WIDTH + 100);
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

  // Compute helper positions and bypass needs (helpers for non-raw nodes)
  const willRenderAnchors = [];
  for (const node of nodes) {
    const isSmelter = (node.building === 'Smelter');
    const isBBM = (node.id === BBM_ID || node.label === BBM_ID);
    const rawRightOnly = !!(node.raw && node.depth !== minDepth);

    // DO NOT render left helper/anchor for raw nodes that sit in the far-left column
    if (node.hasInputAnchor && !isSmelter && !isBBM && !node.raw) {
      willRenderAnchors.push({ side:'left', node, pos: anchorLeftPos(node) });
    }
    if ((node.hasOutputAnchor || rawRightOnly || isBBM) && node.depth !== maxDepth) {
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

  // Expose for debugging
  window._needsOutputBypass = needsOutputBypass;
  window._needsInputBypass = needsInputBypass;
  window._graphNodes = nodes;
  window._graphLinks = links;

  // Build spines
  let spineSvg = '';

  for (let i = 0; i < depthsSorted.length; i++) {
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

    const ysAnch = outputAnchors.map(p => p.y);
    const topAnchorY = Math.min(...ysAnch);
    const bottomAnchorY = Math.max(...ysAnch);
    const spineX = outputAnchors[0].x;

  // Vertical flow into next column (WITH arrow)
    spineSvg += `
      <line
        class="graph-spine-vertical"
        x1="${nextSpineX}"
        y1="${topAnchorY}"
        x2="${nextSpineX}"
        y2="${topInY}"
        stroke="${isDarkMode() ? '#bdbdbd' : '#666666'}"
        stroke-width="2"
        marker-end="url(#arrow-down)"
      />
    `;

    if (i + 1 < depthsSorted.length) {
      const nextDepth = depthsSorted[i + 1];
      const nextColNodes = columns[nextDepth] || [];
      const nextInputs = [];

      for (const n of nextColNodes) {
        if (n.raw && n.depth === minDepth) continue;
        if (n.hasInputAnchor && n.building !== 'Smelter') {
          nextInputs.push(anchorLeftPos(n));
        }
      }

      if (nextInputs.length) {
        const topInY = Math.min(...nextInputs.map(p => p.y));
        const bottomInY = Math.max(...nextInputs.map(p => p.y));
        const nextSpineX = nextInputs[0].x;

        // Horizontal spine (WITH arrow →)
        spineSvg += `
          <line
            class="graph-spine-horizontal"
            x1="${spineX}"
            y1="${topAnchorY}"
            x2="${nextSpineX}"
            y2="${topAnchorY}"
            stroke="${isDarkMode() ? '#bdbdbd' : '#666666'}"
            stroke-width="2"
            marker-end="url(#spineArrow)"
          />
        `;

        // Vertical flow drop (WITH arrow ↓)
        spineSvg += `
          <line
            class="graph-spine-vertical"
            x1="${nextSpineX}"
            y1="${topAnchorY}"
            x2="${nextSpineX}"
            y2="${topInY}"
            stroke="${isDarkMode() ? '#bdbdbd' : '#666666'}"
            stroke-width="2"
            marker-end="url(#arrow-down)"
          />
        `;

        // Vertical grouping spine (NO arrow)
        spineSvg += `
          <line
            class="graph-spine-vertical"
            x1="${nextSpineX}"
            y1="${topInY}"
            x2="${nextSpineX}"
            y2="${bottomInY}"
            stroke="${isDarkMode() ? '#bdbdbd' : '#666666'}"
            stroke-width="2"
          />
        `;
      }
    }
  }

  // Start building inner SVG content
  let inner = `
    <defs>
      <!-- Standard edge arrows -->
      <marker id="arrow-right"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto">
        <path d="M0 0 L10 5 L0 10 Z" fill="var(--line-color)" />
      </marker>

      <marker id="arrow-up"
              viewBox="0 0 10 10"
              refX="5"
              refY="1"
              markerWidth="6"
              markerHeight="6"
              orient="auto">
        <path d="M0 10 L5 0 L10 10 Z" fill="var(--line-color)" />
      </marker>

      <marker id="arrow-down"
              viewBox="0 0 10 10"
              refX="5"
              refY="9"
              markerWidth="6"
              markerHeight="6"
              orient="auto">
        <path d="M0 0 L5 10 L10 0 Z" fill="var(--line-color)" />
      </marker>

      <!-- Spine flow arrow (LEFT → RIGHT) -->
      <marker id="spineArrow"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
              markerUnits="strokeWidth">
        <path d="M0 0 L8 4 L0 8 Z" fill="var(--spine-color)" />
      </marker>

      <!-- Label backdrop -->
      <filter id="labelBackdrop" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blurred" />
        <feDropShadow dx="0" dy="1" stdDeviation="1.5"
                      flood-color="#000" flood-opacity="0.25" />
        <feComposite in="blurred" in2="SourceGraphic" operator="over" />
      </filter>
    </defs>
    ${spineSvg}
  `;

  // --- Direct node-to-node center lines (restricted, with reversed-link handling) ---
  (function emitDirectNodeLines() {
    const lineColor = isDarkMode() ? '#dcdcdc' : '#444444';
    const rawLineColor = '#333333';

      for (const link of links || []) {
        const a = nodeById.get(link.from);
        const b = nodeById.get(link.to);
        if (!a || !b) continue;

        let src = null, dst = null;
        if (a.raw && a.depth === minDepth) { src = a; dst = b; }
        else if (b.raw && b.depth === minDepth) { src = b; dst = a; }
        else continue;

        if (!(dst.depth === minDepth || dst.depth === minDepth + 1)) continue;

        inner += `<line class="graph-edge direct-node-line"
          x1="${src.x}" y1="${src.y}"
          x2="${dst.x}" y2="${dst.y}"
          stroke="${dst.building === 'Smelter' ? '#333333' : (isDarkMode() ? '#dcdcdc' : '#444444')}"
          stroke-width="${dst.building === 'Smelter' ? 2.6 : 1.6}"
          stroke-linecap="round"
          marker-end="url(#arrow-right)" />`;
      }
  })();

  // Node-to-helper connectors and helper dots (do not add left helper for raw nodes in far-left)
  const helperMap = new Map();
  const defaultLineColor = isDarkMode() ? '#dcdcdc' : '#444444';
  for (const node of nodes) {
    const isSmelter = (node.building === 'Smelter');
    const isBBM = (node.id === BBM_ID || node.label === BBM_ID);
    const rawRightOnly = !!(node.raw && node.depth !== minDepth);

    if (! (node.raw && node.depth === minDepth) && (node.hasOutputAnchor || rawRightOnly || isBBM) && node.depth !== maxDepth) {
      const a = anchorRightPos(node);
      helperMap.set(`${node.id}:right`, a);
      inner += `<line class="node-to-helper" data-node="${escapeHtml(node.id)}" data-side="right" x1="${roundCoord(node.x + nodeRadius)}" y1="${node.y}" x2="${a.x}" y2="${a.y}" stroke="${defaultLineColor}" stroke-width="1.2" />`;
      inner += `<g class="helper-dot helper-output" data-node="${escapeHtml(node.id)}" data-side="right" transform="translate(${a.x},${a.y})" aria-hidden="true"><circle cx="0" cy="0" r="${ANCHOR_RADIUS}" fill="var(--bypass-fill)" stroke="var(--bypass-stroke)" stroke-width="1.2" /></g>`;
      inner += `<g class="anchor anchor-right" data-node="${escapeHtml(node.id)}" data-side="right" transform="translate(${a.x},${a.y})" tabindex="0" role="button" aria-label="Output anchor for ${escapeHtml(node.label)}"><circle class="anchor-hit" cx="0" cy="0" r="${ANCHOR_HIT_RADIUS}" fill="transparent" pointer-events="all" /><circle class="anchor-dot" cx="0" cy="0" r="${ANCHOR_RADIUS}" fill="var(--anchor-dot-fill)" stroke="var(--anchor-dot-stroke)" stroke-width="1.2" /></g>`;
    }

    if (node.hasInputAnchor && !isSmelter && !isBBM && !node.raw) {
      const a = anchorLeftPos(node);
      helperMap.set(`${node.id}:left`, a);
      inner += `<line class="node-to-helper" data-node="${escapeHtml(node.id)}" data-side="left" x1="${roundCoord(node.x - nodeRadius)}" y1="${node.y}" x2="${a.x}" y2="${a.y}" stroke="${defaultLineColor}" stroke-width="1.2" />`;
      inner += `<g class="helper-dot helper-input" data-node="${escapeHtml(node.id)}" data-side="left" transform="translate(${a.x},${a.y})" aria-hidden="true"><circle cx="0" cy="0" r="${ANCHOR_RADIUS}" fill="var(--bypass-fill)" stroke="var(--bypass-stroke)" stroke-width="1.2" /></g>`;
      inner += `<g class="anchor anchor-left" data-node="${escapeHtml(node.id)}" data-side="left" transform="translate(${a.x},${a.y})" tabindex="0" role="button" aria-label="Input anchor for ${escapeHtml(node.label)}"><circle class="anchor-hit" cx="0" cy="0" r="${ANCHOR_HIT_RADIUS}" fill="transparent" pointer-events="all" /><circle class="anchor-dot" cx="0" cy="0" r="${ANCHOR_RADIUS}" fill="var(--anchor-dot-fill)" stroke="var(--anchor-dot-stroke)" stroke-width="1.2" /></g>`;
    }
  }

  // Bypass connectors to/from spines
  for (const [depth, info] of needsOutputBypass.entries()) {
    inner += `<line class="bypass-to-spine bypass-output-connector" data-depth="${depth}" x1="${info.x}" y1="${info.y}" x2="${info.x}" y2="${info.helperCenter.y}" stroke="${defaultLineColor}" stroke-width="1.4" />`;
  }
  for (const [consumerDepth, pos] of needsInputBypass.entries()) {
    inner += `<line class="bypass-to-spine bypass-input-connector" data-depth="${consumerDepth}" x1="${pos.x}" y1="${pos.helperCenter.y}" x2="${pos.x}" y2="${pos.y}" stroke="${defaultLineColor}" stroke-width="1.4" />`;
  }
  for (const [outDepth, outInfo] of needsOutputBypass.entries()) {
    for (const consumerDepth of outInfo.causingConsumers) {
      const inPos = needsInputBypass.get(consumerDepth);
      if (!inPos) continue;
      inner += `<line class="bypass-connector" data-from-depth="${outDepth}" data-to-depth="${consumerDepth}" x1="${outInfo.x}" y1="${outInfo.y}" x2="${inPos.x}" y2="${inPos.y}" stroke="${defaultLineColor}" stroke-width="1.4" />`;
    }
  }

  // Node visuals (labels, circles, numbers)
  for (const node of nodes) {
    const fillColor = node.raw ? "#f4d03f" : MACHINE_COLORS[node.building] || "#95a5a6";
    const strokeColor = "#2c3e50";
    const labelText = String(node.label || node.id).trim();
    const labelFontSize = 13;
    const labelPaddingX = 10;
    const labelPaddingY = 8;

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
    inner += `</g>`;
  }

  // Bypass helper dots (visual)
  for (const [depth, info] of needsOutputBypass.entries()) {
    inner += `<g class="bypass-dot bypass-output" data-depth="${depth}" transform="translate(${info.x},${info.y})" aria-hidden="true"><circle cx="0" cy="0" r="${ANCHOR_RADIUS}" fill="var(--bypass-fill)" stroke="var(--bypass-stroke)" stroke-width="1.2" /></g>`;
  }
  for (const [consumerDepth, pos] of needsInputBypass.entries()) {
    inner += `<g class="bypass-dot bypass-input" data-depth="${consumerDepth}" transform="translate(${pos.x},${pos.y})" aria-hidden="true"><circle cx="0" cy="0" r="${ANCHOR_RADIUS}" fill="var(--bypass-fill)" stroke="var(--bypass-stroke)" stroke-width="1.2" /></g>`;
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

  // Theme observer (keeps colors in sync)
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
