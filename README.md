# Adaptive Priority-Aware Entanglement Routing and Resource Allocation for Multi-Tenant Software-Defined Quantum Network Slicing

## Overview

Software-Defined Quantum Networking (SDQN) supports centralized management of quantum-network resources and enables multiple tenants to share infrastructure while meeting their Quality of Service (QoS) requirements. Limited quantum memories, probabilistic entanglement generation, link conditions, and changing traffic demands make resource allocation challenging.

This project proposes an **adaptive, priority-aware framework** that jointly selects entanglement routes and allocates quantum resources to multiple tenants. It considers tenant priorities, fidelity requirements, entanglement generation rates, resource availability, and delivery delays. An event-triggered mechanism initiates reconfiguration when significant network changes occur, with the goal of improving resource utilization while reducing SLA violations and unnecessary control-plane overhead.

## Architecture

### Quantum Data Plane
- Quantum repeaters and network nodes with quantum memories.
- Entanglement-generation sources.
- Quantum communication links (fiber or free-space).
- Entanglement swapping and purification operations where applicable.

### SDQN Control Plane
- **Global Network State Database:** Tracks link fidelity, entanglement-generation success rates, memory availability, and relevant telemetry.
- **Slice Manager:** Assigns and isolates resources for tenants according to Service Level Agreements (SLAs).
- **Entanglement Orchestrator:** Selects multi-hop paths and coordinates entanglement operations.
- **Adaptive Controller:** Detects significant changes and triggers selective routing/resource reallocation.

## Optimization Formulation

The framework aims to maximize priority-weighted QoS while minimizing reconfiguration cost:

\[
\max \sum_{t \in \mathcal{T}} w_t \cdot \mathrm{QoS}_t - \lambda \sum_{t \in \mathcal{T}} \mathrm{ReconfigCost}_t
\]

Where:
- \(w_t\): Priority weight of tenant \(t\).
- \(\mathrm{QoS}_t\): QoS satisfaction for tenant \(t\).
- \(\mathrm{ReconfigCost}_t\): Cost of changing a tenant's route or allocation.
- \(\lambda\): Weight controlling the trade-off between QoS and reconfiguration overhead.

### Key Constraints
- **Fidelity:** Delivered end-to-end fidelity must meet each tenant's threshold.
- **Memory capacity:** Allocated memory at each node cannot exceed available capacity.
- **Link capacity:** Link entanglement-generation and swapping resources must not be over-allocated.
- **QoS/SLA:** Tenant delivery requirements such as fidelity and latency should be respected as far as resources permit.

## Event-Triggered Adaptation

Instead of continuously running the optimization process, the controller monitors network telemetry and adapts when a meaningful event is detected.

1. **Monitor:** Track link quality, memory conditions, new requests, and SLA performance.
2. **Detect an event:** Trigger when SLA-risk crosses a configured threshold, a node/link fails or degrades, or a high-priority tenant requests a change.
3. **Reallocate:** Re-route and reassign resources for affected slices, avoiding unnecessary network-wide changes.
4. **Resume monitoring:** Continue observing the network after reconfiguration.

## Evaluation Methodology

The framework is intended to be evaluated using Python-based discrete-event simulation and graph-based network models against the following baselines:

| Baseline | Description |
|---|---|
| Static Allocation | Fixed resource allocation and shortest-path routing, without adaptive reallocation. |
| Routing-Only Optimization | Dynamic route selection without priority-aware memory reallocation. |
| Proposed Adaptive Framework | Joint priority-aware routing and memory allocation with event-triggered adaptation. |

### Performance Metrics
- **Entanglement Delivery Rate (EDR):** Successful end-to-end entangled pairs delivered per second (ebits/s).
- **Average End-to-End Fidelity:** Average fidelity of delivered entangled pairs.
- **Quantum Memory Utilization:** Percentage of available memory capacity effectively used.
- **SLA Violation Rate:** Percentage of requests failing specified fidelity and/or latency requirements.
- **Reconfiguration Overhead:** Number or cost of route and resource reassignment operations.

## Project Goals
- Prioritize tenants according to their SLA/service tier.
- Select routes that account for link conditions and end-to-end fidelity.
- Allocate limited quantum memories efficiently.
- Adapt to network changes without unnecessary reconfiguration.
- Compare adaptive joint optimization with static and routing-only approaches.

## Status
This repository describes a proposed framework. Simulation implementation, experiments, and reported results should be documented here as they are completed and validated.

## Keywords
Software-Defined Quantum Networking, Quantum Network Slicing, Entanglement Routing, Resource Allocation, QoS, SLA, Quantum Memory, Fidelity, Multi-Tenant Networks, Event-Triggered Adaptation.
