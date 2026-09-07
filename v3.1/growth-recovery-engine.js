/* Loose Ends V4 — customer reactivation + expanded revenue leakage rules. */
(function(){'use strict';
var S=window.LESupabase||null;
var ENGINE={
  rules:['inactive-customer','declined-work','cancelled-no-rebook','awaiting-approval','unfulfilled-order','failed-payment'],
  async scan(workspaceId){
    if(!S||!workspaceId)return {created:0,found:0};
    var now=Date.now(), found=[];
    var [customers,opps,docs,apps,recovery]=await Promise.all([
      S.from('customers').select('*').eq('workspace_id',workspaceId),
      S.from('opportunities').select('*').eq('workspace_id',workspaceId),
      S.from('documents').select('*').eq('workspace_id',workspaceId),
      S.from('appointments').select('*').eq('workspace_id',workspaceId),
      S.from('recovery_events').select('*').eq('workspace_id',workspaceId).order('created_at',{ascending:false}).limit(500)
    ]);
    var customerById={};(customers.data||[]).forEach(function(c){customerById[c.id]=c});
    var lastByCustomer={};
    (opps.data||[]).forEach(function(o){if(o.customer_id){var t=Date.parse(o.updated_at||o.created_at||0);lastByCustomer[o.customer_id]=Math.max(lastByCustomer[o.customer_id]||0,t)}});
    (apps.data||[]).forEach(function(a){if(a.customer_id){var t=Date.parse(a.ends_at||a.starts_at||a.created_at||0);lastByCustomer[a.customer_id]=Math.max(lastByCustomer[a.customer_id]||0,t)}});
    (recovery.data||[]).forEach(function(r){if(r.customer_id){var t=Date.parse(r.created_at||0);lastByCustomer[r.customer_id]=Math.max(lastByCustomer[r.customer_id]||0,t)}});
    (customers.data||[]).forEach(function(c){var last=lastByCustomer[c.id]||Date.parse(c.updated_at||c.created_at||0);var days=(now-last)/86400000;var value=(opps.data||[]).filter(function(o){return o.customer_id===c.id}).reduce(function(s,o){return s+Number(o.amount||0)},0);if(days>=90&&value>0)found.push({workspace_id:workspaceId,customer_id:c.id,source_entity:'inactive-customer',source_id:c.id,reason:'High-value customer has been inactive for 90+ days.',amount:value,score:Math.min(100,72+Math.round(days/10)),priority:value>=5000?'critical':value>=1500?'high':'medium',recommended_action:'Reactivate the customer with a personalized service reminder or offer.',due_at:new Date(now+86400000).toISOString()})});
    (opps.data||[]).forEach(function(o){var txt=String(o.reason||o.source||o.title||'').toLowerCase();if(/declin|unsold|not approved|recommend/.test(txt))found.push({workspace_id:workspaceId,customer_id:o.customer_id||null,opportunity_id:o.id,source_entity:'declined-work',source_id:o.id,reason:'Previously recommended work was declined or left unsold.',amount:Number(o.amount||0),score:91,priority:Number(o.amount||0)>=5000?'critical':Number(o.amount||0)>=1500?'high':'medium',recommended_action:'Follow up with the customer and offer the clearest next step.',due_at:new Date(now+86400000).toISOString()});if(/cancel/.test(txt)&&!['recovered','closed','won'].includes(String(o.status||'').toLowerCase()))found.push({workspace_id:workspaceId,customer_id:o.customer_id||null,opportunity_id:o.id,source_entity:'cancelled-no-rebook',source_id:o.id,reason:'Cancelled opportunity has not been rebooked.',amount:Number(o.amount||0),score:87,priority:Number(o.amount||0)>=1500?'high':'medium',recommended_action:'Contact the customer and rebook the opportunity.',due_at:new Date(now+86400000).toISOString()})});
    (docs.data||[]).forEach(function(d){var type=String(d.document_type||'').toLowerCase(),status=String(d.status||'').toLowerCase(),amount=Number(d.total||0);if(type==='purchase_order'&&['pending','awaiting_approval','open'].includes(status))found.push({workspace_id:workspaceId,customer_id:d.customer_id||null,opportunity_id:d.opportunity_id||null,source_entity:'awaiting-approval',source_id:d.id,reason:'Purchase order is awaiting approval.',amount:amount,score:79,priority:amount>=5000?'critical':amount>=1500?'high':'medium',recommended_action:'Check approval status and remove the blocker.',due_at:new Date(now+86400000).toISOString()});if(type==='order'&&['open','pending','unfulfilled'].includes(status))found.push({workspace_id:workspaceId,customer_id:d.customer_id||null,opportunity_id:d.opportunity_id||null,source_entity:'unfulfilled-order',source_id:d.id,reason:'Order is open but not fulfilled.',amount:amount,score:83,priority:amount>=5000?'critical':amount>=1500?'high':'medium',recommended_action:'Resolve fulfillment and confirm delivery with the customer.',due_at:new Date(now+86400000).toISOString()});if(type==='payment'&&['failed','declined','past_due'].includes(status))found.push({workspace_id:workspaceId,customer_id:d.customer_id||null,opportunity_id:d.opportunity_id||null,source_entity:'failed-payment',source_id:d.id,reason:'Payment failed or remains past due.',amount:amount,score:95,priority:amount>=5000?'critical':amount>=1000?'high':'medium',recommended_action:'Resolve the payment issue and recover the outstanding amount.',due_at:new Date().toISOString()})});
    if(!found.length)return {created:0,found:0};
    var ids=found.map(function(x){return x.source_id}).filter(Boolean),existing=[];if(ids.length){var q=await S.from('loose_ends').select('source_id,source_entity').eq('workspace_id',workspaceId).in('source_id',ids).eq('status','open');existing=(q.data||[]).map(function(x){return String(x.source_entity)+'::'+String(x.source_id)})}
    var fresh=found.filter(function(x){return existing.indexOf(String(x.source_entity)+'::'+String(x.source_id))<0});if(fresh.length)await S.from('loose_ends').insert(fresh);return {created:fresh.length,found:found.length};
  }
};
window.LEGrowthRecovery=ENGINE;
async function boot(){try{if(!S||!S.auth)return;var u=(await S.auth.getUser()).data.user;if(!u)return;var m=await S.from('workspace_members').select('workspace_id').eq('user_id',u.id).limit(1).maybeSingle();var wid=m.data&&m.data.workspace_id;if(!wid)return;var r=await ENGINE.scan(wid);window.dispatchEvent(new CustomEvent('le:growth-scan',{detail:r}))}catch(e){console.warn('Growth recovery scan failed',e)}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
