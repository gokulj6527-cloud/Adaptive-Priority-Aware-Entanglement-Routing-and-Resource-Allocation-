import { NetworkSimulation } from "./simulation.js";

const simulation = new NetworkSimulation();
let currentPage = "overview";
let running = false;
let simulationTimer = null;
let speed = 1;
let routingTenantId = simulation.selectedTenant;

const content = document.querySelector("#content");
const sidebar = document.querySelector("#sidebar");
const dialog = document.querySelector("#tenant-dialog");

const PAGE_TITLES = {
  overview: "Overview",
  topology: "Network topology",
  tenants: "Tenant slices",
  routing: "Adaptive routing",
  resources: "Quantum resources",
  events: "Event monitor",
  analytics: "Performance analytics",
  algorithms: "Algorithm notes",
};

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function n(value, digits = 1) {
  return Number(value || 0).toFixed(digits);
}

function pct(value, digits = 0) {
  return `${(Number(value || 0) * 100).toFixed(digits)}%`;
}

function tenantColor(tenant) {
  return tenant?.color || "#49d9ff";
}

function tenantStatusClass(tenant) {
  return simulation.isSlaMet(tenant) ? "good" : tenant.status === "Inactive" ? "" : "warning";
}

function toast(message) {
  const region = document.querySelector("#toast-region");
  const element = document.createElement("div");
  element.className = "toast";
  element.textContent = message;
  region.append(element);
  window.setTimeout(() => element.remove(), 3500);
}

function updateHeader() {
  document.querySelector("#current-page").textContent = PAGE_TITLES[currentPage] || "Overview";
  document.querySelector("#tenant-count").textContent = String(simulation.tenants.filter((t) => t.active).length).padStart(2, "0");
  document.querySelector("#epoch-label").textContent = String(simulation.elapsed).padStart(3, "0");
  document.querySelectorAll(".nav-link[data-page]").forEach((link) => {
    link.classList.toggle("active", link.dataset.page === currentPage);
  });
  document.querySelector("#clock").textContent = new Date().toLocaleTimeString([], { hour12: false });
}

function header(title, description, actions = "") {
  return `<div class="page-heading"><div><div class="eyebrow">QUANTUM NETWORK OPERATIONS</div><h1>${title}</h1><p>${description}</p></div><div class="heading-actions">${actions}</div></div>`;
}

function statusPill(text, kind = "") {
  return `<span class="pill ${kind}"><i class="dot"></i>${esc(text)}</span>`;
}

function selectedNodeDetails() {
  const node = simulation.getNode(simulation.selectedNode);
  if (!node) return `<div class="empty-state">Select a network node to inspect telemetry.</div>`;
  const utilization = node.used / node.capacity;
  return `<div class="inspector-header"><span class="inspector-icon">${node.available ? "⌘" : "×"}</span><span><strong>Node ${node.id}</strong><small>${esc(node.role)} · ${node.available ? "Operational" : "Offline"}</small></span>${statusPill(node.health === "healthy" ? "Healthy" : "Failed", node.health === "healthy" ? "good" : "bad")}</div>
    <div class="detail-list">
      <div class="detail-row"><span>Memory capacity</span><strong>${node.capacity} slots</strong></div>
      <div class="detail-row"><span>Memory allocated</span><strong>${node.used} slots</strong></div>
      <div class="detail-row"><span>Memory utilization</span><strong>${pct(utilization)}</strong></div>
      <div class="progress-track"><span style="width:${Math.min(100, utilization * 100)}%;background:${utilization > .85 ? "var(--yellow)" : "var(--cyan)"}"></span></div>
      <div class="detail-row"><span>Coherence time (T2)</span><strong>${node.t2} ms</strong></div>
      <div class="detail-row"><span>Connected channels</span><strong>${simulation.edges.filter((edge) => edge.a === node.id || edge.b === node.id).length}</strong></div>
    </div>`;
}

function selectedEdgeDetails() {
  const edge = simulation.edges.find((candidate) => candidate.id === simulation.selectedEdge);
  if (!edge) return `<div class="empty-state">Select a link to inspect channel telemetry.</div>`;
  return `<div class="inspector-header"><span class="inspector-icon">↔</span><span><strong>${esc(edge.id)}</strong><small>Node ${edge.a} ↔ Node ${edge.b}</small></span>${statusPill(edge.status === "failed" ? "Failed" : edge.fidelity < .94 ? "Degraded" : "Healthy", edge.status === "failed" ? "bad" : edge.fidelity < .94 ? "warning" : "good")}</div>
    <div class="detail-list">
      <div class="detail-row"><span>Generation capacity</span><strong>${edge.capacity} ebits/s</strong></div>
      <div class="detail-row"><span>Current link load</span><strong>${n(edge.usedRate, 1)} ebits/s</strong></div>
      <div class="detail-row"><span>Link fidelity</span><strong>${n(edge.fidelity, 4)}</strong></div>
      <div class="detail-row"><span>Latency</span><strong>${n(edge.latency, 1)} ms</strong></div>
      <div class="detail-row"><span>Channel state</span><strong>${esc(edge.status)}</strong></div>
    </div>`;
}

function topologySvg({ compact = false } = {}) {
  const selectedTenant = simulation.getTenant(simulation.selectedTenant);
  const lineMarkup = simulation.edges.map((edge) => {
    const a = simulation.getNode(edge.a);
    const b = simulation.getNode(edge.b);
    const x1 = a.x, y1 = a.y, x2 = b.x, y2 = b.y;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2 - 7;
    const routeTenants = simulation.tenants.filter((tenant) => (
      tenant.active && tenant.path && simulation.pathEdges(tenant.path).some((pathEdge) => pathEdge.id === edge.id)
    ));
    const lineClass = edge.status === "failed" ? "failed" : edge.fidelity < .94 ? "warning" : "";
    const routeLines = routeTenants.map((tenant, index) => {
      const offset = (index - (routeTenants.length - 1) / 2) * 3;
      return `<line class="route-line" x1="${x1}" y1="${y1 + offset}" x2="${x2}" y2="${y2 + offset}" stroke="${tenantColor(tenant)}" style="color:${tenantColor(tenant)};opacity:${tenant.id === selectedTenant?.id ? .95 : .48}"/>`;
    }).join("");
    const label = compact ? "" : `<text class="edge-label" x="${midX}" y="${midY}">${edge.id} · ${edge.capacity}</text>`;
    const pathId = `channel-${edge.id}`;
    const animation = routeTenants.length && selectedTenant && routeTenants.some((tenant) => tenant.id === selectedTenant.id)
      ? `<circle class="packet" r="3"><animateMotion dur="2.8s" repeatCount="indefinite"><mpath href="#${pathId}"/></animateMotion></circle>`
      : "";
    return `<g data-edge="${edge.id}" role="button" tabindex="0" aria-label="Inspect ${edge.id}">
      <line class="edge-hit" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>
      <line id="${pathId}" class="edge-line ${lineClass}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>
      ${routeLines}${label}${animation}
    </g>`;
  }).join("");
  const nodesMarkup = simulation.nodes.map((node) => {
    const utilization = node.used / node.capacity;
    return `<g class="node-group ${node.id === simulation.selectedNode ? "selected" : ""} ${node.available ? "" : "failed"}" data-node="${node.id}" role="button" tabindex="0" aria-label="Inspect node ${node.id}">
      ${node.available ? `<circle class="node-ring" cx="${node.x}" cy="${node.y}" r="22" stroke-dasharray="${Math.max(3, utilization * 68)} 100" transform="rotate(-90 ${node.x} ${node.y})"/>` : ""}
      <circle class="node-halo" cx="${node.x}" cy="${node.y}" r="16"/>
      <circle class="node-core" cx="${node.x}" cy="${node.y}" r="4"/>
      <text class="node-label" x="${node.x}" y="${node.y + 34}">Q${node.id}</text>
      <text class="node-memory" x="${node.x}" y="${node.y + 46}">${node.used}/${node.capacity} mem</text>
    </g>`;
  }).join("");
  return `<svg class="network-svg" viewBox="0 0 820 390" role="img" aria-label="Interactive quantum network topology">${lineMarkup}${nodesMarkup}</svg>`;
}

