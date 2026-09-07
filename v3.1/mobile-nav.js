/* Loose Ends mobile navigation: persistent thumb-friendly tabs + secondary More menu. */
(function(){
  'use strict';
  function boot(){
    if(document.getElementById('leMobileNav')) return;
    var style=document.createElement('style');
    style.id='leMobileNavStyle';
    style.textContent=''
      +'.le-mobile-nav{display:none}'
      +'@media(max-width:700px){'
      +'.le-mobile-nav{position:fixed;left:0;right:0;bottom:0;z-index:900;display:grid;grid-template-columns:repeat(5,1fr);padding:7px 6px calc(7px + env(safe-area-inset-bottom));background:rgba(7,16,23,.97);border-top:1px solid rgba(148,180,205,.16);box-shadow:0 -12px 30px rgba(0,0,0,.28);backdrop-filter:blur(14px)}'
      +'.le-mobile-tab{position:relative;border:0;background:transparent;color:#708698;min-height:52px;border-radius:11px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font:600 10px/1 system-ui,sans-serif;cursor:pointer;-webkit-tap-highlight-color:transparent}'
      +'.le-mobile-tab .le-tab-icon{font-size:19px;line-height:18px}'
      +'.le-mobile-tab.active{color:#48d7b0;background:rgba(72,215,176,.09)}'
      +'.le-mobile-tab.active:after{content:"";position:absolute;top:3px;width:24px;height:2px;border-radius:2px;background:#48d7b0}'
      +'.le-tab-badge{position:absolute;top:3px;margin-left:25px;min-width:15px;height:15px;padding:0 4px;border-radius:8px;background:#e65b67;color:white;font:800 9px/15px system-ui,sans-serif}'
      +'.le-more-menu{position:fixed;right:10px;bottom:calc(74px + env(safe-area-inset-bottom));z-index:901;width:220px;padding:8px;border:1px solid rgba(148,180,205,.18);border-radius:15px;background:#0b141c;box-shadow:0 18px 55px rgba(0,0,0,.48);display:none}'
      +'.le-more-menu.open{display:block}'
      +'.le-more-title{padding:7px 10px 6px;color:#71899a;font:700 9px/1 system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase}'
      +'.le-more-item{width:100%;border:0;background:transparent;color:#dce9ee;text-align:left;border-radius:10px;padding:12px 10px;font:600 12px system-ui,sans-serif;display:flex;gap:10px;align-items:center}'
      +'.le-more-item:active,.le-more-item:hover{background:rgba(72,215,176,.09);color:#48d7b0}'
      +'.le-more-backdrop{position:fixed;inset:0;z-index:900;background:transparent;display:none}'
      +'.le-more-backdrop.open{display:block}'
      +'.main{padding-bottom:76px!important}'
      +'}';
    document.head.appendChild(style);

    var nav=document.createElement('nav');
    nav.id='leMobileNav';nav.className='le-mobile-nav';nav.setAttribute('aria-label','Primary navigation');
    var tabs=[
      ['overview','⌂','Home',''],
      ['loose','☷','Loose Ends','47'],
      ['recovery','↻','Recovery',''],
      ['customers','♙','Customers',''],
      ['more','•••','More','']
    ];
    tabs.forEach(function(t){
      var b=document.createElement('button');b.className='le-mobile-tab';b.dataset.view=t[0];b.type='button';
      b.innerHTML='<span class="le-tab-icon">'+t[1]+'</span><span>'+t[2]+'</span>'+(t[3]?'<span class="le-tab-badge">'+t[3]+'</span>':'');
      b.addEventListener('click',function(){
        if(t[0]==='more'){toggleMore();return;}
        closeMore();
        if(window.LE&&typeof window.LE.setView==='function') window.LE.setView(t[0]);
        else window.setView(t[0]);
        setActive(t[0]);
      });
      nav.appendChild(b);
    });
    document.body.appendChild(nav);

    var backdrop=document.createElement('div');backdrop.className='le-more-backdrop';backdrop.addEventListener('click',closeMore);document.body.appendChild(backdrop);
    var menu=document.createElement('div');menu.className='le-more-menu';menu.setAttribute('role','menu');
    menu.innerHTML='<div class="le-more-title">More</div><button class="le-more-item" data-view="intelligence">▥ &nbsp;Revenue Intelligence</button><button class="le-more-item" data-view="settings">⚙ &nbsp;Settings</button><button class="le-more-item" data-demo="1">▶ &nbsp;Open Demo Guide</button>';
    document.body.appendChild(menu);
    menu.querySelectorAll('[data-view]').forEach(function(b){b.addEventListener('click',function(){closeMore();if(window.LE&&window.LE.setView)window.LE.setView(b.dataset.view);setActive(b.dataset.view);});});
    menu.querySelector('[data-demo]').addEventListener('click',function(){closeMore();var g=document.getElementById('leDemoGuide');if(g)g.classList.remove('hidden');});

    function setActive(view){nav.querySelectorAll('.le-mobile-tab').forEach(function(b){b.classList.toggle('active',b.dataset.view===view);});}
    function toggleMore(){menu.classList.toggle('open');backdrop.classList.toggle('open');nav.querySelector('[data-view="more"]').classList.toggle('active',menu.classList.contains('open'));}
    function closeMore(){menu.classList.remove('open');backdrop.classList.remove('open');}
    var observer=new MutationObserver(function(){var a=document.querySelector('.nav-item.active');if(a)setActive(a.getAttribute('data-view'));});
    var side=document.querySelector('.sidebar');if(side)observer.observe(side,{subtree:true,attributes:true,attributeFilter:['class']});
    setTimeout(function(){var a=document.querySelector('.nav-item.active');setActive(a?a.getAttribute('data-view'):'overview');},50);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
