/* Loose Ends live refresh: keep the recovery queue current without page reloads. */
(function(){
  'use strict';
  function boot(){
    var S=window.LESupabase, live=window.LELive;
    if(!S || !live || !live.loadLive || !S.auth) return;
    S.auth.getUser().then(function(r){
      var u=r.data&&r.data.user;
      if(!u) return;
      S.from('workspace_members').select('workspace_id').eq('user_id',u.id).limit(1).maybeSingle().then(function(m){
        var wid=m.data&&m.data.workspace_id;
        if(!wid) return;
        var timer=null;
        var channel=S.channel('loose-ends-live-'+wid)
          .on('postgres_changes',{event:'*',schema:'public',table:'opportunities',filter:'workspace_id=eq.'+wid},function(){
            clearTimeout(timer); timer=setTimeout(function(){ live.loadLive(); },500);
          })
          .on('postgres_changes',{event:'*',schema:'public',table:'recovery_events',filter:'workspace_id=eq.'+wid},function(){
            clearTimeout(timer); timer=setTimeout(function(){ live.loadLive(); },500);
          })
          .subscribe();
        window.__LELiveRealtimeChannel=channel;
      });
    });
  }
  setTimeout(boot,1200);
})();
