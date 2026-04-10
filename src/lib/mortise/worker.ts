import { PGlite } from '@electric-sql/pglite';
import { HLC } from './hlc';

const instanceId = crypto.randomUUID().slice(0, 8);
const hlc = new HLC(instanceId);

// Initialize a new PGlite instance.
// Using it in-memory for now, can be changed to indexeddb:// later
const db = new PGlite('idb://mortise-' + instanceId);

const channel = new BroadcastChannel('mortise_sync');

let syncReady = false;
const pendingSyncMessages: any[] = [];

// ─── Sync Status Tracking ───────────────────────────────────────────
// Keep a rolling log of the last 5 REPLICATE_ADAPT events received
// from other tabs so we can surface them in a debug dashboard.

interface SyncLogEntry {
  nodeId: string;
  table: string;
  hlc: string;
  operation: string;
  receivedAt: number;
  resolution: 'applied' | 'rejected';
}

const MAX_SYNC_LOG = 5;
const syncLog: SyncLogEntry[] = [];

function pushSyncLog(entry: SyncLogEntry) {
  syncLog.push(entry);
  if (syncLog.length > MAX_SYNC_LOG) {
    syncLog.shift();
  }
}

// ─── SQL Helpers ────────────────────────────────────────────────────
// Robust regexes that handle optional quoting (double-quotes, backticks).

