import { useState, useEffect } from 'react';
import { query, subscribe } from '../lib/mortise/db';

export function useQuery<T = any>(sql: string, params: any[] = []) {
  const [state, setState] = useState({ data: null as T[] | null, loading: true, error: null as Error | null });

  useEffect(() => {
    const fetchData = () => {
      setState(s => ({ ...s, loading: true }));
      query(sql, params)
        .then(res => setState({ data: res.rows, loading: false, error: null }))
        .catch(err => setState(s => ({ ...s, loading: false, error: err instanceof Error ? err : new Error(String(err)) })));
    };
    fetchData();
    return subscribe(sql, fetchData);
  }, [sql, JSON.stringify(params)]);

  return state;
}
