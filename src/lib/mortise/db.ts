import DatabaseWorker from './worker?worker';

// Start the Web Worker
const worker = new DatabaseWorker();

// Keep track of pending queries to resolve their promises
const pendingQueries = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();
let queryIdCounter = 0;

// Simple EventEmitter logic for table changes
export type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

export function subscribe(sql: string, listener: Listener) {
  const tableMatch = sql.match(/FROM\s+([a-zA-Z0-9_]+)/i);
  const table = tableMatch ? tableMatch[1] : null;
  
  if (!table) return () => {};

  if (!listeners.has(table)) {
    listeners.set(table, new Set());
  }
  listeners.get(table)!.add(listener);

  return () => {
    const tableListeners = listeners.get(table);
    if (tableListeners) {
      tableListeners.delete(listener);
    }
  };
}

// ─── Sync Status Listener ───────────────────────────────────────────
// Listeners that want to receive SYNC_STATUS payloads from the worker.

export interface SyncLogEntry {
  nodeId: string;
  table: string;
  hlc: string;
  operation: string;
  receivedAt: number;
  resolution: 'applied' | 'rejected';
}

export interface SyncStatus {
  nodeId: string;
  currentHlc: string;
  recentSyncEvents: SyncLogEntry[];
}

type SyncStatusListener = (status: SyncStatus) => void;
const syncStatusListeners = new Set<SyncStatusListener>();

export function onSyncStatus(listener: SyncStatusListener): () => void {
  syncStatusListeners.add(listener);
  return () => { syncStatusListeners.delete(listener); };
}

/**
 * Requests the current sync status from the worker.
 * Results are delivered asynchronously via `onSyncStatus` listeners.
 */
export function requestSyncStatus(): void {
  worker.postMessage({ type: 'GET_SYNC_STATUS' });
}

// Listen for messages from the Web Worker
worker.onmessage = (event: MessageEvent) => {
  const { type, table, id, results, error, payload } = event.data;
  
  // Deliver sync status to subscribers
  if (type === 'SYNC_STATUS' && payload) {
    syncStatusListeners.forEach(fn => fn(payload as SyncStatus));
    return;
  }

  if (type === 'LOCAL_TAB_CHANGED' || type === 'REMOTE_TAB_CHANGED') {
    if (type === 'LOCAL_TAB_CHANGED') {
      // Logic specific to a local update could go here
    } else {
      // Logic specific to a remote update could go here
    }

    const tableListeners = listeners.get(table);
    if (tableListeners) {
      tableListeners.forEach(fn => fn());
    }
    return;
  }

  // A stale write was rejected by the LWW guard — notify listeners so the
  // dashboard can surface the conflict resolution without triggering a re-query.
  if (type === 'CONFLICT_RESOLVED') {
    const tableListeners = listeners.get(table);
    if (tableListeners) {
      tableListeners.forEach(fn => fn());
    }
    return;
  }

  const pending = pendingQueries.get(id);
  if (pending) {
    if (error) {
      pending.reject(error);
    } else {
      pending.resolve(results);
    }
    pendingQueries.delete(id);
  }
};

/**
 * Executes raw SQL by passing it to the PGlite Web Worker.
 * 
 * This "bridge" allows the UI to interact with the database without
 * blocking the main thread, keeping the application fast and responsive.
 * 
 * @param sql The raw SQL query to execute
 * @param params Optional parameters for the SQL query
 * @returns A promise that resolves with the query results
 */
export function query(sql: string, params?: any[]): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = queryIdCounter++;
    pendingQueries.set(id, { resolve, reject });
    
    // Post the query to the worker
    worker.postMessage({ id, sql, params });
  });
}