function tenantRoutes() {
  const active = simulation.tenants.filter((tenant) => tenant.active);
  if (!active.length) return `<div class="empty-state">No active slices. Activate a tenant to provision a route.</div>`;
  return `<div class="tenant-route-list">${active.map((tenant) => {
    const path = tenant.path?.map((node) => `Q${node}`).join(" → ") || tenant.status;
    return `<div class="route-item ${tenant.id === simulation.selectedTenant ? "selected" : ""}" data-tenant="${tenant.id}">
      <i class="route-color" style="background:${tenantColor(tenant)}"></i>
      <span class="route-item-copy"><strong>${esc(tenant.name)} · ${esc(tenant.tier)}</strong><small>${esc(path)}</small></span>
      <span>${tenant.path ? n(tenant.fidelity, 3) : "—"}</span>
    </div>`;
  }).join("")}</div>`;
}

function recentEvents(limit = 4) {
  if (!simulation.events.length) return `<div class="empty-state">No events recorded.</div>`;
  return `<div class="activity-list">${simulation.events.slice(0, limit).map((event) => {
    const kind = event.triggered ? "warning" : event.type.toLowerCase().includes("restore") ? "good" : "";
    return `<div class="activity-item"><i class="activity-bullet ${kind}"></i><span class="activity-copy"><strong>${esc(event.type)} · ${esc(event.component)}</strong><small>${esc(event.message)}</small></span><time class="activity-time">${esc(event.time)}</time></div>`;
  }).join("")}</div>`;
}

function metricProgress(label, value, color = "var(--cyan)") {
  return `<div class="metric-line"><span>${label}</span><div class="progress-track"><span style="width:${Math.max(0, Math.min(100, value * 100))}%;background:${color}"></span></div><strong>${pct(value)}</strong></div>`;
}

function overviewPage() {
  const m = simulation.metrics();
  const health = simulation.edges.some((edge) => edge.status === "failed") || simulation.nodes.some((node) => !node.available)
    ? "Degraded" : "Operational";
  const kpis = [
    ["Quantum nodes", m.nodes, "nodes", "◈", "#49d9ff", "8 in simulation topology"],
    ["Active links", m.links, "channels", "↔", "#49d9a8", `${simulation.edges.length - m.links} failed`],
    ["Active tenants", m.tenants, "slices", "▤", "#a78bfa", `${m.activeSlices} routes provisioned`],
    ["Available memories", m.freeMemory, "slots", "◉", "#49d9ff", `of ${m.totalMemory} total`],
    ["Mean fidelity", n(m.fidelity, 3), "F", "⌁", "#a78bfa", "end-to-end estimate"],
    ["Entanglement delivery", n(m.edr, 1), "ebits/s", "↗", "#49d9a8", "aggregate active slices"],
  ];
  return `${header("Network overview", "Live telemetry and slice health across the simulated quantum network.", `<button class="button secondary" data-page="topology">Open topology <span>↗</span></button><button class="button primary" data-action="optimize">Run optimization <span>⌘</span></button>`)}
    <div class="kpi-grid">${kpis.map(([label, value, unit, icon, color, foot]) => `<article class="kpi-card" style="--accent:${color}"><span class="kpi-icon">${icon}</span><div class="kpi-label">${label}</div><div class="kpi-value">${value}<span class="kpi-unit">${unit}</span></div><div class="kpi-foot">${foot}<svg class="mini-line" viewBox="0 0 42 12" aria-hidden="true"><path d="M1 9 L8 7 L14 8 L21 3 L28 6 L35 2 L41 4"/></svg></div></article>`).join("")}</div>
    <div class="status-row">
      <div class="stat-card"><span class="stat-symbol">◌</span><span class="stat-copy"><small>Network health</small><strong>${health}</strong></span><span class="stat-trail">${health === "Operational" ? "● Stable" : "● Attention"}</span></div>
      <div class="stat-card"><span class="stat-symbol">◈</span><span class="stat-copy"><small>SLA compliance</small><strong>${pct(m.sla)}</strong></span></div>
      <div class="stat-card"><span class="stat-symbol">ϟ</span><span class="stat-copy"><small>Requests at risk</small><strong>${m.requests} requests</strong></span></div>
      <div class="stat-card"><span class="stat-symbol">▤</span><span class="stat-copy"><small>Active quantum slices</small><strong>${m.activeSlices} / ${m.tenants}</strong></span></div>
    </div>
    <div class="overview-grid">
      <section class="panel network-panel"><div class="panel-heading"><div><div class="panel-title">Quantum network topology</div><div class="panel-subtitle">8 nodes · ${simulation.edges.length} channels · route state shown by tenant color</div></div><div class="panel-heading-actions"><div class="legend"><span><i></i>Active route</span><span><i class="failed"></i>Failed</span></div><button class="icon-button" data-page="topology" title="Expand topology">↗</button></div></div><div class="network-wrap">${topologySvg({ compact: true })}<div class="network-caption">Select a node or channel for live telemetry · simulation data</div></div></section>
      <section class="panel"><div class="panel-heading"><div><div class="panel-title">Active slice routes</div><div class="panel-subtitle">Route assignment & end-to-end fidelity</div></div><button class="icon-button" data-page="tenants" title="Manage slices">↗</button></div><div class="panel-body">${tenantRoutes()}</div></section>
    </div>
    <div class="bottom-grid">
      <section class="panel"><div class="panel-heading"><div><div class="panel-title">Recent event log</div><div class="panel-subtitle">Controller decisions and network state changes</div></div><button class="button secondary compact" data-page="events">View all →</button></div><div class="panel-body">${recentEvents(4)}</div></section>
      <section class="panel"><div class="panel-heading"><div><div class="panel-title">Resource utilization</div><div class="panel-subtitle">Current allocation across network resources</div></div><span class="tag">${pct(m.utilization)} MEMORY</span></div><div class="panel-body"><div class="metric-progress">${metricProgress("Memory", m.utilization)}${metricProgress("SLA health", m.sla, "var(--green)")}${metricProgress("Link availability", m.links / simulation.edges.length, "var(--purple)")}</div><div style="margin-top:16px"><button class="button secondary compact" data-page="resources">Inspect allocations →</button></div></div></section>
    </div>`;
}

