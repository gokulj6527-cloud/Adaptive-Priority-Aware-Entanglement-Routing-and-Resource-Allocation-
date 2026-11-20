const EDGE_LAYOUT = [
  [0, 1], [0, 2], [1, 2], [1, 3], [2, 3], [2, 4], [3, 4], [3, 5],
  [4, 5], [4, 6], [5, 6], [5, 7], [6, 7], [1, 7], [0, 7],
];

const NODE_LAYOUT = [
  [0, 108, 208], [1, 260, 100], [2, 275, 300], [3, 425, 120],
  [4, 440, 300], [5, 590, 110], [6, 610, 300], [7, 755, 208],
];

const TENANT_PRESETS = [
  { name: "Tenant A", priority: 5, tier: "Critical", sla: 99.9, minFidelity: 0.98, source: 0, destination: 7, targetRate: 8, color: "#49d9ff" },
  { name: "Tenant B", priority: 4, tier: "High", sla: 99, minFidelity: 0.95, source: 1, destination: 6, targetRate: 7, color: "#a78bfa" },
  { name: "Tenant C", priority: 3, tier: "Medium", sla: 98, minFidelity: 0.92, source: 2, destination: 5, targetRate: 6, color: "#49d9a8" },
  { name: "Tenant D", priority: 2, tier: "Low", sla: 95, minFidelity: 0.90, source: 0, destination: 4, targetRate: 4, color: "#f5bd55" },
];

const PRIORITIES = {
  1: { tier: "Low", slots: 1, color: "#f5bd55" },
  2: { tier: "Standard", slots: 1, color: "#f5bd55" },
  3: { tier: "Medium", slots: 2, color: "#49d9a8" },
  4: { tier: "High", slots: 3, color: "#a78bfa" },
  5: { tier: "Critical", slots: 4, color: "#49d9ff" },
};

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function edgeKey(a, b) {
  return [a, b].sort((x, y) => x - y).join("-");
}

function tenantIdAt(index) {
  return index <= 26 ? `T-${String.fromCharCode(64 + index)}` : `T-${index}`;
}

class BinaryHeap {
  constructor(compare) {
    this.items = [];
    this.compare = compare;
  }

  push(item) {
    const items = this.items;
    items.push(item);
    let index = items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.compare(items[parent], items[index]) <= 0) break;
      [items[parent], items[index]] = [items[index], items[parent]];
      index = parent;
    }
  }

  pop() {
    if (!this.items.length) return undefined;
    const first = this.items[0];
    const last = this.items.pop();
    if (this.items.length && last) {
      this.items[0] = last;
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < this.items.length && this.compare(this.items[left], this.items[smallest]) < 0) smallest = left;
        if (right < this.items.length && this.compare(this.items[right], this.items[smallest]) < 0) smallest = right;
        if (smallest === index) break;
        [this.items[index], this.items[smallest]] = [this.items[smallest], this.items[index]];
        index = smallest;
      }
    }
    return first;
  }
}

