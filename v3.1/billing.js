/* Stripe billing controls for the existing Loose Ends workspace. Payment state comes from Supabase webhook sync. */
(function(){
  'use strict';
  var S=window.LESupabase;
  if(!S)return;
  var busy=false;
  function toast(msg){var e=document.getElementById('toast');if(e){e.textContent=msg;e.className='toast show';setTimeout(function(){e.className='toast';},3200);}}
  function setText(id,value){var el=document.getElementById(id);if(el)el.textContent=value;}
  async function getContext(){
    var u=await S.auth.getUser();
    if(u.error||!u.data||!u.data.user)throw new Error('Sign in to manage billing.');
    var m=await S.from('workspace_members').select('workspace_id,role,workspaces(name)').eq('user_id',u.data.user.id).limit(1).maybeSingle();
    if(m.error)throw m.error;
    if(!m.data)throw new Error('Your business workspace is not ready yet. Refresh and try again.');
    var s=await S.from('workspace_subscriptions').select('provider_customer_id,provider_subscription_id,plan_key,status,current_period_end,cancel_at_period_end').eq('workspace_id',m.data.workspace_id).maybeSingle();
    if(s.error)throw s.error;
    return {user:u.data.user,member:m.data,subscription:s.data||null};
  }
  function statusLabel(s){
    if(!s)return 'Not configured';
    var status=String(s.status||'unknown').toLowerCase();
    return ({active:'Active',trialing:'Trial',past_due:'Payment needs attention',unpaid:'Payment overdue',canceled:'Canceled',incomplete:'Checkout incomplete',incomplete_expired:'Checkout expired',paused:'Paused'}[status]||status);
  }
  async function initCard(){
    var card=document.getElementById('le-billing-card');
    if(!card||card.dataset.initialized==='1')return;
    card.dataset.initialized='1';
    var btn=document.getElementById('le-billing-action');
    if(!btn)return;
    try{
      var ctx=await getContext(),s=ctx.subscription,role=ctx.member.role;
      var canManage=role==='owner'||role==='admin';
      setText('le-billing-status',statusLabel(s));
      setText('le-billing-plan',s&&s.provider_subscription_id?'Revenue Recovery OS subscription':'Revenue Recovery OS');
      setText('le-billing-detail',s&&s.current_period_end?'$499/month · Current period ends '+new Date(s.current_period_end).toLocaleDateString()+' · Securely processed by Stripe.':'$499/month · Secure payment handled by Stripe.');
      var note=document.getElementById('le-billing-note');
      if(location.search.indexOf('billing=success')>=0&&note)note.textContent='Checkout returned successfully. Stripe is confirming the payment; this status changes only after a verified webhook arrives. Refresh in a moment if needed.';
      else if(location.search.indexOf('billing=cancelled')>=0&&note)note.textContent='Checkout was canceled. No subscription was activated by this page.';
      if(!canManage){
        btn.textContent='Owner/admin only';btn.disabled=true;
        setText('le-billing-note','Only a workspace owner or admin can change the subscription. Payment status is read from Stripe-confirmed records.');
        return;
      }
      var hasCustomer=Boolean(s&&s.provider_customer_id);
      var active=Boolean(s&&['active','trialing','past_due','unpaid'].includes(String(s.status||'').toLowerCase())&&hasCustomer);
      btn.textContent=active?'Manage billing':'Subscribe · $499/mo';
      btn.disabled=false;
      btn.onclick=async function(){
        if(busy)return;busy=true;btn.disabled=true;btn.textContent=active?'Opening Stripe…':'Opening checkout…';
        try{
          var result=await S.functions.invoke(active?'create-billing-portal':'create-subscription-checkout',{body:{workspace_id:ctx.member.workspace_id}});
          if(result.error){
            var msg=result.error.message||'Could not open secure billing.';
            try{if(result.error.context&&typeof result.error.context.json==='function'){var body=await result.error.context.json();if(body&&body.error)msg=body.error;}}catch(_){}
            throw new Error(msg);
          }
          if(!result.data||!result.data.url)throw new Error(result.data&&result.data.error||'Stripe did not return a secure checkout link.');
          window.location.assign(result.data.url);
        }catch(e){toast(e.message||'Could not open billing.');btn.disabled=false;btn.textContent=active?'Manage billing':'Subscribe · $499/mo';}
        finally{busy=false;}
      };
    }catch(e){
      setText('le-billing-status','Unavailable');
      setText('le-billing-note',e.message||'Sign in to load billing details.');
      btn.textContent='Retry billing';btn.disabled=false;
      btn.onclick=function(){card.dataset.initialized='0';initCard();};
    }
  }
  function watch(){
    var target=document.getElementById('content');
    if(!target)return;
    var run=function(){if(document.getElementById('le-billing-card'))initCard();};
    new MutationObserver(run).observe(target,{childList:true,subtree:true});
    run();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',watch);else watch();
})();
