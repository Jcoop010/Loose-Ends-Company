(function(){
  'use strict';
  const supa=()=>window.LE&&window.LE.supabase;
  const stateKey='loose_ends_v31_state';
  function readState(){try{return JSON.parse(localStorage.getItem(stateKey)||'{}')}catch(e){return {}}}
  async function workspaceId(){
    const s=readState();
    if(s.workspaceId)return s.workspaceId;
    const c=supa(); if(!c)return null;
    const {data:u}=await c.auth.getUser(); if(!u||!u.user)return null;
    const {data:m}=await c.from('workspace_members').select('workspace_id').eq('user_id',u.user.id).limit(1).maybeSingle();
    return m&&m.workspace_id||null;
  }
  async function act(action,item,opts){
    opts=opts||{}; const c=supa(); if(!c||!item)return {ok:false,error:'Live data connection unavailable'};
    const wid=await workspaceId(); if(!wid)return {ok:false,error:'No workspace'};
    const now=new Date().toISOString();
    if(['dismiss','snooze','recover'].includes(action)){
      const patch={updated_at:now};
      if(action==='dismiss')patch.status='dismissed';
      if(action==='recover')patch.status='recovered';
      if(action==='snooze')patch.due_at=opts.due_at||new Date(Date.now()+86400000).toISOString();
      const {error}=await c.from('loose_ends').update(patch).eq('id',item.id).eq('workspace_id',wid);
      if(error)throw error;
    }
    if(action==='follow_up'||action==='task'){
      const title=opts.title||item.recommended_action||'Follow up on revenue opportunity';
      const priorityMap={low:30,medium:50,high:80,critical:100};
      const raw=Number(item.priority); const priority=Number.isFinite(raw)?raw:(priorityMap[String(item.priority||'medium').toLowerCase()]||50);
      const {error}=await c.from('tasks').insert({workspace_id:wid,customer_id:item.customer_id||null,opportunity_id:item.opportunity_id||null,title,status:'open',due_at:opts.due_at||now,priority});
      if(error)throw error;
      const {error:updateError}=await c.from('loose_ends').update({status:'in_progress',updated_at:now}).eq('id',item.id).eq('workspace_id',wid);
      if(updateError)throw updateError;
    }
    if(action==='recovery_attempt'||action==='recover'){
      const amount=Number(opts.amount??item.amount??0);
      const {error}=await c.from('recovery_events').insert({workspace_id:wid,customer_id:item.customer_id||null,opportunity_id:item.opportunity_id||null,amount:amount,source:'loose_end',note:(opts.notes||opts.note||action)+(item.id?' ['+item.id+']':'') ,created_at:now});
      if(error)throw error;
    }
    if(action==='opportunity_update'&&item.opportunity_id){
      const patch=opts.patch||{};
      const {error}=await c.from('opportunities').update(patch).eq('id',item.opportunity_id).eq('workspace_id',wid);
      if(error)throw error;
    }
    window.dispatchEvent(new CustomEvent('le:recovery-action',{detail:{action,item,opts}}));
    window.dispatchEvent(new CustomEvent('le:loose-ends-scanned'));
    return {ok:true};
  }
  window.LERecoveryActions={act,snooze:(i,o)=>act('snooze',i,o),dismiss:(i,o)=>act('dismiss',i,o),followUp:(i,o)=>act('follow_up',i,o),createTask:(i,o)=>act('task',i,o),updateOpportunity:(i,o)=>act('opportunity_update',i,o),recordAttempt:(i,o)=>act('recovery_attempt',i,o),recover:(i,o)=>act('recover',i,o)};
  if(window.LE){const original=window.LE.recover; window.LE.recover=async function(item,opts){try{return await window.LERecoveryActions.recover(item,opts)}catch(e){console.error('[Loose Ends] recovery failed',e);return {ok:false,error:e.message}}}; if(original)window.LE.recover.original=original;}
})();