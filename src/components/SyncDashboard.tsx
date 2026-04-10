import { useState } from 'react';
import { useSyncStatus } from '../hooks/useSyncStatus';

function timeAgo(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 1) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

function truncateNodeId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

const OP_COLORS: Record<string, string> = {
  INSERT: 'text-emerald-400',
  UPDATE: 'text-amber-400',
  DELETE: 'text-rose-400',
  UNKNOWN: 'text-zinc-400',
};

const OP_LABELS: Record<string, string> = {
  INSERT: 'INS',
  UPDATE: 'UPD',
  DELETE: 'DEL',
  UNKNOWN: '???',
};

export function SyncDashboard() {
  const status = useSyncStatus();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="fixed bottom-4 right-4 z-50 font-mono text-xs select-none">
      {/* Toggle Button */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -top-2 -left-2 z-10 flex items-center justify-center w-6 h-6 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-zinc-100 hover:border-zinc-500 transition-all duration-200 shadow-lg cursor-pointer"
        title={collapsed ? 'Expand Sync Dashboard' : 'Collapse Sync Dashboard'}
      >
        <span className="text-[10px] leading-none">
          {collapsed ? '▲' : '▼'}
        </span>
      </button>

      {/* Panel */}
      <div
        className={`
          overflow-hidden transition-all duration-300 ease-in-out
          rounded-xl border border-zinc-800 bg-zinc-950/80 backdrop-blur-xl shadow-2xl
          ${collapsed ? 'w-60 max-h-8 opacity-80' : 'w-80 max-h-[500px] opacity-100'}
        `}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/60">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="text-[11px] font-semibold text-zinc-300 tracking-wide uppercase">
            Mortise Sync
          </span>
          <span className="ml-auto text-[10px] text-zinc-600">
            {status ? `node:${truncateNodeId(status.nodeId)}` : '…'}
          </span>
        </div>

        {!collapsed && (
          <div className="divide-y divide-zinc-800/40">
            {/* Node & Clock Section */}
            <div className="px-3 py-2.5 space-y-2">
              <StatusRow
                label="Node ID"
                value={status?.nodeId ?? '—'}
                highlight
              />
              <StatusRow
                label="HLC"
                value={status?.currentHlc ?? '—'}
                mono
              />
            </div>

            {/* Network Activity */}
            <div className="px-3 py-2.5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-semibold text-zinc-500 tracking-widest uppercase">
                  Recent Sync Events
                </span>
                <span className="text-[10px] text-zinc-600">
                  {status?.recentSyncEvents.length ?? 0} / 5
                </span>
              </div>

              {!status || status.recentSyncEvents.length === 0 ? (
                <div className="py-4 text-center text-zinc-600 text-[11px]">
                  <span className="block text-base mb-1">📡</span>
                  No sync events yet.
                  <br />
                  <span className="text-zinc-700">Open another tab to see cross-tab sync.</span>
                </div>
              ) : (
                <ul className="space-y-1">
                  {[...status.recentSyncEvents].reverse().map((entry, i) => (
                    <li
                      key={`${entry.receivedAt}-${i}`}
                      className="flex items-center gap-1.5 py-1 px-1.5 rounded-md bg-zinc-900/50 hover:bg-zinc-800/50 transition-colors duration-150"
                    >
                      <span
                        className={`inline-flex items-center justify-center w-7 text-[9px] font-bold rounded px-1 py-0.5 ${OP_COLORS[entry.operation] ?? OP_COLORS.UNKNOWN} bg-zinc-800`}
                      >
                        {OP_LABELS[entry.operation] ?? OP_LABELS.UNKNOWN}
                      </span>
                      <span className="text-zinc-400 truncate flex-1">
                        <span className="text-zinc-300">{entry.table}</span>
                        {' '}from{' '}
                        <span className="text-indigo-400">{truncateNodeId(entry.nodeId)}</span>
                      </span>
                      {/* LWW Resolution Badge */}
                      {entry.resolution === 'rejected' ? (
                        <span
                          className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded px-1.5 py-0.5 whitespace-nowrap"
                          title={`Ignoring stale update from Node ${entry.nodeId}`}
                        >
                          ✗ Stale
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded px-1.5 py-0.5 whitespace-nowrap">
                          ✓ Applied
                        </span>
                      )}
                      <span className="text-[9px] text-zinc-600 whitespace-nowrap">
                        {timeAgo(entry.receivedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Small Building Blocks ──────────────────────────────────────────

function StatusRow({
  label,
  value,
  highlight,
  mono,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-[10px] text-zinc-500 uppercase tracking-wide shrink-0 pt-px">
        {label}
      </span>
      <span
        className={`text-right break-all leading-snug ${
          highlight
            ? 'text-indigo-400 font-semibold'
            : mono
              ? 'text-emerald-400/80 text-[10px]'
              : 'text-zinc-300'
        }`}
      >
        {value}
      </span>
    </div>
  );
}