function topologyPage() {
  const inspector = simulation.selectedEdge ? selectedEdgeDetails() : selectedNodeDetails();
  return `${header("Network topology", "Interactive graph of quantum sources, repeaters and entanglement channels.", `<button class="button secondary" data-action="degrade-link">Degrade selected path</button><button class="button primary" data-action="optimize">Re-route impacted slices</button>`)}
    <div class="route-layout">
      <section class="panel network-panel"><div class="panel-heading"><div><div class="panel-title">Physical network graph</div><div class="panel-subtitle">Click a node or channel to inspect live simulated telemetry</div></div><div class="legend"><span><i class="cyan"></i>Source</span><span><i class="purple"></i>Tenant route</span><span><i class="failed"></i>Failed</span></div></div><div class="network-wrap">${topologySvg()}<div class="network-caption">Animated entanglement packets follow the selected slice path</div></div></section>
      <section class="panel"><div class="panel-heading"><div><div class="panel-title">Component inspector</div><div class="panel-subtitle">${simulation.selectedEdge ? "Channel telemetry" : "Node telemetry"}</div></div><div class="row-actions"><button class="icon-action" data-action="inspect-node" title="Inspect node">N</button><button class="icon-action" data-action="inspect-link" title="Inspect link">L</button></div></div><div class="panel-body network-inspector">${inspector}<div><div class="eyebrow" style="margin-bottom:8px">OVERLAY ROUTES</div>${tenantRoutes()}</div></div></section>
    </div>
    <div class="bottom-grid">
      <section class="panel"><div class="panel-heading"><div><div class="panel-title">Link inventory</div><div class="panel-subtitle">Rate, fidelity, latency and availability</div></div><span class="tag">${simulation.edges.length} CHANNELS</span></div><div class="data-table-wrap"><table class="data-table"><thead><tr><th>LINK ID</th><th>ENDPOINTS</th><th>GENERATION</th><th>FIDELITY</th><th>LATENCY</th><th>STATE</th></tr></thead><tbody>${simulation.edges.map((edge) => `<tr data-edge="${edge.id}" class="clickable-row"><td class="mono">${edge.id}</td><td>Q${edge.a} ↔ Q${edge.b}</td><td>${edge.capacity} ebits/s</td><td>${n(edge.fidelity, 4)}</td><td>${n(edge.latency, 1)} ms</td><td>${statusPill(edge.status, edge.status === "failed" ? "bad" : edge.fidelity < .94 ? "warning" : "good")}</td></tr>`).join("")}</tbody></table></div></section>
      <section class="panel"><div class="panel-heading"><div><div class="panel-title">Node inventory</div><div class="panel-subtitle">Memory pool and coherence telemetry (T2)</div></div></div><div class="panel-body"><div class="resource-bars">${simulation.nodes.map((node) => `<div class="resource-row"><span class="resource-node">NODE ${node.id}</span><div class="stack-track"><span style="width:${node.used / node.capacity * 100}%;background:${node.available ? "var(--cyan)" : "var(--red)"}"></span></div><span class="resource-numbers">${node.used}/${node.capacity} · ${node.t2}ms</span></div>`).join("")}</div></div></section>
    </div>`;
}

function tenantTable() {
  if (!simulation.tenants.length) return `<div class="empty-state">No tenant slices configured.</div>`;
  return `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>TENANT / SLICE</th><th>PRIORITY</th><th>MIN FIDELITY</th><th>CURRENT FIDELITY</th><th>MEMORY</th><th>EDR</th><th>ACTIVE ROUTE</th><th>SLA</th><th>CONTROLS</th></tr></thead><tbody>${simulation.tenants.map((tenant) => {
    const priority = simulation.priorityDetails(tenant.priority);
    return `<tr>
      <td><span class="tenant-name"><i class="tenant-avatar" style="--tenant-color:${tenantColor(tenant)}">${esc(tenant.id.slice(-1))}</i><span><strong>${esc(tenant.name)}</strong><small>${tenant.id} · SLA ${tenant.sla}%</small></span></span></td>
      <td><select data-priority="${tenant.id}" aria-label="Priority for ${esc(tenant.name)}">${[5, 4, 3, 2, 1].map((value) => `<option value="${value}" ${Number(tenant.priority) === value ? "selected" : ""}>${simulation.priorityDetails(value).tier}</option>`).join("")}</select></td>
      <td><input data-fidelity="${tenant.id}" aria-label="Minimum fidelity for ${esc(tenant.name)}" type="number" min=".8" max=".999" step=".001" value="${n(tenant.minFidelity, 3)}"></td>
      <td class="mono">${tenant.path ? n(tenant.fidelity, 4) : "—"}</td>
      <td class="mono">${tenant.allocatedSlots ? `${tenant.allocatedSlots} × ${tenant.path.length} nodes` : "—"}</td>
      <td class="mono">${tenant.path ? `${n(tenant.deliveryRate, 1)} ebits/s` : "—"}</td>
      <td class="mono">${tenant.path ? tenant.path.map((id) => `Q${id}`).join(" → ") : "No route"}</td>
      <td>${statusPill(tenant.active ? tenant.status : "Inactive", tenantStatusClass(tenant))}</td>
      <td><div class="row-actions"><button class="icon-action" data-action="allocate-tenant" data-id="${tenant.id}" title="Allocate slice resources">↗</button><button class="icon-action" data-action="release-tenant" data-id="${tenant.id}" title="Release quantum memory">⌑</button><button class="icon-action" data-action="toggle-tenant" data-id="${tenant.id}" title="${tenant.active ? "Deactivate" : "Activate"} slice">${tenant.active ? "Ⅱ" : "▶"}</button></div></td>
    </tr>`;
  }).join("")}</tbody></table></div>`;
}

function tenantsPage() {
  const active = simulation.tenants.filter((tenant) => tenant.active).length;
  const totalAllocated = simulation.nodes.reduce((sum, node) => sum + node.used, 0);
  return `${header("Tenant slices", "Manage isolated entanglement routes, fidelity policies and priority-aware memory reservations.", `<button class="button secondary" data-action="optimize">Auto-allocate</button><button class="button primary" data-action="open-tenant-dialog"><span class="plus">+</span> Create tenant</button>`)}
    <div class="status-row">
      <div class="stat-card"><span class="stat-symbol">▤</span><span class="stat-copy"><small>Configured slices</small><strong>${simulation.tenants.length}</strong></span></div>
      <div class="stat-card"><span class="stat-symbol">◈</span><span class="stat-copy"><small>Active slices</small><strong>${active}</strong></span></div>
      <div class="stat-card"><span class="stat-symbol">◉</span><span class="stat-copy"><small>Memory reservations</small><strong>${totalAllocated} slots</strong></span></div>
      <div class="stat-card"><span class="stat-symbol">↗</span><span class="stat-copy"><small>Routes meeting SLA</small><strong>${pct(simulation.metrics().sla)}</strong></span></div>
    </div>
    <section class="panel"><div class="panel-heading"><div><div class="panel-title">Multi-tenant slice manager</div><div class="panel-subtitle">Per-tenant controls · memory reservations are isolated and capacity-checked</div></div><span class="health-chip good"><i class="dot"></i>Isolation enforced</span></div>${tenantTable()}</section>
    <div class="bottom-grid"><section class="panel"><div class="panel-heading"><div><div class="panel-title">Slice isolation model</div><div class="panel-subtitle">Reserved resources are accounted independently for each tenant</div></div></div><div class="panel-body"><div class="metric-progress">${metricProgress("Memory reserved", totalAllocated / simulation.metrics().totalMemory)}${metricProgress("Node capacity safety", 1 - Math.max(...simulation.nodes.map((node) => node.used / node.capacity)), "var(--green)")}</div><p class="muted-note" style="margin:14px 0 0">Priority maps to a per-route memory reservation (1–4 slots per path node). Allocation checks every path node and channel before committing; no reservation can exceed the physical pool.</p></div></section><section class="panel"><div class="panel-heading"><div><div class="panel-title">Provisioning policy</div><div class="panel-subtitle">Higher-priority tenants are considered first</div></div></div><div class="panel-body">${[5,4,3,2,1].map((priority) => `<div class="detail-row"><span><span class="priority-pill" style="--priority-color:${simulation.priorityDetails(priority).color}">${simulation.priorityDetails(priority).tier}</span></span><strong>${simulation.priorityDetails(priority).slots} memory slots / node</strong></div>`).join("")}<p class="muted-note" style="margin:12px 0 0">This is an allocation heuristic for simulation, not a physical quantum memory scheduler.</p></div></section></div>`;
}

