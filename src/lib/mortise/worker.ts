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
  } catch (error) {
    self.postMessage({ id, results: null, error });
  }
};