function priorityOrder(tenants) {
  const queue = new BinaryHeap((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  tenants.forEach((tenant) => queue.push(tenant));
  const ordered = [];
  while (queue.items.length) ordered.push(queue.pop());
  return ordered;
}

export class NetworkSimulation {
  constructor() {
    this.reset();
  }

  reset() {
    const random = seeded(23);
    this.eventRandom = seeded(23023);
    this.nodes = NODE_LAYOUT.map(([id, x, y]) => {
      const t2 = Math.round(78 + random() * 95);
      return {
        id,
        x,
        y,
        role: [0, 7].includes(id) ? "Generation source" : "Quantum repeater",
        capacity: 15 + Math.floor(random() * 10),
        t2,
        baseT2: t2,
        health: "healthy",
        available: true,
        used: 0,
      };
    });
    this.edges = EDGE_LAYOUT.map(([a, b], index) => {
      const edge = {
        id: `Q-${String(index + 1).padStart(2, "0")}`,
        a,
        b,
        capacity: Math.round(20 + random() * 22),
        fidelity: a === 0 && b === 7
          ? Number((0.991 + random() * 0.004).toFixed(4))
          : Number((0.978 + random() * 0.018).toFixed(4)),
        latency: Number((1.2 + random() * 2.8).toFixed(1)),
        status: "healthy",
        usedRate: 0,
      };
      return { ...edge, base: { capacity: edge.capacity, fidelity: edge.fidelity, latency: edge.latency } };
    });
    this.tenants = TENANT_PRESETS.map((preset, index) => ({
      ...preset,
      id: `T-${String.fromCharCode(65 + index)}`,
      active: true,
      path: null,
      fidelity: 0,
      latency: 0,
      deliveryRate: 0,
      allocatedSlots: 0,
      status: "Pending",
    }));
    this.elapsed = 0;
    this.reconfigurations = 0;
    this.eventThreshold = 0.2;
    this.history = [];
    this.events = [];
    this.selectedTenant = this.tenants[0]?.id ?? null;
    this.selectedNode = 0;
    this.selectedEdge = null;
    this.adapt("Initial deterministic allocation", this.tenants.map((tenant) => tenant.id), false);
    this.staticRoutes = Object.fromEntries(this.tenants.map((tenant) => [
      tenant.id,
      this.shortestPath(tenant)?.path ?? null,
    ]));
    this.recordMetrics();
  }

  getTenant(id) {
    return this.tenants.find((tenant) => tenant.id === id);
  }

  getNode(id) {
    return this.nodes.find((node) => node.id === id);
  }

  getEdge(a, b) {
    return this.edges.find((edge) => edgeKey(edge.a, edge.b) === edgeKey(a, b));
  }

  priorityDetails(priority) {
    return PRIORITIES[Math.max(1, Math.min(5, Number(priority)))] ?? PRIORITIES[1];
  }

  fidelityFor(path) {
    if (!path || path.length < 2) return 0;
    const links = this.pathEdges(path);
    const linkFidelity = links.reduce((fidelity, edge) => fidelity * edge.fidelity, 1);
    const memoryFactor = path.reduce((factor, id) => {
      const node = this.getNode(id);
      return factor * (node ? 1 - Math.max(0, 1 - node.t2 / node.baseT2) * 0.08 : 0);
    }, 1);
    return linkFidelity * 0.995 ** Math.max(0, links.length - 1) * memoryFactor;
  }

  pathEdges(path) {
    if (!path) return [];
    return path.slice(1).map((node, index) => this.getEdge(path[index], node)).filter(Boolean);
  }

  candidatePaths(tenant) {
    const results = [];
    const visit = (nodeId, path) => {
      if (results.length >= 180) return;
      if (nodeId === Number(tenant.destination)) {
        const edges = this.pathEdges(path);
        if (edges.length !== path.length - 1 || edges.some((edge) => edge.status === "failed")) return;
        const memoryFactor = path.reduce((factor, id) => {
          const node = this.getNode(id);
          return factor * (node ? 1 - Math.max(0, 1 - node.t2 / node.baseT2) * 0.08 : 0);
        }, 1);
        const fidelity = edges.reduce((value, edge) => value * edge.fidelity, 1)
          * 0.995 ** Math.max(0, edges.length - 1) * memoryFactor;
        const latency = edges.reduce((sum, edge) => sum + edge.latency, 0) + Math.max(0, edges.length - 1) * 0.8;
        const rate = Math.min(...edges.map((edge) => edge.capacity));
        results.push({ path: [...path], fidelity, latency, rate, hops: edges.length });
        return;
      }
      if (path.length > this.nodes.length - 1) return;
      this.edges.forEach((edge) => {
        if (edge.status === "failed") return;
        const next = edge.a === nodeId ? edge.b : edge.b === nodeId ? edge.a : null;
        if (next !== null && !path.includes(next) && this.getNode(next)?.available) visit(next, [...path, next]);
      });
    };
    if (this.getNode(Number(tenant.source))?.available && this.getNode(Number(tenant.destination))?.available) {
      visit(Number(tenant.source), [Number(tenant.source)]);
    }
    return results.sort((a, b) => this.routeScore(tenant, b) - this.routeScore(tenant, a));
  }

  routeScore(tenant, candidate) {
    const fidelityScore = Math.min(1, candidate.fidelity / Math.max(tenant.minFidelity, 0.01));
    const rateScore = Math.min(1, candidate.rate / Math.max(tenant.targetRate, 1));
    const latencyScore = Math.max(0, 1 - candidate.latency / Math.max(tenant.maxLatency ?? 18, 1));
    const memoryScore = candidate.path.reduce((sum, id) => {
      const node = this.getNode(id);
      return sum + (node ? (node.capacity - node.used) / node.capacity : 0);
    }, 0) / candidate.path.length;
    return 0.31 * fidelityScore + 0.28 * rateScore + 0.24 * latencyScore + 0.17 * memoryScore;
  }

  pathMetrics(path) {
    if (!path || path.length < 2) return null;
    if (path.some((id) => !this.getNode(id)?.available)) return null;
    const edges = this.pathEdges(path);
    if (edges.length !== path.length - 1 || edges.some((edge) => edge.status === "failed")) return null;
    const memoryFactor = path.slice(1, -1).reduce((factor, id) => {
      const node = this.getNode(id);
      return factor * (node ? 1 - Math.max(0, 1 - node.t2 / node.baseT2) * 0.08 : 0);
    }, 1);
    return {
      path: [...path],
      fidelity: edges.reduce((value, edge) => value * edge.fidelity, 1)
        * 0.995 ** Math.max(0, edges.length - 1) * memoryFactor,
      latency: edges.reduce((sum, edge) => sum + edge.latency, 0) + Math.max(0, edges.length - 1) * 0.8,
      rate: Math.min(...edges.map((edge) => edge.capacity)),
      hops: edges.length,
    };
  }

  shortestPath(tenant) {
    const source = Number(tenant.source);
    const destination = Number(tenant.destination);
    if (!this.getNode(source)?.available || !this.getNode(destination)?.available) return null;
    const distance = new Map(this.nodes.map((node) => [node.id, Infinity]));
    const previous = new Map();
    const queue = new BinaryHeap((a, b) => a.distance - b.distance);
    distance.set(source, 0);
    queue.push({ id: source, distance: 0 });
    while (queue.items.length) {
      const entry = queue.pop();
      if (!entry || entry.distance !== distance.get(entry.id)) continue;
      if (entry.id === destination) break;
      this.edges.filter((edge) => edge.status !== "failed" && (edge.a === entry.id || edge.b === entry.id))
        .forEach((edge) => {
          const next = edge.a === entry.id ? edge.b : edge.a;
          if (!this.getNode(next)?.available) return;
          const candidateDistance = entry.distance + edge.latency;
          if (candidateDistance < distance.get(next)) {
            distance.set(next, candidateDistance);
            previous.set(next, entry.id);
            queue.push({ id: next, distance: candidateDistance });
          }
        });
    }
    if (distance.get(destination) === Infinity) return null;
    const path = [destination];
    while (path[0] !== source) {
      const parent = previous.get(path[0]);
      if (parent === undefined) return null;
      path.unshift(parent);
    }
    return this.pathMetrics(path);
  }

  rebuildUsage(excludedIds = []) {
    this.nodes.forEach((node) => { node.used = 0; });
    this.edges.forEach((edge) => { edge.usedRate = 0; });
    this.tenants.forEach((tenant) => {
      if (excludedIds.includes(tenant.id) || !tenant.active || !tenant.path || !tenant.allocatedSlots) return;
      tenant.path.forEach((nodeId) => {
        const node = this.getNode(nodeId);
        if (node) node.used += tenant.allocatedSlots;
      });
      this.pathEdges(tenant.path).forEach((edge) => { edge.usedRate += tenant.deliveryRate; });
    });
  }

  canAllocate(tenant, candidate, slots) {
    return candidate.path.every((id) => {
      const node = this.getNode(id);
      return node && node.available && node.used + slots <= node.capacity;
    }) && this.pathEdges(candidate.path).every((edge) => edge.usedRate + tenant.targetRate <= edge.capacity);
  }

  allocateTenant(tenant) {
    if (!tenant.active) {
      tenant.status = "Inactive";
      tenant.path = null;
      tenant.allocatedSlots = 0;
      tenant.deliveryRate = 0;
      return false;
    }
    const slots = this.priorityDetails(tenant.priority).slots;
    const candidates = this.candidatePaths(tenant);
    const candidate = candidates.find((option) => (
      option.fidelity >= tenant.minFidelity && this.canAllocate(tenant, option, slots)
    ));
    if (!candidate) {
      tenant.path = null;
      tenant.fidelity = 0;
      tenant.latency = 0;
      tenant.deliveryRate = 0;
      tenant.allocatedSlots = 0;
      tenant.status = candidates.length ? "Resource constrained" : "No viable route";
      return false;
    }
    tenant.path = candidate.path;
    tenant.fidelity = candidate.fidelity;
    tenant.latency = candidate.latency;
    tenant.deliveryRate = Math.min(tenant.targetRate, candidate.rate);
    tenant.allocatedSlots = slots;
    tenant.path.forEach((id) => { this.getNode(id).used += slots; });
    this.pathEdges(tenant.path).forEach((edge) => { edge.usedRate += tenant.deliveryRate; });
    tenant.status = this.isSlaMet(tenant) ? "Compliant" : "At risk";
    return true;
  }

  isSlaMet(tenant) {
    return Boolean(tenant.path)
      && tenant.fidelity >= tenant.minFidelity
      && tenant.deliveryRate >= tenant.targetRate * 0.75
      && tenant.latency <= (tenant.maxLatency ?? 18);
  }

  adapt(reason, tenantIds = this.tenants.map((tenant) => tenant.id), countReconfiguration = true) {
    const ids = [...new Set(tenantIds)];
    this.rebuildUsage(ids);
    const targets = priorityOrder(this.tenants.filter((tenant) => ids.includes(tenant.id)));
    targets.forEach((tenant) => this.allocateTenant(tenant));
    if (countReconfiguration) this.reconfigurations += Math.max(1, ids.length);
    this.recordMetrics();
    return targets.map((tenant) => ({
      id: tenant.id,
      path: tenant.path,
      status: tenant.status,
      allocatedSlots: tenant.allocatedSlots,
      deliveryRate: tenant.deliveryRate,
    }));
  }

  affectedTenants(predicate) {
    return this.tenants.filter((tenant) => tenant.active && tenant.path && predicate(tenant)).map((tenant) => tenant.id);
  }

  addEvent(type, component, message, risk, changedTenantIds = []) {
    const estimatedRisk = this.estimateRisk(changedTenantIds, risk);
    const triggered = estimatedRisk >= this.eventThreshold;
    const before = changedTenantIds.map((id) => {
      const tenant = this.getTenant(id);
      return {
        id,
        path: tenant?.path ? [...tenant.path] : null,
        status: tenant?.status ?? "Unknown",
        allocatedSlots: tenant?.allocatedSlots ?? 0,
        deliveryRate: tenant?.deliveryRate ?? 0,
      };
    });
    let after = before;
    let reason = "Threshold not exceeded; existing slice allocations retained.";
    if (triggered && changedTenantIds.length) {
      after = this.adapt(`${type}: ${message}`, changedTenantIds);
      reason = `Adaptive controller triggered: estimated SLA risk ${(estimatedRisk * 100).toFixed(0)}% exceeded the ${(this.eventThreshold * 100).toFixed(0)}% threshold.`;
    } else {
      this.recordMetrics();
    }
    this.events.unshift({
      id: `${Date.now()}-${this.events.length}`,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      type,
      component,
      message,
      risk: estimatedRisk,
      triggered,
      reason,
      before,
      after,
    });
    this.events = this.events.slice(0, 60);
    return this.events[0];
  }

  estimateRisk(tenantIds, eventRisk) {
    let risk = eventRisk;
    tenantIds.forEach((id) => {
      const tenant = this.getTenant(id);
      if (!tenant?.path) {
        risk = Math.max(risk, 1);
        return;
      }
      const route = this.pathMetrics(tenant.path);
      if (!route) {
        risk = Math.max(risk, 1);
        return;
      }
      const fidelityGap = Math.max(0, 1 - route.fidelity / tenant.minFidelity);
      const rateGap = Math.max(0, 1 - route.rate / tenant.targetRate);
      const latencyGap = Math.max(0, 1 - (tenant.maxLatency ?? 18) / route.latency);
      risk = Math.max(risk, 1 - (1 - fidelityGap) * (1 - rateGap) * (1 - latencyGap));
    });
    return Math.min(1, risk);
  }

  simulateLinkFailure() {
    const active = this.edges.filter((edge) => edge.status !== "failed");
    const edge = active.find((candidate) => this.affectedTenants((tenant) => this.pathEdges(tenant.path).includes(candidate)).length)
      ?? active[0];
    if (!edge) return;
    const ids = this.affectedTenants((tenant) => this.pathEdges(tenant.path).includes(edge));
    edge.status = "failed";
    edge.capacity = 0;
    this.addEvent("Link failure", edge.id, `Channel ${edge.id} went offline (${edge.a} ↔ ${edge.b}).`, ids.length ? 0.92 : 0.08, ids);
  }

  simulateNodeFailure() {
    const node = this.nodes.find((candidate) => candidate.available && this.affectedTenants((tenant) => tenant.path.includes(candidate.id)).length)
      ?? this.nodes.find((candidate) => candidate.available);
    if (!node) return;
    const ids = this.affectedTenants((tenant) => tenant.path.includes(node.id));
    node.available = false;
    node.health = "failed";
    this.addEvent("Node failure", `Node ${node.id}`, `Node ${node.id} (${node.role.toLowerCase()}) stopped responding.`, ids.length ? 0.95 : 0.1, ids);
  }

  degradeLink(edgeId = null) {
    const edge = this.edges.find((candidate) => candidate.status !== "failed" && candidate.id === edgeId)
      ?? this.edges.find((candidate) => candidate.status !== "failed"
      && this.affectedTenants((tenant) => this.pathEdges(tenant.path).includes(candidate)).length)
      ?? this.edges.find((candidate) => candidate.status !== "failed");
    if (!edge) return;
    const ids = this.affectedTenants((tenant) => this.pathEdges(tenant.path).includes(edge));
    edge.fidelity = Number((edge.fidelity * 0.88).toFixed(4));
    edge.capacity = Math.max(1, Math.round(edge.capacity * 0.72));
    this.addEvent("Link degradation", edge.id, `${edge.id} fidelity and generation capacity degraded.`, ids.length ? 0.64 : 0.14, ids);
  }

  reduceGenerationRate() {
    const edge = this.edges.find((candidate) => candidate.status !== "failed"
      && this.affectedTenants((tenant) => this.pathEdges(tenant.path).includes(candidate)).length)
      ?? this.edges.find((candidate) => candidate.status !== "failed");
    if (!edge) return;
    const ids = this.affectedTenants((tenant) => this.pathEdges(tenant.path).includes(edge));
    edge.capacity = Math.max(1, Math.round(edge.capacity * 0.55));
    this.addEvent(
      "Generation rate reduction",
      edge.id,
      `${edge.id} entanglement generation capacity reduced to ${edge.capacity} ebits/s.`,
      ids.length ? 0.58 : 0.12,
      ids,
    );
  }

  degradeCoherence() {
    const node = this.nodes.find((candidate) => candidate.available && this.affectedTenants((tenant) => tenant.path.includes(candidate.id)).length)
      ?? this.nodes.find((candidate) => candidate.available);
    if (!node) return;
    const ids = this.affectedTenants((tenant) => tenant.path.includes(node.id));
    node.t2 = Math.round(node.t2 * 0.48);
    this.addEvent("Coherence degradation", `Node ${node.id}`, `Node ${node.id} coherence time (T2) fell to ${node.t2} ms.`, ids.length ? 0.52 : 0.12, ids);
  }

  addCriticalTenant() {
    const number = this.tenants.length + 1;
    const id = tenantIdAt(number);
    const tenant = {
      id,
      name: number <= 26 ? `Tenant ${String.fromCharCode(64 + number)}` : `Tenant ${number}`,
      priority: 5,
      tier: "Critical",
      sla: 99.9,
      minFidelity: 0.98,
      source: 0,
      destination: 7,
      targetRate: 8,
      color: ["#49d9ff", "#a78bfa", "#49d9a8", "#f5bd55", "#ff7394"][number % 5],
      active: true,
      path: null,
      fidelity: 0,
      latency: 0,
      deliveryRate: 0,
      allocatedSlots: 0,
      status: "Pending",
    };
    this.tenants.push(tenant);
    this.selectedTenant = id;
    this.addEvent("Critical tenant arrival", id, `${id} requested a priority-5 slice (F ≥ 0.98).`, 0.78, [id]);
    return tenant;
  }

  triggerSlaViolation() {
    const tenant = this.tenants.find((candidate) => candidate.active && candidate.path);
    if (!tenant) return;
    const edge = this.pathEdges(tenant.path).find((candidate) => candidate.status !== "failed");
    const ids = edge ? this.affectedTenants((candidate) => this.pathEdges(candidate.path).includes(edge)) : [tenant.id];
    if (edge) edge.fidelity = Math.min(edge.fidelity, 0.84);
    this.addEvent("SLA violation risk", tenant.id, `${tenant.name} is predicted to miss its fidelity SLA; ${edge?.id ?? "route"} quality was stressed.`, 0.88, ids);
  }

  restoreNetwork() {
    this.nodes.forEach((node, index) => {
      node.available = true;
      node.health = "healthy";
      const random = seeded(23);
      for (let i = 0; i <= index; i++) random();
      node.t2 = Math.round(78 + random() * 95);
    });
    this.edges.forEach((edge) => {
      edge.status = "healthy";
      edge.capacity = edge.base.capacity;
      edge.fidelity = edge.base.fidelity;
      edge.latency = edge.base.latency;
    });
    this.adapt("Network restored and all active slices re-optimized.", this.tenants.map((tenant) => tenant.id));
    this.events.unshift({
      id: `${Date.now()}-restore`,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      type: "Network restored",
      component: "Network",
      message: "Failed components restored to reproducible baseline telemetry.",
      risk: 0,
      triggered: true,
      reason: "Explicit operator restore; all active slices were allocated again by descending priority.",
      before: [],
      after: [],
    });
  }

  setTenantPriority(id, priority) {
    const tenant = this.getTenant(id);
    if (!tenant) return;
    tenant.priority = Math.max(1, Math.min(5, Number(priority)));
    tenant.tier = this.priorityDetails(tenant.priority).tier;
    this.addEvent("Priority change", tenant.id, `${tenant.name} priority changed to ${tenant.tier}.`, 0.4, [tenant.id]);
  }

  setTenantFidelity(id, value) {
    const tenant = this.getTenant(id);
    if (!tenant) return;
    tenant.minFidelity = Math.max(0.8, Math.min(0.999, Number(value)));
    this.addEvent("SLA policy change", tenant.id, `${tenant.name} minimum fidelity changed to ${tenant.minFidelity.toFixed(3)}.`, 0.35, [tenant.id]);
  }

  toggleTenant(id, active) {
    const tenant = this.getTenant(id);
    if (!tenant) return;
    tenant.active = active;
    this.addEvent(active ? "Slice activated" : "Slice deactivated", tenant.id, `${tenant.name} slice ${active ? "activated" : "released"}.`, 0.4, [tenant.id]);
  }

  releaseTenantMemory(id) {
    const tenant = this.getTenant(id);
    if (!tenant || !tenant.path) return;
    tenant.path = null;
    tenant.fidelity = 0;
    tenant.latency = 0;
    tenant.deliveryRate = 0;
    tenant.allocatedSlots = 0;
    tenant.status = "Resources released";
    this.reconfigurations += 1;
    this.rebuildUsage();
    this.recordMetrics();
    this.events.unshift({
      id: `${Date.now()}-release`,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      type: "Memory released",
      component: tenant.id,
      message: `${tenant.name} released its route and reserved memory.`,
      risk: 0,
      triggered: false,
      reason: "Operator released this slice's reservation; other tenant allocations were preserved.",
      before: [],
      after: [],
    });
  }

  runAllOptimization() {
    const outcomes = this.adapt("Operator-requested joint optimization.", this.tenants.map((tenant) => tenant.id));
    this.events.unshift({
      id: `${Date.now()}-opt`,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      type: "Adaptive optimization",
      component: "Controller",
      message: `Priority-aware allocator re-evaluated ${this.tenants.filter((tenant) => tenant.active).length} active slices.`,
      risk: 0,
      triggered: true,
      reason: "Manual operator trigger; route score combines fidelity, generation rate, latency, and available memory.",
      before: [],
      after: outcomes,
    });
  }

  randomEvent() {
    const actions = [() => this.simulateLinkFailure(), () => this.degradeLink(), () => this.degradeCoherence()];
    actions[Math.floor(this.eventRandom() * actions.length)]();
  }

  step() {
    this.elapsed += 1;
    if (this.elapsed % 4 === 0) {
      const links = this.edges.filter((edge) => edge.status !== "failed");
      if (links.length) {
        const edge = links[(this.elapsed / 4 - 1) % links.length];
        const variation = Math.sin(this.elapsed / 3) * 0.006;
        edge.fidelity = Math.max(0.9, Math.min(edge.base.fidelity, edge.fidelity + variation));
      }
      this.tenants.forEach((tenant) => {
        if (!tenant.path) return;
        tenant.fidelity = this.fidelityFor(tenant.path);
        tenant.latency = this.pathEdges(tenant.path).reduce((sum, edge) => sum + edge.latency, 0)
          + Math.max(0, tenant.path.length - 2) * 0.8;
        tenant.deliveryRate = Math.min(tenant.targetRate, ...this.pathEdges(tenant.path).map((edge) => edge.capacity));
        tenant.status = this.isSlaMet(tenant) ? "Compliant" : "At risk";
      });
      this.recordMetrics();
    } else {
      this.recordMetrics();
    }
  }

  metrics() {
    const active = this.tenants.filter((tenant) => tenant.active);
    const routed = active.filter((tenant) => tenant.path);
    const totalMemory = this.nodes.reduce((sum, node) => sum + node.capacity, 0);
    const usedMemory = this.nodes.reduce((sum, node) => sum + node.used, 0);
    const rates = routed.map((tenant) => tenant.deliveryRate);
    return {
      nodes: this.nodes.length,
      links: this.edges.filter((edge) => edge.status !== "failed").length,
      tenants: active.length,
      freeMemory: totalMemory - usedMemory,
      totalMemory,
      fidelity: routed.length ? routed.reduce((sum, tenant) => sum + tenant.fidelity, 0) / routed.length : 0,
      edr: rates.reduce((sum, rate) => sum + rate, 0),
      utilization: totalMemory ? usedMemory / totalMemory : 0,
      sla: active.length ? active.filter((tenant) => this.isSlaMet(tenant)).length / active.length : 1,
      requests: active.filter((tenant) => tenant.status !== "Compliant").length,
      activeSlices: routed.length,
      latency: routed.length ? routed.reduce((sum, tenant) => sum + tenant.latency, 0) / routed.length : 0,
      violations: active.length ? active.filter((tenant) => !this.isSlaMet(tenant)).length / active.length : 0,
      reconfigurations: this.reconfigurations,
    };
  }

  recordMetrics() {
    const current = this.metrics();
    const strategies = this.evaluateStrategies();
    const sample = { time: this.elapsed, ...current, strategies };
    const previous = this.history[this.history.length - 1];
    if (previous && previous.time === sample.time) this.history[this.history.length - 1] = sample;
    else this.history.push(sample);
    this.history = this.history.slice(-24);
  }

  evaluateStrategies() {
    const compute = (strategy) => {
      const nodeUsed = Object.fromEntries(this.nodes.map((node) => [node.id, 0]));
      const edgeUsed = Object.fromEntries(this.edges.map((edge) => [edge.id, 0]));
      const active = this.tenants.filter((tenant) => tenant.active);
      const order = strategy === "static" ? active : priorityOrder(active);
      const items = [];
      order.forEach((tenant) => {
        const candidates = strategy === "static" && this.staticRoutes?.[tenant.id]
          ? [this.pathMetrics(this.staticRoutes[tenant.id])].filter(Boolean)
          : strategy === "routing"
            ? [this.shortestPath(tenant)].filter(Boolean)
            : this.candidatePaths(tenant);
        const slots = strategy === "proposed" ? this.priorityDetails(tenant.priority).slots : 1;
        const candidate = (strategy === "proposed"
          ? candidates
          : candidates.sort((a, b) => a.delay - b.delay)
        ).find((option) => {
          if (option.fidelity < tenant.minFidelity) return false;
          if (!option.path.every((id) => nodeUsed[id] + slots <= this.getNode(id).capacity)) return false;
          return this.pathEdges(option.path).every((edge) => edgeUsed[edge.id] + tenant.targetRate <= edge.capacity);
        });
        if (candidate) {
          candidate.path.forEach((id) => { nodeUsed[id] += slots; });
          this.pathEdges(candidate.path).forEach((edge) => { edgeUsed[edge.id] += tenant.targetRate; });
          items.push({ tenant, candidate });
        }
      });
      const delivered = items.reduce((sum, item) => sum + Math.min(item.tenant.targetRate, item.candidate.rate), 0);
      const fidelity = items.length ? items.reduce((sum, item) => sum + item.candidate.fidelity, 0) / items.length : 0;
      const latency = items.length ? items.reduce((sum, item) => sum + item.candidate.latency, 0) / items.length : 0;
      const sla = active.length ? items.filter(({ tenant, candidate }) => (
        candidate.fidelity >= tenant.minFidelity && candidate.rate >= tenant.targetRate * 0.75 && candidate.latency <= (tenant.maxLatency ?? 18)
      )).length / active.length : 1;
      const used = Object.values(nodeUsed).reduce((sum, value) => sum + value, 0);
      return {
        edr: delivered,
        fidelity,
        utilization: used / Math.max(1, this.nodes.reduce((sum, node) => sum + node.capacity, 0)),
        violation: 1 - sla,
        latency,
        reconfigurations: strategy === "static" ? 0 : strategy === "routing" ? items.length : this.reconfigurations,
      };
    };
    return { static: compute("static"), routing: compute("routing"), proposed: compute("proposed") };
  }
}
