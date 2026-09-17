/* Walk-in demo entry point for sales conversations. */
(function(){'use strict';
function boot(){
  if(location.pathname==='/demo' || location.search.indexOf('demo=1')>=0)return;
  if(location.pathname!=='/'&&location.pathname!=='/index.html')return;
  var actions=document.querySelector('.le-l-hero .le-l-actions');
  if(!actions||document.getElementById('le-walkin-demo'))return;
  var b=document.createElement('button');b.id='le-walkin-demo';b.className='le-l-btn';b.textContent='Walk-in demo';b.onclick=function(){location.href='/demo'};actions.appendChild(b);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){setTimeout(boot,250)});else setTimeout(boot,250);
})();