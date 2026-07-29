import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

async function main() {
  const raw = readFileSync(".env.staging.local", "utf8");
  const env: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    env[m[1].trim()] = v;
  }
  const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("Missing URL/key");
    process.exit(1);
  }
  console.log("target_url=", url);
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const tenant = "00000001-0000-4000-8000-000000000001";
  const month = "2026-07-01";
  const { data: close, error: cErr } = await admin
    .from("month_end_close")
    .select("month, lock_status, notes")
    .eq("tenant_id", tenant)
    .eq("month", month)
    .maybeSingle();
  console.log("month_end_close:", JSON.stringify(close), cErr ? "ERR:" + cErr.message : "");
  const { count, error } = await admin
    .from("payroll_processing")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenant)
    .eq("payroll_month", month);
  console.log("payroll_processing count:", count, error ? "ERR:" + error.message : "");
  const { data: byStatus, error: sErr } = await admin
    .from("payroll_processing")
    .select("status")
    .eq("tenant_id", tenant)
    .eq("payroll_month", month);
  if (sErr) console.log("status query ERR:", sErr.message);
  else {
    const map: Record<string, number> = {};
    for (const r of byStatus || []) {
      const k = String((r as any).status ?? "(null)");
      map[k] = (map[k] || 0) + 1;
    }
    console.log("by_status:", JSON.stringify(map));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
