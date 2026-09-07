/* Loose Ends V3.1 — stable standalone runtime */
(function () {
  'use strict';

  var opportunities = [
    {id:1,type:'Declined Work',cls:'red',customer:'Angela Brooks',phone:'(304) 555-0771',vehicle:'2017 RAM 1500',amount:1680,priority:'High',source:'Declined work',reason:'Recommended repair was declined at the last visit.',next:'Call today and offer two appointment windows.',message:'Hi Angela, this is Riverside Auto Repair. We wanted to follow up on the work we recommended.'},
    {id:2,type:'Declined Work',cls:'red',customer:'Sarah Miller',phone:'(304) 555-0134',vehicle:'2021 Chevrolet Silverado',amount:1240,priority:'High',source:'Declined work',reason:'Brake and rotor recommendation was declined.',next:'Call and offer a priority appointment.',message:'Hi Sarah, we wanted to follow up on the brake work we recommended at your last visit.'},
    {id:3,type:'Missed Call',cls:'purple',customer:'Robert Wilson',phone:'(304) 555-0623',vehicle:'2020 Ford Explorer',amount:1100,priority:'High',source:'Missed call',reason:'Caller could not be reached after an unanswered call.',next:'Call back within business hours.',message:'Hi Robert, this is Riverside Auto Repair returning your call.'},
    {id:4,type:'Dormant Customer',cls:'blue',customer:'Lisa Reynolds',phone:'(304) 555-0412',vehicle:'2016 Honda CR-V',amount:920,priority:'Medium',source:'Customer history',reason:'High-value customer has not returned in 14 months.',next:'Send reactivation text with a service reminder.',message:'Hi Lisa, it’s Riverside Auto Repair. We haven’t seen your CR-V in a while.'},
    {id:5,type:'Overdue Service',cls:'amber',customer:'James Carter',phone:'(304) 555-0276',vehicle:'2018 Jeep Wrangler',amount:680,priority:'Medium',source:'Service interval',reason:'Customer is beyond the recommended service window.',next:'Send service reminder and booking options.',message:'Hi James, Riverside Auto Repair here. Your Jeep is due for its next service.'}
  ];

  var customers = [
    ['Angela Brooks','2017 RAM 1500','$1,680','6 days ago','94'],
    ['Sarah Miller','2021 Chevrolet Silverado','$1,240','8 days ago','89'],
    ['Robert Wilson','2020 Ford Explorer','$1,100','3 days ago','91'],
    ['Lisa Reynolds','2016 Honda CR-V','$920','47 days ago','74'],
    ['James Carter','2018 Jeep Wrangler','$680','21 days ago','78'],
    ['David Harris','2022 Toyota Tacoma','$740','2 days ago','86']
  ];

  var KEY = 'loose_ends_v31_state';
  var state = {view:'overview',query:'',opps:opportunities.slice(),recovered:0,activities:[],followUps:[]};
  var content;

  function money(n){ return '$' + Number(n || 0).toLocaleString(); }
  function escapeHtml(s){ return String(s == null ? '' : s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }

  function load(){
    try {
      var saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if(saved && typeof saved === 'object'){
        state.view = saved.view || 'overview';
        state.query = saved.query || '';
        state.opps = Array.isArray(saved.opps) ? saved.opps : opportunities.slice();
        state.recovered = Number(saved.recovered || 0);
        state.activities = Array.isArray(saved.activities) ? saved.activities : [];
        state.followUps = Array.isArray(saved.followUps) ? saved.followUps : [];
      }
    } catch(e) { state = {view:'overview',query:'',opps:opportunities.slice(),recovered:0,activities:[],followUps:[]}; }
    if(['overview','loose','customers','recovery','intelligence','settings'].indexOf(state.view) < 0) state.view='overview';
  }

  function save(){ try { localStorage.setItem(KEY,JSON.stringify(state)); } catch(e) {} }
  function toast(msg){ var el=document.getElementById('toast'); if(!el)return; el.textContent=msg; el.className='toast show'; setTimeout(function(){el.className='toast';},2200); }
  function findOpp(id){ for(var i=0;i<state.opps.length;i++) if(Number(state.opps[i].id)===Number(id)) return state.opps[i]; return null; }
  function activeCount(){ return 46 + state.opps.length - 5; }

  function head(title,sub,label){
    return '<div class="page-head"><div><div class="eyebrow">'+(label || 'REVENUE RECOVERY')+'</div><div class="title">'+title+'</div><div class="subtitle">'+sub+'</div></div><div class="date">Sep 7, 2026 · Last 30 days</div></div>';
  }
  function kpi(label,value,note,trend,icon,amber){
    return '<div class="card kpi"><div class="kpi-top"><div class="kpi-icon">'+icon+'</div>'+label+'</div><div class="kpi-value">'+value+'</div><div class="kpi-note">'+note+'</div><div class="trend '+(amber?'amber':'')+'">'+trend+'</div></div>';
  }

  function dashboard(){
    var open=state.opps.reduce(function(a,o){return a+Number(o.amount||0);},0);
    var recoverable=23050;
    var recovered=11270+state.recovered;
    return '<div class="page">'+head('Dashboard','Your business at a glance. See what’s at risk, what’s been recovered, and what to do next.')+
      '<div class="grid4">'+
      kpi('Recoverable revenue',money(recoverable),'Estimated revenue from open opportunities','↗ 12% vs. last 30 days','◉')+
      kpi('Revenue recovered',money(recovered),'Actual revenue brought back','↗ 28% vs. last 30 days','✓')+
      kpi('Active loose ends','46','Open opportunities across all categories','↘ 6% vs. last 30 days','⌁',true)+
      kpi('Recovery rate','32.8%','Recovered vs. total opportunity value','↗ 11% vs. last 30 days','◎')+
      '</div><div class="two-col"><div class="card section-card"><div class="section-head"><div><div class="section-title">Loose Ends queue</div><div class="section-sub">Highest-value opportunities, ranked by potential revenue.</div></div><button class="link-btn" onclick="LE.setView(\'loose\')">View all →</button></div>'+state.opps.slice(0,5).map(row).join('')+'</div>'+sideActions()+'</div>'+analytics(open)+'</div>';
  }

  function row(o){
    return '<div class="opp-row"><div><span class="type '+escapeHtml(o.cls)+'">'+escapeHtml(o.type)+'</span></div><div><div class="customer-name">'+escapeHtml(o.customer)+'</div><div class="customer-meta">'+escapeHtml(o.phone)+' · '+escapeHtml(o.vehicle)+'</div></div><div></div><div class="amount">'+money(o.amount)+'</div><div><span class="priority '+(o.priority==='High'?'high':'medium')+'">'+o.priority+'</span></div><button class="action" onclick="LE.openOpp('+o.id+')">Take action</button></div>';
  }

  function sideActions(){
    var actions=[['☎','Make a call','High-value customers waiting','8','call'],['▣','Send a text','Fast, easy follow-ups','15','text'],['✉','Send an email','Re-engage with a written offer','25','email'],['◷','Set reminders','Never let a follow-up slip','12','schedule']];
    return '<div class="side-stack"><div class="card section-card"><div class="section-head"><div><div class="section-title">Next best actions</div><div class="section-sub">Quick actions to recover revenue fast.</div></div></div><div class="action-list">'+actions.map(function(a){return '<div class="action-card" onclick="LE.queue(\''+a[4]+'\')"><div class="action-ico">'+a[0]+'</div><div><strong>'+a[1]+'</strong><small>'+a[2]+'</small></div><span class="mini-number">'+a[3]+'</span></div>';}).join('')+'</div></div><div class="card section-card"><div class="section-head"><div class="section-title">Recent activity</div></div><div class="activity">'+activityRows()+'</div></div></div>';
  }

  function activityRows(){
    var a=state.activities.slice(0,3);
    var seed=[['☎','Call completed','Sarah Miller — Declined Brake Job','2h ago'],['✓','Estimate accepted','David Harris — Transmission Service','4h ago'],['▣','Text sent','Lisa Reynolds — Dormant Customer','5h ago'],['◷','Follow up scheduled','James Carter — Overdue Service','6h ago']];
    var all=a.map(function(x){return [x.icon,x.title,x.detail,'now'];}).concat(seed);
    return all.slice(0,5).map(function(x){return '<div class="activity-row"><div class="act-ico">'+x[0]+'</div><div><strong>'+x[1]+'</strong><small>'+x[2]+'</small></div><time>'+x[3]+'</time></div>';}).join('');
  }

  function analytics(open){
    return '<div class="analytics"><div class="card section-card"><div class="section-head"><div><div class="section-title">Where money is leaking</div><div class="section-sub">Top categories of lost revenue (last 30 days)</div></div></div><div class="donut-wrap"><div class="donut"></div><div class="legend">'+[['#ff6868','Declined Work','$7,800','30%'],['#f6b94a','Unsold Estimates','$6,400','25%'],['#ffd369','Overdue Services','$4,200','16%'],['#4d9cff','Dormant Customers','$3,600','14%'],['#9d73ff','Missed Calls / Inquiries','$2,900','11%'],['#56d9b1','Other','$1,000','4%']].map(function(x){return '<div><span><i class="dot" style="background:'+x[0]+'"></i>'+x[1]+'</span><span>'+x[2]+'　'+x[3]+'</span></div>';}).join('')+'</div></div></div><div class="card section-card"><div class="section-head"><div><div class="section-title">Recovery pipeline</div><div class="section-sub">From first contact to closed revenue</div></div></div><div class="pipeline"><div class="pipe"><div class="pipe-head"><span>Open opportunity</span><span>$23,050</span></div><div class="bar"><span style="width:100%"></span></div></div><div class="pipe"><div class="pipe-head"><span>Contacted</span><span>$16,420</span></div><div class="bar"><span style="width:60%"></span></div></div><div class="pipe"><div class="pipe-head"><span>In progress</span><span>$8,760</span></div><div class="bar"><span style="width:38%"></span></div></div><div class="pipe"><div class="pipe-head"><span>Recovered</span><span>$11,270</span></div><div class="bar"><span style="width:32.8%"></span></div></div></div></div></div>';
  }

  function loose(){
    var list=state.opps.slice().filter(function(o){return JSON.stringify(o).toLowerCase().indexOf(state.query.toLowerCase())>=0;}).sort(function(a,b){return b.amount-a.amount;});
    return '<div class="page">'+head('Loose Ends Queue','Every recoverable opportunity, ranked by value, urgency, and next action.','FIND → PRIORITIZE → RECOVER')+'<div class="card recovery-banner"><div><div class="eyebrow">RECOVER TODAY</div><strong>'+money(list.reduce(function(a,o){return a+o.amount;},0))+'</strong><span>'+list.length+' open opportunities match your current view</span></div><button class="primary" onclick="LE.openOpp('+(list[0]?list[0].id:1)+')">Start with highest value →</button></div><div class="toolbar"><input id="queueSearch" class="input" placeholder="Search loose ends..." value="'+escapeHtml(state.query)+'"></div><div class="queue">'+list.map(function(o){return '<div class="card queue-card '+(o.priority==='Medium'?'medium':'')+'"><div class="priority-strip"></div><div class="queue-main"><h3>'+escapeHtml(o.type)+' · '+escapeHtml(o.customer)+'</h3><p>'+escapeHtml(o.reason)+'</p><div class="queue-meta"><span>'+escapeHtml(o.vehicle)+'</span><span>'+escapeHtml(o.source)+'</span></div></div><div class="queue-value"><strong>'+money(o.amount)+'</strong><small>'+o.priority+' priority</small><button class="action" onclick="LE.openOpp('+o.id+')">Review opportunity</button></div></div>';}).join('')+'</div></div>';
  }

  function customerView(){
    return '<div class="page">'+head('Customers','See customer history, open opportunities, and recovery scores in one place.')+'<div class="card"><div class="section-head"><div><div class="section-title">Customer health</div><div class="section-sub">Sorted by Loose Ends Score</div></div></div><table class="customer-table"><thead><tr><th>Customer</th><th>Vehicle</th><th>Open value</th><th>Last visit</th><th>Score</th><th></th></tr></thead><tbody>'+customers.map(function(c,i){var o=state.opps.filter(function(x){return x.customer===c[0];})[0];return '<tr onclick="LE.customer('+i+')"><td><strong>'+c[0]+'</strong></td><td>'+c[1]+'</td><td>'+(o?money(o.amount):'$0')+'</td><td>'+c[3]+'</td><td><span class="score">'+c[4]+'/100</span></td><td><button class="action" onclick="event.stopPropagation();LE.customer('+i+')">View</button></td></tr>';}).join('')+'</tbody></table></div></div>';
  }

  function recovery(){ return '<div class="page">'+head('Recovery Center','Turn opportunities into conversations, appointments, and recovered revenue.')+'<div class="grid4">'+kpi('In follow-up','28','Active customer conversations','↗ 14% this week','↻')+kpi('Appointments booked','11','From recovery activity','↗ 22% this week','✓')+kpi('Recovered revenue',money(11270+state.recovered),'Closed opportunities','↗ 28% this month','$')+kpi('Avg. recovery','4.6 days','Opportunity → recovered','↘ 0.8 days','◷')+'</div><div class="recovery-grid" style="margin-top:14px"><div class="card sequence"><div class="section-title">Active recovery sequences</div><div class="section-sub">Automated and manual follow-up actions</div>'+state.opps.slice(0,4).map(function(o,i){return '<div class="step"><div class="step-num">'+(i+1)+'</div><div><h4>'+o.customer+'</h4><p>'+o.type+' · '+money(o.amount)+' · '+o.next+'</p></div><span class="status">In progress</span></div>';}).join('')+'</div><div class="card sequence"><div class="section-title">Recovery playbook</div><div class="section-sub">Recommended cadence for your shop</div><div class="step"><div class="step-num">1</div><div><h4>Immediate response</h4><p>High-value opportunities get a call first.</p></div></div><div class="step"><div class="step-num">2</div><div><h4>24-hour follow-up</h4><p>Send a concise text with a clear next step.</p></div></div><div class="step"><div class="step-num">3</div><div><h4>7-day reactivation</h4><p>Revisit dormant and declined opportunities.</p></div></div></div></div></div>'; }

  function intelligence(){ var cards=[['$25,900','Revenue at risk'],['$7,800','Declined work'],['$6,400','Unsold estimates'],['$4,200','Overdue service'],['32.8%','Recovery rate'],['4.6 days','Time to recover']]; return '<div class="page">'+head('Revenue Intelligence','Understand where revenue is leaking, why it is happening, and what to do today.','INTELLIGENCE')+'<div class="insights">'+cards.map(function(c){return '<div class="card insight"><div class="big">'+c[0]+'</div><h3>'+c[1]+'</h3><p>Use this signal to prioritize the next recovery action and keep existing customer revenue from going cold.</p><button class="action" onclick="LE.queue(\'call\')">Act on this</button></div>';}).join('')+'</div></div>'; }

  function settings(){ return '<div class="page">'+head('Settings','Configure your business, recovery rules, and demo environment.')+'<div class="card settings"><div class="setting-row"><div><strong>Demo mode</strong><p>Use sample shop data for presentations and testing.</p></div><button class="toggle on"></button></div><div class="setting-row"><div><strong>High-value alerts</strong><p>Flag opportunities over $1,000 immediately.</p></div><button class="toggle on"></button></div><div class="setting-row"><div><strong>Automatic follow-up suggestions</strong><p>Generate the next best action for every loose end.</p></div><button class="toggle on"></button></div><div class="setting-row"><div><strong>Business</strong><p>Riverside Auto Repair · Parkersburg, WV</p></div><button class="action secondary" onclick="LE.business()">Edit</button></div><div class="setting-row"><div><strong>Reset demo data</strong><p>Return the app to its starting state.</p></div><button class="action secondary" onclick="LE.reset()">Reset</button></div></div></div>'; }

  function openOpp(id){ var o=findOpp(id); if(!o)return; var d=document.querySelector('.drawer'); if(!d)return; d.innerHTML='<div class="drawer-head"><div class="eyebrow">LOOSE END #'+o.id+'</div><button class="close" onclick="LE.close()">×</button></div><h2>'+escapeHtml(o.customer)+'</h2><div class="muted">'+escapeHtml(o.vehicle)+' · '+escapeHtml(o.phone)+'</div><div class="detail-amount">'+money(o.amount)+'</div><div class="detail-grid"><div class="detail-box"><label>Opportunity</label><strong>'+escapeHtml(o.type)+'</strong></div><div class="detail-box"><label>Priority</label><strong>'+o.priority+'</strong></div><div class="detail-box"><label>Source</label><strong>'+escapeHtml(o.source)+'</strong></div><div class="detail-box"><label>Status</label><strong>Open</strong></div></div><div class="recommend"><b>✦ NEXT BEST ACTION</b><p>'+escapeHtml(o.next)+'</p></div><div class="detail-box"><label>Why this is a loose end</label><strong style="line-height:1.5">'+escapeHtml(o.reason)+'</strong></div><div style="margin-top:14px"><div class="muted" style="margin-bottom:7px">Suggested message</div><div class="message">'+escapeHtml(o.message)+'</div></div><div class="drawer-actions"><button onclick="LE.recover('+o.id+')">Mark recovered</button><button class="secondary" onclick="LE.contact('+o.id+',\'call\')">☎ Call</button><button class="secondary" onclick="LE.contact('+o.id+',\'text\')">▣ Text</button><button class="secondary" onclick="LE.schedule('+o.id+')">◷ Schedule</button></div>'; document.getElementById('drawer').classList.remove('hidden'); }

  function close(){document.getElementById('drawer').classList.add('hidden');}
  function contact(id,method){var o=findOpp(id);if(!o)return;state.activities.unshift({icon:method==='call'?'☎':'▣',title:method==='call'?'Call initiated':'Text draft opened',detail:o.customer+' — '+o.type});save();toast(method==='call'?'Call initiated':'Text draft opened');if(method==='call')window.location.href='tel:'+o.phone.replace(/[^\d+]/g,'');if(method==='text')window.location.href='sms:'+o.phone.replace(/[^\d+]/g,'')+'?body='+encodeURIComponent(o.message);}
  function recover(id){var o=findOpp(id);if(!o)return;state.recovered+=Number(o.amount);state.opps=state.opps.filter(function(x){return x.id!==o.id;});state.activities.unshift({icon:'$',title:'Revenue recovered',detail:o.customer+' — '+money(o.amount)});save();close();toast(money(o.amount)+' marked recovered');render();}
  function schedule(id){var o=findOpp(id);if(!o)return;var when=prompt('When should we follow up?','Tomorrow at 9:00 AM');if(when===null)return;state.followUps.unshift({customer:o.customer,when:when});state.activities.unshift({icon:'◷',title:'Follow up scheduled',detail:o.customer+' — '+when});save();toast('Follow-up scheduled');}
  function queue(kind){var o=state.opps.slice().sort(function(a,b){return b.amount-a.amount;})[0];if(!o){toast('No open opportunities');return;}if(kind==='schedule')schedule(o.id);else if(kind==='email')toast('Email task queued for '+o.customer);else contact(o.id,kind);}
  function customer(i){var c=customers[i],o=null;for(var j=0;j<state.opps.length;j++){if(state.opps[j].customer===c[0]){o=state.opps[j];break;}}var d=document.querySelector('.drawer');d.innerHTML='<div class="drawer-head"><div class="eyebrow">CUSTOMER PROFILE</div><button class="close" onclick="LE.close()">×</button></div><h2>'+c[0]+'</h2><div class="muted">'+c[1]+'</div><div class="profile-score"><span>Loose Ends Score</span><strong>'+c[4]+'<small>/100</small></strong></div><div class="detail-grid"><div class="detail-box"><label>Open opportunity</label><strong>'+(o?money(o.amount):'$0')+'</strong></div><div class="detail-box"><label>Last visit</label><strong>'+c[3]+'</strong></div></div><div class="recommend"><b>✦ RECOVERY OPPORTUNITY</b><p>'+(o?o.reason:'No open loose end. Customer is currently clear.')+'</p></div><div class="drawer-actions">'+(o?'<button onclick="LE.openOpp('+o.id+')">Open opportunity</button><button class="secondary" onclick="LE.contact('+o.id+',\'call\')">☎ Call</button>':'<button class="secondary" onclick="LE.close()">Close</button>')+'</div>';document.getElementById('drawer').classList.remove('hidden');}
  function business(){var n=prompt('Business name','Riverside Auto Repair');if(n===null)return;toast('Business settings saved');}
  function reset(){if(!confirm('Reset demo data?'))return;state={view:'overview',query:'',opps:opportunities.slice(),recovered:0,activities:[],followUps:[]};save();toast('Demo reset');render();}
  function setView(v){state.view=v;save();render();window.scrollTo(0,0);}

  function render(){
    var map={overview:dashboard,loose:loose,customers:customerView,recovery:recovery,intelligence:intelligence,settings:settings};
    if(!content)return;
    try { content.innerHTML=(map[state.view]||dashboard)(); }
    catch(e){ content.innerHTML='<div class="page">'+head('Dashboard','Your business at a glance.')+'<div class="card" style="padding:24px"><strong>Dashboard recovered.</strong><p class="subtitle">Please refresh once to continue.</p></div></div>'; }
    document.querySelectorAll('.nav-item').forEach(function(n){n.classList.toggle('active',n.getAttribute('data-view')===state.view);});
    var q=document.getElementById('queueSearch');
    if(q)q.addEventListener('input',function(){state.query=q.value;save();render();});
  }

  window.LE={setView:setView,openOpp:openOpp,close:close,contact:contact,recover:recover,schedule:schedule,queue:queue,customer:customer,business:business,reset:reset};
  window.setView=setView;
  load();
  content=document.getElementById('content');
  if(content){
    document.querySelectorAll('.nav-item').forEach(function(n){n.addEventListener('click',function(){setView(n.getAttribute('data-view'));});});
    var search=document.getElementById('globalSearch');
    if(search)search.addEventListener('input',function(){state.query=search.value;if(search.value){state.view='loose';save();render();}});
    var backdrop=document.querySelector('.backdrop'); if(backdrop)backdrop.addEventListener('click',close);
    render();
  }
})();