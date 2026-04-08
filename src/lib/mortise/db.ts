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

// Listen for messages from the Web Worker
worker.onmessage = (event: MessageEvent) => {
  const { type, table, id, results, error } = event.data;
  
  if (type === 'TAB_CHANGED') {
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