function routingPage() {
  const tenant = simulation.getTenant(routingTenantId) || simulation.tenants[0];
  if (!tenant) return `${header("Adaptive routing", "Priority-aware route analysis.")}<div class="panel empty-state">Create a tenant slice to calculate routes.</div>`;
  const candidates = simulation.candidatePaths(tenant).filter((candidate) => candidate.fidelity >= tenant.minFidelity);
  const selected = tenant.path ? candidates.find((candidate) => candidate.path.join(",") === tenant.path.join(",")) : null;
  const options = candidates.slice(0, 5);
  return `${header("Adaptive entanglement routing", "Compare feasible paths using fidelity, generation capacity, latency and available memory.", `<button class="button primary" data-action="optimize">Run route optimization <span>↗</span></button>`)}
    <div class="route-layout">
      <section class="panel"><div class="panel-heading"><div><div class="panel-title">Route request</div><div class="panel-subtitle">Simple-path enumeration with constraint filtering and weighted scoring</div></div><span class="tag">HEURISTIC MODEL</span></div>
        <div class="panel-body">
          <div class="route-controls"><div class="field"><label>Tenant slice<select data-route-tenant>${simulation.tenants.map((item) => `<option value="${item.id}" ${item.id === tenant.id ? "selected" : ""}>${esc(item.name)} · ${item.tier}</option>`).join("")}</select></label></div>
            <div class="field"><label>Source node<select data-route-endpoint="source" data-id="${tenant.id}">${simulation.nodes.map((node) => `<option value="${node.id}" ${node.id === Number(tenant.source) ? "selected" : ""}>Q${node.id}</option>`).join("")}</select></label></div>
            <div class="field"><label>Destination node<select data-route-endpoint="destination" data-id="${tenant.id}">${simulation.nodes.map((node) => `<option value="${node.id}" ${node.id === Number(tenant.destination) ? "selected" : ""}>Q${node.id}</option>`).join("")}</select></label></div>
            <button class="button secondary" data-action="optimize">Calculate route</button>
          </div>
          <div class="path-summary">${[
            ["Optimal path", selected ? `${selected.hops} hops` : "Unavailable"],
            ["Expected fidelity", selected ? n(selected.fidelity, 4) : "—"],
            ["Estimated latency", selected ? `${n(selected.latency, 1)} ms` : "—"],
            ["Generation rate", selected ? `${n(tenant.deliveryRate, 1)} ebits/s` : "—"],
          ].map(([label, value]) => `<div class="path-metric"><small>${label}</small><strong>${value}</strong><span>${label === "Optimal path" && tenant.path ? tenant.path.map((id) => `Q${id}`).join(" → ") : label === "Expected fidelity" ? `threshold ${n(tenant.minFidelity, 3)}` : label === "Generation rate" ? "current reservation" : "simulation estimate"}</span></div>`).join("")}</div>
          <div class="eyebrow" style="margin:14px 0 8px">FEASIBLE ALTERNATIVES · ${options.length}</div>
          <div class="path-options">${options.length ? options.map((candidate, index) => `<div class="path-option ${tenant.path?.join(",") === candidate.path.join(",") ? "best" : ""}"><span class="rank">0${index + 1}</span><span><strong>${candidate.path.map((id) => `Q${id}`).join(" → ")} ${tenant.path?.join(",") === candidate.path.join(",") ? "· SELECTED" : ""}</strong><small>${candidate.hops} hops · F ${n(candidate.fidelity, 4)} · ${n(candidate.latency, 1)} ms · ${candidate.rate} ebits/s capacity</small></span><span class="path-score">${n(simulation.routeScore(tenant, candidate), 3)}</span></div>`).join("") : `<div class="empty-state">No paths meet current fidelity and link availability constraints.</div>`}</div>
          <div class="explain-box"><strong>Why this route?</strong> Feasible candidates meet the tenant fidelity threshold and link availability. The route heuristic scores end-to-end fidelity, bottleneck generation rate, latency margin and path memory availability. Priority determines admission order and memory reservation; it is not presented as a globally optimal solver.</div>
        </div>
      </section>
      <section class="panel network-panel"><div class="panel-heading"><div><div class="panel-title">Route on topology</div><div class="panel-subtitle">${esc(tenant.name)} selected path highlighted</div></div><span class="health-chip ${tenant.path ? tenantStatusClass(tenant) : "bad"}"><i class="dot"></i>${tenant.path ? esc(tenant.status) : "No route"}</span></div><div class="network-wrap">${topologySvg()}<div class="network-caption">Path colors correspond to tenant route overlays</div></div></section>
    </div>
    <div class="simulation-note section-spacer"><span>ⓘ</span><span><strong>Simulation only.</strong> Path fidelity is estimated as the product of link fidelities with a per-swap factor and simplified coherence penalty. This dashboard does not control quantum hardware.</span></div>`;
}

