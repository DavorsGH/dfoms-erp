/**
 * Caanta: lock month with DEDSAV mix → reopen → re-lock → identical postings.
 * Includes legacy manual advance, absence, loan, register advance (register excluded from DEDSAV).
 *
 * npx tsx scripts/staging-only/prove-payroll-dedsav-caanta-staging.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { calculatePayrollDeductionSavingsTotal } from "../../app/dashboard/hr-payroll/payroll-lock-finance-utils";
import type { SalaryAdvanceRegisterEntry } from "../../app/dashboard/hr-payroll/salary-advance-register-utils";
import type { PayrollProcessingRow } from "../../app/dashboard/hr-payroll/payroll-processing-utils";
import {
  applyRegisterSalaryAdvancesToLockRows,
  expectedDedsavAmount,
} from "./payroll-lock-row-utils";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const PAYROLL_MONTH = "2026-07-01";
const STAMP = Date.now();

async function createHrUser(admin: SupabaseClient) {
  const email = `r1.dedsav.${STAMP}@test.davors`;
  const password = `R1Ded-${STAMP}!Aa9`;
  const { data: u, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { portal: "staff" },
  });
  if (error || !u.user) throw error ?? new Error("createUser");
  await admin.from("user_accounts").insert({
    auth_uid: u.user.id,
    email,
    tenant_id: CAANTA,
    role: "super_admin",
    is_active: true,
  });
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  await client.auth.signInWithPassword({ email, password });
  return { client, email, authUid: u.user.id };
}

async function fingerprint(admin: SupabaseClient, payrollMonth: string) {
  const periodKey = payrollMonth.slice(0, 7);
  const ded = `PAYROLL-DEDSAV-${periodKey}`;
  const sal = `PAYROLL-SAL-${periodKey}`;
  const { data: incDed } = await admin
    .from("income_register")
    .select("invoice_no, amount, description, business_unit_id, notes")
    .eq("tenant_id", CAANTA)
    .eq("invoice_no", ded);
  const { data: expSal } = await admin
    .from("expense_register")
    .select("receipt_no, amount, expense_category, business_unit_id")
    .eq("tenant_id", CAANTA)
    .eq("receipt_no", sal);
  return JSON.stringify(
    { incomeDedSav: incDed ?? [], expenseSal: expSal ?? [] },
    (_k, v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v),
  );
}

async function main() {
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
  if (!bu?.id) throw new Error("Caanta BU missing");

  const { data: employees } = await admin
    .from("employees")
    .select("employee_id, full_name")
    .eq("tenant_id", CAANTA)
    .limit(3);
  if (!employees || employees.length < 3) {
    throw new Error("Need 3 Caanta employees for DEDSAV proof");
  }
  const [empLegacy, empLoan, empRegister] = employees;

  let payAccountId: string;
  const { data: pay } = await admin
    .from("payment_accounts")
    .select("id")
    .eq("tenant_id", CAANTA)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (pay?.id) payAccountId = pay.id;
  else {
    const { data: seeded } = await admin
      .from("payment_accounts")
      .insert({
        tenant_id: CAANTA,
        account_name: "Step44 DEDSAV staging cash",
        is_active: true,
      })
      .select("id")
      .single();
    payAccountId = seeded!.id;
  }

  const { client: userClient, authUid } = await createHrUser(admin);

  for (const emp of employees) {
    const { data: existing } = await admin
      .from("payroll_processing")
      .select("id")
      .eq("tenant_id", CAANTA)
      .eq("payroll_month", PAYROLL_MONTH)
      .eq("employee_id", emp.employee_id)
      .maybeSingle();
    if (existing?.id) continue;
    await admin.from("payroll_processing").insert({
      tenant_id: CAANTA,
      payroll_month: PAYROLL_MONTH,
      employee_id: emp.employee_id,
      status: "Open",
      department: "Step44 DEDSAV test",
      basic_salary: 2000,
      housing_allowance: 0,
      transport_allowance: 0,
      other_allowances: 0,
      days_to_pay: 22,
      overtime_amount: 0,
      bonuses: 0,
      arrears: 0,
      gross_pay: 2000,
      employee_ssnit: 110,
      employer_ssnit: 260,
      tier2: 50,
      paye_tax: 100,
      loan_repayment: 0,
      salary_advance: 0,
      welfare_deduction: 0,
      other_deductions: 0,
      absence_deduction: 0,
      total_deductions: 210,
      net_pay: 1790,
      net_only_adjustment: 0,
    });
  }

  await admin
    .from("payroll_processing")
    .update({
      absence_deduction: 25,
      salary_advance: 15,
      total_deductions: 250,
      net_pay: 1750,
    })
    .eq("tenant_id", CAANTA)
    .eq("payroll_month", PAYROLL_MONTH)
    .eq("employee_id", empLegacy!.employee_id);

  await admin
    .from("payroll_processing")
    .update({
      loan_repayment: 40,
      other_deductions: 10,
      total_deductions: 260,
      net_pay: 1740,
    })
    .eq("tenant_id", CAANTA)
    .eq("payroll_month", PAYROLL_MONTH)
    .eq("employee_id", empLoan!.employee_id);

  const { error: advErr } = await userClient.rpc("save_salary_advances_bulk", {
    p_payload: {
      tenant_id: CAANTA,
      business_unit_id: bu.id,
      advances: [
        {
          employee_id: empRegister!.employee_id,
          amount: 100,
          date_issued: "2026-07-15",
          deduct_payroll_month: PAYROLL_MONTH,
          payment_account_id: payAccountId,
          approved_by: "Step44 DEDSAV",
        },
      ],
    },
  });
  if (advErr) throw advErr;

  const { data: registerRows } = await admin
    .from("salary_advance_register")
    .select("*")
    .eq("tenant_id", CAANTA)
    .eq("deduct_payroll_month", PAYROLL_MONTH)
    .eq("status", "outstanding");
  const advances = (registerRows ?? []) as SalaryAdvanceRegisterEntry[];

  const { data: procRows } = await admin
    .from("payroll_processing")
    .select("*")
    .eq("tenant_id", CAANTA)
    .eq("payroll_month", PAYROLL_MONTH)
    .eq("status", "Open");
  const lockRows = applyRegisterSalaryAdvancesToLockRows(
    (procRows ?? []) as PayrollProcessingRow[],
    advances,
    PAYROLL_MONTH,
    bu.id,
  );

  const expectedDedsav = expectedDedsavAmount(lockRows, advances, PAYROLL_MONTH, bu.id);
  const legacyOnly = calculatePayrollDeductionSavingsTotal(
    lockRows.filter((r) => r.employee_id === empLegacy!.employee_id),
    { registerAdvances: advances, payrollMonth: PAYROLL_MONTH, businessUnitId: bu.id },
  );
  const registerRow = lockRows.find((r) => r.employee_id === empRegister!.employee_id);
  console.log("Expected DEDSAV total:", expectedDedsav);
  console.log("Legacy employee DEDSAV portion (absence+manual adv):", legacyOnly);
  console.log(
    "Register employee salary_advance on lock row:",
    registerRow?.salary_advance,
    "(register; should not add to DEDSAV)",
  );
  if (legacyOnly < 35) {
    throw new Error("Legacy DEDSAV portion too low");
  }
  if ((registerRow?.salary_advance ?? 0) < 99) {
    throw new Error("Register advance not auto-filled on lock row");
  }

  const { data: allEmps } = await admin
    .from("employees")
    .select("employee_id")
    .eq("tenant_id", CAANTA);
  const allEmployeeIds = (allEmps ?? []).map((e) => e.employee_id);
  await admin.rpc("release_payroll_period", {
    p_tenant_id: CAANTA,
    p_business_unit_id: bu.id,
    p_employee_ids: allEmployeeIds,
    p_payroll_month: PAYROLL_MONTH,
    p_period_year: 2026,
    p_period_month: 7,
  });

  const { error: lockErr } = await admin.rpc("lock_payroll_period", {
    p_tenant_id: CAANTA,
    p_business_unit_id: bu.id,
    p_employee_ids: lockRows.map((r) => r.employee_id),
    p_payroll_month: PAYROLL_MONTH,
    p_period_year: 2026,
    p_period_month: 7,
    p_lock_status: "Partially Locked",
    p_notes: "Step44 DEDSAV proof",
    p_rows: lockRows,
  });
  if (lockErr) throw lockErr;

  const before = await fingerprint(admin, PAYROLL_MONTH);
  const { data: inc } = await admin
    .from("income_register")
    .select("amount")
    .eq("tenant_id", CAANTA)
    .eq("invoice_no", `PAYROLL-DEDSAV-2026-07`)
    .maybeSingle();
  const postedDedsav = Number(inc?.amount) || 0;
  console.log("Posted PAYROLL-DEDSAV amount:", postedDedsav);
  if (Math.abs(postedDedsav - expectedDedsav) > 0.05) {
    throw new Error(`DEDSAV mismatch expected ${expectedDedsav} got ${postedDedsav}`);
  }

  const { error: reopenErr } = await admin.rpc("reopen_payroll_period", {
    p_tenant_id: CAANTA,
    p_business_unit_id: bu.id,
    p_employee_ids: lockRows.map((r) => r.employee_id),
    p_payroll_month: PAYROLL_MONTH,
    p_period_year: 2026,
    p_period_month: 7,
  });
  if (reopenErr) throw reopenErr;

  const { data: procAfterReopen } = await admin
    .from("payroll_processing")
    .select("*")
    .eq("tenant_id", CAANTA)
    .eq("payroll_month", PAYROLL_MONTH);
  const relockRows = applyRegisterSalaryAdvancesToLockRows(
    (procAfterReopen ?? []) as PayrollProcessingRow[],
    advances,
    PAYROLL_MONTH,
    bu.id,
  );

  const { error: relockErr } = await admin.rpc("lock_payroll_period", {
    p_tenant_id: CAANTA,
    p_business_unit_id: bu.id,
    p_employee_ids: relockRows.map((r) => r.employee_id),
    p_payroll_month: PAYROLL_MONTH,
    p_period_year: 2026,
    p_period_month: 7,
    p_lock_status: "Partially Locked",
    p_notes: "Step44 DEDSAV re-lock",
    p_rows: relockRows,
  });
  if (relockErr) throw relockErr;

  const after = await fingerprint(admin, PAYROLL_MONTH);
  if (before !== after) {
    console.error("BEFORE", before);
    console.error("AFTER", after);
    throw new Error("DEDSAV fingerprint changed after reopen/re-lock");
  }

  await admin.rpc("release_payroll_period", {
    p_tenant_id: CAANTA,
    p_business_unit_id: bu.id,
    p_employee_ids: relockRows.map((r) => r.employee_id),
    p_payroll_month: PAYROLL_MONTH,
    p_period_year: 2026,
    p_period_month: 7,
  });

  for (const row of advances) {
    await userClient.rpc("delete_salary_advance", {
      p_payload: { tenant_id: CAANTA, advance_id: row.advance_id },
    });
  }
  await admin
    .from("payroll_processing")
    .delete()
    .eq("tenant_id", CAANTA)
    .eq("payroll_month", PAYROLL_MONTH)
    .eq("department", "Step44 DEDSAV test");
  await admin.from("user_accounts").delete().eq("auth_uid", authUid);
  await admin.auth.admin.deleteUser(authUid);

  console.log("\nPASS: Caanta DEDSAV reopen/re-lock + register advance excluded from DEDSAV.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
