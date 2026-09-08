/* Loose Ends closer: make the first screen sell recovered jobs, not software. */
(function () {
  'use strict';
  var KEY = 'loose_ends_closer_v1';
  var jobs = [
    {name:'Angela Brooks',phone:'3045550771',vehicle:'2017 RAM 1500',why:'Declined brake job',amount:1680,script:'Hi Angela, this is Riverside Auto Repair. We still have the brake work reserved if you want a morning or afternoon drop-off this week.'},
    {name:'Sarah Miller',phone:'3045550134',vehicle:'2021 Silverado',why:'Declined rotors',amount:1240,script:'Hi Sarah, Riverside Auto Repair following up on the brake and rotor work. We can get you in this week if you want it done.'},
    {name:'Robert Wilson',phone:'3045550623',vehicle:'2020 Explorer',why:'Missed call',amount:1100,script:'Hi Robert, Riverside Auto Repair returning your call. We have two inspection windows left today.'},
    {name:'Lisa Reynolds',phone:'3045550412',vehicle:'2016 CR-V',why:'Gone 14 months',amount:920,script:'Hi Lisa, it\'s Riverside Auto Repair. We have not seen the CR-V in a while and wanted to hold a service spot for you.'},
    {name:'James Carter',phone:'3045550276',vehicle:'2018 Wrangler',why:'Overdue service',amount:680,script:'Hi James, Riverside Auto Repair. Your Jeep is past the service window. Want morning or afternoon?'}
  ];
  function qs(s, el) { return (el || document).querySelector(s); }
  function money(n) { return '$' + Math.round(Number(n || 0)).toLocaleString(); }
  function toast(m) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = m;
    el.className = 'toast show';
    setTimeout(function () { el.className = 'toast'; }, 2200);
  }
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null') || {won: 0, closed: []}; }
    catch (e) { return {won: 0, closed: []}; }
  }
  function save(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {} }
  var st = load();
  function openJobs() { return jobs.filter(function (j) { return st.closed.indexOf(j.phone) < 0; }); }
  function pool() { return openJobs().reduce(function (a, j) { return a + j.amount; }, 0); }
  function css() {
    if (qs('#le-closer-css')) return;
    var s = document.createElement('style');
    s.id = 'le-closer-css';
    s.textContent = ''
      + '.le-close{margin:0 0 16px;padding:18px;border-radius:20px;background:linear-gradient(180deg,#10261f,#0b1822);border:1px solid rgba(86,217,177,.28);color:#e8f1f6}'
      + '.le-close-k{font:800 10px/1 system-ui;letter-spacing:.14em;text-transform:uppercase;color:#7ee0d2}'
      + '.le-close h2{margin:8px 0 4px;font:800 28px/1.1 system-ui}'
      + '.le-close p{margin:0 0 14px;color:#9db2c6;font:500 13px/1.45 system-ui}'
      + '.le-close-math{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:0 0 14px}'
      + '.le-close-math b{display:block;font-size:20px;margin-top:4px}'
      + '.le-close-math span{font:800 9px/1 system-ui;letter-spacing:.08em;text-transform:uppercase;color:#8fa4ba}'
      + '.le-close-math div{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:12px}'
      + '.le-job{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:12px;margin:8px 0;border-radius:14px;background:#071017;border:1px solid rgba(255,255,255,.08)}'
      + '.le-job small{display:block;color:#8fa4ba;margin-top:3px}'
      + '.le-job em{font-style:normal;color:#7ee0d2;font-weight:800}'
      + '.le-job-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}'
      + '.le-job-actions button,.le-close-offer button{border:0;border-radius:10px;padding:10px 12px;font:800 12px system-ui;cursor:pointer}'
      + '.le-btn-call{background:#56d9b1;color:#062019}'
      + '.le-btn-text{background:#14343a;color:#7ee0d2}'
      + '.le-btn-won{background:#fff;color:#071017}'
      + '.le-close-offer{margin-top:14px;padding:14px;border-radius:14px;background:rgba(86,217,177,.08);border:1px dashed rgba(86,217,177,.35)}'
      + '.le-close-offer strong{display:block;margin-bottom:6px}'
      + '.le-fab{position:fixed;right:16px;bottom:88px;z-index:850;background:#56d9b1;color:#062019;border:0;border-radius:999px;padding:14px 16px;font:800 13px system-ui;box-shadow:0 12px 30px rgba(0,0,0,.35);cursor:pointer}'
      + '@media(min-width:701px){.le-fab{bottom:24px}}'
      + '@media(max-width:700px){.le-close-math{grid-template-columns:1fr}.le-job{grid-template-columns:1fr}.le-job-actions{justify-content:stretch}.le-job-actions button{flex:1}}';
    document.head.appendChild(s);
  }
  function call(j) { window.location.href = 'tel:+1' + j.phone; toast('Calling ' + j.name); }
  function text(j) { window.location.href = 'sms:+1' + j.phone + '?body=' + encodeURIComponent(j.script); toast('Text ready for ' + j.name); }
  function won(j) {
    st.won += j.amount;
    st.closed.push(j.phone);
    save(st);
    toast(money(j.amount) + ' marked recovered');
    paint();
  }
  function book(j) {
    if (window.LESalesCRM && LESalesCRM.go) LESalesCRM.go('calendar');
    toast('Book ' + j.name + ' on the calendar');
  }
  function html() {
    var open = openJobs();
    var risk = pool();
    var months = Math.max(1, Math.floor((st.won || 1680) / 149));
    return '<section class="le-close" id="leCloser">'
      + '<div class="le-close-k">Why a shop cannot pass on this</div>'
      + '<h2>The money is already in your bays.</h2>'
      + '<p>Loose Ends does not sell software. It puts declined jobs, missed calls, and overdue service back on today\'s list. One recovered brake job pays for months.</p>'
      + '<div class="le-close-math">'
      + '<div><span>Sitting in this shop</span><b>' + money(risk + 11270) + '</b></div>'
      + '<div><span>Recovered in demo</span><b>' + money(11270 + st.won) + '</b></div>'
      + '<div><span>One $1,680 job covers</span><b>' + months + ' mo</b></div>'
      + '</div>'
      + '<div class="le-close-k">Do these next — 20 minutes</div>'
      + open.slice(0, 3).map(function (j) {
        return '<div class="le-job"><div><strong>' + j.name + '</strong><small>' + j.vehicle + ' · ' + j.why + '</small></div><div><em>' + money(j.amount) + '</em><div class="le-job-actions">'
          + '<button class="le-btn-call" data-act="call" data-phone="' + j.phone + '">Call</button>'
          + '<button class="le-btn-text" data-act="text" data-phone="' + j.phone + '">Text</button>'
          + '<button class="le-btn-text" data-act="book" data-phone="' + j.phone + '">Book</button>'
          + '<button class="le-btn-won" data-act="won" data-phone="' + j.phone + '">Got the job</button>'
          + '</div></div></div>';
      }).join('')
      + (open.length ? '' : '<p>Queue is clear. Import the next shop\'s estimates and the list fills itself.</p>')
      + '<div class="le-close-offer"><strong>The close for an owner</strong>If this list does not put a real job back on the board in 14 days, the software is not worth paying for. Price it so one recovered ticket covers the month. Then sell the daily list, not a login.</div>'
      + '</section>';
  }
  function bind(root) {
    if (!root) return;
    root.querySelectorAll('[data-act]').forEach(function (b) {
      b.onclick = function () {
        var j = jobs.filter(function (x) { return x.phone === b.getAttribute('data-phone'); })[0];
        if (!j) return;
        var act = b.getAttribute('data-act');
        if (act === 'call') call(j);
        else if (act === 'text') text(j);
        else if (act === 'book') book(j);
        else if (act === 'won') won(j);
      };
    });
  }
  function view() {
    var a = document.querySelector('.nav-item.active');
    return (a && a.getAttribute('data-view')) || 'overview';
  }
  function paint() {
    css();
    var v = view();
    var page = qs('#content .page');
    var old = document.getElementById('leCloser');
    if (v !== 'overview' && v !== 'recovery') {
      if (old) old.remove();
      return;
    }
    if (!page) return;
    var box = document.createElement('div');
    box.innerHTML = html();
    var node = box.firstChild;
    if (old) old.replaceWith(node);
    else page.insertBefore(node, page.firstChild);
    bind(document.getElementById('leCloser'));
  }
  function fab() {
    if (qs('#leCloserFab')) return;
    var b = document.createElement('button');
    b.id = 'leCloserFab';
    b.className = 'le-fab';
    b.type = 'button';
    b.textContent = 'Work next job';
    b.onclick = function () {
      if (window.LE && LE.setView) LE.setView('overview');
      setTimeout(function () {
        var first = qs('#leCloser [data-act="call"]');
        if (first) first.click();
      }, 200);
    };
    document.body.appendChild(b);
  }
  function boot() {
    paint();
    fab();
    setInterval(paint, 1600);
  }
  window.LECloser = {paint: paint, next: function () { var j = openJobs()[0]; if (j) call(j); }};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
