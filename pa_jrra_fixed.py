"""
PA-JRRA: Priority-Aware Adaptive Joint Routing and Resource Allocation
A reproducible, abstract SDQN simulator (not a hardware-accurate quantum stack).

Run:
    python pa_jrra.py
Outputs:
    results.csv
    summary.json

Model:
- Undirected graph; each edge has entanglement-generation capacity, fidelity and delay.
- Each tenant requests an integer number of entangled pairs per allocation epoch.
- A selected pair consumes one unit of residual capacity on every path edge and
  one memory unit at every node on the path.
- End-to-end fidelity = product(edge fidelities) * swap_fidelity_factor^(hops-1).
- Feasibility requires tenant minimum fidelity and maximum delay.
- The proposed allocator repeatedly chooses the feasible tenant/path with the
  largest priority-weighted marginal utility per resource cost.
"""

from dataclasses import dataclass
from collections import defaultdict
from itertools import islice
from copy import deepcopy
import csv
import json
import math
import random
import networkx as nx

SEED = 23
MAX_PATHS_PER_PAIR = 12
SWAP_FIDELITY_FACTOR = 0.995
SWAP_DELAY_MS = 0.8
EVENT_THRESHOLD = 0.20  # relative change in any monitored capacity/demand


@dataclass
class Tenant:
    tenant_id: str
    source: int
    destination: int
    demand: int
    priority: float
    min_fidelity: float
    max_delay_ms: float


def make_network(seed=SEED):
    rng = random.Random(seed)
    graph = nx.Graph()
    graph.add_nodes_from(range(8))
    edges = [
        (0,1),(0,2),(1,2),(1,3),(2,3),(2,4),
        (3,4),(3,5),(4,5),(4,6),(5,6),(5,7),
        (6,7),(1,7),(0,7)
    ]
    for u, v in edges:
        graph.add_edge(
            u, v,
            capacity=rng.randint(5, 11),
            fidelity=round(rng.uniform(0.975, 0.995), 4),
            delay_ms=round(rng.uniform(1.0, 4.0), 2),
        )
    for n in graph.nodes:
        graph.nodes[n]["memory_capacity"] = rng.randint(12, 22)
    return graph


def make_tenants(epoch=0):
    # Traffic shifts over time to test adaptation.
    if epoch in (0, 1):
        return [
            Tenant("T1", 0, 6, 7, 3.0, 0.94, 14.0),
            Tenant("T2", 1, 7, 8, 2.0, 0.93, 16.0),
            Tenant("T3", 2, 5, 6, 1.0, 0.92, 13.0),
            Tenant("T4", 0, 4, 5, 1.5, 0.94, 12.0),
        ]
    if epoch in (2, 3):
        return [
            Tenant("T1", 0, 6, 5, 3.0, 0.94, 14.0),
            Tenant("T2", 1, 7, 11, 2.0, 0.93, 16.0),
            Tenant("T3", 2, 5, 9, 1.0, 0.92, 13.0),
            Tenant("T4", 0, 4, 7, 1.5, 0.94, 12.0),
        ]
    return [
        Tenant("T1", 0, 6, 8, 3.0, 0.94, 14.0),
        Tenant("T2", 1, 7, 6, 2.0, 0.93, 16.0),
        Tenant("T3", 2, 5, 10, 1.0, 0.92, 13.0),
        Tenant("T4", 0, 4, 4, 1.5, 0.94, 12.0),
    ]


def perturb_network(graph, epoch):
    """Deterministic changing conditions: capacity dips and recovery."""
    g = deepcopy(graph)
    for u, v, d in g.edges(data=True):
        base = d["capacity"]
        if epoch == 1 and (u, v) in [(2,3),(3,4),(4,5)]:
            d["capacity"] = max(1, int(base * 0.55))
        elif epoch == 2 and (u, v) in [(0,1),(1,3),(3,5),(5,7)]:
            d["capacity"] = max(1, int(base * 0.60))
        elif epoch >= 3:
            d["capacity"] = max(1, int(base * (0.75 if (u+v+epoch) % 3 == 0 else 1.0)))
    return g


def path_metrics(graph, path):
    edges = list(zip(path[:-1], path[1:]))
    fidelity = 1.0
    delay = 0.0
    for u, v in edges:
        d = graph[u][v]
        fidelity *= d["fidelity"]
        delay += d["delay_ms"]
    fidelity *= SWAP_FIDELITY_FACTOR ** max(0, len(edges)-1)
    delay += SWAP_DELAY_MS * max(0, len(edges)-1)
    return fidelity, delay


