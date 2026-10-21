import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
const source=readFileSync(new URL('../supabase/functions/customer-bulk-import/index.ts',import.meta.url),'utf8')
  .replace(/^import .*?;\s*/,'')
  .replace(/\(status:number,body:unknown\)/,'(status,body)')
let handler, actor='owner-user', allowedRole='owner', calls=0
const jobs=new Map(),receipts=new Map()
const id='10000000-0000-4000-8000-000000000001',workspace='20000000-0000-4000-8000-000000000002'
const chain=(result)=>{const q={select:()=>q,eq:()=>q,limit:()=>q,single:async()=>result,maybeSingle:async()=>result,insert:()=>q,update:()=>q};return q}
const service={
 from(table){
  if(table==='workspace_members')return chain({data:allowedRole?{role:allowedRole}:null,error:null})
  if(table==='customer_import_jobs'){
   const q={select:()=>q,eq:()=>q,insert:(data)=>{jobs.set(id,{id,...data,status:'active',processed:0,created:0,matched:0,rejected:0});return chain({data:jobs.get(id),error:null})},
   update:(data)=>{const j=jobs.get(id);if(j)Object.assign(j,data);return chain({data:j,error:null})},
   maybeSingle:async()=>({data:jobs.get(id)||null,error:null})};return q
  }
  throw Error('Unexpected table '+table)
 },
 async rpc(name,args){
  assert.equal(name,'process_customer_import_batch')
  calls++
  const key=args.p_job_id+':'+args.p_batch_number
  if(receipts.has(key))return {data:{receipt:receipts.get(key),replayed:true},error:null}
  const receipt={job_id:args.p_job_id,batch_number:args.p_batch_number,row_count:args.p_rows.length,created_count:args.p_rows.length,matched_count:0,rejected_count:0}
  receipts.set(key,receipt);return {data:{receipt,replayed:false},error:null}
 }
}
const createClient=(_url,_key,options)=>options?.global?{auth:{getUser:async()=>({data:{user:{id:actor}},error:null})}}:service
const context={createClient,Response,Date,JSON,Number,String,Array,Deno:{env:{get:()=> 'fake'},serve:fn=>{handler=fn}}}
vm.runInNewContext(source,context)
const request=(body,token='test')=>handler(new Request('https://test.invalid',{method:'POST',headers:token?{authorization:'Bearer '+token}:{},body:JSON.stringify(body)}))
const read=async response=>({status:response.status,body:await response.json()})
assert.equal((await read(await request({action:'start',workspace_id:workspace},''))).status,401)
allowedRole=null
assert.equal((await read(await request({action:'start',workspace_id:workspace}))).status,403)
allowedRole='owner'
const started=await read(await request({action:'start',workspace_id:workspace}))
assert.equal(started.status,200)
const batch={action:'batch',workspace_id:workspace,job_id:id,batch_number:0,rows:[{email:'synthetic@example.invalid'}]}
const first=await read(await request(batch))
assert.equal(first.status,200)
assert.equal(first.body.replayed,false)
const replay=await read(await request(batch))
assert.equal(replay.status,200)
assert.equal(replay.body.replayed,true)
assert.equal(receipts.size,1)
assert.equal((await read(await request({...batch,rows:Array(101).fill({email:'x@example.invalid'})}))).status,400)
assert.equal((await read(await request({...batch,job_id:'30000000-0000-4000-8000-000000000003'}))).status,404)
assert.equal(calls,2)
console.log('Customer importer Edge Function HTTP-handler tests passed: auth, roles, start, batch, replay, bounds, job ownership')
