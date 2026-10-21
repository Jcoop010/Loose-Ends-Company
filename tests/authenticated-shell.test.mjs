import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<!doctype html><head></head><body><nav></nav><main id="content"><div class="page"><h1>Executive Command Center</h1></div></main><div id="toast"></div></body>',{url:'https://loose-ends-os.vercel.app/dashboard',runScripts:'outside-only'});
const w=dom.window;const queries=[];
w.LESupabase={auth:{getUser:async()=>({data:{user:{id:'fixture',email:'fixture@example.invalid'}}}),getSession:async()=>({data:{}}),onAuthStateChange(){}},from(table){const q={select(columns){queries.push({table,columns});q.columns=columns;return q},eq(){return q},limit(){return q},order(){return q},maybeSingle:async()=>q.columns.includes('*')?{error:{message:'permission denied for table workspaces'}}:{data:{workspace_id:'workspace',workspaces:{id:'workspace',name:'Fixture business',slug:'fixture'}}},then(a,b){return Promise.resolve({data:[]}).then(a,b)}};return q}};
w.LE={getState:()=>({workspaceId:'workspace'}),refresh:async()=>{},setView(){}};
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const tick=()=>new Promise(r=>setTimeout(r,30));
try{
 w.eval(read('v3.1/auth-live.js'));await tick();
 assert.match(w.document.getElementById('le-auth-pill').textContent,/LIVE.*Fixture business/);
 assert.equal(queries[0].columns,'workspace_id,role,workspaces(id,name,slug)');
 w.eval(read('v3.1/workflow-engine.js'));await tick();
 await w.LEWorkflows.load();await tick();
 assert.equal(w.document.querySelectorAll('#workflowCenter').length,0,'background workflow hydration must not append to the dashboard');
 const nav=w.document.querySelector('[data-view="workflows"]');assert.ok(nav);nav.click();await tick();
 assert.equal(w.document.querySelectorAll('[data-workflow-page] #workflowCenter').length,1,'the dedicated workflow screen remains functional');
 w.document.getElementById('content').innerHTML='<div class="page"><h1>Inventory</h1></div>';
 await w.LEWorkflows.load();await tick();assert.equal(w.document.querySelectorAll('#workflowCenter').length,0,'late refresh must not append to another department');
 console.log('Authenticated shell regressions passed: restricted workspace columns and workflow screen isolation.');
}finally{w.close()}
