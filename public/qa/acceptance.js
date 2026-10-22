/* Read-only browser acceptance: real DOM rendering and navigation; no record mutations. */
(function(){
'use strict';
const frame=document.getElementById('app'),out=document.getElementById('results'),status=document.getElementById('status'),run=document.getElementById('run');
const views=['overview','inventory','jobs','purchasing','finance','team','communications','operations','dispatch','customers','workflows'];
const results=[];let running=false;
function visible(el){if(!el)return false;const s=el.ownerDocument.defaultView.getComputedStyle(el);return s.visibility!=='hidden'&&s.display!=='none'&&el.getClientRects().length>0;}
async function until(fn,label){const deadline=Date.now()+20000;while(Date.now()<deadline){if(fn())return;await new Promise(r=>setTimeout(r,80));}throw Error('Timed out: '+label);}
function resize(width){frame.width=String(width);document.getElementById('width').value=String(width);}
function record(width,view,name,ok,details){results.push({width,view,check:name,passed:!!ok,...(details?{details}:{} )});out.textContent=JSON.stringify({passed:results.filter(x=>x.passed).length,failed:results.filter(x=>!x.passed).length,results},null,2);}
async function navigate(view,width){
 const d=frame.contentDocument;
 if(width<=1100){const tab=d.querySelector('#leMobileNav [data-view="'+view+'"]');if(tab&&visible(tab)){tab.click();}else{const more=d.querySelector('#leMobileNav [data-view="more"]');if(!more)throw Error('Mobile navigation missing');more.click();const item=d.querySelector('.le-more-menu [data-view="'+view+'"]');if(!item||!visible(item))throw Error('Mobile department missing: '+view);item.click();}}
 else{const nav=d.querySelector('.sidebar [data-view="'+view+'"]');if(!nav)throw Error('Desktop department missing: '+view);nav.click();}
 await until(()=>{const page=d.querySelector('#content .page');if(!page||/Loading workspace operations|Connecting to workspace/.test(page.textContent))return false;return view==='workflows'?!!page.querySelector('#workflowCenter'):view==='customers'?!!page.querySelector('#customerServerSearch'):page.dataset.opsView===view;},'navigate '+view);
 await new Promise(r=>setTimeout(r,200));
}
function audit(width,view){
 const d=frame.contentDocument,w=frame.contentWindow,root=d.documentElement;
 record(width,view,'No document overflow',root.scrollWidth<=root.clientWidth+2,{scrollWidth:root.scrollWidth,clientWidth:root.clientWidth});
 record(width,view,'No unexpected overlay',!d.querySelector('#le-auth-modal,#le-launch-modal,#ops-modal'));
 record(width,view,'No backend error',!(d.querySelector('#ops-error')?.textContent||'').trim());
 record(width,view,'One department screen',d.querySelectorAll('#content>.page').length===1);
 record(width,view,'Workflow isolation',view==='workflows'?d.querySelectorAll('#workflowCenter').length===1:d.querySelectorAll('#workflowCenter').length===0);
 const controls=[...d.querySelectorAll('#content input:not([type=hidden]),#content select,#content textarea')].filter(visible);
 const unnamed=controls.filter(el=>!el.getAttribute('aria-label')&&!el.getAttribute('aria-labelledby')&&!(el.labels?.length)&&!el.getAttribute('title'));
 record(width,view,'Form controls have labels',unnamed.length===0,{unnamed:unnamed.map(el=>el.id||el.name||el.tagName)});
 const ids=[...d.querySelectorAll('[id]')].map(el=>el.id).filter(Boolean),duplicates=ids.filter((id,i)=>ids.indexOf(id)!==i);
 record(width,view,'No duplicate element IDs',duplicates.length===0,{duplicates:[...new Set(duplicates)].slice(0,15)});
 const images=[...d.querySelectorAll('#content img')].filter(visible),missingAlt=images.filter(el=>!el.hasAttribute('alt'));
 record(width,view,'Images have alt attributes',missingAlt.length===0,{missing:missingAlt.map(el=>el.src).slice(0,10)});
 const emptyButtons=[...d.querySelectorAll('#content button')].filter(visible).filter(el=>!el.textContent.trim()&&!el.getAttribute('aria-label')&&!el.getAttribute('aria-labelledby')&&!el.getAttribute('title'));
 record(width,view,'Buttons have accessible names',emptyButtons.length===0,{unnamed:emptyButtons.map(el=>el.id||el.className).slice(0,15)});
 const buttons=[...d.querySelectorAll('#content button')].filter(visible),small=buttons.filter(el=>el.getBoundingClientRect().height<43);
 record(width,view,'Touch target height',small.length===0,{small:small.map(el=>el.textContent.trim()).slice(0,15)});
 if(width<=1100){const nav=d.querySelector('#leMobileNav');record(width,view,'Mobile navigation visible',visible(nav));record(width,view,'More menu closes after navigation',!d.querySelector('.le-more-menu.open'));}
 const auth=d.querySelector('#le-auth-pill'),business=d.querySelector('#businessSwitcher');
 if(visible(auth)&&visible(business)){const a=auth.getBoundingClientRect(),b=business.getBoundingClientRect();record(width,view,'Header controls do not overlap',!(a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top));}
}
document.getElementById('export').onclick=function(){const report={generatedAt:new Date().toISOString(),app:'Loose Ends OS',type:'Structural viewport acceptance - not device certification',passed:results.filter(x=>x.passed).length,failed:results.filter(x=>!x.passed).length,results};const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='loose-ends-acceptance.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
document.getElementById('resize').onclick=()=>resize(Number(document.getElementById('width').value));
run.onclick=async function(){if(running)return;running=true;run.disabled=true;results.length=0;try{
 await until(()=>frame.contentDocument?.querySelector('#le-auth-pill.live'),'authenticated workspace');
 for(const width of [375,390,768,1366]){resize(width);status.textContent='Checking '+width+'px';await new Promise(r=>setTimeout(r,120));for(const view of views){try{await navigate(view,width);audit(width,view);}catch(e){record(width,view,'Navigation completes',false,{error:e.message});}}}
 status.textContent='Finished: '+results.filter(x=>!x.passed).length+' failed checks. Results contain structural evidence only.';
 }catch(e){status.textContent=e.message;}finally{running=false;run.disabled=false;}};
window.addEventListener('message',()=>{}); // No messages or credentials are accepted from other origins.
})();
