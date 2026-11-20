# Adaptive Priority-Aware Entanglement Routing and Resource Allocation for Multi-Tenant Software-Defined Quantum Network Slicing

## Abstract
Software-Defined Quantum Networking (SDQN) enables centralized management and flexible allocation of quantum network resources among multiple tenants while maintaining their individual Quality of Service (QoS) requirements. However, dynamically allocating limited resources such as quantum memories, entanglement generation capacities, and communication link resources remains challenging, particularly when network conditions and traffic demands change.

This paper proposes an adaptive optimization framework for multi-tenant quantum network slicing that jointly optimizes entanglement routing and quantum resource allocation. The framework considers tenant priorities, fidelity requirements, entanglement generation rates, resource availability, and delivery delays to dynamically select communication paths and allocate available resources. An event-triggered mechanism adapts allocations when significant network changes occur, aiming to improve resource utilization while minimizing SLA violations and unnecessary reconfiguration.

---

## 1. SDQN Architecture for Multi-Tenant Slicing

A multi-tenant Software-Defined Quantum Network (SDQN) separates the control plane from the quantum data plane, allowing centralized orchestration of virtual quantum slices.

* **Quantum Data Plane:** Consists of quantum repeaters, nodes equipped with atomic/solid-state quantum memories, entanglement generation sources (e.g., SPDC/four-wave mixing), and quantum channels (optical fibers/free-space links).
* **SDQN Control Plane:** 
  * **Global Network State Database:** Maintains real-time telemetry on quantum memory states, link fidelities, and entanglement success rates.
  * **Slice Manager:** Isolates virtual resources (allocated memory slots, dedicated entanglement bandwidth) per tenant based on Service Level Agreements (SLAs).
  * **Entanglement Orchestrator:** Computes multi-hop entanglement paths using purification and swapping protocols.

---

## 2. Optimization Problem Formulation

The joint routing and resource allocation problem can be formulated as a multi-objective optimization problem balancing QoS satisfaction against reconfiguration overhead.

### Key Variables & Parameters
* **Tenant Priority ($w_t$):** Weight assigned to tenant $t$ based on their SLA tier (e.g., mission-critical cryptography vs. standard data transfer).
* **Fidelity Threshold ($F_{th, t}$):** Minimum acceptable end-to-end entanglement fidelity for tenant $t$.
* **Quantum Memory Capacity ($M_i$):** Available storage slots at node $i$ with a coherence time $T_2$.
* **Entanglement Generation Rate ($\gamma_{ij}$):** Probabilistic rate of raw entanglement generation across link $(i, j)$.

### Objective Function
Maximize the overall network utility defined by weighted QoS satisfaction while penalizing control-plane overhead (reconfigurations):

$$\max \sum_{t \in \mathcal{T}} w_t \cdot \text{QoS}_t - \lambda \sum_{t \in \mathcal{T}} \text{ReconfigCost}_t$$

Subject to strict quantum constraints:
1. **Fidelity Constraint:** End-to-end fidelity $F_{\text{end-to-end}} \ge F_{th, t}$ (accounting for degradation across entanglement swaps and memory decoherence).
2. **Memory Constraint:** Allocated memory per node $i$ cannot exceed its physical capacity: $\sum_{t} m_{i,t} \le M_i$.
3. **Link Capacity Constraint:** Entanglement requests on link $(i,j)$ must respect maximum generation and swapping limits.

---

## 3. Proposed Event-Triggered Adaptation Mechanism

Running full optimization loops continuously is computationally prohibitive and unnecessary given the stability of quantum links. Instead, an **event-triggered control loop** is employed:

1. **Normal Operation (Monitoring):** The control plane monitors real-time telemetry (link error rates, memory degradation, and new tenant request arrivals).
2. **Trigger Condition:** An event-trigger evaluates whether:
   * A tenant's SLA violation risk exceeds a threshold ($\Delta \text{SLA} > \epsilon$).
   * A critical link or node fails/degrades significantly.
   * A high-priority tenant requests a dynamic slice adjustment.
3. **Adaptive Reallocation:** When triggered, a priority-aware heuristic solver re-routes active entanglement paths and reallocates memory slots only for affected slices, minimizing unnecessary network-wide reconfiguration churn.

---

## 4. Evaluation Methodology

The proposed approach is evaluated via Python-based discrete-event and network graph simulations against baseline strategies:
1. **Static Allocation:** Fixed pre-allocated resources and shortest-path routing without dynamic adaptation.
2. **Partially Optimized (Routing-Only):** Dynamic routing without priority-aware memory reallocation.
3. **Proposed Adaptive Framework:** Joint priority-aware routing and memory allocation with event-triggered adaptation.

### Key Performance Metrics
* **Entanglement Delivery Rate (EDR):** Successful end-to-end entangled pairs per second (ebits/s).
* **Average End-to-End Fidelity:** Mean fidelity of delivered Bell pairs relative to tenant thresholds.
* **Quantum Memory Utilization:** Percentage of active memory slots effectively utilized across nodes.
* **SLA Violation Rate:** Percentage of tenant requests failing to meet fidelity or latency requirements.
* **Reconfiguration Overhead:** Frequency of slice route/memory re-assignments during dynamic network shifts.