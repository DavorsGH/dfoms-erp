/**
 * PRODUCTION one-time backfill: AP accrual expense_register rows for two
 * Davors operating payables that pre-date the live auto-post path
 * (Ernest Lartey / Direct Operational / Transportation — invoices 0001, 0003).
 *
 * Invoice 000 is intentionally excluded: July already has manual Settled expense
 * DF-EXP-0003 for the same GHS 1,810; backfilling would double-count P&L.
 *
 * Inserts via postAccountsPayableAccrualExpense (same function as AP create/edit).
 *
 * Usage:
 *   npx tsx scripts/backfill-ap-accrual-davors-production.ts --dry-run
 *   npx tsx scripts/backfill-ap-accrual-davors-production.ts --env-file .env.local.backup --allow-production
 *
 * Do not run --allow-production until dry-run is reviewed.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  buildAccountsPayableAccrualExpensePayload,
  buildAccountsPayableAccrualReceiptNo,
  postAccountsPayableAccrualExpense,
  shouldPostAccountsPayableAccrualExpense,
  type AccountsPayableAccrualSource,
} from "../app/dashboard/finance/accounts-payable-accrual-utils";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
} from "../app/dashboard/finance/balance-sheet-utils";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";

const PRODUCTION_PROJECT_REF = "tvcurcnmasnocwdxzgvz";
const TENANT = "00000001-0000-4000-8000-000000000001";
const YEAR = 2026;

/** Known operating APs needing backfill (000 excluded — already paired with DF-EXP-0003). */
const TARGET_INVOICES = ["0001", "0003"] as const;

const BS_MONTHS = [
  { label: "July 2026", index: 6 },
  { label: "August 2026", index: 7 },
  { label: "September 2026", index: 8 },
] as const;

type ApRow = {
  id: string;
  vendor_name: string;
  invoice_number: string | null;
  expense_category: string | null;
  sub_category: string | null;
  invoice_date: string;
  due_date: string | null;
  amount: number | null;
  amount_paid: number | null;
  balance_due: number | null;
  net_of_tax_amount: number | null;
  gross_before_wht: number | null;
  wht_rate: number | null;
  wht_amount: number | null;
  input_vat_amount: number | null;
  business_unit_id: string | null;
  source_type: string | null;
};

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

function toAccrualSource(row: ApRow): AccountsPayableAccrualSource {
  return {
    id: row.id,
    vendor_name: row.vendor_name,
    invoice_number: row.invoice_number,
    expense_category: row.expense_category,
    sub_category: row.sub_category,
    invoice_date: row.invoice_date,
    due_date: row.due_date,
    amount: Number(row.amount) || 0,
    net_of_tax_amount: row.net_of_tax_amount,
    gross_before_wht: row.gross_before_wht,
    wht_rate: row.wht_rate,
    wht_amount: row.wht_amount,
    input_vat_amount: row.input_vat_amount,
    business_unit_id: row.business_unit_id,
    source_type: row.source_type,
  };
}

async function loadBsDiffs(
  admin: SupabaseClient,
  tenantId: string,
): Promise<Record<string, number>> {
  const page = await fetchBalanceSheetPageData(admin, tenantId, {
    dateRange: null,
  });
  const bs = buildBalanceSheetReport(
    page.initialIncomeEntries,
    page.initialExpenseEntries,
    page.initialFixedAssets,
    page.initialPayableEntries,
    page.initialCapitalContributions,
    page.initialCashFlowExpenseEntries,
    page.initialPayrollHistory,
    page.initialMonthEndCloseNetPay,
    YEAR,
    page.initialInventoryBalanceSheet,
    page.initialManualEntries,
    page.initialTaxLedgerEntries,
    {
      tenantId,
      accountsPayablePayments: page.initialAccountsPayablePayments,
      directorsLoanRepayments: page.initialDirectorsLoanRepayments,
    },
  );

  const diffs: Record<string, number> = {};
  for (const month of BS_MONTHS) {
    diffs[month.label] = getBalanceCheckForPeriod(bs, month.index).difference;
  }
  return diffs;
}

function printBsDiffs(label: string, diffs: Record<string, number>) {
  console.log(`\n=== Balance Sheet Check — ${label} ===`);
  for (const month of BS_MONTHS) {
    const diff = diffs[month.label];
    console.log(
      `  ${month.label}: difference=${diff.toFixed(2)} balanced=${Math.abs(diff) <= 0.01}`,
    );
  }
}

