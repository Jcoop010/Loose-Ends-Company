/* Shared keyboard and modal behavior for the existing production runtime. */
(function(){
'use strict';
var selector='#ops-modal,#le-auth-modal,#le-csv-modal,#le-launch-modal,#le-audit-live,.le-engine-modal',active=null,returnFocus=null,lastOutside=null,saved=[];
function isVisible(el){return el&&!el.disabled&&el.type!=='hidden'&&el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden';}
function focusable(root){return Array.from(root.querySelectorAll('button,input,select,textarea,a[href],[tabindex]')).filter(function(el){return el.tabIndex>=0&&isVisible(el);});}
function restore(){saved.forEach(function(pair){if(pair[0].isConnected)pair[0].inert=pair[1];});saved=[];}
function sync(){
 var candidates=Array.from(document.querySelectorAll(selector)).filter(isVisible),next=candidates[candidates.length-1]||null;
 if(next===active)return;
 var old=active;restore();active=next;
 if(!active){if(old){var target=returnFocus&&returnFocus.isConnected?returnFocus:document.getElementById('content');if(target)target.focus();}return;}
 if(!old)returnFocus=lastOutside;
 var dialog=active.querySelector('[role="dialog"]')||active.firstElementChild||active;
 dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.tabIndex=-1;
 if(!dialog.getAttribute('aria-label')&&!dialog.getAttribute('aria-labelledby')){var heading=dialog.querySelector('h1,h2,h3');if(heading){if(!heading.id)heading.id='le-active-dialog-title';dialog.setAttribute('aria-labelledby',heading.id);}else dialog.setAttribute('aria-label','Workspace dialog');}
 active.querySelectorAll('button').forEach(function(b){if(b.textContent.trim()==='×'&&!b.getAttribute('aria-label'))b.setAttribute('aria-label','Close dialog');});
 Array.from(document.body.children).forEach(function(el){if(el===active||el.contains(active)||['SCRIPT','STYLE','LINK'].includes(el.tagName))return;saved.push([el,el.inert]);el.inert=true;});
 if(!active.contains(document.activeElement)){var nodes=focusable(dialog);(nodes[0]||dialog).focus();}
}
document.addEventListener('focusin',function(e){if(!e.target.closest(selector))lastOutside=e.target;});
document.addEventListener('keydown',function(e){
 if(!active)return;
 if(e.key==='Escape'){var close=Array.from(active.querySelectorAll('button')).find(function(b){return isVisible(b)&&(/^(Close|Cancel|Not now|×)/i.test(b.textContent.trim())||b.dataset.opsAction==='close-modal');});if(close){e.preventDefault();close.click();}return;}
 if(e.key!=='Tab')return;
 var nodes=focusable(active),first=nodes[0],last=nodes[nodes.length-1];
 if(!first){e.preventDefault();(active.querySelector('[role="dialog"]')||active).focus();return;}
 if(e.shiftKey&&(document.activeElement===first||!active.contains(document.activeElement))){e.preventDefault();last.focus();}
 else if(!e.shiftKey&&(document.activeElement===last||!active.contains(document.activeElement))){e.preventDefault();first.focus();}
});
function boot(){
 var style=document.createElement('style');style.textContent='.le-skip-link{position:fixed;top:8px;left:8px;transform:translateY(-150%);z-index:12000;background:#fff;color:#10212c;padding:12px 16px;border-radius:8px}.le-skip-link:focus{transform:none}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid #74dfc2;outline-offset:3px}.top-actions{min-width:0}.le-auth-pill{max-width:min(45vw,180px)}@media(max-width:700px){.top-actions .avatar{display:none}.le-auth-pill{max-width:155px}}';document.head.appendChild(style);
 if(document.getElementById('content')){var skip=document.createElement('a');skip.href='#content';skip.textContent='Skip to main content';skip.className='le-skip-link';document.body.insertBefore(skip,document.body.firstChild);}
 new MutationObserver(sync).observe(document.body,{childList:true,subtree:true});sync();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