function resourcePage() {
  const total = simulation.nodes.reduce((sum, node) => sum + node.capacity, 0);
  const used = simulation.nodes.reduce((sum, node) => sum + node.used, 0);
  const colors = new Map(simulation.tenants.map((tenant) => [tenant.id, tenantColor(tenant)]));
  return `${header("Quantum resource allocation", "Memory pools and channel capacity with priority-aware reservation accounting.", `<button class="button secondary" data-action="optimize">Auto-allocate by priority</button>`)}
    <div class="status-row"><div class="stat-card"><span class="stat-symbol">◈</span><span class="stat-copy"><small>Total memory capacity</small><strong>${total} slots</strong></span></div><div class="stat-card"><span class="stat-symbol">◉</span><span class="stat-copy"><small>Allocated / free</small><strong>${used} / ${total - used}</strong></span></div><div class="stat-card"><span class="stat-symbol">↔</span><span class="stat-copy"><small>Generation capacity</small><strong>${simulation.edges.filter((edge) => edge.status !== "failed").reduce((sum, edge) => sum + edge.capacity, 0)} ebits/s</strong></span></div><div class="stat-card"><span class="stat-symbol">▥</span><span class="stat-copy"><small>Network utilization</small><strong>${pct(used / total)}</strong></span></div></div>
    <div class="resource-grid">
      <section class="panel"><div class="panel-heading"><div><div class="panel-title">Per-node memory allocation</div><div class="panel-subtitle">Stacked tenant reservations · physical capacity is enforced</div></div><span class="tag">${simulation.nodes.length} NODES</span></div><div class="panel-body"><div class="resource-bars">${simulation.nodes.map((node) => {
        const tenants = simulation.tenants.filter((tenant) => tenant.active && tenant.path?.includes(node.id));
        const parts = tenants.map((tenant) => `<span title="${esc(tenant.name)}: ${tenant.allocatedSlots} slots" style="width:${tenant.allocatedSlots / node.capacity * 100}%;background:${colors.get(tenant.id)}"></span>`).join("");
        const free = Math.max(0, node.capacity - node.used);
        return `<div class="resource-row"><span class="resource-node">NODE ${node.id}</span><div class="stack-track">${parts}<span title="Free: ${free}" style="width:${free / node.capacity * 100}%;background:#273341"></span></div><span class="resource-numbers">${node.used} / ${node.capacity} slots</span></div>`;
      }).join("")}</div><div class="resource-legend">${simulation.tenants.map((tenant) => `<span><i style="background:${tenantColor(tenant)}"></i>${esc(tenant.name)}</span>`).join("")}<span><i style="background:#273341"></i>Free memory</span></div></div></section>
      <section class="panel"><div class="panel-heading"><div><div class="panel-title">Tenant reservations</div><div class="panel-subtitle">Manual release or allocate controls</div></div></div><div class="panel-body"><div class="allocation-card">${simulation.tenants.map((tenant) => `<div class="allocation-tenant"><span><strong>${esc(tenant.name)}</strong><small>Priority ${tenant.priority} · ${tenant.path ? tenant.path.map((id) => `Q${id}`).join("–") : tenant.status}</small></span><span>${tenant.allocatedSlots ? `${tenant.allocatedSlots} × ${tenant.path.length}` : "—"}</span><button class="button compact ${tenant.path ? "secondary" : "primary"}" data-action="${tenant.path ? "release-tenant" : "allocate-tenant"}" data-id="${tenant.id}">${tenant.path ? "Release" : "Allocate"}</button></div>`).join("")}</div><div class="explain-box"><strong>Allocation guard:</strong> node reservations are checked against each node's physical slot capacity before any allocation is committed. Tenants do not share reservation records.</div></div></section>
    </div>
    <section class="panel section-spacer"><div class="panel-heading"><div><div class="panel-title">Entanglement generation capacity by link</div><div class="panel-subtitle">Allocated tenant EDR compared with simulated channel capacity</div></div></div><div class="panel-body"><div class="resource-bars">${simulation.edges.map((edge) => `<div class="resource-row"><span class="resource-node">${edge.id}</span><div class="stack-track"><span style="width:${Math.min(100, edge.usedRate / Math.max(1, edge.capacity) * 100)}%;background:${edge.status === "failed" ? "var(--red)" : "var(--purple)"}"></span></div><span class="resource-numbers">${n(edge.usedRate, 1)} / ${edge.capacity} ebits/s</span></div>`).join("")}</div></div></section>`;
}

function eventLog() {
  if (!simulation.events.length) return `<div class="empty-state">No network events yet. Use a simulator control to create an event.</div>`;
  return `<div class="log-list">${simulation.events.map((event) => `<div class="log-entry"><i class="log-dot ${event.triggered ? "triggered" : ""}"></i><span><span class="log-title">${esc(event.type)} · ${esc(event.component)}<time>${esc(event.time)}</time></span><div class="log-message">${esc(event.message)}</div><div class="log-reason"><strong>RISK ${Math.round(event.risk * 100)}% · ${event.triggered ? "CONTROLLER FIRED" : "MONITOR ONLY"}:</strong> ${esc(event.reason)}</div></span></div>`).join("")}</div>`;
}

function eventsPage() {
  return `${header("Event-triggered adaptation", "Monitor discrete changes, assess SLA risk, and reconfigure only impacted slices.", `<button class="button secondary" data-action="random-event">Generate random event <span>ϟ</span></button>`)}
    <div class="event-layout">
      <div>
        <section class="panel"><div class="panel-heading"><div><div class="panel-title">Event injection controls</div><div class="panel-subtitle">Each control changes simulated telemetry and records controller action</div></div><span class="tag">THRESHOLD ${pct(simulation.eventThreshold)}</span></div><div class="panel-body">
          <div class="event-buttons">
            <button class="event-button critical" data-action="link-failure"><i class="event-symbol">×</i><span><strong>Simulate link failure</strong><small>Disable an active channel</small></span></button>
            <button class="event-button critical" data-action="node-failure"><i class="event-symbol">⊗</i><span><strong>Simulate node failure</strong><small>Take an in-use node offline</small></span></button>
            <button class="event-button" data-action="degrade-link"><i class="event-symbol">⌁</i><span><strong>Degrade link fidelity</strong><small>Reduce fidelity and rate</small></span></button>
            <button class="event-button" data-action="degrade-rate"><i class="event-symbol">↘</i><span><strong>Reduce generation rate</strong><small>Throttle an active channel</small></span></button>
            <button class="event-button" data-action="degrade-coherence"><i class="event-symbol">◌</i><span><strong>Degrade memory coherence</strong><small>Reduce node T2 lifetime</small></span></button>
            <button class="event-button critical" data-action="add-critical"><i class="event-symbol">+</i><span><strong>Add critical tenant</strong><small>Priority-5 slice arrival</small></span></button>
            <button class="event-button critical" data-action="sla-violation"><i class="event-symbol">!</i><span><strong>Trigger SLA violation risk</strong><small>Stress active route fidelity</small></span></button>
            <button class="event-button" data-action="restore-network"><i class="event-symbol">↻</i><span><strong>Restore network</strong><small>Restore deterministic baseline</small></span></button>
            <button class="event-button" data-action="optimize"><i class="event-symbol">↗</i><span><strong>Run adaptive optimization</strong><small>Recalculate all active slices</small></span></button>
          </div>
          <div class="event-threshold"><div class="threshold-head"><span>SLA risk trigger threshold</span><strong id="threshold-value">${pct(simulation.eventThreshold)}</strong></div><input type="range" min="5" max="90" value="${simulation.eventThreshold * 100}" data-threshold aria-label="SLA risk trigger threshold"><p class="muted-note">The controller acts when estimated event risk exceeds this setting. Failed components affecting an active route receive a high modeled risk score.</p></div>
        </div></section>
        <section class="panel section-spacer"><div class="panel-heading"><div><div class="panel-title">Before / after adaptation</div><div class="panel-subtitle">Most recent event impact and route decision</div></div></div><div class="panel-body">${eventImpact()}</div></section>
      </div>
      <section class="panel"><div class="panel-heading"><div><div class="panel-title">Event & controller log</div><div class="panel-subtitle">${simulation.events.length} recent recorded events</div></div><span class="health-chip"><i class="dot"></i>Live monitor</span></div><div class="panel-body">${eventLog()}</div></section>
    </div>
    <div class="simulation-note section-spacer"><span>ϟ</span><span><strong>Event-driven control.</strong> The simulator records the component, impacted tenants, risk estimate, trigger decision and resulting route state. A monitor-only event retains the current allocation; there is no continuous network-wide optimization loop.</span></div>`;
}