/**
 * In-memory BS diffs after adding the same accrual payloads postAccountsPayableAccrualExpense
 * would insert (uses full page-data inputs so Jul/Aug/Sep match the live dashboard).
 */
async function loadBsDiffsWithSimulatedAccruals(
  admin: SupabaseClient,
  tenantId: string,
  sources: AccountsPayableAccrualSource[],
): Promise<Record<string, number>> {
  const page = await fetchBalanceSheetPageData(admin, tenantId, {
    dateRange: null,
  });

  const simulated = sources.map((source) => {
    const payload = buildAccountsPayableAccrualExpensePayload(source, {
      tenantId,
    });
    return {
      date: payload.date,
      expense_category: payload.expense_category,
      sub_category: payload.sub_category,
      amount: payload.amount,
      payment_status: payload.payment_status,
      description: payload.description,
      receipt_no: payload.receipt_no,
      notes: payload.notes,
      net_of_tax_amount: payload.net_of_tax_amount,
      input_vat_amount: payload.input_vat_amount,
    };
  });

  const expenses = [...page.initialExpenseEntries, ...simulated];
  const cashFlowExpenses = [
    ...page.initialCashFlowExpenseEntries,
    ...simulated.map((e) => ({
      date: e.date,
      expense_category: e.expense_category,
      sub_category: e.sub_category,
      amount: e.amount,
      payment_status: e.payment_status,
      description: e.description,
      receipt_no: e.receipt_no,
      notes: e.notes,
    })),
  ];

  const bs = buildBalanceSheetReport(
    page.initialIncomeEntries,
    expenses,
    page.initialFixedAssets,
    page.initialPayableEntries,
    page.initialCapitalContributions,
    cashFlowExpenses,
    page.initialPayrollHistory,
    page.initialMonthEndCloseNetPay,
    YEAR,
    page.initialInventoryBalanceSheet,
    page.initialManualEntries,
    page.initialTaxLedgerEntries,
    {
      tenantId,
      accountsPayablePayments: page.initialAccountsPayablePayments,
      directorsLoanRepayments: page.initialDirectorsLoanRepayments,
    },
  );

  const diffs: Record<string, number> = {};
  for (const month of BS_MONTHS) {
    diffs[month.label] = getBalanceCheckForPeriod(bs, month.index).difference;
  }
  return diffs;
}

