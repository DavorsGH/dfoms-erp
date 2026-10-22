/**
 * Read-only: HEAD worktree (.worktrees/bs-regression-old) vs working tree — every BS/CF
 * data line, Jan–Oct 2026, all tenants, All + each BU + Untagged.
 *
 * npx tsx scripts/audits/compare-bs-cf-full-old-new-regression-readonly.ts --env=production
 * npx tsx scripts/audits/compare-bs-cf-full-old-new-regression-readonly.ts --env=staging
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const FY = 2026;
const MONTHS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;
const TOL = 0.005;
const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PROD_REF = "tvcurcnmasnocwdxzgvz";

const STAGING_ALLOWED_DIFF_KEYS = new Set([
  "cash",
  "wht-payable",
  "dividends-payable",
  "retained-earnings",
  "dividends-paid",
]);

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

type ScopeDef = {
  scope: string;
  fetch: { viewAllBusinessUnits: boolean; activeBusinessUnitId: string | null };
  buScope: { mode: "all" } | { mode: "unit"; id: string } | { mode: "default" };
  all: boolean;
  buId: string | null;
};

async function loadStack(codeRoot: string) {
  const base = resolve(codeRoot);
  const pageMod = await import(
    pathToFileURL(join(base, "app/dashboard/finance/balance-sheet-page-data.ts")).href
  );
  const standardMod = await import(
    pathToFileURL(join(base, "lib/finance/balance-sheet-standard-report.ts")).href
  );
  const utilsMod = await import(
    pathToFileURL(join(base, "app/dashboard/finance/balance-sheet-utils.ts")).href
  );
  const cfMod = await import(
    pathToFileURL(join(base, "app/dashboard/finance/cash-flow-utils.ts")).href
  );
  const wagesMod = await import(
    pathToFileURL(join(base, "app/dashboard/finance/accrued-wages-utils.ts")).href
  );
  const transferMod = await import(
    pathToFileURL(
      join(base, "app/dashboard/finance/business-unit-transfers-utils.ts"),
    ).href
  );

  const hasViewExtras = Boolean(standardMod.standardBalanceSheetReportExtrasForView);

  return {
    fetchBalanceSheetPageData: pageMod.fetchBalanceSheetPageData,
    buildStandardBalanceSheetReport: standardMod.buildStandardBalanceSheetReport,
    dividendOptionsFromPageData: standardMod.dividendOptionsFromPageData ?? (() => ({})),
    getBalanceSheetMonthCheck: standardMod.getBalanceSheetMonthCheck,
    getBalanceSheetAmountForMonth: utilsMod.getBalanceSheetAmountForMonth,
    buildCashFlowReport: cfMod.buildCashFlowReport,
    filterManualEntriesForYear: cfMod.filterManualEntriesForYear,
    buildNetPayByPayrollMonth: wagesMod.buildNetPayByPayrollMonth,
    resolveInterUnitTransferCashScope: transferMod.resolveInterUnitTransferCashScope,
    hasViewExtras,
    standardBalanceSheetReportExtrasForView:
      standardMod.standardBalanceSheetReportExtrasForView as
        | ((args: {
            viewAllBusinessUnits: boolean;
            activeBusinessUnitId: string | null;
            rawManualFinancialEntries?: unknown;
          }) => Record<string, unknown>)
        | undefined,
  };
}

type Stack = Awaited<ReturnType<typeof loadStack>>;

function reportExtras(stack: Stack, page: Awaited<ReturnType<Stack["fetchBalanceSheetPageData"]>>, s: ScopeDef) {
  const viewAll = s.fetch.viewAllBusinessUnits;
  const buId = s.fetch.activeBusinessUnitId;

  if (stack.hasViewExtras && stack.standardBalanceSheetReportExtrasForView) {
    return stack.standardBalanceSheetReportExtrasForView({
      viewAllBusinessUnits: viewAll,
      activeBusinessUnitId: buId,
      rawManualFinancialEntries: viewAll ? page.initialRawManualEntries : undefined,
    });
  }

  const buScope = s.buScope;
  return {
    allBusinessUnitsDirectorsLoan: s.all,
    rawManualFinancialEntries: s.all ? page.initialRawManualEntries : undefined,
    interUnitTransferScope:
      buScope.mode === "unit"
        ? { mode: "unit" as const, businessUnitId: buScope.id }
        : { mode: "exclude" as const },
    balanceSheetBusinessUnitId: viewAll ? null : buId,
    ...stack.dividendOptionsFromPageData(page, buScope),
  };
}

function comparableRowKeys(
  rows: Array<{ key: string; kind: string }>,
): string[] {
  return rows
    .filter((r) => r.kind !== "section")
    .map((r) => r.key);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

type LineDiff = {
  report: "bs" | "cf";
  tenant: string;
  tenantId: string;
  scope: string;
  month: number;
  key: string;
  old: number;
  new: number;
  delta: number;
};

async function snapshotScopes(
  admin: ReturnType<typeof createClient>,
  stack: Stack,
  tenant: { id: string; name: string },
) {
  const { data: bus } = await admin
    .from("business_units")
    .select("id, name")
    .eq("tenant_id", tenant.id)
    .order("name");

  const scopes: ScopeDef[] = [
    {
      scope: "All businesses",
      fetch: { viewAllBusinessUnits: true, activeBusinessUnitId: null },
      buScope: { mode: "all" },
      all: true,
      buId: null,
    },
  ];
  for (const bu of bus ?? []) {
    scopes.push({
      scope: String(bu.name),
      fetch: { viewAllBusinessUnits: false, activeBusinessUnitId: bu.id },
      buScope: { mode: "unit", id: bu.id },
      all: false,
      buId: bu.id,
    });
  }
  scopes.push({
    scope: "Untagged",
    fetch: { viewAllBusinessUnits: false, activeBusinessUnitId: null },
    buScope: { mode: "default" },
    all: false,
    buId: null,
  });

  const outcomes: Array<{
    scope: string;
    fetchError: string | null;
    bs: ReturnType<Stack["buildStandardBalanceSheetReport"]> | null;
    cf: ReturnType<Stack["buildCashFlowReport"]> | null;
  }> = [];

  for (const s of scopes) {
    const page = await stack.fetchBalanceSheetPageData(admin, tenant.id, s.fetch);
    if (page.fetchError) {
      outcomes.push({ scope: s.scope, fetchError: page.fetchError, bs: null, cf: null });
      continue;
    }
    const extras = reportExtras(stack, page, s);
    const bs = stack.buildStandardBalanceSheetReport(page, tenant.id, FY, extras);
    const staffSalaryNetByPayrollMonth = stack.buildNetPayByPayrollMonth(
      page.initialPayrollHistory,
      page.initialMonthEndCloseNetPay,
    );
    const manualEntriesForYear = stack.filterManualEntriesForYear(
      page.initialManualEntries,
      FY,
    );
    const cf = stack.buildCashFlowReport(
      page.initialIncomeEntries,
      page.initialExpenseEntries,
      manualEntriesForYear,
      FY,
      page.initialInventoryPurchases,
      page.initialFixedAssets,
      page.initialCapitalContributions,
      staffSalaryNetByPayrollMonth,
      page.initialPayableEntries,
      {
        tenantId: tenant.id,
        accountsPayablePayments: page.initialAccountsPayablePayments,
        directorsLoanRepayments: page.initialDirectorsLoanRepayments,
        directorsLoanLedgerEntries: page.initialDirectorsLoanLedgerEntries,
        creditNoteApplications: page.initialCreditNoteApplications,
        businessUnitTransfers: page.initialBusinessUnitTransfers,
        interUnitTransferScope:
          (extras as { interUnitTransferScope?: unknown }).interUnitTransferScope ??
          stack.resolveInterUnitTransferCashScope({
            viewAllBusinessUnits: s.fetch.viewAllBusinessUnits,
            activeBusinessUnitId: s.fetch.activeBusinessUnitId,
          }),
        dividendDeclarations: page.initialDividendDeclarations,
        dividendLines: page.initialDividendLines,
        balanceSheetBusinessUnitId:
          (extras as { balanceSheetBusinessUnitId?: string | null }).balanceSheetBusinessUnitId ??
          (s.all ? null : s.buId),
        dividendBalanceSheetFilter: (
          extras as { dividendBalanceSheetFilter?: unknown }
        ).dividendBalanceSheetFilter,
      },
    );
    outcomes.push({ scope: s.scope, fetchError: null, bs, cf });
  }

  return { tenant, outcomes };
}

function compareTenantSnaps(
  tenant: { id: string; name: string },
  oldOutcomes: Awaited<ReturnType<typeof snapshotScopes>>["outcomes"],
  newOutcomes: Awaited<ReturnType<typeof snapshotScopes>>["outcomes"],
) {
  const diffs: LineDiff[] = [];
  let cellsCompared = 0;
  const newByScope = new Map(newOutcomes.map((o) => [o.scope, o]));

  for (const o of oldOutcomes) {
    const n = newByScope.get(o.scope);
    if (o.fetchError || n?.fetchError || !o.bs || !o.cf || !n?.bs || !n?.cf) {
      continue;
    }
    const bsKeys = comparableRowKeys(o.bs.rows);
    const cfKeys = comparableRowKeys(o.cf.rows);
    for (const mi of MONTHS) {
      for (const key of bsKeys) {
        cellsCompared += 1;
        const orow = o.bs.rows.find((r) => r.key === key)!;
        const nrow = n.bs.rows.find((r) => r.key === key);
        const oldAmt = round2(stackAmount(orow, mi, "bs"));
        const newAmt = round2(stackAmount(nrow ?? orow, mi, "bs"));
        const delta = round2(newAmt - oldAmt);
        if (Math.abs(delta) >= TOL) {
          diffs.push({
            report: "bs",
            tenant: tenant.name,
            tenantId: tenant.id,
            scope: o.scope,
            month: mi + 1,
            key,
            old: oldAmt,
            new: newAmt,
            delta,
          });
        }
      }
      for (const key of cfKeys) {
        cellsCompared += 1;
        const orow = o.cf.rows.find((r) => r.key === key)!;
        const nrow = n.cf.rows.find((r) => r.key === key);
        const oldAmt = round2(stackAmount(orow, mi, "cf"));
        const newAmt = round2(stackAmount(nrow ?? orow, mi, "cf"));
        const delta = round2(newAmt - oldAmt);
        if (Math.abs(delta) >= TOL) {
          diffs.push({
            report: "cf",
            tenant: tenant.name,
            tenantId: tenant.id,
            scope: o.scope,
            month: mi + 1,
            key,
            old: oldAmt,
            new: newAmt,
            delta,
          });
        }
      }
    }
  }
  return { diffs, cellsCompared };
}

function stackAmount(
  row: { amounts: number[] } | undefined,
  monthIndex: number,
  _kind: "bs" | "cf",
) {
  if (!row) return 0;
  return row.amounts[monthIndex] ?? 0;
}

function isDavorsTenant(name: string) {
  return /davors technologies/i.test(name);
}

function stagingDiffAllowed(d: LineDiff) {
  if (!isDavorsTenant(d.tenant)) return false;
  return STAGING_ALLOWED_DIFF_KEYS.has(d.key);
}

async function main() {
  const envArg =
    process.argv.find((a) => a.startsWith("--env="))?.split("=")[1] ?? "staging";
  const repoRoot = resolve(process.cwd());
  const oldRoot = resolve(repoRoot, ".worktrees/bs-regression-old");
  if (!existsSync(join(oldRoot, "app/dashboard/finance/balance-sheet-utils.ts"))) {
    throw new Error(`Missing OLD worktree at ${oldRoot}`);
  }

  if (envArg === "production") {
    let loaded = false;
    for (const f of [".env.local.backup", ".env.vercel.production.local", ".env.production.local"]) {
      const p = resolve(repoRoot, f);
      if (existsSync(p)) {
        loadEnv(p);
        loaded = true;
        console.log(`Loaded production env from ${f}`);
        break;
      }
    }
    if (!loaded) throw new Error("No production env file found");
  } else {
    loadEnv(resolve(repoRoot, ".env.staging.local"));
    if (existsSync(resolve(repoRoot, ".env.local"))) {
      loadEnv(resolve(repoRoot, ".env.local"));
    }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const ref = url.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1] ?? url;
  console.log("Supabase project ref:", ref);

  if (envArg === "production") {
    if (!url.includes(PROD_REF)) {
      throw new Error(`Refusing: expected production ref ${PROD_REF}, got ${ref}`);
    }
  } else if (!url.includes(STAGING_REF)) {
    throw new Error(`Refusing: expected staging ref ${STAGING_REF}, got ${ref}`);
  }

  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const [oldStack, newStack] = await Promise.all([
    loadStack(oldRoot),
    loadStack(repoRoot),
  ]);
  console.log(
    `OLD stack at ${oldRoot} (view extras: ${oldStack.hasViewExtras}) | NEW stack view extras: ${newStack.hasViewExtras}`,
  );

  const { data: tenants } = await admin.from("tenants").select("id, name").order("name");
  const tenantRows = tenants ?? [];

  const allDiffs: LineDiff[] = [];
  let totalCells = 0;
  let fetchErrors = 0;

  for (const tenant of tenantRows) {
    const [oldSnap, newSnap] = await Promise.all([
      snapshotScopes(admin, oldStack, tenant),
      snapshotScopes(admin, newStack, tenant),
    ]);
    for (const o of oldSnap.outcomes) {
      if (o.fetchError) fetchErrors += 1;
    }
    for (const o of newSnap.outcomes) {
      if (o.fetchError) fetchErrors += 1;
    }
    const { diffs, cellsCompared } = compareTenantSnaps(
      tenant,
      oldSnap.outcomes,
      newSnap.outcomes,
    );
    totalCells += cellsCompared;
    allDiffs.push(...diffs);
  }

  const unexpected =
    envArg === "staging"
      ? allDiffs.filter((d) => !stagingDiffAllowed(d))
      : allDiffs;

  const outDir = resolve(repoRoot, "scripts/audits/output");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `bs-cf-full-old-new-${envArg}.json`);
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        env: envArg,
        projectRef: ref,
        fy: FY,
        months: "Jan-Oct (1-10)",
        cellsCompared: totalCells,
        diffCount: allDiffs.length,
        unexpectedDiffCount: unexpected.length,
        fetchErrors,
        diffs: allDiffs,
        unexpectedDiffs: unexpected,
      },
      null,
      2,
    ),
  );

  console.log(`\n=== FULL BS+CF OLD (HEAD) vs NEW (${envArg}) ===`);
  console.log(`Cells compared: ${totalCells}`);
  console.log(`Line diffs (>= ${TOL}): ${allDiffs.length}`);
  console.log(`Scope fetch errors (either side): ${fetchErrors}`);
  if (envArg === "staging") {
    console.log(`Unexpected (non-Davors or non-dividend line): ${unexpected.length}`);
  }
  for (const d of allDiffs) {
    console.log(JSON.stringify(d));
  }
  console.log(`\nWrote ${outPath}`);

  if (fetchErrors > 0) process.exit(3);
  if (envArg === "production" && allDiffs.length > 0) process.exit(2);
  if (envArg === "staging" && unexpected.length > 0) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
