import { useState, useEffect, useRef } from 'react';
import { onSyncStatus, requestSyncStatus, type SyncStatus } from '../lib/mortise/db';

const POLL_INTERVAL_MS = 1000;

/**
 * React hook that polls the Mortise worker for current sync status.
 * Returns the latest SyncStatus (nodeId, currentHlc, recentSyncEvents).
 */
export function useSyncStatus() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Subscribe to status responses from the worker
    const unsubscribe = onSyncStatus((incoming) => {
      setStatus(incoming);
    });

    // Initial request
    requestSyncStatus();

    // Poll on an interval so the HLC stays fresh
    intervalRef.current = setInterval(() => {
      requestSyncStatus();
    }, POLL_INTERVAL_MS);

    return () => {
      unsubscribe();
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return status;
}
