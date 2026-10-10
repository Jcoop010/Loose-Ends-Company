/* Keep the walk-in Sales + Calendar demo universal and current-dated. */
(function(){
  'use strict';
  if(location.pathname!=='/demo'&&location.search.indexOf('demo=1')<0)return;
  function boot(){
    if(!window.LESalesCRM||!window.LESalesCRM.setData)return;
    var now=new Date();
    function day(offset){var d=new Date(now);d.setDate(d.getDate()+offset);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
    function dt(offset,hour){return day(offset)+'T'+String(hour||9).padStart(2,'0')+':00';}
    window.__LE_SALES_SYNCING=true;
    window.LESalesCRM.setData({orders:[
      {id:'demo-so1',number:'SO-1001',customer:'Willow Creek Landscaping',title:'Seasonal maintenance project',status:'In Progress',pay:'Partial',due:day(1),when:dt(1,9),tax:0,notes:'Site visit',items:[{name:'Crew labor',qty:4,price:75},{name:'Materials',qty:1,price:180}]},
      {id:'demo-so2',number:'SO-1002',customer:'Morgan Ellis',title:'Service quote follow-up',status:'Quoted',pay:'Unpaid',due:day(2),when:'',tax:0,notes:'',items:[{name:'Project estimate',qty:1,price:640}]},
      {id:'demo-so3',number:'SO-1003',customer:'Riverbend Studio',title:'Website refresh',status:'Confirmed',pay:'Unpaid',due:day(3),when:dt(3,13),tax:0,notes:'Kickoff call',items:[{name:'Design and setup',qty:1,price:950}]},
      {id:'demo-so4',number:'SO-1004',customer:'Pine Street Market',title:'Monthly service invoice',status:'Invoiced',pay:'Partial',due:day(-2),when:'',tax:0,notes:'Balance due',items:[{name:'Monthly support',qty:1,price:420}]},
      {id:'demo-so5',number:'SO-1005',customer:'Taylor Bennett',title:'Completed project',status:'Paid',pay:'Paid',due:day(-4),when:'',tax:0,notes:'',items:[{name:'Project delivery',qty:1,price:780}]}
    ],events:[
      {id:'demo-ev1',title:'Willow Creek project kickoff',type:'Appointment',start:dt(1,9),end:dt(1,10),who:'Willow Creek Landscaping',loc:'Client site'},
      {id:'demo-ev2',title:'Follow up on service quote',type:'Follow-up',start:dt(2,11),end:dt(2,11),who:'Morgan Ellis',loc:''},
      {id:'demo-ev3',title:'Riverbend Studio project call',type:'Call',start:dt(3,13),end:dt(3,14),who:'Riverbend Studio',loc:'Video call'}
    ]});
    window.__LE_SALES_SYNCING=false;
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){setTimeout(boot,0)});else boot();
})();