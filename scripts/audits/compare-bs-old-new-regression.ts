/**
 * Read-only: compare Balance Sheet at committed HEAD (OLD) vs working tree (NEW).
 * Jan–Oct 2026, all tenants, All businesses + each BU.
 *
 * Usage:
 *   npx tsx scripts/audits/compare-bs-old-new-regression.ts --env staging
 *   npx tsx scripts/audits/compare-bs-old-new-regression.ts --env production
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { buildProfitLossReport } from "../../app/dashboard/finance/profit-loss-utils";
import {
  buildTaxLedgerBsClearanceContext,
  collectTaxLedgerRemittedAtFallbackRows,
} from "../../lib/finance/tax-ledger-bs-clearance";

const FY = 2026;
const MONTHS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
const TOL = 0.02;
const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PROD_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS_PROD = "00000001-0000-4000-8000-000000000001";
const FACILITIES_NAME_MATCH = /facilities/i;

const ROW_KEYS = [
  "cash",
  "wht-payable",
  "paye-payable",
  "ssnit-payable",
  "net-vat-payable",
  "total-liabilities",
] as const;

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

async function loadBsStack(codeRoot: string) {
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
  const dividendOptionsFromPageData =
    standardMod.dividendOptionsFromPageData ??
    ((_page: unknown, _bu: unknown) => ({}));
  return {
    fetchBalanceSheetPageData: pageMod.fetchBalanceSheetPageData,
    buildStandardBalanceSheetReport: standardMod.buildStandardBalanceSheetReport,
    dividendOptionsFromPageData,
    getBalanceSheetMonthCheck: standardMod.getBalanceSheetMonthCheck,
    getBalanceSheetAmountForMonth: utilsMod.getBalanceSheetAmountForMonth,
    hasDividends: Boolean(standardMod.dividendOptionsFromPageData),
  };
}

type ScopeSnap = {
  tenant: string;
  tenantId: string;
  scope: string;
  months: Array<{
    monthIndex: number;
    isBalanced: boolean;
    oob: number;
    lines: Record<(typeof ROW_KEYS)[number], number>;
  }>;
};

type ScopeSnapOutcome = {
  tenant: string;
  tenantId: string;
  scope: string;
  fetchError: string | null;
  snap: ScopeSnap | null;
};

async function snapshotTenantScopes(
  admin: ReturnType<typeof createClient>,
  stack: Awaited<ReturnType<typeof loadBsStack>>,
  tenant: { id: string; name: string },
): Promise<ScopeSnapOutcome[]> {
  const { data: bus } = await admin
    .from("business_units")
    .select("id, name")
    .eq("tenant_id", tenant.id)
    .order("name");

  const scopes: Array<{
    scope: string;
    fetch: { viewAllBusinessUnits: boolean; activeBusinessUnitId: string | null };
    all: boolean;
    buId: string | null;
  }> = [
    {
      scope: "All businesses",
      fetch: { viewAllBusinessUnits: true, activeBusinessUnitId: null },
      all: true,
      buId: null,
    },
  ];
  for (const bu of bus ?? []) {
    scopes.push({
      scope: String(bu.name),
      fetch: { viewAllBusinessUnits: false, activeBusinessUnitId: bu.id },
      all: false,
      buId: bu.id,
    });
  }

  const out: ScopeSnapOutcome[] = [];
  for (const s of scopes) {
    const page = await stack.fetchBalanceSheetPageData(admin, tenant.id, s.fetch);
    if (page.fetchError) {
      out.push({
        tenant: tenant.name,
        tenantId: tenant.id,
        scope: s.scope,
        fetchError: page.fetchError,
        snap: null,
      });
      continue;
    }
    const buScope = s.all
      ? ({ mode: "all" } as const)
      : ({ mode: "unit", id: s.buId! } as const);
    const report = stack.buildStandardBalanceSheetReport(page, tenant.id, FY, {
      allBusinessUnitsDirectorsLoan: s.all,
      rawManualFinancialEntries: s.all ? page.initialRawManualEntries : undefined,
      interUnitTransferScope:
        buScope.mode === "unit"
          ? { mode: "unit", businessUnitId: s.buId! }
          : { mode: "exclude" },
      ...stack.dividendOptionsFromPageData(page, buScope),
    });

    const months = MONTHS.map((mi) => {
      const check = stack.getBalanceSheetMonthCheck(report, mi);
      const lines = {} as Record<(typeof ROW_KEYS)[number], number>;
      for (const key of ROW_KEYS) {
        const row = report.rows.find((r) => r.key === key);
        lines[key] = row
          ? Math.round(stack.getBalanceSheetAmountForMonth(row, mi) * 100) / 100
          : 0;
      }
      return {
        monthIndex: mi,
        isBalanced: check.isBalanced,
        oob: Math.round(check.difference * 100) / 100,
        lines,
      };
    });

    out.push({
      tenant: tenant.name,
      tenantId: tenant.id,
      scope: s.scope,
      fetchError: null,
      snap: {
        tenant: tenant.name,
        tenantId: tenant.id,
        scope: s.scope,
        months,
      },
    });
  }
  return out;
}

function compareSnaps(oldOutcomes: ScopeSnapOutcome[], newOutcomes: ScopeSnapOutcome[]) {
  const newBy = new Map(newOutcomes.map((s) => [`${s.tenantId}:${s.scope}`, s]));
  const oldBy = new Map(oldOutcomes.map((s) => [`${s.tenantId}:${s.scope}`, s]));
  const changes: Array<Record<string, unknown>> = [];
  let balancedRegression = false;
  let missingNewScope = 0;
  let oldFetchErrors = 0;
  let newFetchErrors = 0;
  const erroredScopes: Array<Record<string, string>> = [];

  for (const outcome of oldOutcomes) {
    if (outcome.fetchError) {
      oldFetchErrors += 1;
      erroredScopes.push({
        side: "OLD",
        tenant: outcome.tenant,
        scope: outcome.scope,
        error: outcome.fetchError,
      });
    }
  }
  for (const outcome of newOutcomes) {
    if (outcome.fetchError) {
      newFetchErrors += 1;
      erroredScopes.push({
        side: "NEW",
        tenant: outcome.tenant,
        scope: outcome.scope,
        error: outcome.fetchError,
      });
    }
  }

  for (const o of oldOutcomes) {
    if (o.fetchError || !o.snap) {
      continue;
    }
    const n = newBy.get(`${o.tenantId}:${o.scope}`);
    if (!n?.snap || n.fetchError) {
      missingNewScope += 1;
      continue;
    }
    for (const mi of MONTHS) {
      const om = o.snap.months.find((m) => m.monthIndex === mi)!;
      const nm = n.snap.months.find((m) => m.monthIndex === mi)!;
      const lineDiffs: Record<string, { old: number; new: number; delta: number }> =
        {};
      let anyLine = false;
      for (const key of ROW_KEYS) {
        const delta = Math.round((nm.lines[key] - om.lines[key]) * 100) / 100;
        if (Math.abs(delta) >= TOL) {
          lineDiffs[key] = { old: om.lines[key], new: nm.lines[key], delta };
          anyLine = true;
        }
      }
      const balancedChanged =
        om.isBalanced !== nm.isBalanced ||
        Math.abs(om.oob - nm.oob) >= TOL;
      if (om.isBalanced && !nm.isBalanced) {
        balancedRegression = true;
      }
      if (anyLine || balancedChanged) {
        const bothBalanced = om.isBalanced && nm.isBalanced;
        changes.push({
          tenant: o.tenant,
          scope: o.scope,
          month: mi + 1,
          oldBalanced: om.isBalanced,
          newBalanced: nm.isBalanced,
          oldOob: om.oob,
          newOob: nm.oob,
          bothBalanced,
          lineDiffs,
        });
      }
    }
  }

  for (const n of newOutcomes) {
    if (n.fetchError || !n.snap) {
      continue;
    }
    const o = oldBy.get(`${n.tenantId}:${n.scope}`);
    if (!o?.snap || o.fetchError) {
      missingNewScope += 1;
    }
  }

  return {
    changes,
    balancedRegression,
    missingNewScope,
    oldFetchErrors,
    newFetchErrors,
    erroredScopes,
  };
}

async function collectFallbackRemittedAtRows(
  admin: ReturnType<typeof createClient>,
  stack: Awaited<ReturnType<typeof loadBsStack>>,
  tenants: Array<{ id: string; name: string }>,
) {
  const rows: Array<Record<string, unknown>> = [];
  for (const tenant of tenants) {
    const page = await stack.fetchBalanceSheetPageData(admin, tenant.id, {
      viewAllBusinessUnits: true,
      activeBusinessUnitId: null,
    });
    if (page.fetchError) {
      continue;
    }
    const ctx = buildTaxLedgerBsClearanceContext(page.initialCashFlowExpenseEntries);
    for (const row of collectTaxLedgerRemittedAtFallbackRows(
      tenant.id,
      page.initialTaxLedgerEntries,
      ctx,
    )) {
      rows.push({ tenant: tenant.name, ...row });
    }
  }
  return rows;
}

function stagingDavorsJunOctBalance(
  snaps: ScopeSnapOutcome[],
  tenantNameMatch: RegExp,
) {
  const scopes = snaps.filter(
    (s) =>
      tenantNameMatch.test(s.tenant) &&
      (s.scope === "All businesses" || /facilities/i.test(s.scope)) &&
      s.snap,
  );
  const months = [5, 6, 7, 8, 9];
  const report: Array<Record<string, unknown>> = [];
  for (const s of scopes) {
    for (const mi of months) {
      const m = s.snap!.months.find((x) => x.monthIndex === mi);
      if (!m) continue;
      report.push({
        tenant: s.tenant,
        scope: s.scope,
        monthIndex: mi,
        balanced: m.isBalanced,
        oob: m.oob,
      });
    }
  }
  return report;
}

async function verifyRemitExpensesUntouched(admin: ReturnType<typeof createClient>) {
  const { data } = await admin
    .from("expense_register")
    .select("id, receipt_no, date, amount, updated_at")
    .like("receipt_no", "TAX-REMIT-%")
    .order("date", { ascending: true })
    .limit(5);
  const { count } = await admin
    .from("expense_register")
    .select("id", { count: "exact", head: true })
    .like("receipt_no", "TAX-REMIT-%");
  return { sample: data ?? [], totalCount: count ?? 0 };
}

async function davorsFacilitiesSepPl(
  admin: ReturnType<typeof createClient>,
  stack: Awaited<ReturnType<typeof loadBsStack>>,
  facilitiesBuId: string,
) {
  const page = await stack.fetchBalanceSheetPageData(admin, DAVORS_PROD, {
    viewAllBusinessUnits: false,
    activeBusinessUnitId: facilitiesBuId,
  });
  if (page.fetchError) {
    return {
      fetchError: page.fetchError,
      revenue: 0,
      expenses: 0,
      netProfit: 0,
      balanced: false,
      oob: 0,
    };
  }
  const pl = buildProfitLossReport(
    page.initialIncomeEntries,
    page.initialExpenseEntries,
    page.initialFixedAssets,
    FY,
  );
  const sep = 8;
  const revenue =
    pl.rows.find((r) => r.key === "total-revenue")?.amounts[sep] ?? 0;
  const expenses = pl.rows.find((r) => r.key === "total-expenses")?.amounts[sep] ?? 0;
  const net = pl.rows.find((r) => r.key === "net-profit")?.amounts[sep] ?? 0;
  const buScope = { mode: "unit", id: facilitiesBuId } as const;
  const report = stack.buildStandardBalanceSheetReport(page, DAVORS_PROD, FY, {
    allBusinessUnitsDirectorsLoan: false,
    interUnitTransferScope: { mode: "unit", businessUnitId: facilitiesBuId },
    ...stack.dividendOptionsFromPageData(page, buScope),
  });
  const sepCheck = stack.getBalanceSheetMonthCheck(report, sep);
  return {
    revenue: Math.round(revenue * 100) / 100,
    expenses: Math.round(expenses * 100) / 100,
    netProfit: Math.round(net * 100) / 100,
    balanced: sepCheck.isBalanced,
    oob: sepCheck.difference,
  };
}

async function main() {
  const envArg = process.argv.find((a) => a.startsWith("--env="))?.split("=")[1] ?? "staging";
  const repoRoot = resolve(process.cwd());
  const oldRoot = resolve(repoRoot, ".worktrees/bs-regression-old");
  if (!existsSync(join(oldRoot, "app/dashboard/finance/balance-sheet-utils.ts"))) {
    throw new Error(
      `Missing OLD code worktree at ${oldRoot}. Run: git worktree add ".worktrees/bs-regression-old" HEAD --detach`,
    );
  }

  if (envArg === "production") {
    const prodEnvCandidates = [
      ".env.local.backup",
      ".env.vercel.production.local",
      ".env.production.local",
    ];
    let loaded = false;
    for (const f of prodEnvCandidates) {
      const p = resolve(repoRoot, f);
      if (existsSync(p)) {
        loadEnv(p);
        loaded = true;
        console.log(`Loaded production env from ${f}`);
        break;
      }
    }
    if (!loaded) {
      throw new Error("No production env file found (.env.local.backup)");
    }
  } else {
    loadEnv(resolve(repoRoot, ".env.staging.local"));
    if (existsSync(resolve(repoRoot, ".env.local"))) {
      loadEnv(resolve(repoRoot, ".env.local"));
    }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (envArg === "production") {
    if (url.includes(STAGING_REF)) {
      throw new Error("Refusing: production run loaded staging Supabase URL");
    }
    if (!url.includes(PROD_REF) && !url.includes("supabase.co")) {
      throw new Error("Refusing: missing production Supabase URL");
    }
  }
  if (envArg === "staging" && !url.includes(STAGING_REF)) {
    throw new Error("Refusing: not staging Supabase URL");
  }

  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const [oldStack, newStack] = await Promise.all([
    loadBsStack(oldRoot),
    loadBsStack(repoRoot),
  ]);

  const { data: tenants } = await admin.from("tenants").select("id, name").order("name");

  const tenantRows = tenants ?? [];
  const oldOutcomes: ScopeSnapOutcome[] = [];
  const newOutcomes: ScopeSnapOutcome[] = [];
  for (const tenant of tenantRows) {
    oldOutcomes.push(...(await snapshotTenantScopes(admin, oldStack, tenant)));
    newOutcomes.push(...(await snapshotTenantScopes(admin, newStack, tenant)));
  }

  const {
    changes,
    balancedRegression,
    missingNewScope,
    oldFetchErrors,
    newFetchErrors,
    erroredScopes,
  } = compareSnaps(oldOutcomes, newOutcomes);

  const remittedAtFallbackRows = await collectFallbackRemittedAtRows(
    admin,
    newStack,
    tenantRows,
  );
  const balancedFigureChanges = changes.filter(
    (c) => c.bothBalanced === true && Object.keys(c.lineDiffs as object).length > 0,
  );
  const stagingDavorsNewBalance =
    envArg === "staging"
      ? stagingDavorsJunOctBalance(newOutcomes, /davors technologies/i)
      : [];

  const remitAudit = await verifyRemitExpensesUntouched(admin);

  let davorsCheck: Record<string, unknown> | null = null;
  if (envArg === "production") {
    const { data: facBu } = await admin
      .from("business_units")
      .select("id, name")
      .eq("tenant_id", DAVORS_PROD)
      .ilike("name", "%Facilities%")
      .maybeSingle();
    if (facBu?.id) {
      davorsCheck = {
        facilitiesBu: facBu.name,
        old: await davorsFacilitiesSepPl(admin, oldStack, facBu.id),
        new: await davorsFacilitiesSepPl(admin, newStack, facBu.id),
      };
    }
  }

  const outDir = resolve(repoRoot, "scripts/audits/output");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `bs-old-new-${envArg}.json`);
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        env: envArg,
        fy: FY,
        months: "Jan-Oct (0-9)",
        balancedRegression,
        changeCount: changes.length,
        changes,
        balancedFigureChanges,
        oldFetchErrors,
        newFetchErrors,
        missingNewScope,
        erroredScopes,
        remittedAtFallbackRows,
        stagingDavorsNewBalanceJunOct: stagingDavorsNewBalance,
        remitExpenseAudit: remitAudit,
        davorsFacilitiesSep2026: davorsCheck,
      },
      null,
      2,
    ),
  );

  console.log(`\n=== BS OLD (HEAD) vs NEW (${envArg}) ===`);
  console.log(`Changes (tenant/scope/month with line or balance delta): ${changes.length}`);
  console.log(
    `Scope fetch errors — OLD: ${oldFetchErrors}, NEW: ${newFetchErrors}, missing NEW snap: ${missingNewScope}`,
  );
  console.log(`Balanced→unbalanced regression: ${balancedRegression ? "YES — STOP" : "none"}`);
  console.log(
    `Remitted_at fallback rows (no linked TAX-REMIT expense): ${remittedAtFallbackRows.length}`,
  );
  if (balancedRegression) {
    for (const c of changes.filter((x) => x.oldBalanced === true && x.newBalanced === false)) {
      console.log(JSON.stringify(c));
    }
  }
  for (const c of changes.slice(0, 30)) {
    console.log(JSON.stringify(c));
  }
  if (changes.length > 30) {
    console.log(`… and ${changes.length - 30} more (see ${outPath})`);
  }
  console.log(`\nTAX-REMIT expense rows (read-only count): ${remitAudit.totalCount}`);
  if (davorsCheck) {
    console.log("\nDavors Facilities Sep 2026 P&L / BS:", JSON.stringify(davorsCheck, null, 2));
  }
  console.log(`\nWrote ${outPath}`);

  const scopeFailure =
    newFetchErrors > 0 || oldFetchErrors > 0 || missingNewScope > 0;
  if (balancedRegression) {
    process.exit(2);
  }
  if (scopeFailure) {
    process.exit(3);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
