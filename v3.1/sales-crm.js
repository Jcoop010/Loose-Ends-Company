/* Sales Orders + Calendar for the live Loose Ends Netlify app */
(function(){
  'use strict';
  var KEY='loose_ends_sales_crm_v1';
  var STATUSES=['Draft','Quoted','Confirmed','In Progress','Fulfilled','Invoiced','Paid','Cancelled'];
  var PAY=['Unpaid','Partial','Paid'];
  var TYPES=['Appointment','Follow-up','Delivery','Call','Internal','Install'];
  function qs(s,el){return (el||document).querySelector(s);}
  function money(n){return '$'+Math.round(Number(n||0)).toLocaleString();}
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&','<':'<','>':'>','"':'"',"'":'&#39;'}[c];});}
  function uid(){return 'id-'+Date.now()+'-'+Math.floor(Math.random()*9999);}
  function total(o){var s=(o.items||[]).reduce(function(a,i){return a+(Number(i.qty)||0)*(Number(i.price)||0);},0);return s*(1+(Number(o.tax)||0));}
  function load(){
    try{var d=JSON.parse(localStorage.getItem(KEY)||'null');if(d&&d.orders)return d;}catch(e){}
    return {orders:[
      {id:'so1',number:'SO-1001',customer:'Angela Brooks',title:'Brake job + rotors',status:'In Progress',pay:'Unpaid',due:'2026-09-08',when:'2026-09-08T09:00',tax:0.07,notes:'Morning drop-off',items:[{name:'Front pads',qty:1,price:220},{name:'Rotors',qty:2,price:85},{name:'Labor',qty:2.5,price:140}]},
      {id:'so2',number:'SO-1002',customer:'Sarah Miller',title:'Brake follow-up',status:'Quoted',pay:'Unpaid',due:'2026-09-09',when:'',tax:0.07,notes:'',items:[{name:'Brake/rotor package',qty:1,price:1240}]},
      {id:'so3',number:'SO-1003',customer:'Robert Wilson',title:'Inspection + estimate',status:'Confirmed',pay:'Unpaid',due:'2026-09-08',when:'2026-09-08T15:00',tax:0.07,notes:'Return missed call',items:[{name:'Inspection',qty:1,price:89},{name:'Estimate labor',qty:1,price:110}]},
      {id:'so4',number:'SO-1004',customer:'Lisa Reynolds',title:'Service reactivation',status:'Invoiced',pay:'Partial',due:'2026-09-07',when:'',tax:0.07,notes:'',items:[{name:'Full service',qty:1,price:920}]},
      {id:'so5',number:'SO-1005',customer:'James Carter',title:'Overdue service',status:'Paid',pay:'Paid',due:'2026-09-06',when:'',tax:0.07,notes:'',items:[{name:'Service visit',qty:1,price:680]}]
    ],events:[
      {id:'ev1',title:'Angela Brooks — brake drop-off',type:'Appointment',start:'2026-09-08T09:00',end:'2026-09-08T11:00',who:'Angela Brooks',loc:'Bay 2'},
      {id:'ev2',title:'Call Robert Wilson',type:'Call',start:'2026-09-08T15:00',end:'2026-09-08T15:20',who:'Robert Wilson',loc:''},
      {id:'ev3',title:'Lisa Reynolds follow-up',type:'Follow-up',start:'2026-09-07T11:00',end:'2026-09-07T11:15',who:'Lisa Reynolds',loc:''},
      {id:'ev4',title:'Shop standup',type:'Internal',start:'2026-09-08T07:30',end:'2026-09-08T08:00',who:'',loc:'Office'}
    ]};
  }
  function save(d){try{localStorage.setItem(KEY,JSON.stringify(d));}catch(e){}}
  var db=load();
  function toast(m){if(window.LE&&LE.toast){LE.toast(m);return;}var el=document.getElementById('toast');if(!el)return;el.textContent=m;el.className='toast show';setTimeout(function(){el.className='toast';},2000);}

  function addNav(){
    var nav=qs('.sidebar nav');if(!nav||qs('[data-view="sales"]'))return;
    var sales=document.createElement('button');sales.className='nav-item';sales.setAttribute('data-view','sales');sales.innerHTML='<span>$</span>Sales Orders';
    var cal=document.createElement('button');cal.className='nav-item';cal.setAttribute('data-view','calendar');cal.innerHTML='<span>▦</span>Calendar';
    var customers=qs('[data-view="customers"]');
    if(customers&&customers.parentNode){customers.parentNode.insertBefore(sales,customers.nextSibling);customers.parentNode.insertBefore(cal,sales.nextSibling);}
    else{nav.appendChild(sales);nav.appendChild(cal);}
    sales.onclick=function(e){e.preventDefault();e.stopPropagation();go('sales');};
    cal.onclick=function(e){e.preventDefault();e.stopPropagation();go('calendar');};
  }
  function mark(view){
    document.querySelectorAll('.nav-item').forEach(function(b){b.classList.toggle('active',b.getAttribute('data-view')===view);});
  }
  function go(view){
    try{if(typeof state!=='undefined'){state.view=view;if(typeof save==='function')save();}}catch(e){}
    mark(view);renderView(view);
  }
  function head(title,sub,label){
    return '<div class="page-head"><div><div class="eyebrow">'+(label||'SALES CRM')+'</div><div class="title">'+title+'</div><div class="subtitle">'+sub+'</div></div><div class="date">Sep 7, 2026</div></div>';
  }
  function kpi(l,v,n){return '<div class="card kpi"><div class="kpi-top">'+l+'</div><div class="kpi-value">'+v+'</div><div class="kpi-note">'+n+'</div></div>';}

  function renderSales(){
    var open=db.orders.filter(function(o){return o.status!=='Paid'&&o.status!=='Cancelled';});
    var pipe=open.reduce(function(a,o){return a+total(o);},0);
    var html='<div class="page">'+head('Sales Orders','Quote, schedule, invoice, and collect work from one pipeline.','SALES')+
      '<div class="grid4">'+kpi('Open orders',open.length,'Not paid or cancelled')+kpi('Pipeline',money(pipe),'Open order value')+kpi('Paid',db.orders.filter(function(o){return o.pay==='Paid';}).length,'Collected')+kpi('Calendar',db.events.length,'Booked events')+'</div>'+
      '<div class="toolbar" style="display:flex;gap:8px;flex-wrap:wrap;margin:14px 0"><input id="soSearch" class="input" placeholder="Search orders..." style="flex:1"><select id="soFilter" class="input">'+['All'].concat(STATUSES).map(function(s){return '<option>'+s+'</option>';}).join('')+'</select><button class="primary" id="soNew">+ New order</button></div>'+
      '<div class="le-board">'+STATUSES.filter(function(s){return s!=='Cancelled';}).map(function(st){
        var items=db.orders.filter(function(o){return o.status===st;});
        return '<section class="le-col"><div class="le-col-h"><b>'+st+'</b><span>'+items.length+'</span></div>'+items.map(card).join('')+'</section>';
      }).join('')+'</div></div>';
    var el=document.getElementById('content');if(el)el.innerHTML=html;
    qs('#soNew').onclick=function(){editOrder(null);};
    var run=function(){
      var q=(qs('#soSearch').value||'').toLowerCase(),f=qs('#soFilter').value;
      document.querySelectorAll('.le-card').forEach(function(c){
        var t=c.getAttribute('data-text')||'',st=c.getAttribute('data-status');
        c.style.display=(t.indexOf(q)>=0&&(f==='All'||f===st))?'':'none';
      });
    };
    qs('#soSearch').oninput=run;qs('#soFilter').onchange=run;
    document.querySelectorAll('.le-card').forEach(function(c){c.onclick=function(){editOrder(c.getAttribute('data-id'));};});
  }
  function card(o){
    return '<button class="le-card" data-id="'+o.id+'" data-status="'+esc(o.status)+'" data-text="'+esc((o.number+' '+o.customer+' '+o.title+' '+o.status).toLowerCase())+'"><small>'+esc(o.number)+'</small><strong>'+esc(o.customer)+'</strong><span>'+esc(o.title)+'</span><b>'+money(total(o))+(o.due?' · '+o.due:'')+'</b></button>';
  }
  function editOrder(id){
    var o=id?db.orders.filter(function(x){return x.id===id;})[0]:null;
    var wrap=document.createElement('div');wrap.className='sales-modal-wrap';wrap.id='leOrderModal';
    var items=o&&o.items&&o.items.length?o.items.slice():[{name:'',qty:1,price:0}];
    wrap.innerHTML='<div class="sales-modal" style="max-width:680px"><div class="sales-modal-head"><div><div class="eyebrow">SALES ORDER</div><h2>'+(o?esc(o.number):'New order')+'</h2></div><button class="sales-close">×</button></div>'+
      '<div class="audit-grid">'+
      '<div class="audit-field"><label>Customer</label><input id="soCust" value="'+esc(o?o.customer:'')+'"></div>'+
      '<div class="audit-field"><label>Title</label><input id="soTitle" value="'+esc(o?o.title:'')+'"></div>'+
      '<div class="audit-field"><label>Status</label><select id="soStatus">'+STATUSES.map(function(s){return '<option'+(o&&o.status===s?' selected':'')+'>'+s+'</option>';}).join('')+'</select></div>'+
      '<div class="audit-field"><label>Payment</label><select id="soPay">'+PAY.map(function(s){return '<option'+(o&&o.pay===s?' selected':'')+'>'+s+'</option>';}).join('')+'</select></div>'+
      '<div class="audit-field"><label>Due date</label><input id="soDue" type="date" value="'+(o&&o.due?o.due:'')+'"></div>'+
      '<div class="audit-field"><label>Schedule</label><input id="soWhen" type="datetime-local" value="'+(o&&o.when?o.when:'')+'"></div></div>'+
      '<div id="soLines"></div><button class="action secondary" id="soAddLine">Add line</button>'+
      '<div class="audit-foot"><strong id="soTot"></strong><span></span>'+(o?'<button class="action secondary" id="soDel">Delete</button>':'')+(o?'<button class="action secondary" id="soCal">Add to calendar</button>':'')+'<button class="primary" id="soSave">Save order</button></div></div>';
    document.body.appendChild(wrap);
    function paint(){
      qs('#soLines').innerHTML=items.map(function(it,i){return '<div class="le-line"><input data-k="name" data-i="'+i+'" placeholder="Item" value="'+esc(it.name)+'"><input data-k="qty" data-i="'+i+'" type="number" value="'+it.qty+'"><input data-k="price" data-i="'+i+'" type="number" value="'+it.price+'"><button data-del="'+i+'">×</button></div>';}).join('');
      var t=items.reduce(function(a,i){return a+(Number(i.qty)||0)*(Number(i.price)||0);},0)*1.07;
      qs('#soTot').textContent='Total '+money(t);
      qs('#soLines').querySelectorAll('input').forEach(function(inp){inp.oninput=function(){items[Number(inp.getAttribute('data-i'))][inp.getAttribute('data-k')]=inp.type==='number'?Number(inp.value):inp.value;paint();};});
      qs('#soLines').querySelectorAll('[data-del]').forEach(function(b){b.onclick=function(){items.splice(Number(b.getAttribute('data-del')),1);paint();};});
    }
    paint();
    qs('#soAddLine').onclick=function(){items.push({name:'',qty:1,price:0});paint();};
    qs('.sales-close',wrap).onclick=function(){wrap.remove();};
    wrap.onclick=function(e){if(e.target===wrap)wrap.remove();};
    qs('#soSave').onclick=function(){
      var rec={id:o?o.id:uid(),number:o?o.number:'SO-'+(1000+db.orders.length+1),customer:qs('#soCust').value||'Customer',title:qs('#soTitle').value||'Untitled',status:qs('#soStatus').value,pay:qs('#soPay').value,due:qs('#soDue').value,when:qs('#soWhen').value,tax:0.07,notes:o?o.notes:'',items:items.filter(function(i){return i.name;})};
      if(o)db.orders=db.orders.map(function(x){return x.id===o.id?rec:x;});else db.orders.unshift(rec);
      save(db);wrap.remove();toast('Order saved');renderSales();
    };
    if(qs('#soDel'))qs('#soDel').onclick=function(){db.orders=db.orders.filter(function(x){return x.id!==o.id;});save(db);wrap.remove();toast('Order deleted');renderSales();};
    if(qs('#soCal'))qs('#soCal').onclick=function(){
      var start=qs('#soWhen').value||(qs('#soDue').value?qs('#soDue').value+'T09:00':'');
      if(!start){toast('Set a schedule time first');return;}
      db.events.unshift({id:uid(),title:(qs('#soCust').value||'Customer')+' — '+(qs('#soTitle').value||'Job'),type:'Appointment',start:start,end:start,who:qs('#soCust').value,loc:'Shop'});
      save(db);toast('Added to calendar');
    };
  }

  function renderCal(){
    var now=new Date(2026,8,7);
    var month=window.__leCal||{y:now.getFullYear(),m:now.getMonth()};
    window.__leCal=month;
    var first=new Date(month.y,month.m,1);
    var start=new Date(first);start.setDate(1-((first.getDay()+6)%7));
    var days=[];for(var i=0;i<42;i++){var d=new Date(start);d.setDate(start.getDate()+i);days.push(d);}
    var selected=window.__leSel||now;window.__leSel=selected;
    function key(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
    var extra=db.orders.filter(function(o){return o.when||o.due;}).map(function(o){return {id:'so-'+o.id,title:o.number+' '+o.title,type:'Appointment',start:o.when||(o.due+'T09:00'),who:o.customer};});
    var all=db.events.concat(extra);
    var map={};all.forEach(function(ev){var k=(ev.start||'').slice(0,10);(map[k]=map[k]||[]).push(ev);});
    var selKey=key(selected);
    var list=map[selKey]||[];
    var html='<div class="page">'+head('Calendar','Appointments, sales-order dates, calls, and follow-ups.','SCHEDULE')+
      '<div style="display:flex;gap:8px;align-items:center;margin-bottom:14px"><button class="action secondary" id="calPrev">‹</button><strong>'+first.toLocaleString('en-US',{month:'long',year:'numeric'})+'</strong><button class="action secondary" id="calNext">›</button><button class="primary" id="calNew" style="margin-left:auto">+ New event</button></div>'+
      '<div class="two-col"><div class="card" style="padding:10px"><div class="le-week">'+['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(function(d){return '<div>'+d+'</div>';}).join('')+'</div><div class="le-grid">'+days.map(function(d){
        var k=key(d),evs=map[k]||[],inM=d.getMonth()===month.m;
        return '<button class="le-day'+(k===selKey?' on':'')+(inM?'':' dim')+'" data-day="'+k+'"><i>'+d.getDate()+'</i>'+evs.slice(0,3).map(function(e){return '<em>'+esc(e.title)+'</em>';}).join('')+'</button>';
      }).join('')+'</div></div><div class="card section-card"><div class="section-title">'+selected.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})+'</div><div class="section-sub">'+list.length+' scheduled</div>'+list.map(function(e){return '<div class="activity-row"><div class="act-ico">▦</div><div><strong>'+esc(e.title)+'</strong><small>'+esc(e.type)+(e.who?' · '+esc(e.who):'')+'</small></div>'+(String(e.id).indexOf('so-')===0?'':'<button class="link-btn" data-kill="'+e.id+'">Remove</button>')+'</div>';}).join('')+(list.length?'':'<p class="muted">Nothing scheduled.</p>')+'</div></div></div>';
    var el=document.getElementById('content');if(el)el.innerHTML=html;
    qs('#calPrev').onclick=function(){month.m--;if(month.m<0){month.m=11;month.y--;}renderCal();};
    qs('#calNext').onclick=function(){month.m++;if(month.m>11){month.m=0;month.y++;}renderCal();};
    qs('#calNew').onclick=function(){editEvent(selKey);};
    document.querySelectorAll('.le-day').forEach(function(b){b.onclick=function(){var p=b.getAttribute('data-day').split('-');window.__leSel=new Date(Number(p[0]),Number(p[1])-1,Number(p[2]));renderCal();};});
    document.querySelectorAll('[data-kill]').forEach(function(b){b.onclick=function(){db.events=db.events.filter(function(e){return e.id!==b.getAttribute('data-kill');});save(db);renderCal();};});
  }
  function editEvent(day){
    var wrap=document.createElement('div');wrap.className='sales-modal-wrap';
    wrap.innerHTML='<div class="sales-modal"><div class="sales-modal-head"><h2>New event</h2><button class="sales-close">×</button></div><div class="audit-grid"><div class="audit-field"><label>Title</label><input id="evTitle"></div><div class="audit-field"><label>Type</label><select id="evType">'+TYPES.map(function(t){return '<option>'+t+'</option>';}).join('')+'</select></div><div class="audit-field"><label>Customer</label><input id="evWho"></div><div class="audit-field"><label>Start</label><input id="evStart" type="datetime-local" value="'+day+'T09:00"></div></div><div class="audit-foot"><button class="primary" id="evSave">Save event</button></div></div>';
    document.body.appendChild(wrap);
    qs('.sales-close',wrap).onclick=function(){wrap.remove();};
    qs('#evSave').onclick=function(){
      if(!qs('#evTitle').value){toast('Add a title');return;}
      db.events.unshift({id:uid(),title:qs('#evTitle').value,type:qs('#evType').value,start:qs('#evStart').value,end:qs('#evStart').value,who:qs('#evWho').value,loc:''});
      save(db);wrap.remove();toast('Event saved');renderCal();
    };
  }
  function renderView(view){if(view==='sales')renderSales();else if(view==='calendar')renderCal();}

  function hook(){
    addNav();
    if(window.LE&&LE.setView&&!LE.__salesHooked){
      var orig=LE.setView.bind(LE);
      LE.setView=function(v){if(v==='sales'||v==='calendar'){go(v);return;}orig(v);mark(v);};
      LE.__salesHooked=true;
    }
    document.querySelectorAll('.nav-item').forEach(function(b){
      var v=b.getAttribute('data-view');
      if(v==='sales'||v==='calendar')return;
      b.addEventListener('click',function(){mark(v);});
    });
  }
  function styles(){
    if(qs('#le-crm-style'))return;
    var s=document.createElement('style');s.id='le-crm-style';s.textContent='.le-board{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}.le-col{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:10px;min-height:220px}.le-col-h{display:flex;justify-content:space-between;color:#8fa4ba;font-size:12px;margin-bottom:8px}.le-card{display:block;width:100%;text-align:left;background:#0b1822;border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:10px;margin-bottom:8px;color:inherit;cursor:pointer}.le-card small{display:block;color:#8fa4ba;font-size:10px}.le-card strong,.le-card span,.le-card b{display:block}.le-card b{margin-top:6px}.le-week,.le-grid{display:grid;grid-template-columns:repeat(7,1fr)}.le-week{color:#8fa4ba;font-size:11px;padding:6px}.le-day{min-height:88px;border:1px solid rgba(255,255,255,.06);background:transparent;color:inherit;text-align:left;padding:6px;cursor:pointer}.le-day.dim{opacity:.45}.le-day.on{outline:2px solid #2bb3a3}.le-day i{display:block;font-style:normal;font-size:12px}.le-day em{display:block;font-style:normal;font-size:10px;background:#14343a;color:#7ee0d2;border-radius:6px;padding:2px 4px;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.le-line{display:grid;grid-template-columns:1fr 70px 90px 28px;gap:6px;margin:6px 0}.le-line input,.audit-field select,.audit-field input{width:100%;background:#0b1822;border:1px solid rgba(255,255,255,.12);color:#e8f1f6;border-radius:8px;padding:8px}';
    document.head.appendChild(s);
  }
  function boot(){styles();hook();setTimeout(hook,400);setTimeout(hook,1200);}
  window.LESalesCRM={go:go,renderSales:renderSales,renderCal:renderCal};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