function eventImpact() {
  const event = simulation.events[0];
  if (!event) return `<div class="empty-state">Trigger an event to inspect affected routes.</div>`;
  const before = event.before || [];
  const after = event.after || [];
  if (!before.length && !after.length) return `<div class="muted-note">${esc(event.reason)}</div>`;
  const ids = [...new Set([...before.map((item) => item.id), ...after.map((item) => item.id)])];
  return `<div class="data-table-wrap"><table class="data-table" style="min-width:650px"><thead><tr><th>TENANT</th><th>BEFORE ROUTE / MEMORY</th><th>AFTER ROUTE / MEMORY</th><th>OUTCOME</th></tr></thead><tbody>${ids.map((id) => {
    const old = before.find((item) => item.id === id);
    const next = after.find((item) => item.id === id);
    const beforePath = old?.path?.map((node) => `Q${node}`).join(" → ") || "No route";
    const afterPath = next?.path?.map((node) => `Q${node}`).join(" → ") || "No route";
    const beforeMemory = old?.allocatedSlots ? `${old.allocatedSlots} slots/node` : "0 slots";
    const afterMemory = next?.allocatedSlots ? `${next.allocatedSlots} slots/node` : "0 slots";
    return `<tr><td>${esc(id)}</td><td class="mono">${beforePath}<br><span class="muted-note">${beforeMemory}</span></td><td class="mono">${afterPath}<br><span class="muted-note">${afterMemory}</span></td><td>${statusPill(next?.status ?? old?.status ?? "—", next?.path ? "good" : "warning")}</td></tr>`;
  }).join("")}</tbody></table></div>`;
}

function simulationControls() {
  return `<div class="simulation-controls"><span class="control-label">SIMULATION</span><button class="button ${running ? "secondary" : "primary"} compact" data-action="${running ? "pause" : "start"}">${running ? "Ⅱ Pause" : "▶ Start"}</button><button class="button secondary compact" data-action="step">Step</button><button class="button secondary compact" data-action="reset">Reset</button><button class="button secondary compact" data-action="random-event">Random event ϟ</button><button class="button secondary compact" data-action="optimize">Adaptive optimization ↗</button><label class="speed-control">Speed<select data-speed><option value="0.5" ${speed === .5 ? "selected" : ""}>0.5×</option><option value="1" ${speed === 1 ? "selected" : ""}>1×</option><option value="2" ${speed === 2 ? "selected" : ""}>2×</option><option value="4" ${speed === 4 ? "selected" : ""}>4×</option></select></label></div>`;
}

const STRATEGIES = [
  { key: "static", title: "Static allocation", color: "#49d9a8", className: "green" },
  { key: "routing", title: "Routing-only", color: "#a78bfa", className: "purple" },
  { key: "proposed", title: "Proposed framework", color: "#49d9ff", className: "" },
];

function chartSvg(metric, options = {}) {
  const { min = 0, max = 1, digits = 0, suffix = "%" } = options;
  const history = simulation.history.length ? simulation.history : [{ time: 0, strategies: simulation.evaluateStrategies() }];
  const width = 520, height = 190, left = 44, right = 12, top = 12, bottom = 25;
  const chartWidth = width - left - right, chartHeight = height - top - bottom;
  const x = (index) => left + (history.length <= 1 ? chartWidth / 2 : index * chartWidth / (history.length - 1));
  const y = (value) => top + chartHeight - (Math.max(min, Math.min(max, value)) - min) / (max - min || 1) * chartHeight;
  const grid = [0, .25, .5, .75, 1].map((fraction) => {
    const value = min + (max - min) * fraction;
    const py = y(value);
    const axisLabel = suffix === "%" ? `${(value * 100).toFixed(digits)}%` : `${value.toFixed(digits)}${suffix}`;
    return `<line class="chart-grid" x1="${left}" y1="${py}" x2="${width - right}" y2="${py}"/><text class="chart-label" x="${left - 7}" y="${py + 3}" text-anchor="end">${axisLabel}</text>`;
  }).join("");
  const series = STRATEGIES.map((strategy) => {
    const points = history.map((entry, index) => [x(index), y(entry.strategies?.[strategy.key]?.[metric] ?? 0)]);
    const path = points.map(([px, py], index) => `${index ? "L" : "M"}${px},${py}`).join(" ");
    const circles = points.map(([px, py]) => `<circle class="chart-point" cx="${px}" cy="${py}" r="2.4" fill="${strategy.color}"/>`).join("");
    return `<path class="chart-line" d="${path}" stroke="${strategy.color}"/>${circles}`;
  }).join("");
  const xLabels = history.length > 1 ? [0, Math.floor((history.length - 1) / 2), history.length - 1].map((index) => `<text class="chart-label" x="${x(index)}" y="${height - 5}" text-anchor="middle">epoch ${history[index].time}</text>`).join("") : `<text class="chart-label" x="${x(0)}" y="${height - 5}" text-anchor="middle">epoch 0</text>`;
  return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(metric)} simulation chart">${grid}${xLabels}${series}</svg>`;
}

function chartPanel(title, subtitle, metric, options) {
  return `<section class="panel"><div class="panel-heading"><div><div class="panel-title">${title}</div><div class="panel-subtitle">${subtitle}</div></div><span class="tag">SIMULATION</span></div><div class="chart-box">${chartSvg(metric, options)}</div><div class="chart-legend">${STRATEGIES.map((strategy) => `<span><i class="${strategy.className}" style="background:${strategy.color}"></i>${strategy.title}</span>`).join("")}</div></section>`;
}

function strategyBarChart(metric, maxValue, suffix = "") {
  const data = simulation.evaluateStrategies();
  const width = 520, height = 175, left = 150, right = 42, barHeight = 17;
  const rowGap = 48;
  const plotWidth = width - left - right;
  const grid = [0, .25, .5, .75, 1].map((fraction) => {
    const x = left + fraction * plotWidth;
    return `<line class="chart-grid" x1="${x}" y1="8" x2="${x}" y2="${height - 17}"/><text class="chart-label" x="${x}" y="${height - 3}" text-anchor="middle">${Math.round(maxValue * fraction)}${suffix}</text>`;
  }).join("");
  const bars = STRATEGIES.map((strategy, index) => {
    const value = data[strategy.key][metric];
    const widthValue = Math.min(plotWidth, value / maxValue * plotWidth);
    const y = 18 + index * rowGap;
    return `<text class="chart-label" x="${left - 10}" y="${y + 12}" text-anchor="end">${strategy.title}</text><rect x="${left}" y="${y}" width="${plotWidth}" height="${barHeight}" rx="3" fill="#202a36"/><rect x="${left}" y="${y}" width="${widthValue}" height="${barHeight}" rx="3" fill="${strategy.color}" opacity=".88"/><text class="chart-label" x="${Math.min(width - 6, left + widthValue + 7)}" y="${y + 12}" fill="#cbd5df">${n(value, 1)}${suffix}</text>`;
  }).join("");
  return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${metric} strategy comparison bar chart">${grid}${bars}</svg>`;
}

