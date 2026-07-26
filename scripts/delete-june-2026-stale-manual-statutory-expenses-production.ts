// @ts-nocheck
/**
 * PRODUCTION: delete 3 stale June 2026 manual statutory expense accruals.
 *
 * Usage:
 *   npx tsx scripts/delete-june-2026-stale-manual-statutory-expenses-production.ts --dry-run
 *   npx tsx scripts/delete-june-2026-stale-manual-statutory-expenses-production.ts --env-file .env.local.backup --allow-production
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  FULL_YEAR_INDEX,
  type BalanceSheetAccountsPayableEntry,
  type BalanceSheetIncomeEntry,
  type BalanceSheetTaxLedgerEntry,
} from "../app/dashboard/finance/balance-sheet-utils";
import {
  mergePayrollWagesSources,
  type BalanceSheetCashExpenseEntry,
  type MonthEndCloseNetPayEntry,
  type PayrollHistoryWagesEntry,
} from "../app/dashboard/finance/accrued-wages-utils";
import type { CapitalContributionEntry } from "../app/dashboard/finance/capital-contributions-utils";
import type { ManualFinancialEntry } from "../app/dashboard/finance/cash-flow-utils";
import type {
  ProfitLossAssetEntry,
  ProfitLossExpenseEntry,
} from "../app/dashboard/finance/profit-loss-utils";
import { fetchInventoryBalanceSheetInput } from "../app/dashboard/finance/balance-sheet-page-data";

const PRODUCTION_PROJECT_REF = "tvcurcnmasnocwdxzgvz";
const TENANT = "00000001-0000-4000-8000-000000000001";
const FY = 2026;

const TARGETS = [
  {
    id: "b4431432-aaa4-4907-a25f-9c778327f5a7",
    amount: 676.07,
    description: "Employer SSNIT Contribution",
    date: "2026-06-29",
  },
  {
    id: "3dcc8d88-d9ed-4d7e-b1e0-8c158411f8c4",
    amount: 771.71,
    descriptionPrefix: "PAYE tax withheld, June 2026",
    date: "2026-06-29",
  },
  {
    id: "e1e19772-f844-4e9d-9c77-8f95163676f4",
    amount: 286.03,
    descriptionPrefix: "Employee SSNIT withheld, June 2026",
    date: "2026-06-29",
  },
] as const;

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
}

function r2(n: number) {
  return Math.round(n * 100) / 100;
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

async function computeBs(
  admin: ReturnType<typeof createClient>,
  label: string,
) {
  const [
    { data: incomeEntries },
    { data: expenseEntries },
    { data: fixedAssets },
    { data: payableEntries },
    { data: capitalContributions },
    { data: manualEntries },
    { data: payrollHistory },
    { data: payrollProcessing },
    { data: monthEndCloseRecords },
    { data: taxLedgerEntries },
    inventoryBalanceSheet,
  ] = await Promise.all([
    admin
      .from("income_register")
      .select(
        "date, amount, amount_received, outstanding_balance, wht_amount, service_category, entry_type, sale_status, net_of_tax_amount, output_vat_amount",
      )
      .eq("tenant_id", TENANT)
      .order("date", { ascending: true }),
    admin
      .from("expense_register")
      .select(
        "date, expense_category, sub_category, amount, payment_status, description, receipt_no, net_of_tax_amount, input_vat_amount",
      )
      .eq("tenant_id", TENANT)
      .order("date", { ascending: true }),
    admin
      .from("fixed_assets")
      .select(
        "original_cost, quantity, useful_life_years, purchase_date, depreciation_method",
      )
      .eq("tenant_id", TENANT),
    admin
      .from("accounts_payable")
      .select(
        "invoice_date, balance_due, amount, amount_paid, vendor_name, invoice_number, expense_category",
      )
      .eq("tenant_id", TENANT),
    admin
      .from("capital_contributions")
      .select("id, date, contributed_by, amount, description, notes")
      .eq("tenant_id", TENANT),
    admin.from("manual_financial_entries").select("*").eq("tenant_id", TENANT),
    admin
      .from("payroll_history")
      .select("payroll_month, net_pay")
      .eq("tenant_id", TENANT),
    admin
      .from("payroll_processing")
      .select("payroll_month, net_pay")
      .eq("tenant_id", TENANT),
    admin
      .from("month_end_close")
      .select("month, total_net_pay")
      .eq("tenant_id", TENANT),
    admin
      .from("tax_ledger_entries")
      .select("entry_date, direction, tax_component, tax_amount, status")
      .eq("tenant_id", TENANT)
      .eq("status", "open"),
    fetchInventoryBalanceSheetInput(admin, TENANT),
  ]);

  const cashFlowExpenseEntries: BalanceSheetCashExpenseEntry[] =
    (expenseEntries ?? []).map((entry) => ({
      date: entry.date,
      expense_category: entry.expense_category,
      sub_category: entry.sub_category,
      amount: Number(entry.amount) || 0,
      payment_status: entry.payment_status,
      description: entry.description ?? null,
      receipt_no: entry.receipt_no ?? null,
    }));

  const report = buildBalanceSheetReport(
    (incomeEntries ?? []) as BalanceSheetIncomeEntry[],
    (expenseEntries ?? []) as ProfitLossExpenseEntry[],
    (fixedAssets ?? []) as ProfitLossAssetEntry[],
    (payableEntries ?? []) as BalanceSheetAccountsPayableEntry[],
    (capitalContributions as CapitalContributionEntry[] | null) ?? [],
    cashFlowExpenseEntries,
    mergePayrollWagesSources(
      (payrollHistory as PayrollHistoryWagesEntry[] | null) ?? [],
      (payrollProcessing as PayrollHistoryWagesEntry[] | null) ?? [],
    ),
    (monthEndCloseRecords as MonthEndCloseNetPayEntry[] | null) ?? [],
    FY,
    inventoryBalanceSheet,
    (manualEntries as ManualFinancialEntry[] | null) ?? [],
    (taxLedgerEntries ?? []) as BalanceSheetTaxLedgerEntry[],
  );

  const july = getBalanceCheckForPeriod(report, 6);
  const dec = getBalanceCheckForPeriod(report, FULL_YEAR_INDEX);

  console.log(`\n=== Balance Sheet Check (${label}) ===`);
  console.log("income rows", incomeEntries?.length ?? 0);
  console.log("expense rows", expenseEntries?.length ?? 0);
  console.log("tax open rows", taxLedgerEntries?.length ?? 0);
  console.log("AP rows", payableEntries?.length ?? 0);
  console.log("July 2026:", {
    assets: july.totalAssets,
    le: july.totalLiabilitiesAndEquity,
    difference: july.difference,
    balanced: july.isBalanced,
  });
  console.log("Dec/FY 2026:", {
    assets: dec.totalAssets,
    le: dec.totalLiabilitiesAndEquity,
    difference: dec.difference,
    balanced: dec.isBalanced,
  });

  return { july, dec };
}

async function main() {
  const { envFile, allowProduction, dryRun } = parseArgs(process.argv.slice(2));
  loadEnvForce(resolve(process.cwd(), envFile));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase URL or service role key");

  const projectRef = new URL(url).hostname.split(".")[0];
  if (projectRef !== PRODUCTION_PROJECT_REF) {
    throw new Error(
      `Refusing project ref "${projectRef}" (expected production ${PRODUCTION_PROJECT_REF})`,
    );
  }
  if (!allowProduction && !dryRun) {
    throw new Error("Refusing production write without --allow-production");
  }

  console.log("=== Delete stale June manual statutory expenses (PRODUCTION) ===");
  console.log("env_file:", envFile);
  console.log("project_ref:", projectRef);
  console.log("mode:", dryRun ? "DRY-RUN" : "WRITE");

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Verify keep-targets still present
  const { data: keepRows, error: keepErr } = await admin
    .from("expense_register")
    .select("id,date,amount,description,expense_category,receipt_no,payment_status")
    .eq("tenant_id", TENANT)
    .or(
      "receipt_no.eq.PAYROLL-ESSNIT-2026-06,receipt_no.eq.PAYROLL-SAL-2026-06,description.eq.Staff June Salary",
    );
  if (keepErr) throw keepErr;
  console.log("\nKeep-targets present:");
  for (const row of keepRows ?? []) {
    console.log(
      `  ${row.id.slice(0, 8)} ${row.date} ${row.amount} [${row.expense_category}] ${row.description} ${row.receipt_no ?? ""}`,
    );
  }

  const { data: ledger, error: ledgerErr } = await admin
    .from("tax_ledger_entries")
    .select("id,tax_component,tax_amount,status,source_type,source_id")
    .eq("tenant_id", TENANT)
    .eq("source_type", "payroll_period");
  if (ledgerErr) throw ledgerErr;
  console.log("\nPayroll-period ledger rows (must remain):");
  for (const row of ledger ?? []) {
    console.log(
      `  ${String(row.tax_component)}= ${row.tax_amount} status=${row.status}`,
    );
  }

  const verified: Array<{
    id: string;
    amount: number;
    description: string;
    date: string;
  }> = [];

  for (const target of TARGETS) {
    const { data: row, error } = await admin
      .from("expense_register")
      .select("id,date,amount,description,expense_category,receipt_no")
      .eq("tenant_id", TENANT)
      .eq("id", target.id)
      .maybeSingle();
    if (error) throw error;
    if (!row) throw new Error(`Target row not found: ${target.id}`);
    const amount = r2(Number(row.amount) || 0);
    if (amount !== target.amount) {
      throw new Error(
        `Amount mismatch for ${target.id}: expected ${target.amount}, got ${amount}`,
      );
    }
    if (String(row.date).slice(0, 10) !== target.date) {
      throw new Error(`Date mismatch for ${target.id}`);
    }
    const desc = String(row.description ?? "");
    if ("description" in target && desc !== target.description) {
      throw new Error(`Description mismatch for ${target.id}: ${desc}`);
    }
    if (
      "descriptionPrefix" in target &&
      !desc.startsWith(target.descriptionPrefix)
    ) {
      throw new Error(`Description prefix mismatch for ${target.id}: ${desc}`);
    }
    if (row.receipt_no) {
      throw new Error(
        `Refusing to delete row with receipt_no (looks auto-posted): ${row.receipt_no}`,
      );
    }

    // Ensure no tax_ledger_entries point at this expense id
    const { data: linked, error: linkErr } = await admin
      .from("tax_ledger_entries")
      .select("id,tax_component,tax_amount")
      .eq("tenant_id", TENANT)
      .eq("source_id", target.id);
    if (linkErr) throw linkErr;
    if ((linked ?? []).length > 0) {
      throw new Error(
        `Refusing delete: tax_ledger still references ${target.id}: ${JSON.stringify(linked)}`,
      );
    }

    verified.push({
      id: row.id,
      amount,
      description: desc,
      date: String(row.date).slice(0, 10),
    });
    console.log(`\nVerified DELETE candidate:`);
    console.log(`  id=${row.id}`);
    console.log(`  date=${row.date} amount=${amount}`);
    console.log(`  description=${desc}`);
  }

  const before = await computeBs(admin, "BEFORE");

  if (dryRun) {
    console.log("\nDRY-RUN complete — no deletes performed.");
    console.log("Would delete:", verified.map((v) => v.id));
    return;
  }

  for (const row of verified) {
    const { error: delErr, count } = await admin
      .from("expense_register")
      .delete({ count: "exact" })
      .eq("tenant_id", TENANT)
      .eq("id", row.id)
      .eq("amount", row.amount);
    if (delErr) throw delErr;
    if (count !== 1) {
      throw new Error(`Delete matched ${count} rows for ${row.id}`);
    }
    console.log(`DELETED ${row.id} (${row.amount})`);
  }

  // Confirm gone + keeps intact
  for (const row of verified) {
    const { data: gone } = await admin
      .from("expense_register")
      .select("id")
      .eq("id", row.id)
      .maybeSingle();
    if (gone) throw new Error(`Row still present after delete: ${row.id}`);
  }

  const { data: keeps } = await admin
    .from("expense_register")
    .select("id,amount,receipt_no,description")
    .eq("tenant_id", TENANT)
    .or(
      "receipt_no.eq.PAYROLL-ESSNIT-2026-06,receipt_no.eq.PAYROLL-SAL-2026-06,description.eq.Staff June Salary",
    );
  console.log("\nKeep-targets after delete:");
  for (const row of keeps ?? []) {
    console.log(`  ${row.receipt_no ?? row.description}: ${row.amount}`);
  }

  const { data: ledgerAfter } = await admin
    .from("tax_ledger_entries")
    .select("tax_component,tax_amount,status")
    .eq("tenant_id", TENANT)
    .eq("source_type", "payroll_period");
  console.log("\nLedger after (unchanged expected):");
  for (const row of ledgerAfter ?? []) {
    console.log(`  ${row.tax_component}=${row.tax_amount} ${row.status}`);
  }

  const after = await computeBs(admin, "AFTER");

  console.log("\n=== Summary ===");
  console.log(
    "Deleted total expense reduction:",
    r2(verified.reduce((s, v) => s + v.amount, 0)),
  );
  console.log("BS Jul difference before→after:", before.july.difference, "→", after.july.difference);
  console.log("BS Dec difference before→after:", before.dec.difference, "→", after.dec.difference);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
