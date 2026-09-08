/* Loose Ends launch-readiness.js
 * Lightweight product readiness layer: surfaces configuration gaps without
 * pretending that third-party providers are connected when they are not.
 */
(function(){
  'use strict';
  var KEY='loose_ends_launch_readiness_v1';
  var checks=[
    {id:'business',label:'Business profile configured',ok:function(){return !!(window.LOSMB&&window.LOSMB.getProfile&&window.LOSMB.getProfile().name);}},
    {id:'auth',label:'Signed-in workspace',ok:function(){return !!(window.LESupabase&&window.LESupabase.auth);}},
    {id:'automation',label:'Automation engine available',ok:function(){return !!window.LOoseEndsWorkflowEngine||!!document.getElementById('workflowCenter');}},
    {id:'recovery',label:'Revenue recovery available',ok:function(){return !!window.LOOSE_ENDS_RECOVERY||!!window.RevenueRecovery;}}
  ];
  function status(){
    return checks.map(function(c){var ok=false;try{ok=!!c.ok();}catch(e){}return {id:c.id,label:c.label,ok:ok};});
  }
  function render(){
    var root=document.getElementById('launchReadiness');if(!root)return;
    var rows=status(),good=rows.filter(function(x){return x.ok;}).length;
    root.innerHTML='<div class="section-head"><div><div class="section-title">Launch readiness</div><div class="section-sub">Operational checks only. Integrations are marked ready only when actually configured.</div></div><span class="wf-pill">'+good+'/'+rows.length+'</span></div>'+
      rows.map(function(x){return '<div class="wf-row"><div><strong>'+x.label+'</strong></div><span class="wf-status '+(x.ok?'':'off')+'">'+(x.ok?'Ready':'Needs setup')+'</span></div>';}).join('');
  }
  function mount(){
    if(document.getElementById('launchReadiness'))return;
    var page=document.querySelector('#content .page');if(!page)return;
    var section=document.createElement('section');section.id='launchReadiness';section.className='card section-card';page.appendChild(section);render();
  }
  window.LaunchReadiness={status:status,render:render};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){setTimeout(mount,700);});else setTimeout(mount,700);
})();