def candidate_paths(graph, tenant):
    try:
        paths = nx.shortest_simple_paths(graph, tenant.source, tenant.destination, weight="delay_ms")
        valid = []
        for p in islice(paths, MAX_PATHS_PER_PAIR):
            f, delay = path_metrics(graph, p)
            if f >= tenant.min_fidelity and delay <= tenant.max_delay_ms:
                valid.append((p, f, delay))
        return valid
    except (nx.NetworkXNoPath, nx.NodeNotFound):
        return []


def empty_state(graph):
    return {
        "edge_used": {tuple(sorted((u,v))): 0 for u,v in graph.edges},
        "memory_used": {n: 0 for n in graph.nodes},
        "allocations": defaultdict(int),
        "paths": {},
    }


def can_allocate(graph, state, path):
    for u, v in zip(path[:-1], path[1:]):
        e = tuple(sorted((u,v)))
        if state["edge_used"][e] + 1 > graph[u][v]["capacity"]:
            return False
    for n in path:
        if state["memory_used"][n] + 1 > graph.nodes[n]["memory_capacity"]:
            return False
    return True


def consume(graph, state, tenant, path):
    for u, v in zip(path[:-1], path[1:]):
        state["edge_used"][tuple(sorted((u,v)))] += 1
    for n in path:
        state["memory_used"][n] += 1
    state["allocations"][tenant.tenant_id] += 1
    state["paths"].setdefault(tenant.tenant_id, path)


def resource_cost(path):
    # One unit on each traversed link plus one memory unit at each path node.
    return len(path)-1 + len(path)


def proposed_allocator(graph, tenants):
    """Greedy joint allocator using priority-weighted marginal utility."""
    state = empty_state(graph)
    path_cache = {t.tenant_id: candidate_paths(graph, t) for t in tenants}
    tenant_by_id = {t.tenant_id: t for t in tenants}
    total_requested = sum(t.demand for t in tenants)

    while True:
        best = None
        best_score = -1.0
        for t in tenants:
            allocated = state["allocations"][t.tenant_id]
            if allocated >= t.demand:
                continue
            satisfaction = allocated / max(1, t.demand)
            marginal_gain = 1.0 - satisfaction
            for path, fidelity, delay in path_cache[t.tenant_id]:
                if not can_allocate(graph, state, path):
                    continue
                # Mild quality preference among feasible paths; priority is dominant.
                fidelity_margin = max(0.0, fidelity - t.min_fidelity)
                delay_margin = max(0.0, t.max_delay_ms - delay)
                quality_factor = 1.0 + 0.20*fidelity_margin + 0.002*delay_margin
                score = (t.priority * marginal_gain * quality_factor) / resource_cost(path)
                if score > best_score:
                    best_score = score
                    best = (t, path)
        if best is None:
            break
        t, path = best
        consume(graph, state, t, path)

    return state


def priority_first_baseline(graph, tenants):
    """Partially optimized baseline: priority order, then shortest feasible path."""
    state = empty_state(graph)
    for t in sorted(tenants, key=lambda x: x.priority, reverse=True):
        paths = candidate_paths(graph, t)
        for _ in range(t.demand):
            chosen = next((p for p, f, d in paths if can_allocate(graph, state, p)), None)
            if chosen is None:
                break
            consume(graph, state, t, chosen)
    return state


def static_baseline(initial_graph, initial_tenants, current_graph, current_tenants):
    """Static baseline: keep the initial route/resource plan; count only what remains feasible."""
    plan = proposed_allocator(initial_graph, initial_tenants)
    state = empty_state(current_graph)
    current = {t.tenant_id: t for t in current_tenants}
    for tid, path in plan["paths"].items():
        if tid not in current:
            continue
        t = current[tid]
        planned = plan["allocations"][tid]
        for _ in range(min(planned, t.demand)):
            if can_allocate(current_graph, state, path):
                consume(current_graph, state, t, path)
            else:
                break
    return state


def metrics(graph, tenants, state):
    requested = sum(t.demand for t in tenants)
    delivered = sum(state["allocations"][t.tenant_id] for t in tenants)
    weighted_satisfaction = sum(
        t.priority * state["allocations"][t.tenant_id] / max(1,t.demand)
        for t in tenants
    ) / sum(t.priority for t in tenants)
    fidelity_values, delay_values = [], []
    for t in tenants:
        path = state["paths"].get(t.tenant_id)
        if path:
            f, d = path_metrics(graph, path)
            fidelity_values.extend([f] * state["allocations"][t.tenant_id])
            delay_values.extend([d] * state["allocations"][t.tenant_id])
    total_mem = sum(graph.nodes[n]["memory_capacity"] for n in graph.nodes)
    used_mem = sum(state["memory_used"].values())
    total_link = sum(d["capacity"] for _,_,d in graph.edges(data=True))
    used_link = sum(state["edge_used"].values())
    return {
        "delivery_rate": delivered / max(1, requested),
        "delivered_pairs": delivered,
        "requested_pairs": requested,
        "weighted_qos_satisfaction": weighted_satisfaction,
        "avg_fidelity": sum(fidelity_values)/len(fidelity_values) if fidelity_values else 0,
        "avg_delay_ms": sum(delay_values)/len(delay_values) if delay_values else 0,
        "memory_utilization": used_mem / max(1,total_mem),
        "link_utilization": used_link / max(1,total_link),
        "sla_unserved_pairs": requested - delivered,
    }


