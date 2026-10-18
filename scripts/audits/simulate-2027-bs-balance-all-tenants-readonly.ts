/**
 * Read-only: Jan & Dec 2027 BS must balance; Davors Facilities Jan RE = Dec 2026 RE.
 * npx tsx scripts/audits/simulate-2027-bs-balance-all-tenants-readonly.ts --env=production
 * npx tsx scripts/audits/simulate-2027-bs-balance-all-tenants-readonly.ts --env=staging
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../../app/dashboard/finance/balance-sheet-page-data";
import {
  buildStandardBalanceSheetReport,
  getBalanceSheetMonthCheck,
  standardBalanceSheetReportExtrasForView,
} from "@/lib/finance/balance-sheet-standard-report";
import { getBalanceSheetAmountForMonth } from "../../app/dashboard/finance/balance-sheet-utils";
import { calculateRetainedEarningsAtPriorYearEnd } from "@/lib/finance/balance-sheet-retained-earnings";
import { inferFirstBookYearForBalanceSheet } from "@/lib/finance/balance-sheet-cash-opening";
import { resolveDividendBalanceSheetFilter } from "../../app/dashboard/finance/dividends-balance-sheet-utils";

const PROD_REF = "tvcurcnmasnocwdxzgvz";
const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const FAC_PROD = "608f81b5-38be-4756-8a52-8279c859b07c";
const FY = 2027;
const FY_PRIOR = 2026;
const REF_DEC_2027 = new Date("2027-12-31T12:00:00.000Z");
const REF_JAN_2027 = new Date("2027-01-31T12:00:00.000Z");

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
  const envArg = process.argv.find((a) => a.startsWith("--env="))?.split("=")[1];
  const isProd = envArg === "production";
  const envFile = isProd ? ".env.local.backup" : ".env.staging.local";
  const envPath = resolve(process.cwd(), envFile);
  if (!existsSync(envPath)) {
    console.error(`Missing ${envFile}`);
    process.exit(1);
  }
  loadEnv(envPath);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, key);
  const projectRef = isProd ? PROD_REF : STAGING_REF;

  const { data: tenants } = await admin
    .from("tenants")
    .select("id, name")
    .order("name");
  if (!tenants?.length) {
    console.error("No tenants");
    process.exit(1);
  }

  console.log(`\n=== ${isProd ? "Production" : "Staging"} (${projectRef}) FY ${FY} balance simulation ===\n`);

  let failures = 0;
  for (const tenant of tenants) {
    const page = await fetchBalanceSheetPageData(admin, tenant.id, {
      viewAllBusinessUnits: true,
      dateRange: null,
      financialYear: FY,
      referenceDate: REF_DEC_2027,
    });
    if (page.fetchError) {
      console.log(`[FAIL] ${tenant.name}: fetch ${page.fetchError}`);
      failures += 1;
      continue;
    }
    const extras = standardBalanceSheetReportExtrasForView({
      viewAllBusinessUnits: true,
      activeBusinessUnitId: null,
      rawManualFinancialEntries: page.initialRawManualEntries,
    });
    const report = buildStandardBalanceSheetReport(
      page,
      tenant.id,
      FY,
      extras,
    );
    const jan = getBalanceSheetMonthCheck(report, 0);
    const dec = getBalanceSheetMonthCheck(report, 11);
    const janOk = jan.isBalanced;
    const decOk = dec.isBalanced;
    const status = janOk && decOk ? "OK" : "FAIL";
    if (!janOk || !decOk) failures += 1;
    console.log(
      `[${status}] ${tenant.name} — Jan diff ${jan.difference.toFixed(2)}, Dec diff ${dec.difference.toFixed(2)}`,
    );
  }

  if (isProd) {
    console.log("\n--- Davors Facilities RE continuity (Dec 2026 → Jan 2027) ---\n");
    const pageFac = await fetchBalanceSheetPageData(admin, DAVORS, {
      viewAllBusinessUnits: false,
      activeBusinessUnitId: FAC_PROD,
      dateRange: null,
      financialYear: FY,
      referenceDate: REF_JAN_2027,
    });
    const extras26 = standardBalanceSheetReportExtrasForView({
      viewAllBusinessUnits: false,
      activeBusinessUnitId: FAC_PROD,
    });
    const extras27 = standardBalanceSheetReportExtrasForView({
      viewAllBusinessUnits: false,
      activeBusinessUnitId: FAC_PROD,
    });
    const r26 = buildStandardBalanceSheetReport(
      pageFac,
      DAVORS,
      FY_PRIOR,
      extras26,
    );
    const r27 = buildStandardBalanceSheetReport(pageFac, DAVORS, FY, extras27);
    const reDec26 = getBalanceSheetAmountForMonth(
      r26.rows.find((r) => r.key === "retained-earnings")!,
      11,
    );
    const openingRe2027 = calculateRetainedEarningsAtPriorYearEnd({
      financialYear: FY,
      firstBookYear: inferFirstBookYearForBalanceSheet({
        incomeEntries: pageFac.initialIncomeEntries,
        expenseEntries: pageFac.initialExpenseEntries,
        payableEntries: pageFac.initialPayableEntries,
        capitalContributions: pageFac.initialCapitalContributions,
        manualEntries: pageFac.initialManualEntries,
        fixedAssets: pageFac.initialFixedAssets,
        taxLedgerEntries: pageFac.initialTaxLedgerEntries,
        payrollHistory: pageFac.initialPayrollHistory,
      }),
      incomeEntries: pageFac.initialIncomeEntries,
      expenseEntries: pageFac.initialExpenseEntries,
      fixedAssets: pageFac.initialFixedAssets,
      stockAdjustments: pageFac.initialInventoryBalanceSheet.stockAdjustments ?? [],
      goLiveDate: pageFac.initialInventoryBalanceSheet.config?.go_live_date ?? null,
      dividendDeclarations: pageFac.initialDividendDeclarations ?? [],
      dividendFilter: resolveDividendBalanceSheetFilter({
        balanceSheetBusinessUnitId: FAC_PROD,
      }),
      manualEntries: pageFac.initialRawManualEntries,
    });
    const reMatch = Math.abs(reDec26 - openingRe2027) < 0.05;
    if (!reMatch) failures += 1;
    console.log(
      `Davors Technologies (Facilities BU): Dec 2026 closing RE ${reDec26.toFixed(2)} vs Jan 2027 opening RE ${openingRe2027.toFixed(2)} — ${reMatch ? "OK" : "FAIL"}`,
    );
  }

  if (!isProd) {
    console.log("\n--- Staging: Enterprise Oct 2026 dividends reduce 2027 RE columns ---\n");
    const ENT = tenants.find(
      (t) =>
        /davors technologies/i.test(t.name ?? "") ||
        /enterprise/i.test(t.name ?? ""),
    );
    if (ENT) {
      const page = await fetchBalanceSheetPageData(admin, ENT.id, {
        viewAllBusinessUnits: true,
        dateRange: null,
        financialYear: FY,
        referenceDate: REF_DEC_2027,
      });
      const extras = standardBalanceSheetReportExtrasForView({
        viewAllBusinessUnits: true,
        activeBusinessUnitId: null,
        rawManualFinancialEntries: page.initialRawManualEntries,
      });
      const r27 = buildStandardBalanceSheetReport(page, ENT.id, FY, extras);
      const firstBookYear = inferFirstBookYearForBalanceSheet({
        incomeEntries: page.initialIncomeEntries,
        expenseEntries: page.initialExpenseEntries,
        payableEntries: page.initialPayableEntries,
        capitalContributions: page.initialCapitalContributions,
        manualEntries: page.initialManualEntries,
        fixedAssets: page.initialFixedAssets,
        taxLedgerEntries: page.initialTaxLedgerEntries,
        payrollHistory: page.initialPayrollHistory,
      });
      const openingRe = calculateRetainedEarningsAtPriorYearEnd({
        financialYear: FY,
        firstBookYear,
        incomeEntries: page.initialIncomeEntries,
        expenseEntries: page.initialExpenseEntries,
        fixedAssets: page.initialFixedAssets,
        stockAdjustments: page.initialInventoryBalanceSheet.stockAdjustments ?? [],
        goLiveDate: page.initialInventoryBalanceSheet.config?.go_live_date ?? null,
        dividendDeclarations: page.initialDividendDeclarations ?? [],
        dividendFilter: { mode: "all" },
        manualEntries: page.initialRawManualEntries,
      });
      const reJan = getBalanceSheetAmountForMonth(
        r27.rows.find((r) => r.key === "retained-earnings")!,
        0,
      );
      const reduced = reJan < openingRe - 0.01;
      console.log(
        `Enterprise Jan 2027 RE ${reJan.toFixed(2)} vs opening ${openingRe.toFixed(2)} — Oct 2026 dividends reflected: ${reduced ? "OK" : "CHECK"}`,
      );
      if (!reduced) failures += 1;
    }
  }

  console.log(failures ? `\n${failures} failure(s)` : "\nAll checks passed.");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
