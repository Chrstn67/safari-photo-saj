// frontend/src/utils/realtime.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export default supabase;

/**
 * Abonnement temps réel à une table Supabase
 * @param {string} table   — nom de la table
 * @param {string} event   — 'INSERT' | 'UPDATE' | 'DELETE' | '*'
 * @param {Function} cb    — callback(payload)
 * @param {Object} filter  — ex: { column: 'category_id', value: 5 }
 * @returns {Function}     — fonction unsubscribe
 */
export function subscribe(table, event, cb, filter = null) {
  let channel = supabase
    .channel(`${table}-${event}-${Math.random()}`)
    .on(
      'postgres_changes',
      {
        event,
        schema: 'public',
        table,
        ...(filter ? { filter: `${filter.column}=eq.${filter.value}` } : {})
      },
      cb
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}
