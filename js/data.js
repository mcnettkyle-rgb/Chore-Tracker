// Picks the adapter and hands the app a single data object.
//
// The rest of the app never knows whether it's talking to localStorage or to
// Postgres — both adapters expose the same methods.

import { LocalAdapter } from './local-adapter.js';
import { SupabaseAdapter } from './supabase-adapter.js';
import { CONFIG } from '../config.js';

export { CONFIG };

function chooseAdapter() {
  if (CONFIG.mode === 'supabase') {
    if (!CONFIG.supabaseUrl || !CONFIG.supabaseAnonKey) {
      console.warn('[chore-tracker] mode is "supabase" but the URL/key are blank — falling back to demo mode.');
      return new LocalAdapter();
    }
    return new SupabaseAdapter(CONFIG);
  }
  return new LocalAdapter();
}

export const db = chooseAdapter();
export const isDemo = db.mode === 'local';
