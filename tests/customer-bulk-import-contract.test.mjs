import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const src=readFileSync(new URL('../supabase/functions/customer-bulk-import/index.ts',import.meta.url),'utf8')
  .replace(/^import .*;\s*/,'')
  .replace('status:number,body:unknown','status,body')
  .replaceAll('Deno.env.get("SUPABASE_URL")!','Deno.env.get("SUPABASE_URL")')
  .replaceAll('Deno.env.get("SUPABASE_ANON_KEY")!','Deno.env.get("SUPABASE_ANON_KEY")')
  .replaceAll('Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!','Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")');
const wid='11111111-1111-4111-8111-111111111111',jid='22222222-2222-4222-8222-222222222222';
let handler,role='owner',authorized=true,rpcCalls=0,failRpc=false;
const builder=(table)=>{
 const q={
  select(){return q},eq(){return q},limit(){return q},update(){return q},
  maybeSingle:async()=>({data:table==='workspace_members'?(authorized?{role}:null):{id:jid,status:'active'}}),
  single:async()=>({data:{id:jid,status:'active'}}),
  insert(){return q}
 };return q;
};
const createClient=(_url,key)=>key==='anon'?{auth:{getUser:async()=>({data:{user:{id:'user1'}}})}}:
 {from:builder,rpc:async(name,args)=>{assert.equal(name,'process_customer_import_batch');assert.equal(args.p_workspace_id,wid);rpcCalls++;return failRpc?{error:{message:'failure'}}:{data:{receipt:{batch_number:args.p_batch_number},replayed:false}}}};
runInNewContext(src,{createClient,Response,JSON,String,Number,Array,Date,Deno:{env:{get:k=>k==='SUPABASE_ANON_KEY'?'anon':'service'},serve:fn=>{handler=fn}},console});
async function check(body,expected,token='valid'){
 const req=new Request('https://example.invalid',{method:'POST',headers:token?{Authorization:'Bearer '+token}:{},body:JSON.stringify(body)});
 const res=await handler(req);assert.equal(res.status,expected);return res.json();
}
await check({workspace_id:wid,action:'start'},401,'');
authorized=false;await check({workspace_id:wid,action:'batch',job_id:jid,batch_number:0,rows:[{email:'sample@example.invalid'}]},403);
authorized=true;role='member';await check({workspace_id:wid,action:'start'},403);
role='owner';await check({workspace_id:wid,action:'batch',job_id:jid,batch_number:0,rows:[]},400);
await check({workspace_id:wid,action:'batch',job_id:jid,batch_number:0,rows:Array(101).fill({email:'sample@example.invalid'})},400);
assert.equal(rpcCalls,0);
const ok=await check({workspace_id:wid,action:'batch',job_id:jid,batch_number:0,rows:[{email:'sample@example.invalid'}]},200);
assert.equal(ok.receipt.batch_number,0);
failRpc=true;await check({workspace_id:wid,action:'batch',job_id:jid,batch_number:0,rows:[{email:'sample@example.invalid'}]},409);
assert.equal(rpcCalls,2);
console.log('Edge Function contract tests passed: missing authentication, tenant access, role access, empty/oversized batches, atomic RPC, safe retry error');
