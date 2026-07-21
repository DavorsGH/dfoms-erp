import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvForce(filePath) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
}

loadEnvForce(resolve(process.cwd(), ".env.local"));

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const tenantId = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";

const { data: inserted, error: insertError } = await supabase
  .from("suppliers")
  .insert({ name: "Supabase RPC Shape Test", tenant_id: tenantId })
  .select("id")
  .single();

if (insertError) {
  throw insertError;
}

const { data, error } = await supabase.rpc("preview_supplier_delete", {
  p_supplier_id: inserted.id,
});

console.log("supabase.rpc data:", JSON.stringify(data, null, 2));
console.log("typeof:", typeof data, Array.isArray(data) ? "array" : "");

await supabase.from("suppliers").delete().eq("id", inserted.id);
