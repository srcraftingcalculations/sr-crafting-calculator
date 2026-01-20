/* app.js
   Minimal, self-contained graph renderer that:
   - removes left helper dots for raw nodes
   - draws direct lines from raw nodes on the far-left to their consumer (smelter)
   - includes a small demo dataset so you can verify the line is visible
*/

/* ===============================
   Simple styling hook (optional runtime)
   =============================== */
(function injectDemoStyles() {
  if (document.getElementById('demoGraphStyles')) return;
  const s = document.createElement('style');
  s.id = 'demoGraphStyles';
  s.textContent = `
    .graphWrapper { width: 100%; height: 520px; box-sizing: border-box; background: #fafafa; border: 1px solid #e6e6e6; overflow: hidden; }
    .graphViewport { width: 100%; height: 100%; }
    svg.graphSVG { width: 100%; height: 100%; display: block; }
    .graph-node { cursor: pointer; }
    .graph-node-circle { transition: transform .12s ease; }
    .graph-node:hover .graph-node-circle { transform: scale(1.03); }
    .anchor-dot { transition: opacity .12s ease; }
    .anchor-dot.anchor-hidden { opacity: 0; }
    .anchor-dot.anchor-hover { stroke-width: 2.2; r: 6; }
    .graph-edge { stroke: #666; stroke-width: 2; stroke-linecap: round; opacity: 0.95; }
    .spine-placeholder rect { fill: rgba(0,0,0,0.02); stroke: rgba(0,0,0,0.06); }
    .nodeLabel { font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial; }
  `;
  document.head.appendChild(s);
})();

/* ===============================
   Constants
   =============================== */
const MACHINE_COLORS = {
  "Smelter": "#e67e22",
  "Furnace": "#d63031",
  "Fabricator": "#0984e3",
  "Mega Press": "#6c5ce7",
  "Assembler": "#00b894",
  "Refinery": "#e84393",
  "Compounder": "#00cec9",
  "Pyro Forge": "#a55eea"
};

const GRAPH_COL_WIDTH = 220;
const GRAPH_ROW_HEIGHT = 120;
const GRAPH_LABEL_OFFSET = 40;
const GRAPH_CONTENT_PAD = 64;

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

/* ===============================
   Demo data (ensures Titanium Ore -> Titanium Bar line is visible)
   - links are consumer -> input (consumer consumes input)
   =============================== */
function demoChain() {
  // chain object similar to expandChain output
  // keys: item name -> { raw: boolean, building: string, machines: number, inputs: { name: rate } }
  return {
    "Titanium Bar": { raw: false, building: "Smelter", machines: 1, inputs: { "Titanium Ore": 60 } },
    "Titanium Ore": { raw: true, building: "RAW", machines: 0, inputs: {} },
    "Wolfram Ore": { raw: true, building: "RAW", machines: 0, inputs: {} },
    "Wolfram Bar": { raw: false, building: "Smelter", machines: 1, inputs: { "Wolfram Ore": 60 } }
  };
}

/* ===============================
   Depth computation (simple)
   =============================== */
function computeDepths(chain, rootItem) {
  // For demo: place raw items at depth 0, their consumers at depth 1, others incrementally
  const depths = {};
  // initialize raw items to 0
  for (const [k, v] of Object.entries(chain)) {
    if (v.raw) depths[k] = 0;
  }
  // simple BFS-ish: any node that consumes a raw becomes depth 1
  let changed = true;
  while (changed) {
    changed = false;
    for (const [item, data] of Object.entries(chain)) {
      if (depths[item] !== undefined) continue;
      const inputs = Object.keys(data.inputs || {});
      if (inputs.length === 0) {
        depths[item] = 1;
        changed = true;
        continue;
      }
      const inputDepths = inputs.map(i => depths[i] ?? null).filter(d => d !== null);
      if (inputDepths.length === inputs.length) {
        depths[item] = Math.max(...inputDepths) + 1;
        changed = true;
      }
    }
  }
  // normalize so min depth is 0
  const minDepth = Math.min(...Object.values(depths));
  for (const k of Object.keys(depths)) depths[k] -= minDepth;
  return depths;
}

/* ===============================
   Build nodes + links from chain
   =============================== */
