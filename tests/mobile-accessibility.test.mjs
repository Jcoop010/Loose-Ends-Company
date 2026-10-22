import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {JSDOM} from 'jsdom';
const dom=new JSDOM('<!doctype html><body><div class="app-shell"><nav></nav><main id="content" tabindex="-1"><button id="opener">Open profile</button></main></div></body>',{url:'https://loose-ends-os.vercel.app/dashboard',runScripts:'outside-only'}),w=dom.window;
const source=p=>readFileSync(new URL('../v3.1/'+p,import.meta.url),'utf8');const tick=()=>new Promise(r=>setTimeout(r,25));const calls=[];
w.LE={setView:v=>calls.push(v)};w.HTMLElement.prototype.getClientRects=function(){return this.hidden||this.type==='hidden'?[]:[{}]};
try{
 w.eval(source('mobile-nav.js'));w.eval(source('ui-accessibility.js'));await tick();
 const menu=w.document.querySelector('.le-more-menu');const late=w.document.createElement('button');late.dataset.view='inventory';late.className='le-more-item';late.textContent='Inventory';menu.append(late);
 w.document.querySelector('#leMobileNav [data-view="more"]').click();assert.ok(menu.classList.contains('open'));late.click();assert.deepEqual(calls,['inventory']);assert.ok(!menu.classList.contains('open'),'new department items must navigate and close More');
 const opener=w.document.getElementById('opener');opener.focus();const modal=w.document.createElement('div');modal.id='ops-modal';modal.innerHTML='<section><h2>Profile fixture</h2><input type="hidden"><button id="close">Close</button><input aria-label="Note"><a href="#content">History</a></section>';modal.querySelector('button').onclick=()=>modal.remove();w.document.body.append(modal);await tick();
 assert.equal(modal.firstElementChild.getAttribute('role'),'dialog');assert.equal(w.document.querySelector('.app-shell').inert,true);assert.equal(w.document.activeElement.id,'close');
 w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));assert.equal(w.document.activeElement.tagName,'A','focus wraps to links and excludes hidden inputs');
 w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));assert.equal(w.document.activeElement.id,'close');
 w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await tick();assert.equal(w.document.querySelector('#ops-modal'),null);assert.equal(w.document.activeElement,opener);assert.ok(!w.document.querySelector('.app-shell').inert);
 console.log('Mobile navigation and modal accessibility regressions passed: late items, focus wrap, hidden controls, Escape, inert background and return focus.');
}finally{w.close()}

const qa=readFileSync(new URL('../public/qa/acceptance.js',import.meta.url),'utf8');
const qaHtml=readFileSync(new URL('../public/qa/acceptance.html',import.meta.url),'utf8');
for(const check of ['No duplicate element IDs','Images have alt attributes','Buttons have accessible names','loose-ends-acceptance.json'])assert.ok(qa.includes(check),check);
assert.match(qaHtml,/id="export"/);
assert.match(qaHtml,/id="controls"/);
assert.match(qaHtml,/@media\(max-width:650px\)/);
assert.match(qaHtml,/button:disabled/);
