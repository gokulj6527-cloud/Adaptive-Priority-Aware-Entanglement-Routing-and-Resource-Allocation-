# QNet Control dashboard

This frontend is a dependency-free browser demonstration. Its network, tenant telemetry, route calculations, event handling, and analytics are simulated locally; it does not connect to quantum hardware or a backend API.

## Run locally

From the project `code` directory, serve the existing frontend folder:

```bash
python -m http.server 8000 --directory Frontend
```

Then open `http://localhost:8000`. A local HTTP server is needed because the app uses JavaScript modules. There is no frontend package manifest or build step.

## Simulation model

The initial 8-node topology is deterministic (seed 23). The browser engine uses a binary-heap Dijkstra implementation for shortest-path baselines, a priority queue for tenant admission, a weighted feasible-path heuristic for the proposed policy, per-node memory and per-link rate capacity guards, and event-triggered reallocation of affected slices. Simulation charts compare modeled static, routing-only, and proposed strategies; values are not empirical research results.
