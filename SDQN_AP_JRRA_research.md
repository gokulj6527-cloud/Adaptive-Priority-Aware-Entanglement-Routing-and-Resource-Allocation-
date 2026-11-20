# Complete Research Development: SDQN-Based Adaptive Entanglement Routing and Resource Allocation

We will develop all three components of the proposed research:

1. **Mathematical formulation** — Define the network model, optimization variables, objective function, and constraints.
2. **Optimization algorithm** — Design the proposed adaptive, priority-aware joint routing and resource-allocation algorithm.
3. **Python simulation implementation** — Build an SDQN simulation, implement baseline algorithms, and evaluate performance using research metrics.

The objective is to produce a research contribution that is mathematically defensible, implementable without specialized quantum hardware, and suitable for a simulation-based research paper.

## 1. Define the Proposed System

We consider a **Software-Defined Quantum Network (SDQN)** consisting of:

- **SDQN Controller:** Maintains network state and makes routing and resource-allocation decisions.
- **Quantum Nodes:** Generate, store, and distribute entanglement.
- **Quantum Links:** Connect nodes and support entanglement generation.
- **Tenants:** Independent network slices requesting entanglement services.

Each tenant has its own:

- Priority level.
- Required fidelity.
- Requested entanglement rate.
- Maximum acceptable delivery delay.

The controller dynamically decides which paths to use and how much of the available quantum resources each tenant receives.

### Example Network

Consider a network with six quantum nodes and several possible paths between source and destination.

Suppose three tenants request entanglement:

| Tenant | Priority | Required fidelity | Requested rate |
|---|---:|---:|---:|
| A | High (3) | 0.95 | 5 pairs/s |
| B | Medium (2) | 0.90 | 4 pairs/s |
| C | Low (1) | 0.85 | 3 pairs/s |

These are illustrative simulation parameters, not experimental measurements.

The network has limited memory capacity, entanglement-generation rates, and link bandwidth.

The controller must determine:

- Which path each tenant should use.
- How many resources each tenant should receive.
- Whether a tenant should receive priority over another.
- When an existing allocation should be changed.

This is the optimization problem we are solving.

## 2. Mathematical Formulation

This is the central technical contribution. We need to formulate routing and resource allocation as one joint optimization problem rather than two independent decisions.

### 2.1 Network Model

Represent the quantum network as a weighted graph:

\[
G=(V,E)
\]

Where:

- \(V\): Set of quantum nodes.
- \(E\): Set of quantum communication links.

Each link \(e \in E\) has:

| Parameter | Meaning |
|---|---|
| \(C_e\) | Maximum entanglement-generation capacity |
| \(F_e\) | Link-level entanglement fidelity |
| \(D_e\) | Link transmission delay |
| \(P_e\) | Entanglement-generation success probability |

Each node \(v \in V\) has:

| Parameter | Meaning |
|---|---|
| \(M_v\) | Available quantum-memory capacity |
| \(T_v\) | Quantum-memory coherence time |
| \(S_v\) | Entanglement-swapping capacity |

Each tenant \(i\) has a request:

\[
R_i=(s_i,d_i,\lambda_i,F_i^{min},D_i^{max},w_i)
\]

Where:

- \(s_i\): Source node.
- \(d_i\): Destination node.
- \(\lambda_i\): Requested entanglement-generation rate.
- \(F_i^{min}\): Minimum required fidelity.
- \(D_i^{max}\): Maximum acceptable delay.
- \(w_i\): Tenant priority weight.

We use three priority levels:

\[
w_i \in \{1,2,3\}
\]

Low, medium, and high priority, respectively.

### 2.2 Decision Variables

The controller makes two related decisions.

**Routing decision:**

\[
x_{ip} =
\begin{cases}
1 & \text{if tenant } i \text{ uses path } p \\
0 & \text{otherwise}
\end{cases}
\]

**Resource-allocation decision:**

\[
y_{ip} \geq 0
\]

This represents the entanglement-generation rate allocated to tenant \(i\) along path \(p\).

The delivered rate is:

\[
z_i=\sum_{p \in P_i} y_{ip}
\]

For the initial implementation, we restrict each tenant to one selected path per allocation period. This reduces computational complexity.

### 2.3 Objective Function

We want to maximize successful, priority-weighted entanglement delivery while minimizing resource consumption and SLA violations.