async function main() {
  const { envFile, allowProduction, dryRun } = parseArgs(process.argv.slice(2));
  loadEnvForce(resolve(process.cwd(), envFile));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url.includes(PRODUCTION_PROJECT_REF)) {
    throw new Error(
      `Refusing to run: URL is not production (${PRODUCTION_PROJECT_REF}). Got: ${url}`,
    );
  }
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  if (!allowProduction && !dryRun) {
    throw new Error(
      "Pass --allow-production to write, or --dry-run to preview.",
    );
  }
  if (allowProduction && dryRun) {
    throw new Error("Pass either --dry-run or --allow-production, not both.");
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(dryRun ? "DRY RUN (no writes)" : "APPLYING PRODUCTION BACKFILL");
  console.log(`env-file: ${envFile}`);
  console.log(`URL: ${url}`);
  console.log(`Tenant: Davors Facilities (${TENANT})`);
  console.log(`Target invoices: ${TARGET_INVOICES.join(", ")}`);

  const beforeDiffs = await loadBsDiffs(admin, TENANT);
  printBsDiffs("BEFORE", beforeDiffs);

  const { data: payables, error: apError } = await admin
    .from("accounts_payable")
    .select(
      "id, vendor_name, invoice_number, expense_category, sub_category, invoice_date, due_date, amount, amount_paid, balance_due, net_of_tax_amount, gross_before_wht, wht_rate, wht_amount, input_vat_amount, business_unit_id, source_type",
    )
    .eq("tenant_id", TENANT)
    .in("invoice_number", [...TARGET_INVOICES]);
  if (apError) throw new Error(`accounts_payable: ${apError.message}`);

  const rows = (payables as ApRow[] | null) ?? [];
  if (rows.length !== TARGET_INVOICES.length) {
    throw new Error(
      `Expected ${TARGET_INVOICES.length} AP rows for invoices ${TARGET_INVOICES.join(", ")}; found ${rows.length}: ${rows
        .map((r) => r.invoice_number)
        .join(", ")}`,
    );
  }

  // Stable order: 0001, 0003
  const ordered = [...rows].sort((a, b) => {
    const ai = TARGET_INVOICES.indexOf(
      a.invoice_number as (typeof TARGET_INVOICES)[number],
    );
    const bi = TARGET_INVOICES.indexOf(
      b.invoice_number as (typeof TARGET_INVOICES)[number],
    );
    return ai - bi;
  });

  const createdExpenseIds: string[] = [];
  const pendingSources: AccountsPayableAccrualSource[] = [];

  for (const row of ordered) {
    const source = toAccrualSource(row);
    const receiptNo = buildAccountsPayableAccrualReceiptNo(row.id);

    if (!shouldPostAccountsPayableAccrualExpense(source)) {
      throw new Error(
        `Invoice ${row.invoice_number} (${row.id}) is not an operating AP — refusing backfill.`,
      );
    }

    const { data: existing, error: existingError } = await admin
      .from("expense_register")
      .select("id, receipt_no, amount, net_of_tax_amount, payment_status")
      .eq("tenant_id", TENANT)
      .eq("receipt_no", receiptNo)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);

    const payload = buildAccountsPayableAccrualExpensePayload(source, {
      tenantId: TENANT,
    });

    console.log(`\n--- Invoice ${row.invoice_number} (${row.id}) ---`);
    console.log(
      JSON.stringify(
        {
          vendor: row.vendor_name,
          expense_category: row.expense_category,
          sub_category: row.sub_category,
          invoice_date: row.invoice_date,
          receipt_no: payload.receipt_no,
          date: payload.date,
          amount: payload.amount,
          net_of_tax_amount: payload.net_of_tax_amount,
          payment_status: payload.payment_status,
          business_unit_id: payload.business_unit_id ?? null,
          description: payload.description,
          existing_accrual: existing,
        },
        null,
        2,
      ),
    );

    if (existing) {
      console.log(`SKIP — accrual already exists (expense id ${existing.id})`);
      continue;
    }

    pendingSources.push(source);

    if (dryRun) {
      console.log("Would call postAccountsPayableAccrualExpense with payload above.");
      continue;
    }

    const result = await postAccountsPayableAccrualExpense(admin, source, {
      tenantId: TENANT,
    });

    if (result.status === "skipped") {
      throw new Error(
        `Unexpected skip for invoice ${row.invoice_number}: ${result.reason}`,
      );
    }

    console.log(
      `POSTED status=${result.status} expenseId=${result.expenseId} receiptNo=${result.receiptNo}`,
    );
    if (result.status === "inserted") {
      createdExpenseIds.push(result.expenseId);
    }
  }

  if (dryRun) {
    const simulatedDiffs = await loadBsDiffsWithSimulatedAccruals(
      admin,
      TENANT,
      pendingSources,
    );
    printBsDiffs("SIMULATED AFTER (in-memory accruals for 0001+0003)", simulatedDiffs);
    console.log("\n=== BS delta (simulated − before) ===");
    for (const month of BS_MONTHS) {
      const before = beforeDiffs[month.label];
      const after = simulatedDiffs[month.label];
      console.log(
        `  ${month.label}: ${before.toFixed(2)} → ${after.toFixed(2)} (delta ${(after - before).toFixed(2)})`,
      );
    }
    console.log(
      "\nDry-run complete — no writes. Re-run with --allow-production to apply.",
    );
    return;
  }

  console.log("\n=== Created expense_register ids ===");
  if (createdExpenseIds.length === 0) {
    console.log("(none — all skipped as already present)");
  } else {
    for (const id of createdExpenseIds) {
      console.log(id);
    }
  }

  const afterDiffs = await loadBsDiffs(admin, TENANT);
  printBsDiffs("AFTER", afterDiffs);

  console.log("\n=== BS delta (after − before) ===");
  for (const month of BS_MONTHS) {
    const before = beforeDiffs[month.label];
    const after = afterDiffs[month.label];
    console.log(
      `  ${month.label}: ${before.toFixed(2)} → ${after.toFixed(2)} (delta ${(after - before).toFixed(2)})`,
    );
  }

  console.log("\nProduction backfill complete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
