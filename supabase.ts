import { createClient } from '@supabase/supabase-js'

export const SUPABASE_URL = 'https://uehfvpnnoitgybsmdgef.supabase.co'
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_Lxk1H5zRhlKkx8IVHV7Aiw_EXC4BC2g'

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
