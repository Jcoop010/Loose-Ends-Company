/* Loose Ends V1 sales-ready product layer. Non-destructive: sits on top of the stable V3.1 runtime. */
(function(){
  'use strict';
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function money(n){return '$'+Math.round(Number(n||0)).toLocaleString();}
  function qs(s){return document.querySelector(s);}
  function addStyles(){
    if(document.getElementById('le-sales-style'))return;
    var l=document.createElement('link');l.id='le-sales-style';l.rel='stylesheet';l.href='v3.1/sales-upgrade.css';document.head.appendChild(l);
  }
  function addTopButton(){
    var actions=qs('.top-actions');if(!actions||qs('#leAuditBtn'))return;
    var b=document.createElement('button');b.id='leAuditBtn';b.className='audit-btn';b.textContent='Run Revenue Audit';b.onclick=openAudit;actions.insertBefore(b,actions.firstChild);
  }
  function addRibbon(){
    var page=qs('.page');if(!page||qs('.sales-ribbon'))return;
    var head=page.querySelector('.page-head');if(!head)return;
    var r=document.createElement('div');r.className='sales-ribbon';r.innerHTML='<span class="live-dot"></span><strong>LIVE REVENUE RECOVERY DEMO</strong><span>Built to find, prioritize, and recover revenue already connected to your customers.</span><span class="spacer"></span><button class="audit-btn" onclick="LESales.openAudit()">Calculate your opportunity</button>';
    head.insertAdjacentElement('afterend',r);
    var chips=document.createElement('div');chips.className='value-strip';chips.innerHTML='<div class="value-chip"><b><span class="check">✓</span>Existing customers</b><span>Recover revenue without buying more leads.</span></div><div class="value-chip"><b><span class="check">✓</span>Ranked by dollars</b><span>Start with the opportunities worth the most.</span></div><div class="value-chip"><b><span class="check">✓</span>Human-approved</b><span>AI recommends; your team controls outreach.</span></div><div class="value-chip"><b><span class="check">✓</span>Measured recovery</b><span>Track conversations, bookings, and recovered revenue.</span></div>';
    r.insertAdjacentElement('afterend',chips);
  }
  function openAudit(){
    if(qs('#leAuditModal'))return;
    var wrap=document.createElement('div');wrap.id='leAuditModal';wrap.className='sales-modal-wrap';
    wrap.innerHTML='<div class="sales-modal" role="dialog" aria-modal="true" aria-label="Revenue opportunity audit"><div class="sales-modal-head"><div><div class="eyebrow">REVENUE OPPORTUNITY AUDIT</div><h2>How much revenue could you recover?</h2><p>Use conservative numbers from the shop. This is a sizing tool—not a promise. The owner can replace every assumption with real data.</p></div><button class="sales-close" aria-label="Close">×</button></div><div class="audit-grid"><div class="audit-field"><label>Repair orders / month</label><input id="leRO" type="number" min="1" value="250"></div><div class="audit-field"><label>% with declined work</label><input id="leDeclined" type="number" min="0" max="100" value="40"></div><div class="audit-field"><label>Avg. declined value</label><input id="leAvg" type="number" min="0" value="300"></div><div class="audit-field"><label>Recovery rate</label><input id="leRate" type="number" min="0" max="100" value="15"></div></div><div class="audit-result"><div class="result"><small>Declined work identified</small><strong id="lePool">$30,000</strong></div><div class="result teal"><small>Illustrative monthly recovery</small><strong id="leRecovery">$4,500</strong></div></div><p id="leMath">250 orders × 40% with declined work × $300 average declined × 15% recovered.</p><div class="audit-foot"><span>Tip: ask the owner for their actual last-90-day declined-work total.</span><button class="primary" id="leCopyAudit">Copy audit summary</button></div></div>';
    document.body.appendChild(wrap);
    function calc(){
      var ro=Number(qs('#leRO').value||0),d=Number(qs('#leDeclined').value||0)/100,a=Number(qs('#leAvg').value||0),r=Number(qs('#leRate').value||0)/100;
      var pool=ro*d*a,rec=pool*r;
      qs('#lePool').textContent=money(pool);qs('#leRecovery').textContent=money(rec);
      qs('#leMath').textContent=ro.toLocaleString()+' orders × '+(d*100).toFixed(0)+'% with declined work × '+money(a)+' average declined × '+(r*100).toFixed(0)+'% recovered.';
    }
    wrap.querySelectorAll('input').forEach(function(i){i.addEventListener('input',calc);});
    wrap.querySelector('.sales-close').onclick=closeAudit;wrap.addEventListener('click',function(e){if(e.target===wrap)closeAudit();});
    qs('#leCopyAudit').onclick=function(){
      var summary='Loose Ends revenue audit: '+qs('#lePool').textContent+' of declined work identified; illustrative recovery '+qs('#leRecovery').textContent+' per month. '+qs('#leMath').textContent;
      if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(summary).then(function(){this.textContent='Copied';}.bind(this));}else{this.textContent='Ready to share';}
    };
    calc();
  }
  function closeAudit(){var m=qs('#leAuditModal');if(m)m.remove();}
  function addGuide(){
    if(qs('#leDemoGuide'))return;
    var g=document.createElement('div');g.id='leDemoGuide';g.className='demo-guide';g.innerHTML='<button class="demo-guide-close" aria-label="Close">×</button><h4>5-minute demo path</h4><p>Show the owner the money first. Then show how the system turns it into action.</p><div class="demo-step"><i>1</i><span>Open the highest-value Loose End.</span></div><div class="demo-step"><i>2</i><span>Show the reason + suggested next action.</span></div><div class="demo-step"><i>3</i><span>Show the drafted customer message.</span></div><div class="demo-step"><i>4</i><span>Mark it recovered to demonstrate measurement.</span></div>';
    document.body.appendChild(g);g.querySelector('.demo-guide-close').onclick=function(){g.classList.add('hidden');sessionStorage.setItem('le_guide_hidden','1');};
    if(sessionStorage.getItem('le_guide_hidden')==='1')g.classList.add('hidden');
    var f=document.createElement('button');f.className='demo-guide-btn';f.textContent='Demo guide';f.style.position='fixed';f.style.right='18px';f.style.bottom='18px';f.style.zIndex='840';f.onclick=function(){g.classList.remove('hidden');};document.body.appendChild(f);
  }
  function updateBrand(){
    var note=qs('.demo-note');if(note)note.innerHTML='LIVE DEMO<br><span>Riverside Auto Repair · Revenue Recovery</span>';
    var call=qs('.sidebar-callout');if(call)call.innerHTML='<strong>Find the money.<br>Take the action.<br>Recover the revenue.</strong><div class="line"></div>';
    var title=document.querySelector('title');if(title)title.textContent='Loose Ends — Revenue Recovery OS';
  }
  function boot(){
    addStyles();addTopButton();addGuide();updateBrand();
    var tries=0;function decorate(){
      addTopButton();addGuide();updateBrand();addRibbon();
      tries++;if(tries<12)setTimeout(decorate,250);
    }decorate();
    window.addEventListener('keydown',function(e){if(e.key==='Escape')closeAudit();});
  }
  window.LESales={openAudit:openAudit,closeAudit:closeAudit};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