def event_trigger(previous_graph, current_graph, previous_tenants, current_tenants):
    changes = []
    for u, v, d in current_graph.edges(data=True):
        old = previous_graph[u][v]["capacity"]
        if old:
            changes.append(abs(d["capacity"]-old)/old)
    old_d = {t.tenant_id:t.demand for t in previous_tenants}
    for t in current_tenants:
        if t.tenant_id in old_d and old_d[t.tenant_id]:
            changes.append(abs(t.demand-old_d[t.tenant_id])/old_d[t.tenant_id])
    return max(changes, default=0.0) >= EVENT_THRESHOLD


def plan_is_feasible(graph, tenants, state):
    """A cached plan is reusable only if it still fits current capacities and demands."""
    demand = {t.tenant_id: t.demand for t in tenants}
    used = {tuple(sorted((u, v))): 0 for u, v in graph.edges}
    mem = {n: 0 for n in graph.nodes}
    for tid, path in state["paths"].items():
        k = state["allocations"][tid]
        if tid not in demand or k > demand[tid]:
            return False
        for u, v in zip(path[:-1], path[1:]):
            used[tuple(sorted((u, v)))] += k
        for n in path:
            mem[n] += k
    return (all(used[e] <= graph[e[0]][e[1]]["capacity"] for e in used)
            and all(mem[n] <= graph.nodes[n]["memory_capacity"] for n in mem))


def run_experiment(seed=SEED, write_files=True):
    base = make_network(seed)
    initial_tenants = make_tenants(0)
    initial_plan_graph = perturb_network(base, 0)
    rows = []
    prev_graph, prev_tenants = initial_plan_graph, initial_tenants

    for epoch in range(5):
        g = perturb_network(base, epoch)
        tenants = make_tenants(epoch)
        triggered = (epoch == 0) or event_trigger(prev_graph, g, prev_tenants, tenants)

        # Proposed system re-optimizes only when event trigger fires; otherwise retain plan.
        if epoch == 0 or triggered or not plan_is_feasible(g, tenants, cached_plan):
            proposed = proposed_allocator(g, tenants)
            cached_plan = deepcopy(proposed)
            triggered = True
        else:
            proposed = deepcopy(cached_plan)  # no event: keep the existing plan
        partial = priority_first_baseline(g, tenants)
        static = static_baseline(initial_plan_graph, initial_tenants, g, tenants)

        for name, state in [
            ("PA-JRRA (adaptive)", proposed),
            ("Priority-first (no joint scoring)", partial),
            ("Static allocation", static),
        ]:
            m = metrics(g, tenants, state)
            rows.append({"epoch":epoch, "strategy":name, "event_triggered":triggered, **m})
        prev_graph, prev_tenants = g, tenants

    for r in rows:
        r["seed"] = seed
    if write_files:
        with open("results.csv","w",newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)
    summary = {}
    for strategy in sorted(set(r["strategy"] for r in rows)):
        sr = [r for r in rows if r["strategy"] == strategy]
        summary[strategy] = {
            key: sum(r[key] for r in sr)/len(sr)
            for key in ["delivery_rate","weighted_qos_satisfaction","avg_fidelity",
                        "avg_delay_ms","memory_utilization","link_utilization"]
        }
    if write_files:
        with open("summary.json","w") as f:
            json.dump(summary, f, indent=2)
    return rows, summary


def run_multi_seed(seeds=range(20)):
    """Mean and std over random topologies/capacities (seeds)."""
    import statistics as st
    keys = ["delivery_rate","weighted_qos_satisfaction","avg_fidelity",
            "avg_delay_ms","memory_utilization","link_utilization"]
    acc = {}
    for sd in seeds:
        _, summ = run_experiment(sd, write_files=False)
        for strat, vals in summ.items():
            for k in keys:
                acc.setdefault(strat, {}).setdefault(k, []).append(vals[k])
    return {s_: {k: (st.mean(v), st.stdev(v)) for k, v in d.items()} for s_, d in acc.items()}


if __name__ == "__main__":
    rows, summary = run_experiment()
    print(json.dumps(summary, indent=2))
    multi = run_multi_seed()
    with open("summary_multiseed.json", "w") as f:
        json.dump(multi, f, indent=2)
    print("\n20-seed mean (std):")
    for strat, d in multi.items():
        print(strat, {k: f"{m:.3f} ({sd:.3f})" for k, (m, sd) in d.items()})
