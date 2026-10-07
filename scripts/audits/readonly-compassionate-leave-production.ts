import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const COMPASSIONATE = "Compassionate Leave";
const PROD_REF = "tvcurcnmasnocwdxzgvz";

function loadEnv(filePath: string) {
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

async function main() {
  loadEnv(resolve(".env.local.production-backup-2026-08-25"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(PROD_REF)) {
    throw new Error("Refusing non-production env");
  }
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: tenants } = await admin.from("tenants").select("id, name").order("name");

  const { count: lmCount, error: lmErr } = await admin
    .from("leave_management")
    .select("*", { count: "exact", head: true })
    .eq("leave_type", COMPASSIONATE);

  console.log(`leave_management (${COMPASSIONATE}): ${lmErr?.message ?? lmCount ?? 0}`);

  const { data: lmSample } = await admin
    .from("leave_management")
    .select("tenant_id, leave_id, employee_id, leave_type, start_date, approval_status")
    .eq("leave_type", COMPASSIONATE)
    .limit(10);

  if ((lmSample ?? []).length) {
    console.log("leave_management sample:", lmSample);
  }

  const { data: ltRows } = await admin
    .from("leave_types")
    .select("id, tenant_id, type_name")
    .eq("type_name", COMPASSIONATE);

  console.log(`leave_types rows named "${COMPASSIONATE}": ${(ltRows ?? []).length}`);

  const { data: allTypes } = await admin.from("leave_types").select("tenant_id, type_name");
  const byTenant = new Map<string, Set<string>>();
  for (const row of allTypes ?? []) {
    const tid = String(row.tenant_id);
    if (!byTenant.has(tid)) byTenant.set(tid, new Set());
    byTenant.get(tid)!.add(String(row.type_name));
  }

  console.log("\nTenants missing Compassionate Leave in leave_types:");
  for (const t of tenants ?? []) {
    const have = byTenant.get(t.id) ?? new Set();
    if (!have.has(COMPASSIONATE)) {
      console.log(`  ${t.name} (${t.id})`);
    }
  }

  const { data: lrAll } = await admin
    .from("leave_requests")
    .select("id, tenant_id, employee_id, leave_type_id, status, leave_types(type_name)")
    .limit(5000);

  const lrCompassionate = (lrAll ?? []).filter(
    (r) =>
      (r.leave_types as { type_name?: string } | null)?.type_name ===
        COMPASSIONATE ||
      String((r.leave_types as { type_name?: string } | null)?.type_name ?? "")
        .toLowerCase()
        .includes("compassionate"),
  );

  console.log(`\nleave_requests with Compassionate type (in sample): ${lrCompassionate.length}`);

  const { data: balances } = await admin
    .from("employee_leave_balances")
    .select("id, employee_id, year, leave_type_id, leave_types(type_name)")
    .limit(5000);

  const balComp = (balances ?? []).filter(
    (b) =>
      (b.leave_types as { type_name?: string } | null)?.type_name ===
      COMPASSIONATE,
  );
  console.log(`employee_leave_balances (Compassionate, in sample): ${balComp.length}`);

  const variants = ["Compassionate", "compassionate leave", "Compassionate leave"];
  for (const v of variants) {
    if (v === COMPASSIONATE) continue;
    const { count } = await admin
      .from("leave_management")
      .select("*", { count: "exact", head: true })
      .ilike("leave_type", v);
    if (count && count > 0) {
      console.log(`leave_management ilike '${v}': ${count}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
