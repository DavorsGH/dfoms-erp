/**
 * Release (reopen) a Caanta payroll month if locked — staging cleanup helper.
 * npx tsx scripts/staging-only/caanta-release-payroll-month-staging.ts 2026-08-01
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";

async function main() {
  const payrollMonth = process.argv[2] ?? "2026-08-01";
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { data: bu } = await admin
    .from("business_units")
    .select("id")
    .eq("tenant_id", CAANTA)
    .limit(1)
    .single();
  const { data: emps } = await admin
    .from("employees")
    .select("employee_id")
    .eq("tenant_id", CAANTA);
  const ids = (emps ?? []).map((e) => e.employee_id);
  const y = Number(payrollMonth.slice(0, 4));
  const m = Number(payrollMonth.slice(5, 7));
  const { error } = await admin.rpc("release_payroll_period", {
    p_tenant_id: CAANTA,
    p_business_unit_id: bu!.id,
    p_employee_ids: ids,
    p_payroll_month: payrollMonth,
    p_period_year: y,
    p_period_month: m,
  });
  console.log(`release ${payrollMonth}:`, error?.message ?? "OK");
}

main();
