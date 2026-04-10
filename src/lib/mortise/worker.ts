import { PGlite } from '@electric-sql/pglite';
import { HLC } from './hlc';

const instanceId = crypto.randomUUID().slice(0, 8);
const hlc = new HLC(instanceId);

// Initialize a new PGlite instance.
// Using it in-memory for now, can be changed to indexeddb:// later
const db = new PGlite('idb://mortise-' + instanceId);

const channel = new BroadcastChannel('mortise_sync');

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
  const colMatch = sql.match(INSERT_COLS_RE);
  if (!colMatch) return null;
  const cols = colMatch[1].split(',').map(c => c.trim().replace(/["`]/g, ''));
  const idIndex = cols.indexOf('id');
  return idIndex >= 0 ? String(params[idIndex]) : null;
}

/**
 * Converts an INSERT statement into an UPSERT
 * (INSERT … ON CONFLICT (id) DO UPDATE SET …).
 * This makes replication idempotent — retries are harmless.
 */
function toUpsert(sql: string): string {
  if (!/^\s*INSERT\s+INTO/i.test(sql)) return sql;

  const colMatch = sql.match(INSERT_COLS_RE);
  if (!colMatch) return sql;

  const cols = colMatch[1].split(',').map(c => c.trim().replace(/["`]/g, ''));
  const nonPkCols = cols.filter(c => c !== 'id');

  if (nonPkCols.length === 0) return sql;

  const updateSet = nonPkCols.map(c => `${c} = EXCLUDED.${c}`).join(', ');
  return `${sql.trim().replace(/;?\s*$/, '')} ON CONFLICT (id) DO UPDATE SET ${updateSet}`;
}

// ─── BroadcastChannel Listener ──────────────────────────────────────

channel.onmessage = async (event) => {
  if (!event.data) return;
  const { type, sql, params, hlc: remoteHlc, table, nodeId, recordId } =
    event.data;

  if (type === 'REPLICATE_ADAPT' && nodeId !== instanceId) {
    console.log('📡 Mortise: Syncing change from another tab...');

    if (remoteHlc) {
      hlc.receive(remoteHlc);
    }

    // Detect operation type from the replicated SQL
    const opMatch = sql?.match(/^\s*(INSERT|UPDATE|DELETE)/i);
    const operation = opMatch ? opMatch[1].toUpperCase() : 'UNKNOWN';

    // ─── LWW Guard ──────────────────────────────────────────────
    let resolution: 'applied' | 'rejected' = 'applied';

    if (remoteHlc && recordId && table) {
      try {
        const existing = await db.query(
          `SELECT last_modified_hlc FROM ${table} WHERE id = $1`,
          [recordId],
        );

        if (
          existing.rows.length > 0 &&
          (existing.rows[0] as any).last_modified_hlc
        ) {
          const localHlc = (existing.rows[0] as any).last_modified_hlc as string;
          if (HLC.compare(remoteHlc, localHlc) <= 0) {
            // Incoming timestamp is older or equal — reject the stale write
            resolution = 'rejected';
            console.log(
              `⚔️ Mortise LWW: Rejecting stale update from ${nodeId} ` +
                `(incoming: ${remoteHlc.slice(0, 24)} ≤ local: ${localHlc.slice(0, 24)})`,
            );
          }
        }
      } catch (err) {
        // If the guard query fails (e.g. table doesn't have the column yet),
        // allow the write through rather than silently dropping data.
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
};

// ─── Main Thread Message Handler ────────────────────────────────────

self.onmessage = async (event: MessageEvent) => {
  const { id, type, sql, params } = event.data;

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
