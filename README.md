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

## 🔋 Storage: Persistent IndexedDB

Unlike many memory-only demos, Mortise is fully persistent. It uses a **PGlite IndexedDB** strategy to ensure that data survives page refreshes and tab closures:

- **Automatic Mounting:** The database is asynchronously mounted before any synchronization or querying begins.
- **Node-Isolated Stores:** Each unique node (tab) maintains its own isolated IndexedDB storefront to prevent file-locking conflicts.

## 🆔 Multi-Tab Safety: Hybrid Identity

To support robust testing on `localhost` where all tabs share `localStorage`, Mortise employs a **Hybrid Identity** system:

1. **Device ID (Stored: localStorage):** A stable prefix that identifies the browser/device.
2. **Session ID (Stored: sessionStorage):** A unique suffix generated per tab that is stable across refreshes but unique across multiple tabs.

**Format:** `DeviceID-SessionID` (e.g., `4367-io5k`)

This ensures that tabs on the same port do not collide on IndexedDB locks or ignore each other's synchronization broadcasts.

## ⚡ Performance: Delta Sync

To minimize payload sizes in established databases, Mortise employs a **Delta Sync** optimization during the handshake:

1. **High-Water Mark:** Before requesting a sync, the node finds its maximum local `last_modified_hlc`.
2. **Targeted Fetch:** It sends this timestamp as `sinceHlc` in the `SYNC_REQUEST`.
3. **Strict Delta:** The remote peer returns only the records modified strictly *after* that timestamp.
4. **Efficiency:** Fresh tabs perform a "Full" sync, while existing tabs perform a fast "Delta" sync upon refresh or reconnection.

## 📊 Visual Monitoring: Sync Dashboard

Mortise includes a built-in debug dashboard to monitor the distributed state in real-time:
- **Node Identity:** View the unique Hybrid ID of the current tab.
- **Storage Status:** Confirms `💾 Persistent (IDB)` status.
- **Nuke Database:** A "big red button" to clear all local IndexedDB data and `localStorage` identity—essential for starting fresh tests.
- **Event Log:** A rolling history of replication events with status badges:
  - `🤝 Synced X rows (Delta/Full)`: Indicates an initial handshake or refresh sync with row counts.
  - `✓ Applied`: The mutation was newer and successfully merged.
  - `👻 DEL`: A tombstone was received and applied.
  - `✗ Stale`: The mutation was older and was rejected (LWW or Zombie Guard).

## 🛠️ Technology Stack

- **Database:** [PGlite](https://pglite.dev/) (Postgres WASM) with **IndexedDB persistence**.
- **Identity:** Hybrid `localStorage` + `sessionStorage` residency.
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
