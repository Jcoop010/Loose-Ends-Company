import {createClient} from "https://esm.sh/@supabase/supabase-js@2.57.0";
const headers={"Access-Control-Allow-Origin":"https://loose-ends-os.vercel.app","Access-Control-Allow-Headers":"authorization,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS","Content-Type":"application/json"};
const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(req.method!=="POST")return reply(405,{error:"Method not allowed"});
 try{
  const token=req.headers.get("authorization")?.replace(/^Bearer\s+/i,"");
  if(!token)return reply(401,{error:"Sign in required"});
  const url=Deno.env.get("SUPABASE_URL")!,anon=Deno.env.get("SUPABASE_ANON_KEY")!,service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const userClient=createClient(url,anon,{global:{headers:{Authorization:"Bearer "+token}}});
  const auth=await userClient.auth.getUser();
  if(auth.error||!auth.data.user)return reply(401,{error:"Invalid session"});
  const input=await req.json(),workspaceId=String(input.workspace_id||"");
  if(!/^[a-f\d-]{36}$/i.test(workspaceId))return reply(400,{error:"Invalid workspace"});
  const admin=createClient(url,service);
  const member=await admin.from("workspace_members").select("role").eq("workspace_id",workspaceId).eq("user_id",auth.data.user.id).maybeSingle();
  if(member.error||!member.data||!["owner","admin"].includes(member.data.role))return reply(403,{error:"Workspace owner/admin required"});
  const action=String(input.action||"");
  if(action==="start"){
    const job=await admin.from("customer_import_jobs").insert({workspace_id:workspaceId,created_by:auth.data.user.id}).select("id,status,processed,created,matched,rejected").single();
    return job.error?reply(500,{error:"Could not start import"}):reply(200,{job:job.data});
  }
  const id=String(input.job_id||"");
  if(!/^[a-f\d-]{36}$/i.test(id))return reply(400,{error:"Invalid import ID"});
  const lookup=await admin.from("customer_import_jobs").select("*").eq("id",id).eq("workspace_id",workspaceId).eq("created_by",auth.data.user.id).maybeSingle();
  if(!lookup.data)return reply(404,{error:"Import not found"});
  if(action==="status")return reply(200,{job:lookup.data});
  if(action==="finish"){
   if(lookup.data.status!=="active")return reply(200,{job:lookup.data});
   const done=await admin.from("customer_import_jobs").update({status:"completed",updated_at:new Date().toISOString()}).eq("id",id).eq("status","active").select("*").single();
   return done.error?reply(500,{error:"Could not finish import"}):reply(200,{job:done.data});
  }
  if(action!=="batch")return reply(400,{error:"Unsupported action"});
  if(lookup.data.status!=="active")return reply(409,{error:"Import already closed"});
  const n=Number(input.batch_number),rows=input.rows;
  if(!Number.isInteger(n)||n<0||!Array.isArray(rows)||rows.length<1||rows.length>100)return reply(400,{error:"Batch must have 1-100 rows and valid number"});
  const previous=await admin.from("customer_import_batches").select("*").eq("job_id",id).eq("batch_number",n).maybeSingle();
  if(previous.data)return reply(200,{receipt:previous.data,replayed:true});
  let created=0,matched=0,rejected=0;
  for(const row of rows){
   const email=String(row.email||"").trim().toLowerCase().slice(0,320);
   const phone=String(row.phone||"").trim().slice(0,50);
   if(!email&&!phone){rejected++;continue}
   const q=admin.from("customers").select("id").eq("workspace_id",workspaceId);
   const existing=await(email?q.ilike("email",email):q.eq("phone",phone)).limit(1).maybeSingle();
   if(existing.error){rejected++;continue}
   if(existing.data){matched++;continue}
   const record={workspace_id:workspaceId,first_name:String(row.first_name||"").slice(0,100)||null,last_name:String(row.last_name||"").slice(0,100)||null,email:email||null,phone:phone||null};
   const result=await admin.from("customers").insert(record).select("id").single();
   if(result.error){
    if(result.error.code==="23505"){matched++;continue}
    rejected++;continue;
   }
   created++;
  }
  const receipt=await admin.from("customer_import_batches").insert({job_id:id,batch_number:n,row_count:rows.length,created_count:created,matched_count:matched,rejected_count:rejected}).select("*").single();
  if(receipt.error)return reply(409,{error:"Batch receipt not saved; check status before retrying"});
  const entries=await admin.from("customer_import_batches").select("row_count,created_count,matched_count,rejected_count").eq("job_id",id);
  if(!entries.error){
   const summary=entries.data.reduce((a,r)=>({processed:a.processed+r.row_count,created:a.created+r.created_count,matched:a.matched+r.matched_count,rejected:a.rejected+r.rejected_count}),{processed:0,created:0,matched:0,rejected:0});
   await admin.from("customer_import_jobs").update({...summary,updated_at:new Date().toISOString()}).eq("id",id);
  }
  return reply(200,{receipt:receipt.data});
 }catch(_){return reply(500,{error:"Import request failed"})}
});