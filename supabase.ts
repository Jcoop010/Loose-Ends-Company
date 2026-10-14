import { createClient } from '@supabase/supabase-js'

export const SUPABASE_URL = window.__LOOSE_ENDS_SUPABASE_URL__
export const SUPABASE_PUBLISHABLE_KEY = window.__LOOSE_ENDS_SUPABASE_PUBLISHABLE_KEY__

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
