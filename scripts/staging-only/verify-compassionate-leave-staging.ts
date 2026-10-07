import { config } from "dotenv";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { fetchLeavePageData } from "../../app/dashboard/hr-payroll/leave-page-fetch";
import { fetchLeaveBalancesPageData } from "../../app/dashboard/hr-payroll/leave-balances-page-fetch";
import { resolveBusinessUnitReadScope } from "../../utils/business-unit-view";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const DAVORS = "00000001-0000-4000-8000-000000000001";
const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";

async function sessionUser(admin: ReturnType<typeof createClient>, tenantId: string, label: string) {
  const stamp = Date.now();
  const email = `cl.${label}.${stamp}@test.davors`;
  const password = `Cl-${stamp}!Aa9`;
  const { data: userData } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { portal: "staff" },
  });
  const { data: bu } = await admin
    .from("business_units")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  await admin.from("user_accounts").insert({
    auth_uid: userData.user!.id,
    email,
    tenant_id: tenantId,
    role: "super_admin",
    is_active: true,
    active_business_unit_id: bu?.id ?? null,
  });
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  await client.auth.signInWithPassword({ email, password });
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits: false,
    activeBusinessUnitId: bu?.id ?? null,
  });
  return { client, tenantId, buScope, label };
}

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  let failed = 0;
  for (const [tenantId, label] of [
    [DAVORS, "davors"],
    [CAANTA, "caanta"],
  ] as const) {
    const session = await sessionUser(admin, tenantId, label);
    const leave = await fetchLeavePageData(session.client, session.tenantId, session.buScope);
    const hasCompassionate = leave.leaveTypeOptions.includes("Compassionate Leave");
    console.log(
      `[${label}] leave types (${leave.leaveTypeOptions.length}): ${leave.leaveTypeOptions.join(", ")}`,
    );
    if (!hasCompassionate) {
      console.error(`FAIL [${label}] missing Compassionate Leave in HR Leave dropdown`);
      failed += 1;
    }

    const bal = await fetchLeaveBalancesPageData(
      session.client,
      session.tenantId,
      session.buScope,
      new Date().getFullYear(),
    );
    const typeNames = bal.leaveTypes.map((t) => t.type_name);
    if (!typeNames.includes("Compassionate Leave")) {
      console.error(`FAIL [${label}] missing Compassionate Leave in balances leaveTypes`);
      failed += 1;
    }
    const foreign = bal.employees.filter((e) =>
      e.employee_id.startsWith(label === "davors" ? "CAN-" : "DF-"),
    ).length;
    if (foreign > 0) {
      console.error(`FAIL [${label}] foreign employees on balances: ${foreign}`);
      failed += 1;
    } else {
      console.log(`PASS [${label}] balances scoped (${bal.employees.length} employees)`);
    }
  }
  if (failed) process.exit(1);
  console.log("All compassionate + isolation checks passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
