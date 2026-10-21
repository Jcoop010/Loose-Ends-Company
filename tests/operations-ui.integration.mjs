// Real Supabase-backed DOM interaction test. It does not claim browser layout or auth-UI coverage.
// Run only against the disposable QA credentials in LE_QA_CREDENTIALS_FILE.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {createClient} from '@supabase/supabase-js';
const path=process.env.LE_QA_CREDENTIALS_FILE;if(!path)throw new Error('Disposable LE_QA_CREDENTIALS_FILE required');
const q=JSON.parse(readFileSync(path,'utf8'));
const S=createClient('https://uehfvpnnoitgybsmdgef.supabase.co','sb_publishable_Lxk1H5zRhlKkx8IVHV7Aiw_EXC4BC2g',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const login=await S.auth.signInWithPassword({email:q.email,password:q.password});assert.ifError(login.error);
writeFileSync('/tmp/coordination-qa-session.json',JSON.stringify({...q,token:login.data.session.access_token}),{mode:0o600});
let customers=await S.from('customers').select('*').eq('workspace_id',q.workspace).limit(10);assert.ifError(customers.error);
if(!customers.data.length){const c=await S.from('customers').insert({workspace_id:q.workspace,first_name:'DOM acceptance',email:'dom-qa@example.invalid'}).select().single();assert.ifError(c.error);customers.data=[c.data];}
const testTitle='DOM acceptance service '+crypto.randomUUID().slice(0,8);
const st={workspaceId:q.workspace,customers:customers.data,view:'overview'};
const dom=new JSDOM('<!doctype html><html><head></head><body><aside class="sidebar"><nav></nav><div class="brand-tag"></div><div class="sidebar-callout"><strong></strong></div></aside><main><div id="content"></div></main><div id="toast"></div></body></html>',{url:'https://loose-ends-os.vercel.app/dashboard',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window;w.LESupabase=S;w.LE={getState:()=>st,setView:v=>{st.view=v}};w.scrollTo=()=>{};w.alert=()=>{};w.confirm=()=>true;w.prompt=()=> 'QA recorded customer approval';Object.defineProperty(w,'crypto',{value:webcrypto});w.TextEncoder=TextEncoder;
const errors=[];w.addEventListener('error',e=>errors.push(e.message));
w.eval(readFileSync(new URL('../v3.1/operations-os.js',import.meta.url),'utf8'));
async function until(fn,label){const deadline=Date.now()+25000;while(Date.now()<deadline){if(fn())return;await new Promise(r=>setTimeout(r,80));}throw new Error('Timed out: '+label+'; '+w.document.body.textContent.slice(-1600));}
async function view(v){w.LE.setView(v);await until(()=>w.document.querySelector('#ops-page[data-ops-view="'+v+'"]')&&!w.document.body.textContent.includes('Loading workspace operations'),'load '+v);const e=w.document.getElementById('ops-error');assert.equal(e?.textContent,'');}
function fill(form,name,value){const el=w.document.querySelector('#'+form+' [name="'+name+'"]');assert.ok(el,form+' '+name);el.value=String(value);el.dispatchEvent(new w.Event('input',{bubbles:true}));}
async function submit(id){const f=w.document.getElementById(id);assert.ok(f,id);await f.onsubmit(new w.Event('submit',{cancelable:true,bubbles:true}));assert.equal(w.document.getElementById('ops-modal-error')?.textContent||w.document.getElementById('ops-error')?.textContent||'','');}
async function click(selector){const b=w.document.querySelector(selector);assert.ok(b,selector);await b.onclick();}
try{
 await until(()=>w.LEOperations&&w.document.querySelector('#ops-page'),'initial module');
 await view('operations');
 for(const [k,v] of Object.entries({enabled:'true',coordinate_enabled:'true',enforce_hours:'false',timezone:'UTC',business_start:'08:00',business_end:'18:00',business_days:'1,2,3,4,5',travel_buffer:15}))fill('ops-coordination-policy',k,v);
 await submit('ops-coordination-policy');
 await view('team');await click('[data-ops-action="employee-edit"]');
 fill('ops-employee','display_name','QA Dispatch Technician');fill('ops-employee','job_title','Service technician');fill('ops-employee','skills','HVAC, Diagnostics');await submit('ops-employee');
 assert.ok(w.document.body.textContent.includes('QA Dispatch Technician'));
 await view('jobs');
 fill('ops-job','title',testTitle);fill('ops-job','customer_id',customers.data[0].id);fill('ops-job','assigned_to',q.user);fill('ops-job','labor_total',80);await submit('ops-job');
 const jobs=await S.from('ops_jobs').select('*').eq('workspace_id',q.workspace).eq('title',testTitle).single();assert.ifError(jobs.error);const id=jobs.data.id;
 assert.ok(jobs.data.checklist.length>=4);assert.ok(jobs.data.checklist.every(x=>!x.done),'industry checklist must start incomplete');
 await click('[data-ops-action="job-quoted"][data-id="'+id+'"]');
 await click('[data-ops-action="quote-history"][data-id="'+id+'"]');assert.ok(w.document.body.textContent.includes('Revision 1'));
 await click('#ops-modal [data-ops-action="close-modal"]');
 await click('[data-ops-action="estimate-revise"][data-id="'+id+'"]');fill('ops-revise','labor_total',95);fill('ops-revise','reason','QA revised customer scope');await submit('ops-revise');
 await click('[data-ops-action="job-quoted"][data-id="'+id+'"]');
 const revisions=await S.from('ops_quote_revisions').select('*').eq('workspace_id',q.workspace).eq('job_id',id).order('revision');assert.ifError(revisions.error);assert.deepEqual(revisions.data.map(r=>r.total),[80,95]);
 await click('[data-ops-action="job-approved"][data-id="'+id+'"]');
 await click('[data-ops-action="schedule"][data-id="'+id+'"]');fill('ops-schedule','starts_at','2030-01-07T09:00');fill('ops-schedule','ends_at','2030-01-07T10:00');await submit('ops-schedule');
 await view('dispatch');assert.ok(w.document.body.textContent.includes(testTitle));
 await click('[data-ops-action="booking-edit"]');fill('ops-booking','starts_at','2030-01-07T13:00');fill('ops-booking','ends_at','2030-01-07T14:00');await submit('ops-booking');
 await view('jobs');await click('[data-ops-action="job-in_progress"][data-id="'+id+'"]');
 await click('[data-ops-action="job-edit"][data-id="'+id+'"]');fill('ops-job-update','checklist',jobs.data.checklist.map(x=>'[x] '+x.title).join('\n'));await submit('ops-job-update');
 await click('[data-ops-action="job-completed"][data-id="'+id+'"]');
 const completed=await S.from('ops_jobs').select('invoice_id').eq('workspace_id',q.workspace).eq('id',id).single();assert.ifError(completed.error);const invoice=await S.from('documents').select('id,total,status').eq('workspace_id',q.workspace).eq('document_number','JOB-'+id);assert.ifError(invoice.error);assert.equal(invoice.data.length,1);assert.equal(invoice.data[0].id,completed.data.invoice_id);assert.equal(invoice.data[0].total,95);assert.equal(invoice.data[0].status,'draft');
 await view('communications');fill('ops-draft','customer_id',customers.data[0].id);fill('ops-draft','subject','DOM QA draft');fill('ops-draft','message','Synthetic QA follow-up; never send.');await submit('ops-draft');assert.ok(w.document.body.textContent.includes('DOM QA draft'));
 await w.LEOperations.openCustomer(customers.data[0].id);assert.ok(w.document.body.textContent.includes('Jobs & estimates'));fill('ops-customer-update','notes','QA unified profile note');await submit('ops-customer-update');
 const updated=await S.from('customers').select('notes').eq('workspace_id',q.workspace).eq('id',customers.data[0].id).single();assert.ifError(updated.error);assert.equal(updated.data.notes,'QA unified profile note');
 await view('finance');assert.ok(w.document.body.textContent.includes('Provider-verified recovery'));
 fill('ops-expense','vendor','QA vendor');fill('ops-expense','amount',15);fill('ops-expense','description','Synthetic vendor bill');await submit('ops-expense');await click('[data-ops-action="expense-paid"]');
 const bill=await S.from('ops_expenses').select('paid').eq('workspace_id',q.workspace).eq('vendor','QA vendor');assert.ifError(bill.error);assert.ok(bill.data.some(x=>x.paid));
 for(const v of ['overview','inventory','purchasing','operations','team','dispatch','communications'])await view(v);
 assert.deepEqual(errors,[]);
 console.log('PASS authenticated DOM→real Supabase: policy, named employee, industry checklist, quote and revision, approval, booking/reschedule, completion checklist, one invoice draft, communication draft, finance and all new department views.');
 console.log('No real browser layout/auth UI, provider delivery or customer charges are claimed by this test.');
}finally{dom.window.close();S.auth.stopAutoRefresh();}
