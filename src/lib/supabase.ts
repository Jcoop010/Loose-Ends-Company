import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const DEFAULT_SUPABASE_URL = 'https://uehfvpnnoitgybsmdgef.supabase.co'
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_Lxk1H5zRhlKkx8IVHV7Aiw_EXC4BC2g'

const rawEnvUrl = import.meta.env?.VITE_SUPABASE_URL as string | undefined
const rawEnvKey = (import.meta.env?.VITE_SUPABASE_ANON_KEY ??
  import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY) as string | undefined

export const SUPABASE_URL: string = (rawEnvUrl ?? DEFAULT_SUPABASE_URL).trim()
export const SUPABASE_ANON_KEY: string = (rawEnvKey ?? DEFAULT_SUPABASE_ANON_KEY).trim()

export const isSupabaseConfigured: boolean =
  SUPABASE_URL.startsWith('https://') && SUPABASE_ANON_KEY.length > 0

export const supabase: SupabaseClient = createClient(
  isSupabaseConfigured ? SUPABASE_URL : 'https://placeholder.supabase.co',
  isSupabaseConfigured ? SUPABASE_ANON_KEY : 'unconfigured-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
)

export function assertSupabaseConfigured(): void {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured. Provide VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  }
}
