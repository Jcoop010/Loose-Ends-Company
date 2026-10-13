import assert from "node:assert/strict";
import fs from "node:fs";

const endpoint = fs.readFileSync("supabase/functions/ai-advisor/index.ts", "utf8");
const page = fs.readFileSync("pages/Ask.tsx", "utf8");

for (const marker of [
  "auth.getUser()",
  "workspace_members",
  'eq("workspace_id", wid)',
  'Deno.env.get("OPENROUTER_API_KEY")',
  'model: "openrouter/free"',
  "Origin is not allowed.",
  "customer labels are anonymized",
]) {
  assert.ok(endpoint.includes(marker), "Missing AI advisor security/provider marker: " + marker);
}

for (const forbidden of [
  'select("id,first_name,last_name")',
  "clean(rawBusiness.name",
  "clean(item.message)",
  "clean(item.note)",
]) {
  assert.ok(!endpoint.includes(forbidden), "AI advisor must not send identifiable/free-text customer data: " + forbidden);
}

assert.ok(page.includes("supabase.functions.invoke('ai-advisor'"), "Ask page must use the server endpoint.");
console.log("AI advisor security, privacy, and free-routing checks passed.");
