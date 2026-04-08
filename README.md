# Mortise

Mortise is a local-first synchronization framework designed to seamlessly sync data between disconnected clients and over the network using robust distributed systems primitives.

## The Heartbeat: Hybrid Logical Clocks

At the core of Mortise's conflict-free sync architecture is the **Hybrid Logical Clock (HLC)**. Because nodes in an eventually-consistent distributed system (like browsers or mobile apps) cannot rely on perfectly synchronized physical hardware clocks, Mortise uses HLCs to gracefully assign globally unique, sortable timestamps to all local data mutations.

### How Mortise Uses HLCs
1. **Preserving True Causality:** Unlike a standard `Date.now()` timestamp, HLCs guarantee event causality. If a local mutation relies on data received from another client, the `receive` action bumps the local logical clock forward. This guarantees the local reaction strictly happens "after" the event that caused it, preserving sequential integrity across the network.
2. **Offline Resilience:** HLCs enable Mortise to track state perfectly during offline gaps. When clients eventually reconnect and exchange data streams, their offline timelines effortlessly zip together. The deterministic structure (incorporating physical time, an event counter, and a tie-breaking `nodeId`) means any peer can precisely order events identically without a central server.
3. **Painless Serialization:** Mortise encodes these clocks identically to strict ISO lexicographic patterns (e.g. `2026-04-08T12:00:00.000Z-0000-node123`). This means that your underlying storage layer—whether it’s IndexedDB, SQLite, or a cloud backend—can trivially sort state transitions organically as strings.

## The Body: WASM Database

Mortise uses a **PGlite** instance running in a dedicated Web Worker thread. This leverages WebAssembly (WASM) to run a lightweight, actual PostgreSQL engine right in the browser. 

By offloading all database initialization, SQL parsing, and data manipulation to a background worker string, the main thread remains entirely unblocked. The application's UI stays responsive down to the frame while relying on robust local-first persistence capabilities.

## Framework-Agnostic Core

Mortise uses a **Framework-Agnostic Core**. The database engine handles SQL parsing and change-notifications natively. React hooks are provided as a lightweight convenience layer, but the engine can be used with any framework (Vue, Svelte, Vanilla) via the `db.subscribe()` API.

## Peer-to-Peer Multi-Tab Synchronization

Mortise embraces true local device simulation by treating individual browser tabs as independent disconnected peers. 

1. **Isolated Storage:** Every tab spins up its own standalone background worker and provisions a uniquely identified IndexedDB partition.
2. **Replication Protocol:** When local SQL mutations occur on one tab, the worker dynamically stamps the payload with the current `HLC` timestamp and broadcasts it across a native `BroadcastChannel`.
3. **CRDT-Ready Ingestion:** Remote tabs ingest the SQL payload, logically advance their own `HLC` clocks, silently execute the query, and instantly trigger their local reactivity hooks to update the UI without ever getting stuck in infinite broadcast loops.