function analyticsPage() {
  const data = simulation.evaluateStrategies();
  return `${header("Performance analytics", "Compare static, routing-only and proposed control policies under the current simulated conditions.", `<button class="button primary" data-action="step">Advance simulation <span>→</span></button>`)}
    ${simulationControls()}
    <div class="simulation-note" style="margin-bottom:13px"><span>ⓘ</span><span><strong>Simulation data, not measured research results.</strong> Values are generated by the deterministic browser-side topology and heuristic models. Static uses cached shortest paths, routing-only uses shortest feasible paths with one memory slot, and Proposed uses priority-aware path scoring and tier-based memory allocation.</span></div>
    <div class="analytics-grid">${chartPanel("Entanglement delivery rate", "Aggregate estimated rate · ebits/s", "edr", { min: 0, max: 45, digits: 0, suffix: "" })}${chartPanel("Average end-to-end fidelity", "Mean across routed slices", "fidelity", { min: .75, max: 1, digits: 0, suffix: "%" })}${chartPanel("Quantum memory utilization", "Allocated node slots / total capacity", "utilization", { min: 0, max: 1, digits: 0, suffix: "%" })}${chartPanel("SLA violation rate", "Share of active tenant slices at risk", "violation", { min: 0, max: 1, digits: 0, suffix: "%" })}</div>
    <section class="panel section-spacer"><div class="panel-heading"><div><div class="panel-title">Strategy delivery comparison</div><div class="panel-subtitle">Current-state simulation output · aggregate ebits/s</div></div><span class="tag">BAR COMPARISON</span></div><div class="chart-box" style="height:195px">${strategyBarChart("edr", 45)}</div></section>
    <div class="bottom-grid">
      <section class="panel"><div class="panel-heading"><div><div class="panel-title">Current strategy comparison</div><div class="panel-subtitle">Recomputed from current deterministic network state</div></div></div><div class="panel-body"><table class="comparison-table"><thead><tr><th>Strategy</th><th>EDR (ebits/s)</th><th>Mean F</th><th>Memory</th><th>SLA risk</th><th>Latency</th><th>Reconfigs</th></tr></thead><tbody>${STRATEGIES.map((strategy) => {
        const value = data[strategy.key];
        return `<tr><td><i class="strategy-mark ${strategy.className}" style="background:${strategy.color}"></i>${strategy.title}</td><td>${n(value.edr, 1)}</td><td>${n(value.fidelity, 4)}</td><td>${pct(value.utilization)}</td><td>${pct(value.violation)}</td><td>${n(value.latency, 1)} ms</td><td>${value.reconfigurations}</td></tr>`;
      }).join("")}</tbody></table></div></section>
      <section class="panel"><div class="panel-heading"><div><div class="panel-title">Control-plane overhead</div><div class="panel-subtitle">Event-triggered reconfiguration count and estimated route latency</div></div></div><div class="panel-body"><div class="metric-progress">${metricProgress("Current SLA", simulation.metrics().sla, "var(--green)")}${metricProgress("Memory utilization", simulation.metrics().utilization)}${metricProgress("Link availability", simulation.metrics().links / simulation.edges.length, "var(--purple)")}</div><div class="detail-list" style="margin-top:12px"><div class="detail-row"><span>Reconfigurations</span><strong>${simulation.reconfigurations}</strong></div><div class="detail-row"><span>Mean latency</span><strong>${n(simulation.metrics().latency, 2)} ms</strong></div></div></div></section>
    </div>`;
}

function algorithmsPage() {
  const algorithms = [
    ["Simple-path search & weighted routing", "Enumerates simple paths through the 8-node graph, then filters by link status and minimum fidelity. A weighted heuristic ranks feasible paths.", "Topology, fidelity floor, channel capacity, delay and node memory.", "Highest-scoring feasible path; no route when constraints cannot be met.", "O(P × L)", "The route score combines fidelity, bottleneck rate, latency margin and available memory. Priority controls admission order."],
    ["Priority-ordered admission", "Processes active slices by descending tenant priority. Priority tiers reserve 1–4 memory slots at every node on a selected route.", "Active tenant requests, priority weights and current resource reservations.", "Tenant route plus isolated per-node memory and link-rate reservations.", "O(T log T + T·P)", "Implements priority-aware multi-tenant allocation with explicit capacity checks; it is a heuristic, not a global optimum."],
    ["Greedy memory and bandwidth allocation", "Tests the route's required memory and target EDR against every node and edge before committing; rejected allocations do not consume resources.", "Candidate route, tenant slot requirement and residual node/link capacity.", "Accepted reservation or a capacity/fidelity constraint status.", "O(T·P·(V+E))", "Prevents memory over-allocation and approximates link sharing for the interactive model."],
    ["Event-driven controller", "Derives affected slices from their current route. It re-runs allocation only for impacted tenants when modeled risk crosses the configurable threshold.", "Discrete component change, affected route set, risk estimate and trigger threshold.", "Trigger decision, updated routes, allocations and an auditable event record.", "O(A·P·(V+E))", "Makes reconfiguration demand-driven and exposes before/after route decisions."],
    ["End-to-end fidelity estimate", "Multiplies link fidelities, applies a 0.995 per-swap factor, and adds a small simplified penalty for reduced path-node T2.", "Link fidelity measurements, hop count and path-node coherence state.", "Estimated end-to-end fidelity compared with each tenant's minimum.", "O(H)", "A compact abstract estimate inspired by the simulator; it is not a quantum-state or hardware model."],
    ["Dijkstra shortest-path baseline", "Static and routing-only baselines rank routes by accumulated channel latency. The proposed heuristic separately weighs multiple QoS/resource factors.", "Graph links with latency weights and current availability.", "Shortest feasible route for baseline comparisons.", "O((V+E) log V)", "Provides a familiar reference point; topology path enumeration is used for the proposed multi-constraint ranking."],
  ];
  return `${header("Algorithm notes", "Inspectable description of the simulated routing, allocation and event-control mechanisms.", `<button class="button secondary" data-page="routing">Open route analysis <span>↗</span></button>`)}
    <div class="simulation-note" style="margin-bottom:13px"><span>ⓘ</span><span><strong>Scope:</strong> the dashboard is a deterministic educational simulation. Complexity figures are high-level bounds and depend on graph representation/path count; no algorithm communicates with quantum equipment.</span></div>
    <div class="algorithm-grid">${algorithms.map(([title, purpose, input, output, complexity, contribution]) => `<article class="algorithm-card"><div class="algorithm-top"><h3>${title}</h3><span class="complexity">${complexity}</span></div><p>${purpose}</p><div class="algorithm-facts"><div><small>Input</small><strong>${input}</strong></div><div><small>Output</small><strong>${output}</strong></div><div style="grid-column:1/-1"><small>Research contribution</small><strong>${contribution}</strong></div></div></article>`).join("")}</div>`;
}

function render() {
  updateHeader();
  const pages = {
    overview: overviewPage,
    topology: topologyPage,
    tenants: tenantsPage,
    routing: routingPage,
    resources: resourcePage,
    events: eventsPage,
    analytics: analyticsPage,
    algorithms: algorithmsPage,
  };
  content.innerHTML = (pages[currentPage] || overviewPage)();
  document.querySelectorAll("[data-edge]").forEach((element) => {
    element.addEventListener("click", () => {
      simulation.selectedEdge = element.dataset.edge;
      render();
    });
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") element.click();
    });
  });
  document.querySelectorAll("[data-node]").forEach((element) => {
    element.addEventListener("click", () => {
      simulation.selectedNode = Number(element.dataset.node);
      simulation.selectedEdge = null;
      render();
    });
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") element.click();
    });
  });
  document.querySelectorAll("[data-tenant]").forEach((element) => {
    element.addEventListener("click", (event) => {
      const id = event.currentTarget.dataset.tenant;
      if (simulation.getTenant(id)) {
        simulation.selectedTenant = id;
        routingTenantId = id;
        render();
      }
    });
  });
}

