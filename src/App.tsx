import { useEffect, useState, useCallback } from 'react';
import { query, subscribe, startSync, onHandshake } from './lib/mortise/db';
import { SyncDashboard } from './components/SyncDashboard';

interface TestUser {
  id: string;
  name: string;
}

export function App() {
  const [users, setUsers] = useState<TestUser[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reactivityCount, setReactivityCount] = useState(0);

  // Bootstrap: create table, start sync, and wait for handshake
  useEffect(() => {
    (async () => {
      try {
        // 1. Ensure schema exists
        await query(`
          CREATE TABLE IF NOT EXISTS test_users (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            last_modified_hlc TEXT,
            is_deleted BOOLEAN DEFAULT FALSE
          );
        `);

        // 2. Set up handshake listener
        let handshakeDone = false;
        const unsubHandshake = onHandshake(() => {
          console.log('🤝 UI: Handshake received, ready to display.');
          handshakeDone = true;
        });

        // 3. Trigger sync request in worker
        startSync();

        // 4. Wait for handshake OR 2s timeout (for solitary tabs)
        const startTime = Date.now();
        while (!handshakeDone && Date.now() - startTime < 2000) {
          await new Promise(r => setTimeout(r, 100));
        }
        unsubHandshake();

        // 5. Final query to load initial state
        const res = await query(`SELECT * FROM test_users WHERE is_deleted = false`);
        setUsers(res.rows);
        setReady(true);
      } catch (err: any) {
        setError(err.message ?? String(err));
      }
    })();
  }, []);

  // Subscribe to table changes for reactivity
  useEffect(() => {
    if (!ready) return;
    const unsub = subscribe(`SELECT * FROM test_users WHERE is_deleted = false`, () => {
      setReactivityCount(c => c + 1);
      query(`SELECT * FROM test_users WHERE is_deleted = false`).then(res => setUsers(res.rows));
    });
    return unsub;
  }, [ready]);

  const addUser = useCallback(async () => {
    const names = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Heidi'];
    const name = names[Math.floor(Math.random() * names.length)];
    const id = crypto.randomUUID();
    await query(`INSERT INTO test_users (id, name, last_modified_hlc, is_deleted) VALUES ($1, $2, $3, false)`, [id, name, '__HLC_NOW__']);
  }, []);

  const deleteUser = useCallback(async (id: string) => {
    await query(`UPDATE test_users SET is_deleted = true, last_modified_hlc = $1 WHERE id = $2`, ['__HLC_NOW__', id]);
  }, []);

  const clearUsers = useCallback(async () => {
    const res = await query(`SELECT id FROM test_users WHERE is_deleted = false`);
    const ids = res.rows.map((r: any) => r.id);
    for (const id of ids) {
      await query(`UPDATE test_users SET is_deleted = true, last_modified_hlc = $1 WHERE id = $2`, ['__HLC_NOW__', id]);
    }
  }, []);

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen p-8">
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-6 py-4 max-w-md">
          <h2 className="text-rose-400 font-semibold mb-1">Database Error</h2>
          <pre className="text-rose-300/70 text-xs whitespace-pre-wrap">{error}</pre>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="mb-10">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-100">
          Mortise
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Local-first sync engine &middot; dev playground
        </p>
      </header>

      {/* Controls */}
      <section className="mb-8 flex items-center gap-3">
        <button
          onClick={addUser}
          disabled={!ready}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 px-4 py-2 text-sm font-medium text-white transition-colors duration-150 cursor-pointer disabled:cursor-not-allowed"
        >
          + Add User
        </button>
        <button
          onClick={clearUsers}
          disabled={!ready}
          className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 disabled:opacity-40 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors duration-150 cursor-pointer disabled:cursor-not-allowed"
        >
          Clear All
        </button>
        <span className="ml-auto text-xs text-zinc-600">
          Reactivity fired <span className="text-zinc-400 font-mono">{reactivityCount}</span> times
        </span>
      </section>

      {/* Users Table */}
      <section className="rounded-xl border border-zinc-800 overflow-hidden">
        <div className="px-4 py-3 bg-zinc-900/50 border-b border-zinc-800">
          <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
            test_users
            <span className="ml-2 text-zinc-600 lowercase tracking-normal">
              ({users.length} rows)
            </span>
          </h2>
        </div>

        {!ready ? (
          <div className="px-4 py-8 text-center text-zinc-600 text-sm">
            Initializing database…
          </div>
        ) : users.length === 0 ? (
          <div className="px-4 py-8 text-center text-zinc-600 text-sm">
            No rows yet. Click <span className="text-indigo-400">&quot;+ Add User&quot;</span> to insert a record.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] text-zinc-500 uppercase tracking-wider">
                <th className="px-4 py-2 font-medium">ID</th>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-zinc-900/50 transition-colors">
                  <td className="px-4 py-2 font-mono text-xs text-zinc-500">{u.id.slice(0, 12)}…</td>
                  <td className="px-4 py-2 text-zinc-200">{u.name}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => deleteUser(u.id)}
                      className="text-[10px] text-zinc-500 hover:text-rose-400 transition-colors font-medium border border-zinc-700 hover:border-rose-400/30 px-2 py-0.5 rounded uppercase tracking-tighter"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Sync Dashboard */}
      <SyncDashboard />
    </div>
  );
}
