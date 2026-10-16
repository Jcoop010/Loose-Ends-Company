import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
const cors={"Access-Control-Allow-Origin":"https://loose-ends-os.vercel.app","Access-Control-Allow-Headers":"authorization, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const respond=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json"}});
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(req.method!=="POST")return respond(405,{error:"Method not allowed"});
 try{
 const token=req.headers.get("Authorization")?.replace(/^Bearer\s+/i,"");
 if(!token)return respond(401,{error:"Authentication required"});
 const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_ANON_KEY");
 if(!url||!key)return respond(503,{error:"Service unavailable"});
 const client=createClient(url,key,{global:{headers:{Authorization:"Bearer "+token}},auth:{persistSession:false,autoRefreshToken:false}});
 const auth=await client.auth.getUser(token),user=auth.data.user;
 if(auth.error||!user)return respond(401,{error:"Invalid session"});
 const body=await req.json().catch(()=>null);
 if(!body||typeof body.workspace_id!=="string"||typeof body.approval_id!=="string")return respond(400,{error:"workspace_id and approval_id required"});
 const member=await client.from("workspace_members").select("role").eq("workspace_id",body.workspace_id).eq("user_id",user.id).maybeSingle();
 if(member.error||!member.data||!["owner","admin"].includes(member.data.role))return respond(403,{error:"Workspace approval role required"});
 const approval=await client.from("audit_events").select("id,entity_id,metadata,action,actor_user_id").eq("id",body.approval_id).eq("workspace_id",body.workspace_id).maybeSingle();
 if(approval.error||!approval.data||approval.data.action!=="recovery_draft_approved")return respond(404,{error:"Approval not found"});
 const a=approval.data,meta=a.metadata||{},channel=meta.channel;
 if(!["sms","email","call"].includes(channel)||!meta.consent_event_id||!meta.customer_id||meta.delivery_status!=="not_sent")return respond(409,{error:"Approval missing delivery prerequisites"});
 const opportunity=await client.from("opportunities").select("id,customer_id").eq("workspace_id",body.workspace_id).eq("id",a.entity_id).maybeSingle();
 if(opportunity.error||!opportunity.data||opportunity.data.customer_id!==meta.customer_id)return respond(409,{error:"Opportunity/customer mismatch"});
 const consent=await client.from("customer_contact_consent_events").select("id,decision,evidence_reference").eq("workspace_id",body.workspace_id).eq("customer_id",meta.customer_id).eq("channel",channel).order("created_at",{ascending:false}).order("id",{ascending:false}).limit(1);
 if(consent.error||!consent.data?.length||consent.data[0].decision!=="granted"||consent.data[0].id!==meta.consent_event_id||consent.data[0].evidence_reference!==meta.consent_reference)return respond(409,{error:"Consent missing, superseded or revoked"});
 // Queuing is explicitly opt-in and has no delivery consumer or provider connection.
 if(body.action==="enqueue_draft"){
   const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
   if(!serviceKey)return respond(503,{error:"Queue writer not configured"});
   const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
   const job={workspace_id:body.workspace_id,approval_event_id:a.id,customer_id:meta.customer_id,channel,status:"draft",idempotency_key:"approved:"+a.id,created_by:user.id};
   const existing=await admin.from("recovery_outbound_jobs").select("id,status").eq("workspace_id",body.workspace_id).eq("approval_event_id",a.id).maybeSingle();
   if(existing.error)return respond(503,{error:"Queue lookup failed"});
   if(existing.data)return respond(200,{queued:true,duplicate:true,delivery_enabled:false,job_id:existing.data.id,status:existing.data.status});
   const saved=await admin.from("recovery_outbound_jobs").insert(job).select("id,status").single();
   if(saved.error){
     if(saved.error.code==="23505"){
       const again=await admin.from("recovery_outbound_jobs").select("id,status").eq("workspace_id",body.workspace_id).eq("approval_event_id",a.id).maybeSingle();
       if(!again.error&&again.data)return respond(200,{queued:true,duplicate:true,delivery_enabled:false,job_id:again.data.id,status:again.data.status});
     }
     return respond(409,{error:"Queue request not accepted"});
   }
   return respond(201,{queued:true,duplicate:false,delivery_enabled:false,job_id:saved.data.id,status:saved.data.status});
 }
 // Intentionally NO provider request, message queue insertion, or transmission.
 return respond(200,{authorized:true,delivery_enabled:false,status:"dry_run_only",approval_id:a.id,channel,notice:"Checks passed. No message sent."});
 }catch(_){return respond(400,{error:"Invalid request or verification unavailable. No message sent."})}
});