function routeToPage(page) {
  currentPage = page;
  render();
}

function openTenantDialog() {
  const form = document.querySelector("#tenant-form");
  const source = form.elements.source;
  const destination = form.elements.destination;
  source.innerHTML = simulation.nodes.map((node) => `<option value="${node.id}">Q${node.id}</option>`).join("");
  destination.innerHTML = simulation.nodes.map((node) => `<option value="${node.id}">Q${node.id}</option>`).join("");
  source.value = "0";
  destination.value = "7";
  dialog.showModal();
}

document.addEventListener("click", (event) => {
  const navigation = event.target.closest("[data-page]");
  if (!navigation) return;
  currentPage = navigation.dataset.page;
  if (currentPage === "routing") routingTenantId = simulation.selectedTenant;
  sidebar.classList.remove("open");
  render();
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const { action, id } = button.dataset;
  switch (action) {
    case "toggle-sidebar":
      sidebar.classList.toggle("open");
      break;
    case "settings":
      routeToPage("events");
      toast("Simulation controls and event thresholds are available in Event monitor.");
      break;
    case "open-tenant-dialog":
      openTenantDialog();
      break;
    case "optimize":
      simulation.runAllOptimization();
      toast("Priority-aware optimization completed for active slices.");
      render();
      break;
    case "link-failure":
      simulation.simulateLinkFailure();
      toast("Link failure injected; impacted active slices were evaluated.");
      render();
      break;
    case "node-failure":
      simulation.simulateNodeFailure();
      toast("Node failure injected; impacted active slices were evaluated.");
      render();
      break;
    case "degrade-link":
      simulation.degradeLink(simulation.selectedEdge);
      toast("Link fidelity and generation capacity degraded.");
      render();
      break;
    case "degrade-rate":
      simulation.reduceGenerationRate();
      toast("Entanglement generation rate reduction recorded.");
      render();
      break;
    case "degrade-coherence":
      simulation.degradeCoherence();
      toast("Memory coherence degradation recorded.");
      render();
      break;
    case "add-critical":
      simulation.addCriticalTenant();
      toast("Critical tenant arrived; priority-aware allocation evaluated.");
      render();
      break;
    case "sla-violation":
      simulation.triggerSlaViolation();
      toast("SLA risk injected; controller decision recorded.");
      render();
      break;
    case "restore-network":
      simulation.restoreNetwork();
      toast("Network restored to deterministic baseline.");
      render();
      break;
    case "random-event":
      simulation.randomEvent();
      toast("A deterministic network event was injected.");
      render();
      break;
    case "allocate-tenant":
      simulation.adapt("Manual tenant allocation.", [id]);
      simulation.events.unshift({
        id: `${Date.now()}-alloc`,
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        type: "Manual allocation",
        component: id,
        message: `${simulation.getTenant(id)?.name || id} requested a memory and route reservation.`,
        risk: 0,
        triggered: true,
        reason: "Operator allocation request passed through the same capacity and fidelity guards.",
        before: [],
        after: [],
      });
      toast("Tenant allocation request processed.");
      render();
      break;
    case "release-tenant":
      simulation.releaseTenantMemory(id);
      toast("Tenant route and memory reservation released.");
      render();
      break;
    case "toggle-tenant": {
      const tenant = simulation.getTenant(id);
      if (tenant) {
        simulation.toggleTenant(id, !tenant.active);
        render();
      }
      break;
    }
    case "start":
      startSimulation();
      render();
      break;
    case "pause":
      pauseSimulation();
      render();
      break;
    case "step":
      simulation.step();
      render();
      break;
    case "reset":
      pauseSimulation();
      simulation.reset();
      routingTenantId = simulation.selectedTenant;
      toast("Simulation reset to seed 23.");
      render();
      break;
    case "inspect-node":
      simulation.selectedEdge = null;
      render();
      break;
    case "inspect-link":
      simulation.selectedEdge = simulation.edges[0]?.id ?? null;
      render();
      break;
    default:
      break;
  }
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (target.matches("[data-priority]")) {
    simulation.setTenantPriority(target.dataset.priority, target.value);
    render();
  } else if (target.matches("[data-fidelity]")) {
    simulation.setTenantFidelity(target.dataset.fidelity, target.value);
    render();
  } else if (target.matches("[data-route-tenant]")) {
    routingTenantId = target.value;
    simulation.selectedTenant = target.value;
    render();
  } else if (target.matches("[data-route-endpoint]")) {
    const tenant = simulation.getTenant(target.dataset.id);
    if (tenant) {
      tenant[target.dataset.routeEndpoint] = Number(target.value);
      simulation.adapt("Tenant endpoint changed.", [tenant.id]);
      routingTenantId = tenant.id;
      render();
    }
  } else if (target.matches("[data-threshold]")) {
    simulation.eventThreshold = Number(target.value) / 100;
    render();
  } else if (target.matches("[data-speed]")) {
    speed = Number(target.value);
    if (running) startSimulation();
  }
});

document.addEventListener("input", (event) => {
  if (event.target.matches("[data-threshold]")) {
    simulation.eventThreshold = Number(event.target.value) / 100;
    const label = document.querySelector("#threshold-value");
    if (label) label.textContent = pct(simulation.eventThreshold);
  }
});

document.querySelector("#tenant-form").addEventListener("submit", (event) => {
  if (event.submitter?.id !== "create-tenant") return;
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const count = simulation.tenants.length + 1;
  const id = count <= 26 ? `T-${String.fromCharCode(64 + count)}` : `T-${count}`;
  const priority = Number(formData.get("priority"));
  const tier = simulation.priorityDetails(priority);
  const tenant = {
    id,
    name: String(formData.get("name")).trim(),
    priority,
    tier: tier.tier,
    sla: Number(formData.get("sla")),
    minFidelity: Number(formData.get("fidelity")),
    source: Number(formData.get("source")),
    destination: Number(formData.get("destination")),
    targetRate: Number(formData.get("rate")),
    color: ["#49d9ff", "#a78bfa", "#49d9a8", "#f5bd55", "#ff7394"][count % 5],
    active: true,
    path: null,
    fidelity: 0,
    latency: 0,
    deliveryRate: 0,
    allocatedSlots: 0,
    status: "Pending",
  };
  if (!tenant.name || tenant.source === tenant.destination) {
    toast("Enter a tenant name and choose different source/destination nodes.");
    return;
  }
  simulation.tenants.push(tenant);
  simulation.selectedTenant = tenant.id;
  simulation.addEvent("Tenant arrival", tenant.id, `${tenant.name} requested a new isolated slice.`, tenant.priority >= 4 ? .75 : .35, [tenant.id]);
  dialog.close();
  form.reset();
  currentPage = "tenants";
  toast("Tenant slice created and admission evaluated.");
  render();
});

function startSimulation() {
  pauseSimulation();
  running = true;
  simulationTimer = window.setInterval(() => {
    if (!running) return;
    simulation.step();
    render();
  }, 1600 / speed);
}

function pauseSimulation() {
  running = false;
  if (simulationTimer) window.clearInterval(simulationTimer);
  simulationTimer = null;
}

window.addEventListener("beforeunload", pauseSimulation);
window.setInterval(() => {
  document.querySelector("#clock").textContent = new Date().toLocaleTimeString([], { hour12: false });
}, 1000);

render();
