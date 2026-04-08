# Mortise

Mortise is a local-first synchronization framework designed to seamlessly sync data between disconnected clients and over the network using robust distributed systems primitives.

## The Heartbeat: Hybrid Logical Clocks

At the core of Mortise's conflict-free sync architecture is the **Hybrid Logical Clock (HLC)**. Because nodes in an eventually-consistent distributed system (like browsers or mobile apps) cannot rely on perfectly synchronized physical hardware clocks, Mortise uses HLCs to gracefully assign globally unique, sortable timestamps to all local data mutations.

### How Mortise Uses HLCs
1. **Preserving True Causality:** Unlike a standard `Date.now()` timestamp, HLCs guarantee event causality. If a local mutation relies on data received from another client, the `receive` action bumps the local logical clock forward. This guarantees the local reaction strictly happens "after" the event that caused it, preserving sequential integrity across the network.
2. **Offline Resilience:** HLCs enable Mortise to track state perfectly during offline gaps. When clients eventually reconnect and exchange data streams, their offline timelines effortlessly zip together. The deterministic structure (incorporating physical time, an event counter, and a tie-breaking `nodeId`) means any peer can precisely order events identically without a central server.
3. **Painless Serialization:** Mortise encodes these clocks identically to strict ISO lexicographic patterns (e.g. `2026-04-08T12:00:00.000Z-0000-node123`). This means that your underlying storage layer—whether it’s IndexedDB, SQLite, or a cloud backend—can trivially sort state transitions organically as strings.
