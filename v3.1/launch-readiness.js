/* Loose Ends launch-readiness.js
 * Lightweight product readiness layer: surfaces real configuration gaps.
 */
(function(){
  'use strict';
  var checks=[
    {id:'business',label:'Business profile configured',ok:function(){return !!(window.LOSMB&&window.LOSMB.getProfile&&window.LOSMB.getProfile().name);}},
    {id:'auth',label:'Signed-in workspace',ok:async function(){return !!(window.LESupabase&&window.LESupabase.auth&&(await window.LESupabase.auth.getUser()).data.user);}},
    {id:'automation',label:'Automation engine available',ok:function(){return !!window.LELaunchControl||!!document.getElementById('workflowCenter')||!!document.querySelector('[data-view="automations"]');}},
    {id:'recovery',label:'Revenue recovery available',ok:function(){return !!window.LELiveProduct||!!window.LOOSE_ENDS_RECOVERY||!!window.RevenueRecovery;}}
  ];
  async function status(){
    var rows=[];
    for(var i=0;i<checks.length;i++){var ok=false;try{ok=!!(await checks[i].ok());}catch(e){}rows.push({id:checks[i].id,label:checks[i].label,ok:ok});}
    return rows;
  }
  async function render(){
    var root=document.getElementById('launchReadiness');if(!root)return;
    var rows=await status(),good=rows.filter(function(x){return x.ok;}).length;
    root.innerHTML='<div class="section-head"><div><div class="section-title">Launch readiness</div><div class="section-sub">Truthful operational checks. Provider integrations are not marked live without configuration evidence.</div></div><span class="wf-pill">'+good+'/'+rows.length+'</span></div>'+rows.map(function(x){return '<div class="wf-row"><div><strong>'+x.label+'</strong></div><span class="wf-status '+(x.ok?'':'off')+'">'+(x.ok?'Ready':'Needs setup')+'</span></div>';}).join('');
  }
  function mount(){
    if(document.getElementById('launchReadiness'))return;
    var page=document.querySelector('#content .page');if(!page)return;
    var section=document.createElement('section');section.id='launchReadiness';section.className='card section-card';page.appendChild(section);render();
  }
  window.LaunchReadiness={status:status,render:render};
  function boot(){setTimeout(mount,1000);setInterval(function(){if(document.querySelector('#content .page')&&!document.getElementById('launchReadiness'))mount()},1500)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
