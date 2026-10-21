// DOM regression checks; backend integration is verified separately by operations-ui.integration.mjs.
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {webcrypto} from 'node:crypto';import {JSDOM} from 'jsdom';
const st={workspaceId:'11111111-1111-4111-8111-111111111111',view:'overview',customers:[]};
const rows={ops_jobs:[{id:'22222222-2222-4222-8222-222222222222',title:'Checklist fixture',status:'draft',labor_total:10,checklist:[{title:'Incomplete step',done:false},{title:'Completed step',done:true}]}]};
const calls=[],listeners=[];
const S={auth:{onAuthStateChange(fn){listeners.push(fn)}},async rpc(name,args){calls.push({name,args});return {data:name==='ops_team_status'?[]:{}}},from(table){const q={select(){return q},eq(){return q},order(){return q},limit(){return q},range(){return q},then(a,b){return Promise.resolve({data:rows[table]||[]}).then(a,b)}};return q}};
const dom=new JSDOM('<!doctype html><html><head></head><body><aside class="sidebar"><nav></nav></aside><main><div id="content"></div></main><div id="toast"></div></body></html>',{url:'https://loose-ends-os.vercel.app/dashboard',runScripts:'outside-only'});const w=dom.window;
w.LE={getState:()=>st,setView:v=>{st.view=v}};w.LESupabase=S;Object.defineProperty(w,'crypto',{value:webcrypto});w.confirm=()=>true;w.eval(readFileSync(new URL('../v3.1/operations-os.js',import.meta.url),'utf8'));
async function tick(){await new Promise(r=>setTimeout(r,20));}
try{
 await tick();w.LE.setView('jobs');await tick();
 assert.equal(w.document.querySelectorAll('#ops-page').length,1);
 await w.document.querySelector('[data-ops-action="job-edit"]').onclick();
 const checklist=w.document.querySelector('#ops-job-update [name="checklist"]');assert.equal(checklist.value,'[ ] Incomplete step\n[x] Completed step');
 // Submitting unchanged content must preserve incomplete items rather than marking every item complete.
 await w.document.getElementById('ops-job-update').onsubmit(new w.Event('submit',{cancelable:true}));
 const cmd=calls.find(x=>x.name==='ops_command'&&x.args.p_action==='job_update');assert.ok(cmd);assert.deepEqual(JSON.parse(JSON.stringify(cmd.args.p_payload.checklist)),[{title:'Incomplete step',done:false},{title:'Completed step',done:true}]);
 for(const view of ['overview','team','inventory','purchasing','finance','dispatch','communications','operations']){w.LE.setView(view);await tick();assert.equal(w.document.querySelectorAll('#ops-page').length,1);assert.equal(w.document.querySelector('#ops-page').dataset.opsView,view);}
 st.workspaceId=null;listeners.forEach(fn=>fn('SIGNED_OUT'));await tick();assert.ok(!w.document.body.textContent.includes('Checklist fixture'));
 console.log('Coordination DOM regressions passed: incomplete checklists, all department views, single screen and sign-out clearing.');
}finally{w.close()}
