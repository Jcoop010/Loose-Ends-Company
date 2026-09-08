/* Loose Ends SMB OS — universal small-business configuration layer.
 * Keeps the core product horizontal: business type changes the context, not the data model.
 */
(function () {
  'use strict';

  var KEY = 'loose_ends_smb_profile_v1';
  var TYPES = [
    ['general','General business'],['professional','Professional services'],['home','Home services / trades'],
    ['health','Health & wellness'],['beauty','Beauty & personal care'],['retail','Retail / e-commerce'],
    ['hospitality','Hospitality / food'],['automotive','Automotive'],['creative','Creative / agency'],
    ['education','Education / coaching'],['realestate','Real estate / property'],['nonprofit','Nonprofit / community']
  ];
  var DEFAULT = {name:'Your Business', type:'general', owner:'Owner'};
  var state = load();

  function load(){ try { return Object.assign({}, DEFAULT, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch(e){ return Object.assign({}, DEFAULT); } }
  function save(){ try { localStorage.setItem(KEY, JSON.stringify(state)); } catch(e){} }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c];}); }
  function initials(s){ return String(s || 'YB').trim().split(/\s+/).slice(0,2).map(function(x){return x.charAt(0);}).join('').toUpperCase() || 'YB'; }
  function typeName(){ for(var i=0;i<TYPES.length;i++) if(TYPES[i][0]===state.type) return TYPES[i][1]; return 'General business'; }
  function toast(m){ var el=document.getElementById('toast'); if(!el)return; el.textContent=m; el.className='toast show'; setTimeout(function(){el.className='toast';},2200); }

  function style(){
    if(document.getElementById('smb-os-css')) return;
    var s=document.createElement('style'); s.id='smb-os-css'; s.textContent=
      '.smb-profile{margin-top:14px;padding:18px;border:1px solid rgba(86,217,177,.22);border-radius:16px;background:linear-gradient(180deg,rgba(86,217,177,.08),rgba(255,255,255,.02))}' +
      '.smb-profile h3{margin:0 0 4px;font:800 18px/1.2 system-ui}.smb-profile p{margin:0 0 14px;color:#8fa4ba;font:500 12px/1.45 system-ui}' +
      '.smb-profile-grid{display:grid;grid-template-columns:1.3fr 1fr;gap:10px}.smb-profile label{display:block;font:800 10px/1 system-ui;letter-spacing:.08em;text-transform:uppercase;color:#8fa4ba}.smb-profile input,.smb-profile select{width:100%;box-sizing:border-box;margin-top:6px;padding:11px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:#071017;color:#e8f1f6}.smb-profile button{margin-top:12px;border:0;border-radius:10px;padding:11px 14px;background:#56d9b1;color:#062019;font:800 12px system-ui;cursor:pointer}' +
      '@media(max-width:700px){.smb-profile-grid{grid-template-columns:1fr}}';
    document.head.appendChild(s);
  }

  function apply(){
    document.title='Loose Ends — Small Business OS';
    var tag=document.querySelector('.brand-tag'); if(tag) tag.textContent='Small business operating system';
    var btn=document.getElementById('businessSwitcher'); if(btn) btn.innerHTML=esc(state.name)+' <small>'+esc(state.owner)+'</small>⌄';
    var av=document.getElementById('businessAvatar'); if(av) av.textContent=initials(state.name);
    var demo=document.querySelector('.demo-note'); if(demo) demo.innerHTML='WORKSPACE PROFILE<br><span>'+esc(typeName())+' · '+esc(state.name)+'</span>';
  }

  function settingsPanel(){
    var page=document.querySelector('#content .page'); if(!page || document.getElementById('smbProfile')) return;
    style();
    var box=document.createElement('section'); box.className='smb-profile'; box.id='smbProfile';
    box.innerHTML='<h3>Business profile</h3><p>Loose Ends is designed to work across industries. Choose the business context you want the workspace to use; the underlying customer, sales, work, payment, and recovery records stay universal.</p>'+
      '<div class="smb-profile-grid"><label>Business name<input id="smbName" maxlength="80" value="'+esc(state.name)+'"></label><label>Business type<select id="smbType">'+TYPES.map(function(t){return '<option value="'+t[0]+'"'+(t[0]===state.type?' selected':'')+'>'+t[1]+'</option>';}).join('')+'</select></label></div>'+
      '<button type="button" id="smbSave">Save business profile</button>';
    page.appendChild(box);
    document.getElementById('smbSave').onclick=function(){
      state.name=(document.getElementById('smbName').value||'Your Business').trim();
      state.type=document.getElementById('smbType').value||'general'; save(); apply(); toast('Business profile saved');
    };
  }

  function boot(){
    apply();
    var oldSetView=window.LE && window.LE.setView;
    if(oldSetView && !oldSetView.__smbWrapped){
      var wrapped=function(v){ oldSetView(v); setTimeout(function(){ if(v==='settings') settingsPanel(); apply(); },50); };
      wrapped.__smbWrapped=true; window.LE.setView=wrapped;
    }
    var nav=document.querySelectorAll('.nav-item[data-view="settings"]');
    nav.forEach(function(n){ n.addEventListener('click',function(){ setTimeout(settingsPanel,80); }); });
    setTimeout(function(){ if((window.LE && LE.state && LE.state.view==='settings')) settingsPanel(); apply(); },100);
  }

  window.LESmbOS={getProfile:function(){return Object.assign({},state);},getBusinessType:function(){return state.type;},getBusinessTypeName:typeName,saveProfile:function(p){state=Object.assign({},state,p||{});save();apply();}};
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
})();