const TABLE_RE =
  /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+["`]?([a-zA-Z0-9_]+)["`]?/i;

const INSERT_COLS_RE =
  /INSERT\s+INTO\s+["`]?[a-zA-Z0-9_]+["`]?\s*\(([^)]+)\)/i;

/**
 * Extracts the primary-key value from an INSERT statement by locating the
 * `id` column in the column list and returning the matching parameter.
 */
function extractRecordId(sql: string, params?: any[]): string | null {
  if (!params?.length) return null;

  // Case 1: INSERT INTO ... (id, ...) VALUES ($1, ...)
  const colMatch = sql.match(INSERT_COLS_RE);
  if (colMatch) {
    const cols = colMatch[1].split(',').map(c => c.trim().replace(/["`]/g, ''));
    const idIndex = cols.indexOf('id');
    return idIndex >= 0 ? String(params[idIndex]) : null;
  }

  // Case 2: UPDATE table SET ... WHERE id = $x
  // This matches both single row updates and where clauses with $ placeholders
  const updateMatch = sql.match(/UPDATE\s+["`]?[a-zA-Z0-9_]+["`]?\s+SET.*?WHERE\s+id\s*=\s*\$(\d+)/i);
  if (updateMatch) {
    const paramIndex = parseInt(updateMatch[1], 10) - 1;
    return paramIndex >= 0 && paramIndex < params.length ? String(params[paramIndex]) : null;
  }

  return null;
}

/**
 * Converts an INSERT statement into an UPSERT
 * (INSERT … ON CONFLICT (id) DO UPDATE SET …).
 * This makes replication idempotent — retries are harmless.
 */
function toUpsert(sql: string): string {
  if (!/^\s*INSERT\s+INTO/i.test(sql)) return sql;

  const tableMatch = sql.match(/INSERT\s+INTO\s+["`]?([a-zA-Z0-9_]+)["`]?/i);
  if (!tableMatch) return sql;
  const table = tableMatch[1];

  const colMatch = sql.match(INSERT_COLS_RE);
  if (!colMatch) return sql;

  const cols = colMatch[1].split(',').map(c => c.trim().replace(/["`]/g, ''));
  const nonPkCols = cols.filter(c => c !== 'id');

  if (nonPkCols.length === 0) return sql;

  const updateSet = nonPkCols.map(c => `${c} = EXCLUDED.${c}`).join(', ');
  
  // Enforce LWW: Only update if the incoming HLC is strictly newer than the local one.
  return `${sql.trim().replace(/;?\s*$/, '')} ON CONFLICT (id) DO UPDATE SET ${updateSet} WHERE EXCLUDED.last_modified_hlc > ${table}.last_modified_hlc`;
}

// ─── BroadcastChannel Listener ──────────────────────────────────────

async function handleSyncMessage(data: any) {
  if (!data) return;
  const { type, sql, params, hlc: remoteHlc, table, nodeId, recordId, data: bulkData, targetNodeId, senderNodeId } =
    data;

  if (type === 'SYNC_REQUEST' && nodeId !== instanceId) {
    console.log(`🤝 Mortise: Received sync request from ${nodeId}`);
    try {
      const results = await db.query('SELECT * FROM test_users');
      channel.postMessage({
        type: 'SYNC_RESPONSE',
        data: results.rows,
        hlc: hlc.now(),
        targetNodeId: nodeId,
        senderNodeId: instanceId,
      });
    } catch (err) {
      console.error('Failed to handle SYNC_REQUEST:', err);
    }
    return;
  }

  if (type === 'SYNC_RESPONSE' && targetNodeId === instanceId) {
    console.log(`🤝 Mortise: Received state handshake from ${senderNodeId}`);
    
    if (remoteHlc) {
      hlc.receive(remoteHlc);
    }

    if (Array.isArray(bulkData)) {
      for (const row of bulkData) {
        // Construct an UPSERT for each row
        const cols = Object.keys(row);
        const vals = Object.values(row);
        const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
        const insertSql = `INSERT INTO test_users (${cols.join(', ')}) VALUES (${placeholders})`;
        
        try {
          await db.query(toUpsert(insertSql), vals);
        } catch (err) {
          console.error('Failed to upsert row during handshake:', err);
        }
      }
      
      pushSyncLog({
        nodeId: senderNodeId,
        table: 'test_users',
        hlc: remoteHlc || '',
        operation: 'HANDSHAKE',
        receivedAt: Date.now(),
        resolution: 'applied',
      });

      // Notify main thread handshake is fully applied
      self.postMessage({ type: 'HANDSHAKE_COMPLETED', table: 'test_users' });
      self.postMessage({ type: 'REMOTE_TAB_CHANGED', table: 'test_users' });
    }
    return;
  }

  if (type === 'REPLICATE_ADAPT' && nodeId !== instanceId) {
    console.log('📡 Mortise: Syncing change from another tab...');

    if (remoteHlc) {
      hlc.receive(remoteHlc);
    }

    // Detect operation type from the replicated SQL
    const opMatch = sql?.match(/^\s*(INSERT|UPDATE|DELETE)/i);
    let operation = opMatch ? opMatch[1].toUpperCase() : 'UNKNOWN';

    // If it's an UPDATE setting is_deleted=true, it's a SOFT_DELETE
    if (operation === 'UPDATE' && /is_deleted\s*=\s*true/i.test(sql || '')) {
      operation = 'SOFT_DELETE';
    }

    // ─── LWW Guard (Operation Zombie Hunter) ───────────────────────
    let resolution: 'applied' | 'rejected' = 'applied';

    if (remoteHlc && recordId && table) {
      try {
        const existing = await db.query(
          `SELECT last_modified_hlc, is_deleted FROM ${table} WHERE id = $1`,
          [recordId],
        );

        if (
          existing.rows.length > 0 &&
          (existing.rows[0] as any).last_modified_hlc
        ) {
          const row = existing.rows[0] as any;
          const localHlc = row.last_modified_hlc as string;
          const localIsDeleted = !!row.is_deleted;

          if (HLC.compare(remoteHlc, localHlc) <= 0) {
            // Incoming timestamp is older or equal — reject the stale write
            resolution = 'rejected';
            const reason = localIsDeleted ? 'Zombie Guard' : 'LWW Stale';
            console.log(
              `⚔️ Mortise ${reason}: Rejecting stale update from ${nodeId} ` +
                `(incoming: ${remoteHlc.slice(0, 24)} ≤ local: ${localHlc.slice(0, 24)})`,
            );
          } else if (localIsDeleted) {
            console.log(`🧟 Mortise: Resurrecting ${recordId} via newer remote write`);
          }
        }
      } catch (err) {
        console.warn('Mortise LWW check failed, allowing write:', err);
      }
    }

    pushSyncLog({
      nodeId,
      table: table || 'unknown',
      hlc: remoteHlc || '',
      operation,
      receivedAt: Date.now(),
      resolution,
    });

    if (resolution === 'applied') {
      try {
        if (sql) {
          await db.query(sql, params);
        }
        self.postMessage({ type: 'REMOTE_TAB_CHANGED', table });
      } catch (err) {
        console.error('Mortise sync error:', err);
      }
    } else {
      // Notify the main thread so the dashboard can surface the conflict
      self.postMessage({
        type: 'CONFLICT_RESOLVED',
        table,
        payload: {
          nodeId,
          table,
          hlc: remoteHlc,
          resolution: 'rejected',
        },
      });
    }
  }
}

channel.onmessage = async (event) => {
  if (!syncReady) {
    console.log('📥 Mortise: Queuing sync message until bootstrap complete');
    pendingSyncMessages.push(event.data);
    return;
  }
  await handleSyncMessage(event.data);
};

// ─── Main Thread Message Handler ────────────────────────────────────

self.onmessage = async (event: MessageEvent) => {
  const { id, type, sql, params } = event.data;

  // Handle synchronization trigger from main thread
  if (type === 'START_SYNC') {
    console.log('🏁 Mortise: Bootstrap complete. Starting synchronization...');
    syncReady = true;
    
    // Process any messages that arrived during bootstrap
    while (pendingSyncMessages.length > 0) {
      const msg = pendingSyncMessages.shift();
      await handleSyncMessage(msg);
    }
    
    // Broadcast initial sync request
    channel.postMessage({ type: 'SYNC_REQUEST', nodeId: instanceId });
    return;
  }

  // Handle sync status requests from the main thread
  if (type === 'GET_SYNC_STATUS') {
    self.postMessage({
      type: 'SYNC_STATUS',
      payload: {
        nodeId: instanceId,
        currentHlc: hlc.now(),
        recentSyncEvents: [...syncLog],
      },
    });
    return;
  }

  try {
    // ─── HLC Stamping ─────────────────────────────────────────
    // Replace __HLC_NOW__ sentinel values in params with a fresh
    // HLC timestamp.  This keeps the main thread unaware of clock
    // internals — it just passes the placeholder.
    let resolvedParams = params;
    let stampedHlc: string | null = null;

    if (params?.length) {
      resolvedParams = params.map((p: any) => {
        if (p === '__HLC_NOW__') {
          stampedHlc = hlc.now();
          return stampedHlc;
        }
        return p;
      });
    }

    // Execute the SQL
    const results = await db.query(sql, resolvedParams);

    // Post the results back to the main thread
    self.postMessage({ id, results, error: null });

    // ─── Broadcast Mutations ──────────────────────────────────
    // If this was a mutating statement, notify the local UI and
    // broadcast an UPSERT to other tabs via BroadcastChannel.
    const tableMatch = sql.match(TABLE_RE);
    if (tableMatch) {
      const table = tableMatch[1];
      const recordId = extractRecordId(sql, resolvedParams);
      const broadcastHlc = stampedHlc || hlc.now();

      self.postMessage({ type: 'LOCAL_TAB_CHANGED', table });

      channel.postMessage({
        type: 'REPLICATE_ADAPT',
        sql: toUpsert(sql),
        params: resolvedParams,
        hlc: broadcastHlc,
        table,
        nodeId: instanceId,
        recordId,
      });
    }
  } catch (error) {
    self.postMessage({ id, results: null, error });
  }
};

// ─── Initial Handshake ──────────────────────────────────────────────
// REMOVED: Auto-fire SYNC_REQUEST. Now triggered by START_SYNC from main thread.
