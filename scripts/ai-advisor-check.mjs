import assert from "node:assert/strict";
import fs from "node:fs";
const endpoint = fs.readFileSync("supabase/functions/ai-advisor/index.ts", "utf8");
const page = fs.readFileSync("pages/Ask.tsx", "utf8");
for (const text of ["auth.getUser()", "workspace_members", 'eq("workspace_id", wid)', 'Deno.env.get("OPENROUTER_API_KEY")', 'model: "openrouter/free"', "Origin is not allowed."]) {
  assert.ok(endpoint.includes(text), "Missing AI advisor security/provider marker: " + text);
}
assert.ok(page.includes("supabase.functions.invoke('ai-advisor'"), "Ask page must use the server endpoint.");
console.log("AI advisor checks passed.");
