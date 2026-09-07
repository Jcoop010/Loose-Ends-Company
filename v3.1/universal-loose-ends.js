/* Loose Ends V4 — Universal revenue leakage detector. */
(function(){'use strict';
var S=window.LESupabase||null;
var ENGINE={
  rules:[
    {key:'stale-opportunity',source:'opportunity',days:3,reason:'Opportunity has stalled without recent progress.',weight:72},
    {key:'overdue-invoice',source:'invoice',reason:'Invoice is overdue and may require collection action.',weight:92},
    {key:'no-show',source:'appointment',reason:'Appointment was missed and has no recovery action.',weight:88},
    {key:'stale-quote',source:'quote',days:3,reason:'Quote has been sent without a response.',weight:84},
    {key:'open-task',source:'task',days:2,reason:'Revenue-related follow-up is overdue.',weight:68}
  ],
  async scan(workspaceId){
    if(!S||!workspaceId)return {created:0,found:0};
    var now=Date.now(), found=[];
    var [opp,docs,apps,tasks]=await Promise.all([
      S.from('opportunities').select('*').eq('workspace_id',workspaceId),
      S.from('documents').select('*').eq('workspace_id',workspaceId),
      S.from('appointments').select('*').eq('workspace_id',workspaceId),
      S.from('tasks').select('*').eq('workspace_id',workspaceId).eq('status','open')
    ]);
    (opp.data||[]).forEach(function(o){
      var d=Date.parse(o.updated_at||o.created_at||0), days=(now-d)/86400000;
      if(days>=3&&!['recovered','closed','won'].includes(String(o.status||'').toLowerCase()))found.push({workspace_id:workspaceId,customer_id:o.customer_id||null,opportunity_id:o.id,source_entity:'stale-opportunity',source_id:o.id,reason:'Opportunity has stalled without recent progress.',amount:Number(o.amount||0),score:Math.min(100,72+Math.round(days)),priority:Number(o.amount||0)>=5000?'critical':Number(o.amount||0)>=1500?'high':'medium',recommended_action:'Contact customer and move the opportunity forward.',due_at:new Date(now+86400000).toISOString()});
    });
    (docs.data||[]).forEach(function(d){
      var type=String(d.document_type||'').toLowerCase(), status=String(d.status||'').toLowerCase(), due=Date.parse(d.due_at||0);
      if(type==='invoice'&&due&&due<now&&!['paid','void','cancelled'].includes(status))found.push({workspace_id:workspaceId,customer_id:d.customer_id||null,opportunity_id:d.opportunity_id||null,source_entity:'overdue-invoice',source_id:d.id,reason:'Invoice is overdue and may require collection action.',amount:Number(d.total||0),score:94,priority:Number(d.total||0)>=5000?'critical':Number(d.total||0)>=1000?'high':'medium',recommended_action:'Send payment reminder and review collection status.',due_at:new Date().toISOString()});
      if(type==='quote'&&['sent','open','pending'].includes(status)&&d.created_at&&(now-Date.parse(d.created_at))/86400000>=3)found.push({workspace_id:workspaceId,customer_id:d.customer_id||null,opportunity_id:d.opportunity_id||null,source_entity:'stale-quote',source_id:d.id,reason:'Quote has been sent without a response.',amount:Number(d.total||0),score:86,priority:Number(d.total||0)>=1500?'high':'medium',recommended_action:'Follow up on the quote and ask for the next step.',due_at:new Date(now+86400000).toISOString()});
    });
    (apps.data||[]).forEach(function(a){if(String(a.status||'').toLowerCase()==='no_show')found.push({workspace_id:workspaceId,customer_id:a.customer_id||null,opportunity_id:a.opportunity_id||null,source_entity:'no-show',source_id:a.id,reason:'Appointment was missed and has no recovery action.',amount:0,score:90,priority:'high',recommended_action:'Contact the customer and reschedule.',due_at:new Date().toISOString()});});
    (tasks.data||[]).forEach(function(t){if(t.due_at&&Date.parse(t.due_at)<now)found.push({workspace_id:workspaceId,customer_id:t.customer_id||null,opportunity_id:t.opportunity_id||null,source_entity:'overdue-task',source_id:t.id,reason:'Revenue-related follow-up is overdue.',amount:0,score:70,priority:'medium',recommended_action:'Complete or reassign the overdue follow-up.',due_at:t.due_at});});
    if(!found.length)return {created:0,found:0};
    var ids=found.map(function(x){return x.source_id}).filter(Boolean), existing=[];
    if(ids.length){var q=await S.from('loose_ends').select('source_id').eq('workspace_id',workspaceId).in('source_id',ids).eq('status','open');existing=(q.data||[]).map(function(x){return String(x.source_id)});}
    var fresh=found.filter(function(x){return existing.indexOf(String(x.source_id))<0;});
    if(fresh.length)await S.from('loose_ends').insert(fresh);
    return {created:fresh.length,found:found.length};
  }
};
window.LEUniversal=ENGINE;
async function boot(){try{if(!S||!S.auth)return;var u=(await S.auth.getUser()).data.user;if(!u)return;var m=await S.from('workspace_members').select('workspace_id').eq('user_id',u.id).limit(1).maybeSingle();var wid=m.data&&m.data.workspace_id;if(!wid)return;var r=await ENGINE.scan(wid);window.dispatchEvent(new CustomEvent('le:loose-ends-scanned',{detail:r}));}catch(e){console.warn('Universal Loose Ends scan failed',e);}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
