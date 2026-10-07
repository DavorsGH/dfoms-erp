/**
 * Exercise salary advance RPCs with the same payload shape as Loans & Advances UI.
 * Includes month picker value "2026-10" (YYYY-MM).
 *
 * npx tsx scripts/staging-only/test-caanta-advance-ui-payload-staging.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { normalizePayrollMonthStart } from "../../app/dashboard/hr-payroll/salary-advance-register-utils";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";

function buildFormPayload(args: {
  tenantId: string;
  businessUnitId: string | null;
  employeeIds: string[];
  perEmployeeAmounts: Record<string, number>;
  commonAmount: number;
  dateIssued: string;
  deductPayrollMonthPicker: string;
  paymentAccountId: string;
  approvedBy: string;
}) {
  const deductMonth = normalizePayrollMonthStart(
    args.deductPayrollMonthPicker.trim() ||
      normalizePayrollMonthStart(args.dateIssued),
  );
  return {
    tenant_id: args.tenantId,
    business_unit_id: args.businessUnitId,
    advances: args.employeeIds.map((employeeId) => ({
      employee_id: employeeId,
      amount:
        args.perEmployeeAmounts[employeeId] ?? args.commonAmount,
      date_issued: args.dateIssued,
      deduct_payroll_month: deductMonth,
      payment_account_id: args.paymentAccountId,
      approved_by: args.approvedBy,
    })),
  };
}

async function createCaantaUser(admin: SupabaseClient) {
  const stamp = Date.now();
  const email = `ui.adv.${stamp}@test.davors`;
  const password = `UiAdv-${stamp}!Aa9`;
  const { data: userData, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { portal: "staff" },
  });
  if (userErr || !userData.user) throw userErr ?? new Error("createUser");

  const { data: bu } = await admin
    .from("business_units")
    .select("id")
    .eq("tenant_id", CAANTA)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  await admin.from("user_accounts").insert({
    auth_uid: userData.user.id,
    email,
    tenant_id: CAANTA,
    role: "super_admin",
    is_active: true,
    active_business_unit_id: bu?.id ?? null,
  });

  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  const { error: signErr } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (signErr) throw signErr;
  return client;
}

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const userClient = await createCaantaUser(admin);

  const { data: employees } = await admin
    .from("employees")
    .select("employee_id, full_name")
    .eq("tenant_id", CAANTA)
    .limit(2);
  if (!employees || employees.length < 2) {
    throw new Error("Need at least 2 Caanta employees");
  }

  const { data: payAcct } = await admin
    .from("payment_accounts")
    .select("id")
    .eq("tenant_id", CAANTA)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (!payAcct?.id) throw new Error("No payment account");

  const { data: bu } = await admin
    .from("business_units")
    .select("id")
    .eq("tenant_id", CAANTA)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  const dateIssued = "2026-10-07";
  /** Month picker sends YYYY-MM; use an unlocked payroll month on staging for save/delete. */
  const pickerMonth = "2027-01";
  const ids = employees.map((e) => e.employee_id);

  const savePayload = buildFormPayload({
    tenantId: CAANTA,
    businessUnitId: bu?.id ?? null,
    employeeIds: ids,
    commonAmount: 100,
    perEmployeeAmounts: { [ids[0]!]: 100, [ids[1]!]: 150 },
    dateIssued,
    deductPayrollMonthPicker: pickerMonth,
    paymentAccountId: payAcct.id,
    approvedBy: "UI Payload Test Approver",
  });

  console.log(
    "Save payload deduct_payroll_month per row:",
    savePayload.advances[0]?.deduct_payroll_month,
  );

  const { error: rawMonthErr } = await userClient.rpc("save_salary_advances_bulk", {
    p_payload: {
      tenant_id: CAANTA,
      business_unit_id: bu?.id ?? null,
      advances: [
        {
          employee_id: ids[0]!,
          amount: 1,
          date_issued: dateIssued,
          deduct_payroll_month: "2026-10",
          payment_account_id: payAcct.id,
          approved_by: "Raw YYYY-MM parse probe",
        },
      ],
    },
  });
  if (rawMonthErr?.message.includes("invalid input syntax for type date")) {
    console.error("RPC still rejects YYYY-MM:", rawMonthErr.message);
    process.exit(1);
  }
  console.log(
    "RPC accepts YYYY-MM (probe:",
    rawMonthErr ? rawMonthErr.message.slice(0, 80) : "saved",
    ")",
  );
  if (!rawMonthErr) {
    const probe = await admin
      .from("salary_advance_register")
      .select("advance_id")
      .eq("tenant_id", CAANTA)
      .eq("approved_by", "Raw YYYY-MM parse probe")
      .maybeSingle();
    if (probe.data?.advance_id) {
      await userClient.rpc("delete_salary_advance", {
        p_payload: { tenant_id: CAANTA, advance_id: probe.data.advance_id },
      });
    }
  }

  const { data: saveData, error: saveErr } = await userClient.rpc(
    "save_salary_advances_bulk",
    { p_payload: savePayload },
  );
  if (saveErr) {
    console.error("SAVE failed:", saveErr.message);
    process.exit(1);
  }
  const advanceIds = (saveData as { advanceIds?: string[] })?.advanceIds ?? [];
  console.log("SAVE ok, advanceIds:", advanceIds);

  const editId = advanceIds[0];
  if (!editId) throw new Error("No advance id returned");

  const { error: updateErr } = await userClient.rpc("update_salary_advance", {
    p_payload: {
      tenant_id: CAANTA,
      advance_id: editId,
      amount: 125,
      date_issued: dateIssued,
      deduct_payroll_month: pickerMonth,
      payment_account_id: payAcct.id,
      approved_by: "UI Payload Test Approver",
    },
  });
  if (updateErr) {
    console.error("UPDATE failed:", updateErr.message);
    process.exit(1);
  }
  console.log("UPDATE ok (deduct month picker YYYY-MM)");

  for (const advanceId of advanceIds) {
    const { error: delErr } = await userClient.rpc("delete_salary_advance", {
      p_payload: { tenant_id: CAANTA, advance_id: advanceId },
    });
    if (delErr) {
      console.error("DELETE failed:", delErr.message);
      process.exit(1);
    }
  }
  console.log("DELETE ok for all test advances");
  console.log("All UI-path advance tests passed on Caanta.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
