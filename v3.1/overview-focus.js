/* Dashboard focus: show the primary workflow instead of stacking multiple recovery dashboards.
   All underlying modules remain available in their dedicated navigation views. */
(function(){
  'use strict';
  function sync(){
    var state=(window.LE&&window.LE.getState&&window.LE.getState())||window.state||{};
    var overview=state.view==='overview'||(!state.view&&document.querySelector('.nav-item[data-view="overview"].active'));
    document.body.classList.toggle('le-focused-overview',!!overview);
    if(!overview)return;
    var page=document.querySelector('#content .page');
    if(!page)return;
    var launch=document.getElementById('le-launch-panel');
    var engine=document.getElementById('le-engine-panel');
    var scan=document.querySelector('.le-scan');
    if(launch&&launch.parentElement===page&&page.firstElementChild!==launch)page.insertBefore(launch,page.firstElementChild);
    if(engine&&engine.parentElement===page&&launch&&launch.nextElementSibling!==engine)page.insertBefore(engine,launch.nextElementSibling);
    if(scan&&scan.parentElement===page&&engine&&engine.nextElementSibling!==scan)page.insertBefore(scan,engine.nextElementSibling);
  }
  var style=document.createElement('style');style.id='le-overview-focus-css';
  style.textContent=`
    body.le-focused-overview #le-os-layer,
    body.le-focused-overview #leLaunchControl {display:none!important}
    body.le-focused-overview #le-launch-panel{margin-top:0!important}
    body.le-focused-overview #le-engine-panel{margin-top:12px!important}
    body.le-focused-overview #le-engine-panel .le-engine-head h2{font-size:clamp(19px,2.8vw,27px);line-height:1.15}
    body.le-focused-overview #le-engine-panel .le-engine-stat{min-width:0}
    body.le-focused-overview .le-scan{margin-top:12px!important}
    body.le-focused-overview #content .page{display:flex;flex-direction:column;gap:12px}
    body.le-focused-overview #content .page > *{flex-shrink:0;min-width:0}
    @media(max-width:700px){
      body.le-focused-overview #le-engine-panel .le-engine-grid{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:8px}
      body.le-focused-overview #le-engine-panel .le-engine-head{flex-wrap:wrap;gap:10px}
      body.le-focused-overview #le-engine-panel .le-engine-actions{display:flex;flex-wrap:wrap;gap:8px;width:100%}
      body.le-focused-overview #le-engine-panel .le-engine-actions button{min-height:42px;flex:1}
      body.le-focused-overview #le-launch-panel .le-launch-steps{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:8px}
      body.le-focused-overview #le-launch-panel .le-launch-actions{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:8px}
      body.le-focused-overview #le-launch-panel .le-launch-actions button{min-width:0;white-space:normal;min-height:44px}
      body.le-focused-overview .le-scan{padding:15px!important}
    }
  `;
  document.head.appendChild(style);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){sync();setInterval(sync,900)});
  else {sync();setInterval(sync,900)}
})();
