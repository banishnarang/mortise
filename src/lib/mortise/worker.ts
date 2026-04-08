import { PGlite } from '@electric-sql/pglite';

// Initialize a new PGlite instance.
// Using it in-memory for now, can be changed to indexeddb:// later
const db = new PGlite();

self.onmessage = async (event: MessageEvent) => {
  const { id, sql, params } = event.data;

  try {
    // Execute the SQL
    const results = await db.query(sql, params);
    
    // Post the results back to the main thread
    self.postMessage({ id, results, error: null });

    // Simple heuristic: if it's an INSERT, UPDATE, or DELETE, notify the main thread
    const tableMatch = sql.match(/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+([a-zA-Z0-9_]+)/i);
    if (tableMatch) {
      self.postMessage({ type: 'TAB_CHANGED', table: tableMatch[1] });
    }
  } catch (error) {
    self.postMessage({ id, results: null, error });
  }
};
