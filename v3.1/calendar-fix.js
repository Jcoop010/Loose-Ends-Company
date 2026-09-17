/* Loose Ends V3 calendar reliability layer. Preserves the V3 shell and uses the same local sales/calendar store. */
(function(){
  'use strict';
  var KEY='loose_ends_sales_crm_v1';
  var TYPES=['Appointment','Follow-up','Delivery','Call','Internal','Install'];
  var month=new Date(); month=new Date(month.getFullYear(),month.getMonth(),1);
  var selected=new Date();

  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function uid(){return 'cal-'+Date.now()+'-'+Math.floor(Math.random()*99999);}
  function load(){
    try{var d=JSON.parse(localStorage.getItem(KEY)||'null');if(d&&Array.isArray(d.orders)&&Array.isArray(d.events))return d;}catch(e){}
    return {orders:[],events:[]};
  }
  function save(d){try{localStorage.setItem(KEY,JSON.stringify(d));}catch(e){}}
  function key(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
  function fromKey(k){var p=k.split('-');return new Date(Number(p[0]),Number(p[1])-1,Number(p[2]));}
  function toast(m){var t=document.getElementById('toast');if(!t)return;t.textContent=m;t.className='toast show';setTimeout(function(){t.className='toast';},1800);}
  function events(){
    var d=load();
    var orders=(d.orders||[]).filter(function(o){return o.when||o.due;}).map(function(o){return {id:'so-'+o.id,title:(o.number||'Order')+' '+(o.title||''),type:'Appointment',start:o.when||(o.due+'T09:00'),who:o.customer||''};});
    return (d.events||[]).concat(orders);
  }
  function render(){
    var first=new Date(month.getFullYear(),month.getMonth(),1);
    var start=new Date(first);start.setDate(1-((first.getDay()+6)%7));
    var days=[];for(var i=0;i<42;i++){var d=new Date(start);d.setDate(start.getDate()+i);days.push(d);}
    var all=events(), map={};
    all.forEach(function(e){var k=String(e.start||'').slice(0,10);if(k)(map[k]=map[k]||[]).push(e);});
    var sel=key(selected), list=map[sel]||[];
    var html='<div class="page"><div class="page-head"><div><div class="eyebrow">SCHEDULE</div><div class="title">Calendar</div><div class="subtitle">Appointments, sales-order dates, calls, and follow-ups.</div></div><div class="date">'+new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})+'</div></div>'+
      '<div style="display:flex;gap:8px;align-items:center;margin-bottom:14px"><button type="button" class="action secondary" id="lefCalPrev">‹</button><strong>'+first.toLocaleString('en-US',{month:'long',year:'numeric'})+'</strong><button type="button" class="action secondary" id="lefCalNext">›</button><button type="button" class="primary" id="lefCalNew" style="margin-left:auto">+ New event</button></div>'+
      '<div class="two-col"><div class="card" style="padding:10px"><div class="le-week">'+['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(function(x){return '<div>'+x+'</div>';}).join('')+'</div><div class="le-grid">'+days.map(function(d){var k=key(d),evs=map[k]||[],inM=d.getMonth()===month.getMonth();return '<button type="button" class="le-day'+(k===sel?' on':'')+(inM?'':' dim')+'" data-le-day="'+k+'"><i>'+d.getDate()+'</i>'+evs.slice(0,3).map(function(e){return '<em>'+esc(e.title)+'</em>';}).join('')+(evs.length>3?'<em>+'+(evs.length-3)+' more</em>':'')+'</button>';}).join('')+'</div></div>'+
      '<div class="card section-card"><div class="section-title">'+selected.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})+'</div><div class="kpi-note" style="margin-bottom:12px">'+list.length+' scheduled</div>'+ (list.length?list.map(function(e){var own=String(e.id||'').indexOf('so-')!==0;return '<div class="le-card" style="margin-bottom:8px"><strong>'+esc(e.title)+'</strong><span>'+esc(e.type||'Appointment')+(e.who?' · '+esc(e.who):'')+'</span><b>'+esc(String(e.start||'').replace('T',' ').slice(0,16))+'</b>'+ (own?'<button type="button" class="action secondary" data-le-delete="'+esc(e.id)+'" style="margin-top:8px">Delete</button>':'')+'</div>';}).join(''):'<p class="subtitle">Nothing scheduled.</p>')+'</div></div></div>';
    var el=document.getElementById('content');if(!el)return;el.innerHTML=html;
    document.getElementById('lefCalPrev').onclick=function(){month=new Date(month.getFullYear(),month.getMonth()-1,1);render();};
    document.getElementById('lefCalNext').onclick=function(){month=new Date(month.getFullYear(),month.getMonth()+1,1);render();};
    document.getElementById('lefCalNew').onclick=function(){edit(key(selected));};
    document.querySelectorAll('[data-le-day]').forEach(function(b){b.onclick=function(){selected=fromKey(b.getAttribute('data-le-day'));month=new Date(selected.getFullYear(),selected.getMonth(),1);render();};});
    document.querySelectorAll('[data-le-delete]').forEach(function(b){b.onclick=function(){var d=load();d.events=(d.events||[]).filter(function(e){return String(e.id)!==String(b.getAttribute('data-le-delete'));});save(d);render();toast('Event deleted');};});
  }
  function edit(dayKey){
    var d=fromKey(dayKey),wrap=document.createElement('div');wrap.className='sales-modal-wrap';
    var start=key(d)+'T09:00',end=key(d)+'T10:00';
    wrap.innerHTML='<div class="sales-modal" style="max-width:600px"><div class="sales-modal-head"><div><div class="eyebrow">CALENDAR</div><h2>New event</h2></div><button type="button" class="sales-close" id="lefCalClose">×</button></div><div class="audit-grid"><div class="audit-field"><label>Title</label><input id="lefTitle" required placeholder="Customer appointment"></div><div class="audit-field"><label>Type</label><select id="lefType">'+TYPES.map(function(t){return '<option>'+t+'</option>';}).join('')+'</select></div><div class="audit-field"><label>Customer / contact</label><input id="lefWho" placeholder="Optional"></div><div class="audit-field"><label>Start</label><input id="lefStart" type="datetime-local" value="'+start+'" required></div><div class="audit-field"><label>End</label><input id="lefEnd" type="datetime-local" value="'+end+'"></div><div class="audit-field"><label>Location</label><input id="lefLoc" placeholder="Optional"></div></div><div class="audit-field"><label>Notes</label><textarea id="lefNotes" class="input" rows="3" placeholder="Optional"></textarea></div><div class="audit-foot"><button type="button" class="action secondary" id="lefCancel">Cancel</button><button type="button" class="primary" id="lefSave">Save event</button></div></div>';
    document.body.appendChild(wrap);
    document.getElementById('lefCalClose').onclick=document.getElementById('lefCancel').onclick=function(){wrap.remove();};
    document.getElementById('lefSave').onclick=function(){
      var title=document.getElementById('lefTitle').value.trim(),s=document.getElementById('lefStart').value;if(!title||!s){toast('Title and start time are required');return;}
      var e={id:uid(),title:title,type:document.getElementById('lefType').value,start:s,end:document.getElementById('lefEnd').value||s,who:document.getElementById('lefWho').value.trim(),loc:document.getElementById('lefLoc').value.trim(),notes:document.getElementById('lefNotes').value.trim()};
      var data=load();data.events=data.events||[];data.events.unshift(e);save(data);selected=new Date(s);month=new Date(selected.getFullYear(),selected.getMonth(),1);wrap.remove();render();toast('Event saved');
    };
  }
  function activate(e){
    var n=e.target.closest?e.target.closest('.nav-item[data-view]'):null;if(!n||n.getAttribute('data-view')!=='calendar')return;
    e.preventDefault();e.stopPropagation();if(e.stopImmediatePropagation)e.stopImmediatePropagation();
    document.querySelectorAll('.nav-item').forEach(function(b){b.classList.toggle('active',b===n);});
    render();
  }
  document.addEventListener('click',activate,true);
  document.addEventListener('pointerup',activate,true);
  window.LECalendarFix={open:render};
})();