Define:

\[
\boxed{
\max J =
\alpha \sum_i w_i z_i
-\beta \sum_e u_e
-\gamma \sum_i V_i
-\delta \sum_i H_i
}
\]

Where:

- \(z_i\): Delivered entanglement rate.
- \(u_e\): Normalized utilization of link \(e\).
- \(V_i\): SLA-violation penalty.
- \(H_i\): Reconfiguration cost.
- \(\alpha,\beta,\gamma,\delta\): Objective weights.

The terms have distinct purposes:

1. **Priority-weighted delivery:** Rewards satisfying higher-priority tenants.
2. **Resource utilization:** Discourages unnecessarily expensive allocations and bottlenecks.
3. **SLA penalty:** Discourages failure to meet requested fidelity, rate, and delay.
4. **Reconfiguration penalty:** Prevents unnecessary route changes.

For a more interpretable implementation, we will use a normalized utility score rather than trying to solve the full mixed-integer optimization problem exactly.

### 2.4 Constraints

**Constraint 1: Demand limitation**

\[
0 \leq z_i \leq \lambda_i
\]

A tenant cannot receive more resources than requested.

**Constraint 2: Link capacity**

\[
\sum_i \sum_{p:e \in p} y_{ip} \leq C_e
\]

The total allocated rate through a link cannot exceed its generation capacity.

**Constraint 3: Quantum-memory capacity**

\[
\sum_i \sum_{p:v \in p} y_{ip}\tau_{ip} \leq M_v
\]

Here, \(\tau_{ip}\) represents the average memory-holding time associated with the allocated entanglement rate.

**Constraint 4: Fidelity requirement**

\[
F_{ip} \geq F_i^{min}
\]

**Constraint 5: Delivery delay**

\[
D_{ip} \leq D_i^{max}
\]

**Constraint 6: Routing selection**

\[
\sum_{p \in P_i} x_{ip} \leq 1
\]

**Constraint 7: Allocation only on selected paths**

\[
y_{ip} \leq \lambda_i x_{ip}
\]

These constraints ensure that the selected route is physically feasible within the simplified network model.

### 2.5 Modeling End-to-End Fidelity

This is important because quantum networking cannot be modeled like ordinary packet routing.

For a simple Werner-state approximation, define the link visibility:

\[
v_e=\frac{4F_e-1}{3}
\]

For a path containing multiple links:

\[
\boxed{
F_p=\frac{1}{4}
+
\frac{3}{4}
\prod_{e \in p}v_e
\prod_{v \in p_{\text{internal}}}v_v^{swap}
}
\]

Here, \(v_v^{swap}\) represents the effective visibility factor associated with swapping operations.

This is a simplified model. It assumes compatible Werner-state links and idealized swapping behavior apart from the modeled visibility factors.

Memory decoherence can be modeled using:

\[
F_p(t)=\frac{1}{4}
+
\left(F_p(0)-\frac{1}{4}\right)e^{-t/T_{\mathrm{eff}}}
\]

This allows us to penalize paths where entanglement must remain stored for extended periods.

> **Important:** Fidelity composition depends on the quantum-state and noise model. We should state the assumptions explicitly in the paper rather than presenting this equation as universally applicable.

## 3. Proposed Optimization Algorithm

### Adaptive Priority-Aware Joint Routing and Resource Allocation (AP-JRRA)

We will use this as the name of the proposed algorithm.

It combines four operations:

1. Priority-aware request ordering.
2. Fidelity- and delay-aware path selection.
3. Joint resource allocation.
4. Event-triggered reoptimization.

It is a heuristic, not an exact global optimizer. That is appropriate for an initial Python simulation, provided we compare it with suitable baselines.

### 3.1 How the Algorithm Works

**Step 1 — Monitor network state**

Collect link capacities, fidelity, memory availability, and tenant demands.

**Step 2 — Detect significant changes**

Check whether demand or network conditions exceed the adaptation threshold.

**Step 3 — Prioritize tenant requests**

Sort requests using priority, unmet demand, and SLA urgency.

**Step 4 — Select candidate routes**

Evaluate alternative paths using fidelity, delay, capacity, and resource cost.

**Step 5 — Allocate resources**

Allocate available link and memory resources without violating constraints.

