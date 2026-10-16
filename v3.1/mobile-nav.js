/* Loose Ends Co. mobile navigation: real modules, no invented counts, thumb-friendly menu. */
(function(){
  'use strict';
  function boot(){
    if(document.getElementById('leMobileNav'))return;
    var style=document.createElement('style');
    style.id='leMobileNavStyle';
    style.textContent=''
      +'.le-mobile-nav,.le-more-menu,.le-more-backdrop{display:none}'
      +'@media(max-width:1100px){'
      +'.le-mobile-nav{position:fixed;left:0;right:0;bottom:0;z-index:900;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));padding:6px 6px calc(6px + env(safe-area-inset-bottom));background:rgba(7,17,31,.97);border-top:1px solid #26394c;box-shadow:0 -12px 30px rgba(0,0,0,.28);backdrop-filter:blur(16px)}'
      +'.le-mobile-tab{position:relative;border:0;background:transparent;color:#9aadc0;min-width:0;min-height:54px;border-radius:11px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;font:650 10px/1.1 system-ui,sans-serif;cursor:pointer;-webkit-tap-highlight-color:transparent}'
      +'.le-mobile-tab .le-tab-icon{font-size:20px;line-height:20px}'
      +'.le-mobile-tab.active{color:#ff9a3d;background:rgba(255,122,26,.11)}'
      +'.le-mobile-tab.active:after{content:"";position:absolute;top:3px;width:24px;height:2px;border-radius:2px;background:#ff873d}'
      +'.le-more-menu{position:fixed;right:10px;bottom:calc(76px + env(safe-area-inset-bottom));z-index:901;width:min(270px,calc(100vw - 20px));max-height:min(70vh,560px);overflow:auto;padding:9px;border:1px solid #29415b;border-radius:15px;background:#0c1a2b;box-shadow:0 18px 55px rgba(0,0,0,.48);display:none}'
      +'.le-more-menu.open{display:block}'
      +'.le-more-title{padding:8px 10px;color:#8fa4ba;font:800 10px/1 system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase}'
      +'.le-more-item{width:100%;border:0;background:transparent;color:#dce7f0;text-align:left;border-radius:10px;padding:13px 11px;font:650 13px system-ui,sans-serif;display:flex;gap:11px;align-items:center;min-height:44px}'
      +'.le-more-item:active,.le-more-item:hover,.le-more-item:focus-visible{background:#172b40;color:#ffad68;outline:none}'
      +'.le-more-backdrop{position:fixed;inset:0;z-index:900;background:rgba(0,0,0,.12);display:none}'
      +'.le-more-backdrop.open{display:block}'
      +'.main{padding-bottom:calc(82px + env(safe-area-inset-bottom))!important}'
      +'}';
    document.head.appendChild(style);
    var nav=document.createElement('nav');
    nav.id='leMobileNav';nav.className='le-mobile-nav';nav.setAttribute('aria-label','Primary navigation');
    var tabs=[['overview','⌂','Home'],['loose','☷','Loose Ends'],['recovery','↻','Revenue'],['customers','♙','Customers'],['more','•••','More']];
    tabs.forEach(function(t){
      var b=document.createElement('button');b.className='le-mobile-tab';b.dataset.view=t[0];b.type='button';b.setAttribute('aria-label',t[2]);
      b.innerHTML='<span class="le-tab-icon">'+t[1]+'</span><span>'+t[2]+'</span>';
      b.addEventListener('click',function(){
        if(t[0]==='more'){toggleMore();return;}
        closeMore();navigate(t[0]);setActive(t[0]);
      });
      nav.appendChild(b);
    });
    document.body.appendChild(nav);
    var backdrop=document.createElement('div');backdrop.className='le-more-backdrop';backdrop.addEventListener('click',closeMore);document.body.appendChild(backdrop);
    var menu=document.createElement('div');menu.className='le-more-menu';menu.setAttribute('role','menu');menu.setAttribute('aria-label','All workspace modules');
    menu.innerHTML='<div class="le-more-title">All modules</div>'
      +'<button class="le-more-item" data-view="sales" role="menuitem">＄ &nbsp; Sales pipeline</button>'
      +'<button class="le-more-item" data-view="calendar" role="menuitem">▦ &nbsp; Calendar</button>'
      +'<button class="le-more-item" data-view="tasks" role="menuitem">✓ &nbsp; Tasks</button>'
      +'<button class="le-more-item" data-view="documents" role="menuitem">▤ &nbsp; Documents</button>'
      +'<button class="le-more-item" data-view="intelligence" role="menuitem">▥ &nbsp; Intelligence</button>'
      +'<button class="le-more-item" data-view="workflows" role="menuitem">⚡ &nbsp; Automations</button>'
      +'<button class="le-more-item" data-view="settings" role="menuitem">⚙ &nbsp; Settings</button>'
      +'<button class="le-more-item" data-demo="1" role="menuitem">ⓘ &nbsp; Demo guide</button>';
    document.body.appendChild(menu);
    menu.querySelectorAll('[data-view]').forEach(function(b){b.addEventListener('click',function(){closeMore();navigate(b.dataset.view);setActive(b.dataset.view);});});
    var demo=menu.querySelector('[data-demo]');demo.addEventListener('click',function(){closeMore();var g=document.getElementById('leDemoGuide');if(g)g.classList.remove('hidden');});
    function navigate(view){if(window.LE&&typeof window.LE.setView==='function')window.LE.setView(view);else if(typeof window.setView==='function')window.setView(view);}
    function setActive(view){
      var primary=['overview','loose','recovery','customers'].indexOf(view)>=0?view:'more';
      nav.querySelectorAll('.le-mobile-tab').forEach(function(b){b.classList.toggle('active',b.dataset.view===primary);});
    }
    function toggleMore(){var open=!menu.classList.contains('open');menu.classList.toggle('open',open);backdrop.classList.toggle('open',open);nav.querySelector('[data-view="more"]').classList.toggle('active',open);nav.querySelector('[data-view="more"]').setAttribute('aria-expanded',String(open));}
    function closeMore(){menu.classList.remove('open');backdrop.classList.remove('open');nav.querySelector('[data-view="more"]').classList.remove('active');nav.querySelector('[data-view="more"]').setAttribute('aria-expanded','false');}
    var observer=new MutationObserver(function(){var a=document.querySelector('.nav-item.active');if(a)setActive(a.getAttribute('data-view'));});
    var side=document.querySelector('.sidebar');if(side)observer.observe(side,{subtree:true,attributes:true,attributeFilter:['class']});
    setTimeout(function(){var a=document.querySelector('.nav-item.active');setActive(a?a.getAttribute('data-view'):'overview');},100);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();