function buildGraphData(chain) {
  const depths = computeDepths(chain);
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
      hasInputAnchor: !data.raw, // raw items: no left anchor
      hasOutputAnchor: true      // raw and non-raw both show right anchor for demo
    };
    nodes.push(node);
    nodeMap.set(item, node);
  }

  // links: consumer -> input
  for (const [item, data] of Object.entries(chain)) {
    for (const input of Object.keys(data.inputs || {})) {
      if (nodeMap.has(input)) links.push({ from: item, to: input });
    }
  }

  // Special rule: if a smelter consumes only raw inputs, hide its left anchor so wire connects to body
  for (const node of nodes) {
    if (node.building === 'Smelter') {
      const inputNames = Object.keys(node.inputs || {});
      if (inputNames.length > 0 && inputNames.every(n => chain[n] && chain[n].raw)) {
        node.hasInputAnchor = false;
      }
    }
  }

  return { nodes, links };
}

/* ===============================
   Render graph (nodes + raw-left direct wires)
   =============================== */
function renderGraph(nodes, links) {
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

  // Layout nodes
  for (const [depth, colNodes] of Object.entries(columns)) {
    colNodes.sort((a, b) => (a.label || '').localeCompare(b.label || ''));
    colNodes.forEach((node, i) => {
      node.x = Number(depth) * GRAPH_COL_WIDTH + 100;
      node.y = i * GRAPH_ROW_HEIGHT + 100;
    });
  }

  // Bounds
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

  let inner = '';

  // Spine placeholders (visual only)
  for (const depthKey of Object.keys(columns)) {
    const depth = Number(depthKey);
    const spineX = depth * GRAPH_COL_WIDTH + 100 + nodeRadius + 36;
    const topY = minY - GRAPH_ROW_HEIGHT;
    const bottomY = maxY + GRAPH_ROW_HEIGHT;
    inner += `
      <g class="spine-placeholder" data-depth="${depth}">
        <line x1="${spineX}" y1="${topY}" x2="${spineX}" y2="${bottomY}"
              stroke="${isDark ? '#2b2b2b' : '#e9e9e9'}" stroke-width="1" stroke-dasharray="4 6" opacity="0.35" pointer-events="none" />
        <rect x="${spineX - 18}" y="${topY - 44}" width="36" height="28" rx="6" ry="6"
              fill="${isDark ? '#222' : '#fff'}" stroke="${isDark ? '#444' : '#ddd'}" stroke-width="1" opacity="0.6" pointer-events="none" />
      </g>
    `;
  }

  // Draw direct wires for raw sources on the far-left
  const minDepth = nodes.length ? Math.min(...nodes.map(n => n.depth)) : 0;
  for (const link of links) {
    // links are consumer -> input
    const rawSource = nodes.find(n => n.id === link.to);
    const consumer = nodes.find(n => n.id === link.from);
    if (!rawSource || !consumer) continue;

    if (!(rawSource.raw && rawSource.depth === minDepth)) continue;

    const startX = rawSource.hasOutputAnchor ? (rawSource.x + nodeRadius + 10) : rawSource.x;
    const startY = rawSource.y;
    const endX = consumer.hasInputAnchor ? (consumer.x - nodeRadius - 10) : consumer.x;
    const endY = consumer.y;

    inner += `
      <line class="graph-edge" data-from="${escapeHtml(rawSource.id)}" data-to="${escapeHtml(consumer.id)}"
            x1="${startX}" y1="${startY}"
            x2="${endX}" y2="${endY}"
            stroke="#2f2f2f" stroke-width="2.6" stroke-linecap="round" />
    `;
  }

  // Nodes + anchors
  for (const node of nodes) {
    const fillColor = node.raw ? "#f4d03f" : MACHINE_COLORS[node.building] || "#95a5a6";
    const strokeColor = "#2c3e50";
    const textColor = getTextColor(fillColor);
    const labelY = node.y - GRAPH_LABEL_OFFSET;

    inner += `
      <g class="graph-node" data-id="${escapeHtml(node.id)}" tabindex="0" role="button" aria-label="${escapeHtml(node.label)}" style="outline:none;">
        <text class="nodeLabel" x="${node.x}" y="${labelY}"
              text-anchor="middle" font-size="13" font-weight="700"
              fill="${textColor}" stroke="${isDark ? '#000' : '#fff'}" stroke-width="0.6" paint-order="stroke" pointer-events="none">
          ${escapeHtml(node.label)}
        </text>

        <circle class="graph-node-circle" data-id="${escapeHtml(node.id)}" cx="${node.x}" cy="${node.y}" r="${nodeRadius}"
                fill="${fillColor}" stroke="${strokeColor}" stroke-width="2" />
    `;

    // small rectangle for non-raw nodes (visual)
    if (!node.raw) {
      inner += `<rect x="${node.x - 14}" y="${node.y - 10}" width="28" height="20" fill="${fillColor}" rx="4" ry="4" pointer-events="none" />`;
    }

    inner += `
        <text class="nodeNumber" x="${node.x}" y="${node.y}"
              text-anchor="middle" font-size="13" font-weight="700"
              fill="${textColor}" stroke="${isDark ? '#000' : '#fff'}" stroke-width="0.6" paint-order="stroke" pointer-events="none">
          ${node.raw ? "" : Math.ceil(node.machines)}
        </text>
    `;

    // Left input anchor (if present)
    if (node.hasInputAnchor) {
      const ax = node.x - nodeRadius - 10;
      const ay = node.y;
      inner += `
        <g class="anchor anchor-left" data-node="${escapeHtml(node.id)}" data-side="left" transform="translate(${ax},${ay})" tabindex="0" role="button" aria-label="Input anchor for ${escapeHtml(node.label)}">
          <circle class="anchor-hit" cx="0" cy="0" r="${anchorHitRadius}" fill="transparent" pointer-events="all" />
          <circle class="anchor-dot" cx="0" cy="0" r="${anchorRadius}" fill="${isDark ? '#ffffff' : '#2c3e50'}" stroke="${isDark ? '#000' : '#fff'}" stroke-width="1.2" />
        </g>
      `;
    }

    // Right output anchor (if present) - raw nodes keep right anchor visible
    if (node.hasOutputAnchor) {
      const bx = node.x + nodeRadius + 10;
      const by = node.y;
      // hide left helper dot for raw nodes by keeping left anchor absent earlier
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
   Simple attach handlers so clicks work
   =============================== */
function attachAnchorHandlers(wrapper) {
  if (!wrapper) return;
  const svg = wrapper.querySelector('svg.graphSVG');
  if (!svg) return;
  svg.querySelectorAll('g.anchor').forEach(anchor => {
    anchor.addEventListener('mouseenter', () => anchor.querySelector('.anchor-dot')?.classList.add('anchor-hover'));
    anchor.addEventListener('mouseleave', () => anchor.querySelector('.anchor-dot')?.classList.remove('anchor-hover'));
    anchor.addEventListener('click', (ev) => { ev.stopPropagation(); console.log('anchorClick', anchor.dataset.node, anchor.dataset.side); });
  });
}

function attachNodePointerHandlers(wrapper) {
  if (!wrapper) return;
  const svg = wrapper.querySelector('svg.graphSVG');
  if (!svg) return;
  svg.querySelectorAll('g.graph-node').forEach(group => {
    group.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const id = group.getAttribute('data-id');
      console.log('node clicked', id);
      // simple highlight: toggle stroke
      const circle = group.querySelector('circle.graph-node-circle');
      if (!circle) return;
      const active = circle.classList.toggle('active-node');
      circle.style.strokeWidth = active ? '4' : '2';
    });
  });
}

/* ===============================
   Render demo on DOMContentLoaded
   =============================== */
document.addEventListener('DOMContentLoaded', () => {
  const chain = demoChain();
  const { nodes, links } = buildGraphData(chain);
  window._lastGraphNodes = nodes;
  const html = renderGraph(nodes, links);
  const container = document.getElementById('graphArea') || document.body;
  // If there's a dedicated graphArea, use it; otherwise append to body
  if (document.getElementById('graphArea')) {
    document.getElementById('graphArea').innerHTML = html;
  } else {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    document.body.appendChild(wrapper);
  }
  const wrapperEl = document.querySelector('.graphWrapper');
  attachAnchorHandlers(wrapperEl);
  attachNodePointerHandlers(wrapperEl);

  // Quick verification log: list edges drawn
  console.log('Rendered nodes:', nodes.map(n => n.id));
  console.log('Rendered links (consumer->input):', links);
});