**Step 6 — Update network slices**

Apply feasible allocations and monitor performance for the next interval.

### 3.2 Path Evaluation

For each tenant, generate a set of candidate paths.

Reject any path that violates:

\[
F_p < F_i^{min}
\]

or

\[
D_p > D_i^{max}
\]

For the remaining paths, calculate:

\[
Cost(i,p)=
a\frac{D_p}{D_i^{max}}
+
b\frac{1-F_p}{1-F_i^{min}}
+
cR_p
\]

Where \(R_p\) represents normalized resource scarcity along the path.

The controller selects:

\[
p_i^*=\arg\min_{p \in P_i}Cost(i,p)
\]

This avoids selecting a path based solely on the number of hops or shortest distance.

### 3.3 Priority-Aware Allocation

We introduce a priority-adjusted allocation weight:

\[
W_i=w_i(1+\rho U_i)
\]

Where:

\[
U_i=1-\frac{z_i}{\lambda_i}
\]

is the fraction of unmet demand and \(\rho\) controls how strongly unmet demand affects priority.

This means:

- Higher-priority tenants receive preference.
- Tenants with unsatisfied requests receive additional consideration.
- Lower-priority tenants can still receive resources when capacity is available.

### 3.4 Event-Triggered Adaptation

This is an important part of the proposed framework.

Instead of recalculating every route after every simulation step, the controller checks whether a meaningful change has occurred.

For example:

\[
\Delta(t)=
\max\left(
\frac{|C_e(t)-C_e(t-1)|}{C_e(t-1)},
\frac{|\lambda_i(t)-\lambda_i(t-1)|}{\lambda_i(t-1)}
\right)
\]

We trigger reoptimization when:

\[
\boxed{\Delta(t)>\theta}
\]

Where \(\theta\) is the adaptation threshold.

For example:

\[
\theta=0.15
\]

This means a change exceeding 15% can trigger a new allocation.

In practice, we should also introduce a minimum interval between reconfigurations to avoid excessive controller activity.

## 4. Algorithm Pseudocode

```text
Algorithm AP-JRRA

Input:
    Quantum network G(V,E)
    Tenant requests R
    Link capacities C
    Node memory capacities M
    Adaptation threshold θ

Initialize:
    Previous network state
    Previous allocations

For each simulation interval t:

    Collect current network state

    Calculate network-state changes Δ(t)

    If Δ(t) > θ OR a new request arrives:

        Generate candidate paths for each tenant

        Sort tenants using:
            Priority
            Unmet demand
            SLA urgency

        Reset temporary resource allocations

        For each tenant i:

            Generate feasible paths

            Remove paths violating:
                Fidelity requirements
                Delay requirements

            For each remaining path:
                Calculate path cost

            Select minimum-cost feasible path

            Calculate available link capacity

            Calculate available memory capacity

            Allocate resources up to:
                Requested demand
                Link capacity
                Memory capacity

            Update resource availability

        Compare new allocations with previous allocations

        Apply feasible allocations

        Record reconfiguration cost

    Update performance metrics

    Store current network state

Output:
    Routing decisions
    Resource allocations
    Performance measurements
```

## 5. Python Simulation Architecture

We will implement this without requiring an actual quantum computer.

The simulation represents quantum-network behavior mathematically and models the SDQN controller in Python.

### 5.1 Technology Stack

| Component | Technology |
|---|---|
| Programming language | Python 3 |
| Network topology | NetworkX |
| Numerical calculations | NumPy |
| Performance analysis | Pandas |
| Graph visualization | Matplotlib |
| Optimization | Custom AP-JRRA heuristic |

No Qiskit or quantum hardware is required for the initial study. We are simulating network-level entanglement distribution, not executing quantum circuits.

### 5.2 Simulation Modules

Proposed project structure:

```text
AP-JRRA/
├── main.py               # Simulation entry point
├── network.py            # Quantum network topology and link properties
├── tenants.py            # Tenant requests, priorities, and SLA parameters
├── routing.py            # Candidate-path generation and fidelity evaluation
├── optimizer.py          # AP-JRRA routing and resource allocation
├── baselines.py          # Comparison algorithms
├── metrics.py            # Performance evaluation
├── visualization.py      # Plots and result visualization
├── config.py             # Simulation parameters
└── results/              # CSV files and performance graphs
```

