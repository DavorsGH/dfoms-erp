/**
 * Snapshot payroll lock finance postings → reopen → re-lock → compare (staging).
 *
 * npx tsx scripts/staging-only/prove-payroll-relock-postings.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { connectPg } from "../lib/pg-connect";

config({ path: resolve(process.cwd(), ".env.staging.local") });

/** Caanta only — do not mutate Davors payroll on staging. */
const TENANT = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";

async function fingerprint(admin: ReturnType<typeof createClient>, tenantId: string, payrollMonth: string) {
  const periodKey = payrollMonth.slice(0, 7);
  const sal = `PAYROLL-SAL-${periodKey}`;
  const essnit = `PAYROLL-ESSNIT-${periodKey}`;
  const ded = `PAYROLL-DEDSAV-${periodKey}`;

  const [expSal, expEssnit, incDed, tax, welfare] = await Promise.all([
    admin
      .from("expense_register")
      .select(
        "receipt_no, amount, payment_status, expense_category, expense_subcategory, notes, business_unit_id",
      )
      .eq("tenant_id", tenantId)
      .eq("receipt_no", sal),
    admin
      .from("expense_register")
      .select(
        "receipt_no, amount, payment_status, expense_category, expense_subcategory, notes, business_unit_id",
      )
      .eq("tenant_id", tenantId)
      .eq("receipt_no", essnit),
    admin
      .from("income_register")
      .select("invoice_no, amount, income_category, notes, business_unit_id")
      .eq("tenant_id", tenantId)
      .eq("invoice_no", ded),
    admin
      .from("tax_ledger_entries")
      .select("tax_component, tax_amount, status, business_unit_id, source_id")
      .eq("tenant_id", tenantId)
      .eq("source_type", "payroll_period")
      .like("source_id", `%${periodKey}%`),
    admin
      .from("staff_welfare_fund_accrual")
      .select("employee_id, accrual_amount, payroll_month, business_unit_id")
      .eq("tenant_id", tenantId)
      .eq("payroll_month", payrollMonth),
  ]);

  const pack = {
    expenseSal: expSal.data ?? [],
    expenseEssnit: expEssnit.data ?? [],
    incomeDedSav: incDed.data ?? [],
    tax: (tax.data ?? []).sort((a, b) =>
      String(a.tax_component).localeCompare(String(b.tax_component)),
    ),
    welfare: (welfare.data ?? []).sort((a, b) =>
      String(a.employee_id).localeCompare(String(b.employee_id)),
    ),
  };

  return JSON.stringify(pack, (_k, v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v));
}

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { client: pg } = await connectPg({
    requiredProjectRef: "wieflwbfdmjtsdnwbfii",
    envFiles: [".env.staging.local", ".env.local"],
  });

  const { rows: candidates } = await pg.query<{
    payroll_month: string;
    business_unit_id: string;
  }>(`
    SELECT mec.month::text AS payroll_month,
           mec.business_unit_id::text AS business_unit_id
    FROM month_end_close mec
    WHERE mec.tenant_id = $1
      AND mec.lock_status = 'Partially Locked'
      AND EXISTS (
        SELECT 1
        FROM payroll_history ph
        WHERE ph.tenant_id = mec.tenant_id
          AND ph.payroll_month = mec.month
          AND ph.locked = true
      )
    ORDER BY mec.month DESC
    LIMIT 1
  `, [TENANT]);

  let payrollMonth = candidates[0]?.payroll_month?.slice(0, 10) ?? null;
  let buId = candidates[0]?.business_unit_id ?? null;
  if (!payrollMonth) {
    const { data: buRow } = await admin
      .from("business_units")
      .select("id")
      .eq("tenant_id", TENANT)
      .limit(1)
      .maybeSingle();
    payrollMonth = "2026-06-01";
    buId = buRow?.id ?? null;
    console.log("Fallback: Caanta Jun 2026 (first BU)");
  }
  const periodYear = Number(payrollMonth.slice(0, 4));
  const periodMonth = Number(payrollMonth.slice(5, 7));

  console.log(`Using locked month ${payrollMonth} BU ${buId} (DEDSAV/other ded present)`);

  const before = await fingerprint(admin, TENANT, payrollMonth);
  console.log("Before reopen fingerprint length:", before.length);

  const { data: histRows, error: histErr } = await admin
    .from("payroll_history")
    .select("employee_id")
    .eq("tenant_id", TENANT)
    .eq("payroll_month", payrollMonth);
  if (histErr) throw histErr;
  const employeeIds = [...new Set((histRows ?? []).map((r) => r.employee_id))];

  const { error: reopenErr } = await admin.rpc("reopen_payroll_period", {
    p_tenant_id: TENANT,
    p_business_unit_id: buId,
    p_employee_ids: employeeIds,
    p_payroll_month: payrollMonth,
    p_period_year: periodYear,
    p_period_month: periodMonth,
  });
  if (reopenErr) throw reopenErr;

  const { data: procRows, error: procErr } = await admin
    .from("payroll_processing")
    .select("*")
    .eq("tenant_id", TENANT)
    .eq("payroll_month", payrollMonth);
  if (procErr) throw procErr;

  const { error: lockErr } = await admin.rpc("lock_payroll_period", {
    p_tenant_id: TENANT,
    p_business_unit_id: buId,
    p_employee_ids: (procRows ?? []).map((r) => r.employee_id),
    p_payroll_month: payrollMonth,
    p_period_year: periodYear,
    p_period_month: periodMonth,
    p_lock_status: "Locked",
    p_notes: "Release 1 re-lock posting compare",
    p_rows: procRows ?? [],
  });
  if (lockErr) throw lockErr;

  const after = await fingerprint(admin, TENANT, payrollMonth);
  console.log("After re-lock fingerprint length:", after.length);

  if (before !== after) {
    console.error("DIFF detected between before and after fingerprints");
    console.log("BEFORE", before);
    console.log("AFTER ", after);
    process.exit(1);
  }

  console.log("PASS: payroll lock postings identical after reopen + re-lock.");
  await pg.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
