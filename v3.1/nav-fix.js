/* Makes every sidebar / mobile tab actually change the page. */
(function(){
  'use strict';
  function mark(view){
    document.querySelectorAll('.nav-item').forEach(function(b){
      b.classList.toggle('active', b.getAttribute('data-view')===view);
    });
    document.querySelectorAll('.le-mobile-tab').forEach(function(b){
      b.classList.toggle('active', (b.getAttribute('data-view')||b.dataset.view)===view);
    });
  }
  function show(view){
    if(!view || view==='more') return;
    try {
      if (typeof state !== 'undefined' && state) state.view = view;
      if (window.state) window.state.view = view;
    } catch (e) {}
    mark(view);
    if (view==='sales' || view==='calendar') {
      if (window.LESalesCRM && typeof LESalesCRM.go === 'function') {
        LESalesCRM.go(view);
        return;
      }
    }
    if (window.LE && typeof LE.setView === 'function') {
      var fn = LE.setView;
      if (LE.__navFixed) {
        fn(view);
      } else {
        try { fn(view); } catch (err) { console.warn(err); }
      }
      return;
    }
    if (typeof window.setView === 'function') window.setView(view);
  }
  function patchSetView(){
    if (!window.LE || typeof LE.setView !== 'function' || LE.__navFixed) return;
    var orig = LE.setView;
    LE.setView = function(v){
      if (v==='sales' || v==='calendar') {
        if (window.LESalesCRM) { LESalesCRM.go(v); mark(v); return; }
      }
      return orig(v);
    };
    LE.__navFixed = true;
    window.setView = LE.setView;
  }
  function onClick(e){
    var n = e.target.closest ? e.target.closest('[data-view]') : null;
    if (!n) return;
    if (!n.classList.contains('nav-item') && !n.classList.contains('le-mobile-tab') && !n.classList.contains('le-more-item')) return;
    var view = n.getAttribute('data-view') || n.dataset.view;
    if (!view || view==='more') return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    show(view);
  }
  document.addEventListener('click', onClick, true);
  document.addEventListener('pointerup', function(e){
    var n = e.target.closest ? e.target.closest('.nav-item[data-view], .le-mobile-tab[data-view], .le-more-item[data-view]') : null;
    if (!n) return;
    var view = n.getAttribute('data-view');
    if (!view || view==='more') return;
    show(view);
  }, true);
  function boot(){
    patchSetView();
    if (window.state && (window.state.view==='sales' || window.state.view==='calendar')) show(window.state.view);
  }
  boot();
  setTimeout(boot, 300);
  setTimeout(boot, 1200);
})();
