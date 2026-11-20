import random
import math
import networkx as nx
import numpy as np
import pandas as pd
from dataclasses import dataclass, field
from typing import List, Dict, Tuple, Optional


@dataclass
class TenantSlice:
    tenant_id: str
    priority: int  # Higher number = higher priority (e.g., 1 to 10)
    source: int
    destination: int
    min_fidelity: float
    required_rate: float  # ebits/sec
    max_delay_ms: float
    active_path: List[int] = field(default_factory=list)
    allocated_memory_per_node: Dict[int, int] = field(default_factory=dict)


class QuantumNetwork:
    def __init__(self, num_nodes: int = 10, seed: int = 42):
        random.seed(seed)
        np.random.seed(seed)
        self.graph = nx.erdos_renyi_graph(n=num_nodes, p=0.45, seed=seed)
        while not nx.is_connected(self.graph):
            seed += 1
            self.graph = nx.erdos_renyi_graph(n=num_nodes, p=0.45, seed=seed)

        # Initialize node quantum memories and coherence times
        for node in self.graph.nodes():
            self.graph.nodes[node]["total_memory"] = random.randint(12, 24)
            self.graph.nodes[node]["available_memory"] = self.graph.nodes[node]["total_memory"]
            self.graph.nodes[node]["coherence_time_ms"] = random.uniform(50.0, 150.0)
            self.graph.nodes[node]["swap_success_prob"] = random.uniform(0.75, 0.92)

        # Initialize quantum channel parameters
        for u, v in self.graph.edges():
            distance_km = random.uniform(5.0, 35.0)
            # Fidelity degrades slightly with distance
            base_fidelity = max(0.88, 0.995 - 0.002 * distance_km)
            # Entanglement generation rate (ebits/sec)
            gen_rate = random.uniform(80.0, 200.0) * math.exp(-0.02 * distance_km)
            self.graph.edges[u, v]["distance_km"] = distance_km
            self.graph.edges[u, v]["fidelity"] = base_fidelity
            self.graph.edges[u, v]["gen_rate"] = gen_rate
            self.graph.edges[u, v]["delay_ms"] = distance_km * 0.005  # ~5 us/km in fiber

    def compute_path_metrics(self, path: List[int], memory_allocated: int) -> Tuple[float, float, float]:
        """Computes end-to-end fidelity, effective entanglement rate, and delay for a path."""
        if len(path) < 2:
            return 0.0, 0.0, float("inf")

        hops = len(path) - 1
        e2e_fidelity = 1.0
        min_link_rate = float("inf")
        total_delay = 0.0

        for i in range(hops):
            u, v = path[i], path[i + 1]
            edge = self.graph.edges[u, v]
            # Werner state approximation for multi-hop fidelity degradation
            link_f = edge["fidelity"]
            e2e_fidelity *= (4 * link_f - 1) / 3.0
            min_link_rate = min(min_link_rate, edge["gen_rate"])
            total_delay += edge["delay_ms"]

        # Convert Werner parameter back to fidelity
        e2e_fidelity = (3 * e2e_fidelity + 1) / 4.0

        # Account for entanglement swapping at intermediate repeater nodes
        swap_prob = 1.0
        for node in path[1:-1]:
            swap_prob *= self.graph.nodes[node]["swap_success_prob"]

        # Memory multiplexing boosts effective rate linearly up to link cap
        multiplex_factor = max(1, memory_allocated // 2)
        effective_rate = min_link_rate * swap_prob * (1 - math.exp(-0.4 * multiplex_factor))
        # Delay increases if rate is low (waiting for entanglement generation)
        gen_wait_ms = (1000.0 / max(effective_rate, 1e-3))
        total_delay += gen_wait_ms

        return e2e_fidelity, effective_rate, total_delay

    def trigger_network_degradation(self, severity: float = 0.25):
        """Simulates dynamic network condition changes (decoherence / link noise)."""
        affected_edges = random.sample(list(self.graph.edges()), k=max(1, int(len(self.graph.edges()) * 0.3)))
        for u, v in affected_edges:
            self.graph.edges[u, v]["fidelity"] *= (1.0 - severity * random.uniform(0.3, 0.8))
            self.graph.edges[u, v]["gen_rate"] *= (1.0 - severity * random.uniform(0.4, 0.9))


class SDQNController:
    def __init__(self, network: QuantumNetwork, reconfig_penalty: float = 0.15):
        self.net = network
        self.reconfig_penalty = reconfig_penalty
        self.reconfig_count = 0

    def release_slice_resources(self, tenant: TenantSlice):
        for node, mem in tenant.allocated_memory_per_node.items():
            self.net.graph.nodes[node]["available_memory"] += mem
        tenant.allocated_memory_per_node.clear()
        tenant.active_path = []

    def allocate_adaptive(self, tenants: List[TenantSlice], event_triggered: bool = True):
        """
        Jointly optimizes path selection and memory allocation ordered by tenant priority.
        If event_triggered=True, only slices violating QoS or degraded beyond threshold are reconfigured.
        """
        sorted_tenants = sorted(tenants, key=lambda t: t.priority, reverse=True)

        for tenant in sorted_tenants:
            if event_triggered and tenant.active_path:
                mem_alloc = min(tenant.allocated_memory_per_node.values()) if tenant.allocated_memory_per_node else 2
                f, r, d = self.net.compute_path_metrics(tenant.active_path, mem_alloc)
                # Check if SLA is still satisfied within a safety margin
                if f >= tenant.min_fidelity and r >= tenant.required_rate * 0.9 and d <= tenant.max_delay_ms:
                    continue  # Skip reconfiguration to save control overhead

            # Release existing resources before finding an optimal slice
            had_previous = len(tenant.active_path) > 0
            self.release_slice_resources(tenant)

            # Candidate paths (up to 5 shortest paths by delay)
            try:
                candidate_paths = list(nx.shortest_simple_paths(
                    self.net.graph, tenant.source, tenant.destination, weight="delay_ms"
                ))[:5]
            except nx.NetworkXNoPath:
                continue

            best_utility = -float("inf")
            best_plan = None

            for path in candidate_paths:
                # Check minimum available memory along path
                min_avail = min(self.net.graph.nodes[n]["available_memory"] for n in path)
                if min_avail < 2:
                    continue

                # Priority-scaled memory allocation (higher priority gets up to 6 slots per node)
                desired_mem = min(min_avail, 2 + (tenant.priority // 3) * 2)
                f, r, d = self.net.compute_path_metrics(path, desired_mem)

                # Utility function combining fidelity, rate satisfaction, and priority weight
                f_score = 1.0 if f >= tenant.min_fidelity else (f / tenant.min_fidelity) - 1.5
                r_score = min(1.2, r / tenant.required_rate)
                d_score = 1.0 if d <= tenant.max_delay_ms else (tenant.max_delay_ms / d) - 1.0

                utility = tenant.priority * (0.45 * f_score + 0.35 * r_score + 0.20 * d_score)
                if had_previous:
                    utility -= self.reconfig_penalty * tenant.priority

                if utility > best_utility:
                    best_utility = utility
                    best_plan = (path, desired_mem)

            if best_plan:
                chosen_path, mem_per_node = best_plan
                tenant.active_path = chosen_path
                for node in chosen_path:
                    self.net.graph.nodes[node]["available_memory"] -= mem_per_node
                    tenant.allocated_memory_per_node[node] = mem_per_node
                if had_previous:
                    self.reconfig_count += 1

    def allocate_static(self, tenants: List[TenantSlice]):
        """Baseline: Static shortest-path allocation with fixed 2 memory slots per node."""
        for tenant in tenants:
            if tenant.active_path:
                continue
            path = nx.shortest_path(self.net.graph, tenant.source, tenant.destination)
            if all(self.net.graph.nodes[n]["available_memory"] >= 2 for n in path):
                tenant.active_path = path
                for n in path:
                    self.net.graph.nodes[n]["available_memory"] -= 2
                    tenant.allocated_memory_per_node[n] = 2


def evaluate_tenants(net: QuantumNetwork, tenants: List[TenantSlice]) -> Dict[str, float]:
    total_rate = 0.0
    fidelities = []
    sla_satisfied = 0

    for t in tenants:
        if not t.active_path:
            continue
        mem = min(t.allocated_memory_per_node.values())
        f, r, d = net.compute_path_metrics(t.active_path, mem)
        total_rate += r
        fidelities.append(f)
        if f >= t.min_fidelity and r >= t.required_rate * 0.85 and d <= t.max_delay_ms:
            sla_satisfied += 1

    total_mem = sum(net.graph.nodes[n]["total_memory"] for n in net.graph.nodes())
    used_mem = total_mem - sum(net.graph.nodes[n]["available_memory"] for n in net.graph.nodes())

    return {
        "Avg_Delivery_Rate_ebits_s": round(total_rate / len(tenants), 2),
        "Avg_Fidelity": round(float(np.mean(fidelities)) if fidelities else 0.0, 4),
        "Memory_Utilization_%": round((used_mem / total_mem) * 100, 1),
        "QoS_Satisfaction_%": round((sla_satisfied / len(tenants)) * 100, 1),
    }


def run_comparison():
    tenants_template = [
        TenantSlice("T1_QKD_Gov", priority=10, source=0, destination=7, min_fidelity=0.90, required_rate=25.0, max_delay_ms=60.0),
        TenantSlice("T2_Fin_Net", priority=8, source=1, destination=8, min_fidelity=0.87, required_rate=20.0, max_delay_ms=80.0),
        TenantSlice("T3_Cloud_Sync", priority=5, source=2, destination=9, min_fidelity=0.82, required_rate=15.0, max_delay_ms=120.0),
        TenantSlice("T4_Research", priority=3, source=3, destination=6, min_fidelity=0.78, required_rate=10.0, max_delay_ms=150.0),
        TenantSlice("T5_Telemetry", priority=2, source=4, destination=5, min_fidelity=0.75, required_rate=8.0, max_delay_ms=200.0),
    ]

    # 1. Static Baseline Simulation
    net_static = QuantumNetwork(num_nodes=10, seed=42)
    ctrl_static = SDQNController(net_static)
    tenants_static = [TenantSlice(**{k: v for k, v in vars(t).items() if k not in ["active_path", "allocated_memory_per_node"]}) for t in tenants_template]
    ctrl_static.allocate_static(tenants_static)
    net_static.trigger_network_degradation(severity=0.30)
    res_static = evaluate_tenants(net_static, tenants_static)
    res_static["Reconfigurations"] = ctrl_static.reconfig_count

    # 2. Proposed Adaptive Event-Triggered Simulation
    net_adaptive = QuantumNetwork(num_nodes=10, seed=42)
    ctrl_adaptive = SDQNController(net_adaptive)
    tenants_adaptive = [TenantSlice(**{k: v for k, v in vars(t).items() if k not in ["active_path", "allocated_memory_per_node"]}) for t in tenants_template]
    ctrl_adaptive.allocate_adaptive(tenants_adaptive, event_triggered=False)  # Initial orchestration
    net_adaptive.trigger_network_degradation(severity=0.30)
    ctrl_adaptive.allocate_adaptive(tenants_adaptive, event_triggered=True)   # Event-triggered adaptation
    res_adaptive = evaluate_tenants(net_adaptive, tenants_adaptive)
    res_adaptive["Reconfigurations"] = ctrl_adaptive.reconfig_count

    df = pd.DataFrame([res_static, res_adaptive], index=["Static Allocation", "Adaptive Priority-Aware SDQN"])
    print("\n=== Multi-Tenant SDQN Slicing Simulation Results (Post-Degradation) ===")
    print(df.to_string())


if __name__ == "__main__":
    run_comparison()