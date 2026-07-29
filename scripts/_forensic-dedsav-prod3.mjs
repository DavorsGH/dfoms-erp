import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnv(filePath) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[t.slice(0, i).trim()] = v;
  }
}

loadEnv(resolve(".env.local.backup"));
const TENANT = "00000001-0000-4000-8000-000000000001";
const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data: cust } = await s
  .from("customers")
  .select("client_id, client_name")
  .eq("tenant_id", TENANT)
  .eq("client_id", "CL-001")
  .maybeSingle();
console.log("customers CL-001:", cust);

const { data: tax } = await s
  .from("tax_ledger_entries")
  .select("*")
  .eq("tenant_id", TENANT)
  .eq("source_type", "income_register")
  .eq("source_id", "8091b3ef-3f13-43c1-bbad-9bab3bdf493a");
console.log("tax legs for June DEDSAV:", JSON.stringify(tax, null, 2));

const { data: taxJuly } = await s
  .from("tax_ledger_entries")
  .select("*")
  .eq("tenant_id", TENANT)
  .eq("source_type", "income_register")
  .eq("source_id", "b60b70db-1179-4226-b86f-bbaefeed1fc5");
console.log("tax legs for July DEDSAV id:", taxJuly);

// Any orphan tax for 85.76?
const { data: tax8576 } = await s
  .from("tax_ledger_entries")
  .select("id, source_type, source_id, tax_component, tax_amount, status, entry_date")
  .eq("tenant_id", TENANT)
  .eq("entry_date", "2026-07-31")
  .eq("source_type", "income_register");
console.log("July 31 income_register tax legs:", tax8576);
