/* Loose Ends Supabase bridge. Safe browser configuration only: publishable key + RLS. */
(function(){
  'use strict';
  var url=window.__LOOSE_ENDS_SUPABASE_URL__ || '';
  var key=window.__LOOSE_ENDS_SUPABASE_PUBLISHABLE_KEY__ || '';
  if(!url || !key || !window.supabase) return;
  try{
    window.LESupabase=window.supabase.createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    window.LESupabaseReady=true;
  }catch(e){ console.warn('Loose Ends Supabase initialization failed',e); }
})();