### 5.3 Simulation Procedure

We will simulate the network over multiple time intervals.

For example:

| Interval | Network condition |
|---:|---|
| 1–20 | Normal network operation |
| 21–30 | Congestion on selected links |
| 31–45 | Capacity recovery |
| 46–60 | Increased tenant demand |
| 61–80 | Changing link conditions |
| 81–100 | Recovery and new demand patterns |

These are controlled experimental scenarios, not predictions of real network behavior.

At every interval, we record:

- Entanglement-delivery rate.
- End-to-end fidelity.
- Quantum-memory utilization.
- Link utilization.
- Delivery delay.
- QoS satisfaction.
- Number of controller reconfigurations.

### 5.4 Baseline Algorithms

We need meaningful comparisons to establish whether AP-JRRA actually improves performance.

| Algorithm | Routing | Priority | Adaptation |
|---|---|---|---|
| Static shortest-path | Shortest delay | No | No |
| Priority-blind adaptive | Cost-based | No | Event-triggered |
| AP-JRRA | Fidelity/delay/resource-aware | Yes | Event-triggered |

We should also add an ablation experiment:

- AP-JRRA without priority awareness.
- AP-JRRA without event triggering.
- AP-JRRA without resource-scarcity awareness.
- Complete AP-JRRA.

This will establish which component contributes to the improvement.

## 6. Expected Research Evaluation

We should not assume that the proposed algorithm performs better before running experiments. Instead, we establish measurable hypotheses.

| Metric | Expected behavior |
|---|---|
| Entanglement-delivery rate | Increase |
| Fidelity compliance | Increase or remain above SLA thresholds |
| Memory utilization | Improve efficiency |
| Link utilization | Improve distribution of available capacity |
| Delivery delay | Decrease |
| QoS satisfaction | Increase |
| Reconfiguration count | Decrease compared with frequent periodic optimization |

### Important Distinction

Higher utilization is not always better.

For example, a network operating at 99% utilization may have insufficient spare capacity to handle sudden tenant requests.

Therefore, we should evaluate both utilization and SLA satisfaction. We should also report resource wastage and congestion.

### Proposed Graphs

1. Entanglement-delivery rate.
2. QoS satisfaction.
3. Resource utilization.
4. Delivery delay.

We should run each scenario across multiple random seeds and report mean values and confidence intervals. This is important for publication credibility.

## 7. Research Novelty: What Can We Actually Claim?

This requires particular care.

The general ideas of priority-aware resource allocation, fidelity-aware routing, and quantum-resource optimization already exist.

For example:

- Abane et al. (2025) provide a comprehensive survey of entanglement-routing approaches.
- Halder et al. (2024) formulate quantum resource allocation using integer linear programming and a heuristic.
- FARA (2025) already investigates priority-driven and fair resource allocation in entanglement networks.
- High-fidelity routing research has also considered throughput and resource allocation jointly.

Therefore, simply proposing a priority-based routing algorithm would not be a defensible novelty claim.

### Our Potential Contribution

We recommend concentrating the novelty on the combination of:

1. **Cross-slice joint optimization:** Routing and resource-allocation decisions are made together across competing tenants.
2. **SLA-aware priority adaptation:** Priority and unmet demand influence allocation decisions while preserving fidelity and delay constraints.
3. **Event-triggered reconfiguration:** Allocations are reconsidered only when meaningful changes occur.
4. **Reconfiguration-aware optimization:** The controller accounts for the cost of changing existing allocations, rather than optimizing each interval independently.

**Recommended research contribution:**

> This work investigates an event-triggered, SLA-aware joint entanglement-routing and resource-allocation heuristic for multi-tenant SDQN environments, incorporating tenant priority, quantum-resource scarcity, and reconfiguration overhead into a unified optimization framework.

This is a proposed contribution, not a verified claim that no equivalent algorithm exists. We need a deeper literature comparison before asserting originality.

## 8. Initial Python Implementation

The following is the core implementation that can be saved as `main.py`. It includes network generation, candidate routing, priority-aware allocation, event-triggered updates, and baseline comparisons.

Install dependencies:

```bash
pip install networkx numpy pandas matplotlib
```

