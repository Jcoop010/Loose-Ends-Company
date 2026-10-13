import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response(JSON.stringify({error:"POST required"}), {status:405,headers:{"Content-Type":"application/json"}});
  const auth = req.headers.get("Authorization");
  if (!auth) return new Response(JSON.stringify({error:"Missing authorization"}), {status:401,headers:{"Content-Type":"application/json"}});
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {global:{headers:{Authorization:auth}}});
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response(JSON.stringify({error:"Unauthorized"}), {status:401,headers:{"Content-Type":"application/json"}});
  const body = await req.json().catch(() => ({}));
  const workspaceId = body.workspace_id;
  if (!workspaceId) return new Response(JSON.stringify({error:"workspace_id required"}), {status:400,headers:{"Content-Type":"application/json"}});
  const { data: member } = await supabase.from("workspace_members").select("id").eq("workspace_id", workspaceId).eq("user_id", user.id).limit(1).maybeSingle();
  if (!member) return new Response(JSON.stringify({error:"Not a workspace member"}), {status:403,headers:{"Content-Type":"application/json"}});
  const { data: connection, error } = await supabase.from("quickbooks_connections").select("realm_id,status,last_sync_at,last_sync_count,last_error").eq("workspace_id",workspaceId).maybeSingle();
  if (error) return new Response(JSON.stringify({error:error.message}), {status:500,headers:{"Content-Type":"application/json"}});
  return new Response(JSON.stringify({ok:true, workspace_id:workspaceId, connection:connection ?? {status:"disconnected"}, ready_for_oauth: Boolean(Deno.env.get("INTUIT_CLIENT_ID") && Deno.env.get("INTUIT_CLIENT_SECRET")), message:"QuickBooks sync bridge is installed. OAuth credentials are still required before live QBO API sync can run."}), {headers:{"Content-Type":"application/json"}});
});
