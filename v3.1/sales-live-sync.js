/* Live persistence for Sales Orders + Calendar. Uses the existing workspace_records and appointments tables. */
(function(){
  'use strict';
  if(location.pathname==='/demo'||location.pathname.indexOf('/demo/')===0)return;
  if(location.pathname!=='/dashboard'&&location.pathname!=='/dashboard/'&&location.pathname!=='/index.html'&&location.pathname!=='/')return;
  var S=window.LESupabase, KEY='loose_ends_sales_crm_v1', workspaceId=null, ready=false, busy=false, queue=Promise.resolve(), idMap={};
  if(!S||!S.auth)return;
  var nativeSet=Storage.prototype.setItem;
  function toast(msg){var e=document.getElementById('toast');if(e){e.textContent=msg;e.className='toast show';setTimeout(function(){e.className='toast';},2400);}}
  function parseMeta(s){try{return JSON.parse(s||'{}')||{};}catch(e){return {loc:s||''};}}
  function localDate(v){if(!v)return '';var d=new Date(v);if(isNaN(d.getTime()))return String(v).slice(0,16);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')+'T'+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');}
  function iso(v){if(!v)return null;var d=new Date(v);return isNaN(d.getTime())?null:d.toISOString();}
  function isUuid(v){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||''));}
  async function getWorkspace(){
    var u=await S.auth.getUser(), user=u&&u.data&&u.data.user;
    if(!user)return null;
    var m=await S.from('workspace_members').select('workspace_id').eq('user_id',user.id).limit(1).maybeSingle();
    if(m.error)throw m.error;
    return m.data&&m.data.workspace_id||null;
  }
  function clearLocal(){if(location.pathname!=='/dashboard'&&location.pathname!=='/dashboard/')return;window.__LE_SALES_SYNCING=true;if(window.LESalesCRM&&window.LESalesCRM.setData)window.LESalesCRM.setData({orders:[],events:[]});else nativeSet.call(localStorage,KEY,JSON.stringify({orders:[],events:[]}));window.__LE_SALES_SYNCING=false;}
  async function hydrate(){
    if(busy)return;busy=true;
    try{
      var w=await getWorkspace();if(!w){ready=false;workspaceId=null;clearLocal();return;}
      if(ready&&workspaceId===w)return;
      workspaceId=w;
      var results=await Promise.all([
        S.from('workspace_records').select('record_key,data').eq('workspace_id',w).eq('record_type','sales_order').order('created_at',{ascending:true}),
        S.from('appointments').select('*').eq('workspace_id',w).order('starts_at',{ascending:true})
      ]);
      if(results[0].error)throw results[0].error;
      if(results[1].error)throw results[1].error;
      var orders=(results[0].data||[]).map(function(r){var d=r.data||{};d.id=String(r.record_key||d.id||'');return d;});
      var events=(results[1].data||[]).map(function(r){
        var meta=parseMeta(r.notes);
        return {id:r.id,title:r.title,type:meta.type||'Appointment',start:localDate(r.starts_at),end:localDate(r.ends_at||r.starts_at),who:meta.who||'',loc:meta.loc||'',source:meta.source||'workspace'};
      });
      ready=true;
      window.__LE_SALES_SYNCING=true;
      if(window.LESalesCRM&&window.LESalesCRM.setData)window.LESalesCRM.setData({orders:orders,events:events});
      else nativeSet.call(localStorage,KEY,JSON.stringify({orders:orders,events:events}));
      window.__LE_SALES_SYNCING=false;
    }catch(e){window.__LE_SALES_SYNCING=false;console.error('Sales/calendar sync load failed',e);toast('Sales & calendar could not load: '+(e.message||'connection error'));}
    finally{busy=false;}
  }
  async function sync(data){
    if(!ready||!workspaceId||!data||!Array.isArray(data.orders)||!Array.isArray(data.events))return;
    var w=workspaceId;
    var oldOrders=await S.from('workspace_records').select('record_key').eq('workspace_id',w).eq('record_type','sales_order');
    if(oldOrders.error)throw oldOrders.error;
    var rows=data.orders.map(function(o){return {workspace_id:w,record_type:'sales_order',record_key:String(o.id),data:o,updated_at:new Date().toISOString()};});
    if(rows.length){var up=await S.from('workspace_records').upsert(rows,{onConflict:'workspace_id,record_type,record_key'});if(up.error)throw up.error;}
    var keys=rows.map(function(r){return r.record_key;});
    for(var i=0;i<(oldOrders.data||[]).length;i++){var key=String(oldOrders.data[i].record_key);if(keys.indexOf(key)<0){var del=await S.from('workspace_records').delete().eq('workspace_id',w).eq('record_type','sales_order').eq('record_key',key);if(del.error)throw del.error;}}
    var remote=await S.from('appointments').select('id,notes').eq('workspace_id',w);
    if(remote.error)throw remote.error;
    var remoteById={};(remote.data||[]).forEach(function(r){remoteById[r.id]=r;});
    var currentIds=[];
    for(var j=0;j<data.events.length;j++){
      var e=data.events[j], id=String(e.id||'');
      if(!isUuid(id)&&idMap[id]){id=idMap[id];e.id=id;}
      var starts=iso(e.start);if(!starts)continue;
      var ends=iso(e.end)||starts;
      var notes=JSON.stringify({source:'sales_crm',type:e.type||'Appointment',who:e.who||'',loc:e.loc||''});
      if(isUuid(id)&&remoteById[id]){
        currentIds.push(id);
        var meta=parseMeta(remoteById[id].notes);
        if(meta.source==='sales_crm'){
          var upd=await S.from('appointments').update({title:String(e.title||'Appointment'),starts_at:starts,ends_at:ends,notes:notes,updated_at:new Date().toISOString()}).eq('id',id).eq('workspace_id',w);
          if(upd.error)throw upd.error;
        }
      }else{
        var ins=await S.from('appointments').insert({workspace_id:w,title:String(e.title||'Appointment'),starts_at:starts,ends_at:ends,status:'scheduled',notes:notes}).select('id').single();
        if(ins.error)throw ins.error;
        idMap[String(e.id)]=ins.data.id;e.id=ins.data.id;e.source='sales_crm';currentIds.push(ins.data.id);remoteById[ins.data.id]={id:ins.data.id,notes:notes};
      }
    }
    for(var k=0;k<(remote.data||[]).length;k++){
      var rr=remote.data[k], rm=parseMeta(rr.notes);
      if(rm.source==='sales_crm'&&currentIds.indexOf(rr.id)<0){
        var rmv=await S.from('appointments').delete().eq('id',rr.id).eq('workspace_id',w);
        if(rmv.error)throw rmv.error;
      }
    }
    if(data.events.some(function(e){return isUuid(e.id)&&!((remote.data||[]).some(function(r){return r.id===e.id;}));})){
      window.__LE_SALES_SYNCING=true;nativeSet.call(localStorage,KEY,JSON.stringify(data));window.__LE_SALES_SYNCING=false;
    }
  }
  Storage.prototype.setItem=function(k,v){
    nativeSet.call(this,k,v);
    if(this!==localStorage||k!==KEY||window.__LE_SALES_SYNCING||!ready)return;
    var data;try{data=JSON.parse(v);}catch(e){return;}
    queue=queue.then(function(){return sync(data);}).catch(function(e){console.error('Sales/calendar save failed',e);toast('Save failed: '+(e.message||'please retry'));});
  };
  S.auth.onAuthStateChange(function(event){if(event==='SIGNED_IN'||event==='INITIAL_SESSION'||event==='TOKEN_REFRESHED')setTimeout(hydrate,0);if(event==='SIGNED_OUT'){ready=false;workspaceId=null;idMap={};clearLocal();}});
  hydrate();
})();
