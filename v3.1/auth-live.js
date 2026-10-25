/* Loose Ends live workspace bridge: Supabase Auth + workspace bootstrap + live data sync. */
(function(){
  'use strict';
  var S=window.LESupabase;
  if(!S) return;
  var KEY='loose_ends_v31_state', MAP='loose_ends_live_map';
  try{localStorage.removeItem(KEY);localStorage.removeItem(MAP);}catch(e){}
  var sessionUser=null, workspace=null, live=false, generation=0, bootPromise=null, bootAgain=false;
  function esc(s){return String(s||'').replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c];});}
  function toast(m){var e=document.getElementById('toast');if(e){e.textContent=m;e.className='toast show';setTimeout(function(){e.className='toast';},2200)}}
  function setPill(){var p=document.getElementById('le-auth-pill');if(!p)return;p.innerHTML=live?'● LIVE · '+esc(workspace?workspace.name:'Workspace'):'Sign in';p.className='le-auth-pill '+(live?'live':'demo');}
  function styles(){if(document.getElementById('le-auth-css'))return;var s=document.createElement('style');s.id='le-auth-css';s.textContent='.le-auth-pill{position:static;flex-shrink:0;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-height:44px;border:1px solid rgba(255,255,255,.12);background:#111827;color:#fff;padding:8px 12px;border-radius:999px;font:700 11px/1 system-ui;letter-spacing:.08em;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.18)}.le-auth-pill.live{background:#0b3b31;border-color:#27c59a;color:#b9ffe8}.le-auth-pill.demo{background:#222a38}.le-auth-modal{position:fixed;inset:0;z-index:10060;background:rgba(4,8,15,.72);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:18px}.le-auth-card{width:min(440px,100%);background:#0c1a2b;color:#f4f8fb;border:1px solid #29415b;border-radius:22px;padding:26px;max-height:calc(100dvh - 36px);overflow:auto;box-shadow:0 30px 90px rgba(0,0,0,.3)}.le-auth-card h2{margin:0 0 6px;font:800 26px/1.1 system-ui;color:#f4f8fb}.le-auth-card p{color:#9fb2c4;margin:0 0 20px}.le-auth-field{display:block;font:700 12px system-ui;color:#c4d2df;margin:12px 0 6px}.le-auth-input{width:100%;box-sizing:border-box;padding:13px 14px;border:1px solid #29415b;background:#07111f;color:#f4f8fb;border-radius:12px;font:500 15px system-ui}.le-auth-actions{display:flex;gap:10px;margin-top:18px}.le-auth-btn{flex:1;border:0;border-radius:12px;padding:13px 15px;font:800 14px system-ui;cursor:pointer}.le-auth-primary{background:#ff7a1a;color:#07111f}.le-auth-secondary{background:#102238;color:#d6e4ef}.le-auth-note{min-height:18px;margin-top:12px;font:600 12px system-ui;color:#9fb2c4}.le-auth-close{float:right;border:0;background:none;font-size:26px;cursor:pointer;color:#9fb2c4}.le-auth-lock{font-size:12px;color:#9fb2c4;margin-top:12px}.le-live-banner{position:fixed;left:18px;bottom:18px;z-index:10040;background:#0b3b31;color:#b9ffe8;border:1px solid #27c59a;border-radius:14px;padding:10px 13px;font:700 11px system-ui;box-shadow:0 12px 32px rgba(0,0,0,.2)}@media(max-width:700px){.le-auth-pill{right:10px;top:10px}.le-live-banner{left:10px;bottom:76px}}';document.head.appendChild(s)}
  function pill(){var p=document.createElement('button');p.id='le-auth-pill';p.onclick=openAuth;p.setAttribute('aria-label','Account and live mode');(document.querySelector('.top-actions')||document.body).appendChild(p);setPill()}
  function openAuth(){var old=document.getElementById('le-auth-modal');if(old)old.remove();var d=document.createElement('div');d.id='le-auth-modal';d.className='le-auth-modal';d.innerHTML='<div class="le-auth-card"><button class="le-auth-close" onclick="document.getElementById(\'le-auth-modal\').remove()">×</button><div class="eyebrow">LOOSE ENDS</div><h2>'+(sessionUser?'Live workspace':'Your business workspace')+'</h2><p>'+(sessionUser?'Your account is connected. Live data is isolated to your workspace.':'Create an account to save real customers, opportunities, follow-ups, and business activity.')+'</p>'+(sessionUser?'<div class="le-auth-user"><div><strong>'+esc(sessionUser.email)+'</strong><small>Signed in</small></div><button class="le-auth-btn le-auth-secondary" onclick="LELive.signOut()">Sign out</button></div><div class="le-auth-lock">Secure browser session · database access protected by Supabase Auth + RLS.</div>':'<form id="le-auth-form"><label class="le-auth-field" for="le-auth-email">Email</label><input id="le-auth-email" class="le-auth-input" name="email" type="email" autocomplete="email" required placeholder="you@business.com"><label class="le-auth-field" for="le-auth-password">Password</label><input id="le-auth-password" class="le-auth-input" name="password" type="password" autocomplete="current-password" required placeholder="Password (new accounts: 12+ characters)"><div class="le-auth-actions"><button class="le-auth-btn le-auth-primary" type="submit">Sign in</button><button class="le-auth-btn le-auth-secondary" type="button" id="le-signup">Create account</button></div><button type="button" class="le-auth-btn le-auth-secondary" style="margin-top:12px;width:100%" onclick="LEAccountRecovery.openRequest()">Forgot password?</button><div class="le-auth-note" id="le-auth-note">Use Sign in for an existing account, or Create account for a new workspace.</div></form>')+'</div>';document.body.appendChild(d);var f=document.getElementById('le-auth-form');if(f)f.addEventListener('submit',function(e){e.preventDefault();auth(false,f)});var su=document.getElementById('le-signup');if(su)su.addEventListener('click',function(){var form=document.getElementById('le-auth-form'),field=document.getElementById('le-auth-password'),note=document.getElementById('le-auth-note');if(field){field.autocomplete='new-password';field.minLength=12;}if(note)note.textContent='New passwords need 12+ characters and must not appear in known breaches. The safety check is free and privacy-preserving.';auth(true,form)})}
  async function auth(signup,f){var note=document.getElementById('le-auth-note'),buttons=f.querySelectorAll('button'),email=f.email.value.trim(),password=f.password.value;buttons.forEach(function(b){b.disabled=true});if(note)note.textContent=signup?'Creating your account…':'Signing you in…';try{if(signup){if(!window.LEPasswordSecurity)throw Error('Password security check is unavailable. Please reload.');await window.LEPasswordSecurity.check(password);}var r=signup?await S.auth.signUp({email:email,password:password,options:{emailRedirectTo:window.location.origin+'/dashboard'}}):await S.auth.signInWithPassword({email:email,password:password});if(r.error)throw r.error;if(signup&&!r.data.session){if(note)note.textContent='Account created. Check your email to confirm, then sign in.';return}await bootSession();if(!sessionUser||!workspace)throw new Error('You are signed in, but your business workspace could not be loaded. Please try again or contact support.');var m=document.getElementById('le-auth-modal');if(m)m.remove();if(location.pathname==='/'||location.pathname==='/index.html')location.assign('/dashboard');}catch(err){if(note)note.textContent=(err&&err.message)||'Sign-in failed. Check your connection and try again.';}finally{buttons.forEach(function(b){b.disabled=false})}}
  function bootSession(){
    if(bootPromise)return bootPromise;
    bootPromise=(async function(){do{bootAgain=false;await readSession();}while(bootAgain);})().finally(function(){bootPromise=null;});
    return bootPromise;
  }
  async function readSession(){
    var request=++generation;
    live=false;workspace=null;sessionUser=null;setPill();
    var r=await S.auth.getUser();if(request!==generation)return;
    sessionUser=r.data&&r.data.user;
    if(!sessionUser){setPill();return;}
    var q=await S.from('workspace_members').select('workspace_id,role,workspaces(id,name,slug)').eq('user_id',sessionUser.id).limit(1).maybeSingle();
    if(request!==generation)return;
    if(q.error){toast('Could not load workspace');return;}
    if(!q.data){
      var rr=await S.functions.invoke('bootstrap-workspace',{body:{name:'My Business',slug:'my-business-'+sessionUser.id.replaceAll('-','').slice(0,8)}});
      if(request!==generation)return;
      if(rr.error){toast('Could not create workspace');return;}
      workspace=rr.data&&rr.data.workspace;
    }else workspace=q.data.workspaces;
    live=!!workspace;setPill();if(live)await loadLive();
  }
  async function loadLive(){
    // The production runtime owns workspace state. Never cache customer records in browser storage.
    try{localStorage.removeItem(KEY);localStorage.removeItem(MAP);}catch(e){}
    if(window.LE&&window.LE.refresh)await window.LE.refresh();
  }
  function classFor(s){s=String(s||'').toLowerCase();if(s.indexOf('declin')>=0)return'red';if(s.indexOf('miss')>=0)return'purple';if(s.indexOf('dorm')>=0)return'blue';return'amber'}
  async function signOut(){
    try{localStorage.removeItem(KEY);localStorage.removeItem(MAP);}catch(e){}
    var result=await S.auth.signOut();
    if(result&&result.error){toast('Sign out failed. Please try again.');return;}
    live=false;workspace=null;sessionUser=null;setPill();location.reload();
  }
  // Recovery writes are handled by v3.1/app.js after explicit owner confirmation.
  window.LELive={openAuth:openAuth,signOut:signOut,loadLive:loadLive};styles();pill();S.auth.onAuthStateChange(function(){generation++;bootAgain=true;live=false;workspace=null;sessionUser=null;setPill();setTimeout(bootSession,0)});bootSession();
})();