```python
import networkx as nx
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

# ---------------- NETWORK ----------------
def create_network():
    G = nx.Graph()

    links = [
        (0, 1, 8, .985, 2),
        (1, 2, 6, .980, 2.5),
        (2, 3, 7, .986, 2),
        (3, 7, 8, .984, 2),
        (0, 4, 5, .992, 3),
        (4, 5, 5, .990, 3),
        (5, 7, 5, .991, 3),
        (1, 5, 4, .982, 4),
        (2, 6, 5, .988, 2.5),
        (6, 7, 5, .987, 2.5),
        (4, 6, 3.5, .980, 3.5)
    ]

    for u, v, cap, fidelity, delay in links:
        G.add_edge(
            u, v,
            capacity=cap,
            fidelity=fidelity,
            delay=delay,
            base_capacity=cap
        )

    for n in G.nodes:
        G.nodes[n]["memory"] = 15

    return G
```

> **Prototype status:** This is a starting implementation, not a validated research simulator. Before using its results in a paper, correct the baseline comparison, add memory and swapping-capacity accounting to every algorithm, model stochastic entanglement generation and decoherence, and test multiple random seeds. The code also uses a simplified fidelity model and should not be interpreted as a complete physical-layer simulation.

## 9. Important Implementation Corrections

Before running the code, make these corrections.

### Correction 1 — Baseline Dictionary Syntax

Replace the `residual` initialization in `shortest_path_baseline()` with:

```python
residual = {
    tuple(sorted((u, v))): G[u][v]["capacity"]
    for u, v in G.edges
}
```

### Correction 2 — Demand Changes Must Trigger Optimization

The current event detector tracks link capacities only. Include tenant demands in the state vector:

```python
current_state = np.array(
    [G[u][v]["capacity"] for u, v in G.edges]
    + [r["demand"] for r in tenants]
)
```

Initialize `previous_state` using the same structure.

### Correction 3 — Baseline Terminology

The current shortest-path baseline recomputes allocations every interval. It is therefore a **shortest-path allocation baseline**, not a strictly static allocation strategy.

We should implement a separate **fixed-allocation baseline** for the final experiments.

## 10. Final Research Paper Structure

| Section | Content |
|---|---|
| I. Introduction | SDQN, multi-tenancy, research motivation |
| II. Related Work | Entanglement routing, slicing, resource allocation |
| III. System Model | Network, tenants, quantum resources |
| IV. Problem Formulation | Objective function and constraints |
| V. Proposed AP-JRRA | Algorithm and event-triggered adaptation |
| VI. Simulation Setup | Topology, parameters, baselines |
| VII. Results and Discussion | Performance graphs and comparisons |
| VIII. Conclusion | Contributions and future work |

### Research Papers to Study First

These are particularly relevant to the proposed work:

1. [Entanglement Routing in Quantum Networks: A Comprehensive Survey (2025)](https://doi.org/10.1109/TQE.2025.3541123)
2. [Optimal Routing and End-to-End Entanglement Distribution in Quantum Networks (2024)](https://doi.org/10.1038/s41598-024-70114-1)
3. [Enhancing Quantum Communication: A Fair and Restricted Resource Allocation Approach for Entanglement Networks (2025)](https://doi.org/10.1109/TNSE.2025.3551425)
4. [High-Fidelity Entanglement Routing in Quantum Networks (2024)](https://doi.org/10.1016/j.rinp.2024.107682)

## 11. Recommended Development Order

Follow this order rather than immediately writing the complete paper:

1. **Finalize mathematical formulation** — Verify the fidelity, memory, capacity, and delay constraints.
2. **Implement AP-JRRA** — Complete the routing and resource-allocation heuristic.
3. **Implement baselines** — Include shortest-path, priority-blind, and fixed-allocation approaches.
4. **Run experiments** — Test different topologies, tenant counts, demand levels, and network disruptions.
5. **Perform statistical analysis** — Compare averages, confidence intervals, and ablation results.
6. **Write the research paper** — Establish the novelty claim using the results and literature comparison.

**Recommendation:** Keep the initial implementation relatively small. A six-to-ten-node network with three-to-five tenants is sufficient for a first experimental prototype. Expand only after the algorithm works correctly.

The most important research question is not whether AP-JRRA can find a good route. It is whether jointly considering tenant priorities, quantum-resource scarcity, and reconfiguration overhead produces measurable improvements over existing allocation strategies.
