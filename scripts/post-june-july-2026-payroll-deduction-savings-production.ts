/**
 * PRODUCTION one-time correction: post PAYROLL-DEDSAV income for June/July 2026.
 *
 * These periods were locked before deduction-savings auto-post existed.
 * Amounts = sum(absence + loan + advance + welfare + other) from payroll_history
 * (confirmed: absence only — June 244.94, July 85.76). Does NOT touch loan_register.
 *
 * Usage:
 *   npx tsx scripts/post-june-july-2026-payroll-deduction-savings-production.ts --dry-run
 *   npx tsx scripts/post-june-july-2026-payroll-deduction-savings-production.ts --env-file .env.local.backup --allow-production
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildPayrollDeductionSavingsDescription,
  buildPayrollDeductionSavingsInvoiceNo,
  PAYROLL_INCOME_CATEGORY_OTHER,
  PAYROLL_INCOME_CUSTOMER_NAME,
  PAYROLL_INCOME_PAYMENT_STATUS,
  resolvePayrollLockFinancePeriod,
} from "../app/dashboard/hr-payroll/payroll-lock-finance-utils";

const PRODUCTION_PROJECT_REF = "tvcurcnmasnocwdxzgvz";
const TENANT = "00000001-0000-4000-8000-000000000001";

const CORRECTIONS = [
  { payrollMonth: "2026-06-01", expectedAmount: 244.94 },
  { payrollMonth: "2026-07-01", expectedAmount: 85.76 },
] as const;

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    let value = trimmed.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[trimmed.slice(0, i).trim()] = value;
  }
}

function parseArgs(argv: string[]) {
  let envFile = ".env.local.backup";
  let allowProduction = false;
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--allow-production") allowProduction = true;
    else if (arg === "--env-file") envFile = argv[++i] ?? envFile;
  }
  return { envFile, allowProduction, dryRun };
}

function r2(n: number) {
  return Math.round(n * 100) / 100;
}

async function sumHistoryDeductionSavings(admin, payrollMonth: string) {
  const { data, error } = await admin
    .from("payroll_history")
    .select(
      "absence_deduction, loan_repayment, salary_advance, welfare_deduction, other_deductions",
    )
    .eq("tenant_id", TENANT)
    .eq("payroll_month", payrollMonth);

  if (error) throw new Error(error.message);

  return r2(
    (data ?? []).reduce(
      (sum, row) =>
        sum +
        (Number(row.absence_deduction) || 0) +
        (Number(row.loan_repayment) || 0) +
        (Number(row.salary_advance) || 0) +
        (Number(row.welfare_deduction) || 0) +
        (Number(row.other_deductions) || 0),
      0,
    ),
  );
}

async function main() {
  const { envFile, allowProduction, dryRun } = parseArgs(process.argv.slice(2));
  loadEnvForce(resolve(envFile));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(PRODUCTION_PROJECT_REF)) {
    throw new Error(
      `Refusing to run: URL is not production (${PRODUCTION_PROJECT_REF}). Got: ${url}`,
    );
  }
  if (!allowProduction && !dryRun) {
    throw new Error("Pass --allow-production to write, or --dry-run to preview.");
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  console.log(dryRun ? "DRY RUN" : "APPLYING PRODUCTION CORRECTION");
  console.log("Tenant", TENANT);

  for (const correction of CORRECTIONS) {
    const period = resolvePayrollLockFinancePeriod(correction.payrollMonth);
    if (!period) {
      throw new Error(`Unable to resolve period ${correction.payrollMonth}`);
    }

    const liveSum = await sumHistoryDeductionSavings(
      admin,
      correction.payrollMonth,
    );
    if (liveSum !== correction.expectedAmount) {
      throw new Error(
        `${correction.payrollMonth}: history sum ${liveSum} != expected ${correction.expectedAmount}`,
      );
    }

    const periodKey = correction.payrollMonth.slice(0, 7);
    const invoiceNo = buildPayrollDeductionSavingsInvoiceNo(periodKey);
    const description = buildPayrollDeductionSavingsDescription(period.monthLabel);

    const { data: existing, error: existingError } = await admin
      .from("income_register")
      .select("id, amount, invoice_no, description")
      .eq("tenant_id", TENANT)
      .eq("invoice_no", invoiceNo)
      .maybeSingle();

    if (existingError) throw new Error(existingError.message);

    const payload = {
      tenant_id: TENANT,
      date: period.periodEndDate,
      due_date: period.periodEndDate,
      invoice_no: invoiceNo,
      customer_name: PAYROLL_INCOME_CUSTOMER_NAME,
      client_id: null,
      entry_type: "service",
      service_category: PAYROLL_INCOME_CATEGORY_OTHER,
      description,
      amount: correction.expectedAmount,
      amount_received: 0,
      outstanding_balance: 0,
      payment_status: PAYROLL_INCOME_PAYMENT_STATUS,
      notes:
        "One-time backfill: non-cash payroll deduction savings for period locked before auto-post existed.",
      tax_inclusive: true,
      net_of_tax_amount: correction.expectedAmount,
      output_vat_amount: 0,
      output_tax_component: null,
      wht_rate: null,
      wht_amount: 0,
    };

    console.log("\n---", period.monthLabel, "---");
    console.log("invoice_no", invoiceNo);
    console.log("amount", correction.expectedAmount);
    console.log("existing", existing);

    if (dryRun) {
      console.log("Would upsert income_register payload:", payload);
      continue;
    }

    if (existing) {
      if (Number(existing.amount) === correction.expectedAmount) {
        console.log("Already correct — skipping update");
        continue;
      }
      const { error } = await admin
        .from("income_register")
        .update({
          date: payload.date,
          due_date: payload.due_date,
          customer_name: payload.customer_name,
          service_category: payload.service_category,
          description: payload.description,
          amount: payload.amount,
          amount_received: payload.amount_received,
          outstanding_balance: payload.outstanding_balance,
          payment_status: payload.payment_status,
          notes: payload.notes,
          net_of_tax_amount: payload.net_of_tax_amount,
          output_vat_amount: payload.output_vat_amount,
          wht_amount: payload.wht_amount,
        })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
      console.log("Updated existing income row", existing.id);
    } else {
      const { data: inserted, error } = await admin
        .from("income_register")
        .insert(payload)
        .select("id, invoice_no, amount")
        .single();
      if (error) throw new Error(error.message);
      console.log("Inserted", inserted);
    }
  }

  console.log("\nDone. loan_register was not modified.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
