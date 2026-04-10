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
4. **Zombie Guard:** Mortise specifically protects against "zombies"—deleted records returning to life due to stale updates. If a remote update arrives for a row already marked as deleted locally, it is rejected unless the remote HLC is strictly newer than the local tombstone.

## 👻 Reliable Deletion: Tombstones

Instead of destructive `DELETE` operations, Mortise uses **Tombstones** to ensure deletion synchronization is permanent and reliable:

- **Soft Deletes:** Records are marked with `is_deleted = true`.
- **Filtering:** The UI automatically filters out these tombstones, but the data remains to provide a "memory" of the deletion for conflict resolution.
- **Convergence:** Tombstones are broadcasted just like inserts, ensuring all nodes reach the same state even if they were offline during the deletion event.

## 🤝 Bootstrapping: Bulletproof Initialization

Mortise uses a sequenced bootstrap process to ensure new nodes converge to the correct state without race conditions:

1. **Sequenced Startup:** The UI coordinates with the worker to ensure tables are created before synchronization begins.
2. **Message Queuing:** Incoming replication events arriving during startup are queued in a buffer and processed only after the initial handshake is ready.
3. **Verified Handshake:** Handshakes are HLC-aware; a node will only update its local records if the handshake data is strictly newer than its current state.
4. **Loading Gate:** The UI waits for a `HANDSHAKE_COMPLETED` signal (with a 2s timeout) before allowing user interaction, preventing "flickers" of stale data.

## 📊 Visual Monitoring: Sync Dashboard

Mortise includes a built-in debug dashboard to monitor the distributed state in real-time:
- **Node Identity:** View the unique 8-character ID of the current tab.
- **Clock State:** Real-time HLC monitoring.
- **Event Log:** A rolling history of replication events with status badges:
  - `🤝 State synced`: A successful initial handshake from another tab.
  - `✓ Applied`: The mutation was newer and successfully merged.
  - `👻 DEL`: A tombstone was received and applied.
  - `✗ Stale`: The mutation was older and was rejected (LWW or Zombie Guard).

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
5. **Delete a User**: Click "Delete" and observe the `👻 DEL` ghost badge arrival in other tabs.
6. **Stress Test**: Rapidly refresh Tab A while deleting in Tab B to observe the **Zombie Guard** and **Sequenced Bootstrap** in action.
