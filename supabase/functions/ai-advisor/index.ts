import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const ORIGIN = "https://loose-ends-os.vercel.app";
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin") || "";
  if (origin && origin !== ORIGIN) return new Response(JSON.stringify({ error: "Origin is not allowed." }), { status: 403 });
  const cors = { "Access-Control-Allow-Origin": ORIGIN, "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST required" }), { status: 405, headers: cors });
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!url || !anon) return new Response(JSON.stringify({ error: "Advisor is not configured." }), { status: 503, headers: cors });
  const authorization = req.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return new Response(JSON.stringify({ error: "Sign in is required." }), { status: 401, headers: cors });
  const db = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) return new Response(JSON.stringify({ error: "Invalid session." }), { status: 401, headers: cors });
  return new Response(JSON.stringify({ error: "AI provider setup is still pending." }), { status: 503, headers: { ...cors, "Content-Type": "application/json" } });
});
