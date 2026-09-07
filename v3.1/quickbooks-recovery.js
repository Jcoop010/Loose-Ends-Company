/* Loose Ends V4 — QuickBooks Sync Bridge client */
(function(){
  const SUPABASE_URL = window.SUPABASE_URL || 'https://uehfvpnnoitgybsmdgef.supabase.co';
  const FN = SUPABASE_URL + '/functions/v1/quickbooks-sync';
  async function sync(workspaceId){
    if(!workspaceId) throw new Error('Workspace required');
    const client = window.LE && window.LE.supabase;
    if(!client) throw new Error('Supabase client unavailable');
    const {data:{session}} = await client.auth.getSession();
    if(!session?.access_token) throw new Error('Sign in to sync QuickBooks');
    const res = await fetch(FN,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token},body:JSON.stringify({workspace_id:workspaceId})});
    const data = await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error || 'QuickBooks bridge error');
    window.dispatchEvent(new CustomEvent('le:quickbooks-sync',{detail:data}));
    return data;
  }
  window.LEQuickBooks={sync};
})();
