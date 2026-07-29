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
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

// CL-001 details
const { data: client } = await admin
  .from("clients")
  .select("client_id, client_name, service_category, tenant_id")
  .eq("client_id", "CL-001")
  .maybeSingle();
console.log("CL-001:", client);

// Any tax ledger rows referencing DEDSAV / that income id
const { data: tax } = await admin
  .from("tax_ledger_entries")
  .select("id, source_type, source_id, tax_component, tax_amount, status, entry_date, notes, description")
  .eq("tenant_id", TENANT)
  .or(
    "source_id.eq.b60b70db-1179-4226-b86f-bbaefeed1fc5,source_id.eq.8091b3ef-3f13-43c1-bbad-9bab3bdf493a,source_id.ilike.%DEDSAV%,notes.ilike.%DEDSAV%,description.ilike.%DEDSAV%",
  );
console.log("tax ledger hits:", tax);

// Broader: income-sourced tax around June 30 / July 31 2026 with 40.82 or 85.76
const { data: tax2 } = await admin
  .from("tax_ledger_entries")
  .select("id, source_type, source_id, tax_component, tax_amount, status, entry_date")
  .eq("tenant_id", TENANT)
  .in("tax_amount", [40.82, 85.76, 244.94, 204.12]);
console.log("tax by amounts:", tax2);

// payroll_history locked flags for July (reopen would unlock/move)
const { data: julyHist } = await admin
  .from("payroll_history")
  .select("locked, locked_at")
  .eq("tenant_id", TENANT)
  .eq("payroll_month", "2026-07-01")
  .limit(5);
console.log("July history locked sample:", julyHist);

const { count: julyProc } = await admin
  .from("payroll_processing")
  .select("*", { count: "exact", head: true })
  .eq("tenant_id", TENANT)
  .eq("payroll_month", "2026-07-01");
console.log("July processing rows:", julyProc);

// Compare script constants to live June row fields
const scriptExpected = {
  customer_name: "Payroll",
  client_id: null,
  service_category: "Other Income",
  outstanding_balance: 0,
  payment_status: "Unpaid",
  net_of_tax_amount: 244.94,
  output_vat_amount: 0,
  output_tax_component: null,
  notes:
    "One-time backfill: non-cash payroll deduction savings for period locked before auto-post existed.",
};
const { data: june } = await admin
  .from("income_register")
  .select("*")
  .eq("invoice_no", "PAYROLL-DEDSAV-2026-06")
  .single();

console.log("\nJune field-by-field vs script payload:");
for (const [k, v] of Object.entries(scriptExpected)) {
  const actual = june?.[k];
  const match = actual === v || (v === null && actual === null);
  console.log(
    `${match ? "MATCH" : "DIFF "} ${k}: expected=${JSON.stringify(v)} actual=${JSON.stringify(actual)}`,
  );
}

// Schema: any created_at?
console.log("\nJune keys:", Object.keys(june ?? {}));
