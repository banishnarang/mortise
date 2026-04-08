import { PGlite } from '@electric-sql/pglite';
import { HLC } from './hlc';

const instanceId = crypto.randomUUID().slice(0, 8);
const hlc = new HLC(instanceId);

// Initialize a new PGlite instance.
// Using it in-memory for now, can be changed to indexeddb:// later
const db = new PGlite('idb://mortise-' + instanceId);

const channel = new BroadcastChannel('mortise_sync');

channel.onmessage = async (event) => {
  if (!event.data) return;
  const { type, sql, params, hlc: remoteHlc, table, nodeId } = event.data;

  if (type === 'REPLICATE_ADAPT' && nodeId !== instanceId) {
    console.log("📡 Mortise: Syncing change from another tab...");
    
    if (remoteHlc) {
      hlc.receive(remoteHlc);
    }

    try {
      if (sql) {
        await db.query(sql, params);
      }
      self.postMessage({ type: 'REMOTE_TAB_CHANGED', table });
    } catch (err) {
      console.error("Mortise sync error:", err);
    }
  }
};

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
      const table = tableMatch[1];
      self.postMessage({ type: 'LOCAL_TAB_CHANGED', table });
      
      channel.postMessage({
        type: 'REPLICATE_ADAPT',
        sql,
        params,
        hlc: hlc.now(),
        table,
        nodeId: instanceId
      });
    }
  } catch (error) {
    self.postMessage({ id, results: null, error });
  }
};
