// Live integration test. Run only with a disposable QA workspace/account.
// LE_QA_SESSION_FILE contains {token,workspace,otherWorkspace}; never committed.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const path=process.env.LE_QA_SESSION_FILE;if(!path)throw new Error('LE_QA_SESSION_FILE must identify a disposable QA session');
const q=JSON.parse(readFileSync(path,'utf8'));
const base='https://uehfvpnnoitgybsmdgef.supabase.co',apikey='sb_publishable_Lxk1H5zRhlKkx8IVHV7Aiw_EXC4BC2g';
async function request(route,body,expected=200,method='POST'){
 const r=await fetch(base+route,{method,headers:{apikey,Authorization:'Bearer '+q.token,'content-type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(body)})});
 const text=await r.text();let data;try{data=JSON.parse(text)}catch{data={message:text.slice(0,200)}};
 assert.equal(r.status,expected,route+' '+JSON.stringify(data));return data;
}
const rpc=(action,payload,key=crypto.randomUUID(),expected=200,ws=q.workspace)=>request('/rest/v1/rpc/ops_command',{p_workspace:ws,p_action:action,p_payload:payload,p_key:key},expected);
const get=path=>request('/rest/v1/'+path,undefined,200,'GET');
// The deployed importer accepts mapped CSV rows; use its actual client parser for upload semantics.
const client=readFileSync(new URL('../v3.1/live-product-layer.js',import.meta.url),'utf8');
const parserStart=client.indexOf('function parseCsv(text){'),parserEnd=client.indexOf('async function importRun(){',parserStart);
const parse=runInNewContext('('+client.slice(parserStart,parserEnd).trim()+')');
const rows=JSON.parse(JSON.stringify(parse('first_name,last_name,email,phone\n"Quoted, Customer","Line\nBreak",ops-contact@example.invalid,5550000100\nDuplicate,Contact,ops-contact@example.invalid,5550000100')));
const invoke=body=>request('/functions/v1/customer-bulk-import',{workspace_id:q.workspace,...body});
const start=await invoke({action:'start'});assert.ok(start.job.id);const job=start.job.id;
await request('/functions/v1/customer-bulk-import',{workspace_id:q.otherWorkspace,action:'status',job_id:job},403);
await request('/functions/v1/customer-bulk-import',{workspace_id:q.workspace,action:'finish',job_id:job,expected_batches:2,expected_rows:3},409);
const batch={action:'batch',job_id:job,batch_number:0,rows};
await invoke(batch);const replay=await invoke(batch);assert.equal(replay.replayed,true);
// Resume by asking the server for counts, then uploading the missing numbered batch.
const status=await invoke({action:'status',job_id:job});assert.equal(status.job.processed,2);
await invoke({action:'batch',job_id:job,batch_number:1,rows:[{first_name:'Resumed',email:'ops-resume@example.invalid'}]});
const done=await invoke({action:'finish',job_id:job,expected_batches:2,expected_rows:3});
assert.equal(done.job.status,'completed');assert.equal(done.job.processed,3);assert.equal(done.job.created+done.job.matched+done.job.rejected,3);
const contacts=await get('customers?workspace_id=eq.'+q.workspace+'&select=id,first_name,last_name,email');
assert.equal(contacts.length,2);assert.ok(contacts.some(c=>c.first_name==='Quoted, Customer'&&c.last_name==='Line\nBreak'));
console.log('PASS live customer import: auth, cross-tenant denial, early finish rejected, duplicate match, retry, resume, receipt/count reconciliation, quoted/multiline mapped fields.');
const item=await rpc('inventory_save',{name:'HTTP QA item',sku:'HTTP-QA',purchase_cost:12,selling_price:24,reorder_threshold:2,reorder_quantity:5});
const key=crypto.randomUUID();await rpc('stock_move',{id:item.id,kind:'receipt',quantity:5,reason:'QA receipt'},key);await rpc('stock_move',{id:item.id,kind:'receipt',quantity:5,reason:'QA receipt'},key);
await rpc('stock_move',{id:item.id,kind:'adjustment',quantity:-6,reason:'QA negative'},crypto.randomUUID(),400);
await rpc('stock_move',{id:item.id,kind:'receipt',quantity:5,reason:'QA cross workspace'},crypto.randomUUID(),403,q.otherWorkspace);
const work=await rpc('job_save',{title:'HTTP QA job',customer_id:contacts[0].id,labor_total:40});
await rpc('reserve_material',{id:work.id,item_id:item.id,quantity:3});
for(const status of ['quoted','approved','in_progress','completed'])await rpc('job_transition',{id:work.id,status,...(status==='approved'?{approval_evidence:'QA approval reference'}:{}),...(status==='completed'?{checklist_confirmed:true}:{})});
const completed=await rpc('job_transition',{id:work.id,status:'completed',checklist_confirmed:true});
const inventory=await get('inventory_items?workspace_id=eq.'+q.workspace+'&select=quantity,reserved');assert.equal(inventory[0].quantity,2);assert.equal(inventory[0].reserved,0);
const invoices=await get('documents?workspace_id=eq.'+q.workspace+'&document_type=eq.invoice&select=id,total,status');assert.equal(invoices.length,1);assert.equal(invoices[0].total,112);assert.equal(invoices[0].id,completed.invoice_id);assert.equal(invoices[0].status,'draft');
// Direct writes are forbidden even for an authenticated owner: invariants require the RPC.
await request('/rest/v1/inventory_items?workspace_id=eq.'+q.workspace,{quantity:999},403,'PATCH');
await request('/rest/v1/ops_queue?workspace_id=eq.'+q.workspace,{status:'completed'},403,'PATCH');
const foreign=await get('inventory_items?workspace_id=eq.'+q.otherWorkspace+'&select=id');assert.equal(foreign.length,0);
await rpc('policy_save',{enabled:true,draft_limit:1000,industry:'general'});
console.log('PASS live operations: authenticated RPC, tenant isolation, write denial, duplicate stock receipts, negative stock guard, job reservation/approval/completion, single invoice, verified amounts.');
console.log('QA workspace now has a low-stock fixture with internal draft automation enabled; verify scheduled backend execution before cleanup.');
