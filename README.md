# Mortise

Mortise is a local-first synchronization framework designed to seamlessly sync data between disconnected clients using robust distributed systems primitives.

## 🕰️ The Heartbeat: Hybrid Logical Clocks (HLC)

At the core of Mortise is the **Hybrid Logical Clock (HLC)**. Because distributed nodes (browsers, mobile apps) cannot rely on perfectly synchronized hardware clocks, Mortise uses HLCs to assign globally unique, sortable timestamps (`ISO-CCCC-nodeId`) to all mutations.

- **Causality Tracking:** The `hlc.receive()` action ensures local clocks "jump" forward to stay ahead of any remote data received.
- **Lexicographic Sorting:** Encoded HLCs are naturally sortable as strings, making conflict resolution computationally cheap.

## 🛡️ Conflict Resolution: Last Write Wins (LWW)

Mortise implements a **Last Write Wins (LWW)** strategy to ensure convergence across all nodes:

1. **Guarded Writes:** Every table includes a `last_modified_hlc` column.
2. **Deterministic Merging:** Before applying a remote replication message, the worker compares the incoming HLC with the local record's HLC.
3. **Stale Rejection:** If `Incoming HLC <= Local HLC`, the update is rejected as "stale news."
4. **Idempotency:** Remote updates are automatically converted to `UPSERT` (INSERT ... ON CONFLICT DO UPDATE) patterns to handle retries and out-of-order delivery gracefully.

## 📊 Visual Monitoring: Sync Dashboard

Mortise includes a built-in debug dashboard to monitor the distributed state in real-time:
- **Node Identity:** View the unique 8-character ID of the current tab.
- **Clock State:** Real-time HLC monitoring.
- **Event Log:** A rolling history of replication events with status badges:
  - `✓ Applied`: The mutation was newer and successfully merged.
  - `✗ Stale`: The mutation was older and was rejected by the LWW guard.

## 🛠️ Technology Stack

- **Database:** [PGlite](https://pglite.dev/) (Postgres WASM) running in a Web Worker.
- **Replication:** `BroadcastChannel` for low-latency multi-tab coordination.
- **UI:** React + Tailwind CSS with a focus on high-fidelity dashboarding.

## 🚀 Getting Started

### Installation
```bash
npm install
```

### Development
```bash
npm run dev
```

### Testing Synchronization
1. Open the dev server (usually `localhost:5173`).
2. Open **two or more tabs** side-by-side.
3. Click **"+ Add User"** in Tab A.
4. Observe Tab B's dashboard receiving the event and updating its table in real-time.
5. Use the console to simulate "Time Travel" conflicts by broadcasting old HLCs and watching the LWW engine reject them.
