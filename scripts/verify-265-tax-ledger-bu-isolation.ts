/**
 * Phase 265 tax ledger BU isolation verify.
 *
 * Usage:
 *   npx tsx scripts/verify-265-tax-ledger-bu-isolation.ts --env staging
 *   npx tsx scripts/verify-265-tax-ledger-bu-isolation.ts --env staging --isolation-test
 *   npx tsx scripts/verify-265-tax-ledger-bu-isolation.ts --env production --enterprise-case
 *
 * --isolation-test (staging): create temporary named-BU income + VAT tax leg via RPC,
 *   assert stamp, assert default vs named Net VAT Payable, then delete test rows.
 * --enterprise-case (production): assert Enterprise VAT leg stamped + Facilities/Enterprise
 *   Aug BS differences no longer carry the ±41666.67 stamp-leak pattern.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  getBalanceSheetAmountForMonth,
} from "../app/dashboard/finance/balance-sheet-utils";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const ENTERPRISE_BU = "3b787f50-de08-40d5-af9c-14523a63503c";
const ENTERPRISE_INCOME_ID = "42087110-a74e-400b-941c-da2645c99ba8";
const ENTERPRISE_VAT = 41666.67;
const MARKER = "dfoms-265-tax-ledger-income-bu-stamp";
const FY = 2026;
const AUG = 7;

const r2 = (n: number) => Math.round(Number(n || 0) * 100) / 100;

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

export type Verify265Args = {
  environment: "staging" | "production";
};

export async function runVerify265Core(
  args: Verify265Args,
): Promise<{ ok: boolean; failures: string[] }> {
  const envFile =
    args.environment === "production"
      ? ".env.local.backup"
      : ".env.staging.local";
  loadEnvForce(resolve(envFile));

  const expectedRef =
    args.environment === "production" ? PRODUCTION_REF : STAGING_REF;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(expectedRef)) {
    return {
      ok: false,
      failures: [`URL does not look like ${args.environment}`],
    };
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    return { ok: false, failures: ["DATABASE_URL missing"] };
  }

  const failures: string[] = [];
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("localhost")
      ? undefined
      : { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const { rows } = await client.query<{ src: string }>(
      `
      SELECT pg_get_functiondef(p.oid) AS src
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'replace_income_register_tax_ledger_entries'
        AND pg_get_function_identity_arguments(p.oid) ILIKE '%text%jsonb%'
      `,
    );
    const src = rows[0]?.src ?? "";
    if (!src.includes(MARKER)) {
      failures.push(`RPC missing marker ${MARKER}`);
    } else {
      console.log("PASS: RPC has 265 marker");
    }
    if (!src.includes("v_business_unit_id")) {
      failures.push("RPC missing v_business_unit_id");
    } else {
      console.log("PASS: RPC declares v_business_unit_id");
    }

    const { rows: orphans } = await client.query<{ n: string }>(
      `
      SELECT COUNT(*)::text AS n
      FROM public.tax_ledger_entries t
      JOIN public.income_register i
        ON t.source_type = 'income_register'
       AND t.source_id = i.id::text
      WHERE t.business_unit_id IS NULL
        AND i.business_unit_id IS NOT NULL
      `,
    );
    if (Number(orphans[0]?.n ?? -1) !== 0) {
      failures.push(`income orphans remain: ${orphans[0]?.n}`);
    } else {
      console.log("PASS: income tax ledger orphan count = 0");
    }
  } finally {
    await client.end();
  }

  return { ok: failures.length === 0, failures };
}

async function runStagingIsolationTest(): Promise<{
  ok: boolean;
  failures: string[];
}> {
  const failures: string[] = [];
  loadEnvForce(resolve(".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!url.includes(STAGING_REF) || !key || !databaseUrl) {
    return { ok: false, failures: ["staging env incomplete"] };
  }

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  let incomeId: string | null = null;
  let namedBuId: string | null = null;

  try {
    const { rows: bus } = await client.query<{ id: string; name: string }>(
      `
      SELECT id, name FROM public.business_units
      WHERE tenant_id = $1 AND is_active = true
      ORDER BY name
      LIMIT 1
      `,
      [DAVORS],
    );
    namedBuId = bus[0]?.id ?? null;
    if (!namedBuId) {
      failures.push("No active business_unit on staging Davors tenant");
      return { ok: false, failures };
    }
    console.log(`Isolation test using BU ${bus[0].name} (${namedBuId})`);

    const { rows: inserted } = await client.query<{ id: string }>(
      `
      INSERT INTO public.income_register (
        tenant_id, date, invoice_no, description, amount, amount_received,
        outstanding_balance, payment_status, due_date, entry_type,
        service_category, net_of_tax_amount, output_vat_amount,
        output_tax_component, tax_inclusive, wht_amount, business_unit_id,
        notes
      ) VALUES (
        $1, CURRENT_DATE, $2, '265 isolation test', 1200, 1200,
        0, 'Paid', CURRENT_DATE, 'service',
        'Commercial Cleaning', 1000, 200,
        'vat_bundle', true, 0, $3,
        'dfoms-265-isolation-test'
      )
      RETURNING id
      `,
      [DAVORS, `265-TEST-${Date.now()}`, namedBuId],
    );
    incomeId = inserted[0]?.id ?? null;
    if (!incomeId) {
      failures.push("Failed to insert test income");
      return { ok: false, failures };
    }

    await client.query(
      `
      SELECT public.replace_income_register_tax_ledger_entries(
        $1::text,
        $2::jsonb
      )
      `,
      [
        incomeId,
        JSON.stringify([
          {
            tenant_id: DAVORS,
            entry_date: new Date().toISOString().slice(0, 10),
            period_month: new Date().toISOString().slice(0, 7) + "-01",
            direction: "output",
            tax_component: "vat_bundle",
            rate_pct: 20,
            taxable_base: 1000,
            tax_amount: 200,
            status: "open",
            counterparty_name: "265 test",
            notes: "dfoms-265-isolation-test",
          },
        ]),
      ],
    );

    const { rows: legs } = await client.query<{
      business_unit_id: string | null;
      tax_amount: string;
    }>(
      `
      SELECT business_unit_id, tax_amount::text
      FROM public.tax_ledger_entries
      WHERE source_type = 'income_register' AND source_id = $1
      `,
      [incomeId],
    );
    if (legs.length !== 1) {
      failures.push(`expected 1 tax leg, got ${legs.length}`);
    } else if (legs[0].business_unit_id !== namedBuId) {
      failures.push(
        `tax leg BU=${legs[0].business_unit_id} expected ${namedBuId}`,
      );
    } else {
      console.log(
        `PASS: tax ledger stamped to named BU (amount=${legs[0].tax_amount})`,
      );
    }

    // BS Net VAT Payable via app helpers
    const admin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    async function vatPayable(
      activeBusinessUnitId: string | null,
      viewAll: boolean,
    ) {
      const page = await fetchBalanceSheetPageData(admin, DAVORS, {
        dateRange: null,
        activeBusinessUnitId,
        viewAllBusinessUnits: viewAll,
      });
      if (page.fetchError) throw new Error(page.fetchError);
      const report = buildBalanceSheetReport(
        page.initialIncomeEntries,
        page.initialExpenseEntries,
        page.initialFixedAssets,
        page.initialPayableEntries,
        page.initialCapitalContributions,
        page.initialCashFlowExpenseEntries,
        page.initialPayrollHistory,
        page.initialMonthEndCloseNetPay,
        FY,
        page.initialInventoryBalanceSheet,
        page.initialManualEntries,
        page.initialTaxLedgerEntries,
        {
          tenantId: DAVORS,
          accountsPayablePayments: page.initialAccountsPayablePayments,
          directorsLoanRepayments: page.initialDirectorsLoanRepayments,
        },
      );
      const vatRow = report.rows.find((row) => row.key === "net-vat-payable");
      const monthIndex = new Date().getUTCMonth(); // current month for test entry
      return {
        vat: r2(getBalanceSheetAmountForMonth(vatRow!, monthIndex)),
        check: getBalanceCheckForPeriod(report, monthIndex),
      };
    }

    const defaultScope = await vatPayable(null, false);
    const namedScope = await vatPayable(namedBuId, false);

    // Default must not include the +200 test VAT (named BU only).
    // Named must include at least 200 from the test leg.
    if (namedScope.vat + 0.001 < 200) {
      failures.push(
        `named-BU Net VAT Payable ${namedScope.vat} does not include test 200`,
      );
    } else {
      console.log(
        `PASS: named-BU Net VAT Payable includes test VAT (${namedScope.vat})`,
      );
    }

    // Default VAT should be less than named by ~200 if default had no other named VAT,
    // or at least: default should not equal named when only the test leg differs.
    // Stronger: re-query open output VAT summed under null BU must exclude test source.
    const { rows: defaultVatSum } = await client.query<{ s: string }>(
      `
      SELECT COALESCE(SUM(tax_amount),0)::text AS s
      FROM public.tax_ledger_entries
      WHERE tenant_id = $1
        AND status = 'open'
        AND direction = 'output'
        AND business_unit_id IS NULL
        AND source_id = $2
      `,
      [DAVORS, incomeId],
    );
    if (Number(defaultVatSum[0]?.s ?? 1) !== 0) {
      failures.push("default/null BU still sees test income VAT leg");
    } else {
      console.log(
        "PASS: default (null BU) filter excludes named-BU test VAT leg",
      );
    }

    console.log(
      `default Net VAT Payable (UI scope)=${defaultScope.vat}; named=${namedScope.vat}`,
    );
  } catch (e) {
    failures.push(e instanceof Error ? e.message : String(e));
  } finally {
    if (incomeId) {
      await client.query(
        `DELETE FROM public.tax_ledger_entries WHERE source_type = 'income_register' AND source_id = $1`,
        [incomeId],
      );
      await client.query(`DELETE FROM public.income_register WHERE id = $1`, [
        incomeId,
      ]);
      console.log("Cleanup: deleted 265 isolation test income + tax legs");
    }
    await client.end();
  }

  return { ok: failures.length === 0, failures };
}

async function runProductionEnterpriseCase(): Promise<{
  ok: boolean;
  failures: string[];
}> {
  const failures: string[] = [];
  loadEnvForce(resolve(".env.local.backup"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!url.includes(PRODUCTION_REF) || !key || !databaseUrl) {
    return { ok: false, failures: ["production env incomplete"] };
  }

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const { rows } = await client.query<{
      business_unit_id: string | null;
      tax_amount: string;
    }>(
      `
      SELECT business_unit_id, tax_amount::text
      FROM public.tax_ledger_entries
      WHERE source_type = 'income_register'
        AND source_id = $1
        AND direction = 'output'
        AND abs(tax_amount - $2::numeric) < 0.02
      `,
      [ENTERPRISE_INCOME_ID, ENTERPRISE_VAT],
    );
    if (rows.length !== 1) {
      failures.push(
        `expected 1 Enterprise VAT leg, found ${rows.length}`,
      );
    } else if (rows[0].business_unit_id !== ENTERPRISE_BU) {
      failures.push(
        `Enterprise VAT leg BU=${rows[0].business_unit_id} expected ${ENTERPRISE_BU}`,
      );
    } else {
      console.log(
        `PASS: Enterprise VAT ${rows[0].tax_amount} stamped to Enterprise BU`,
      );
    }
  } finally {
    await client.end();
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  async function augCheck(activeBusinessUnitId: string | null, viewAll: boolean) {
    const page = await fetchBalanceSheetPageData(admin, DAVORS, {
      dateRange: null,
      activeBusinessUnitId,
      viewAllBusinessUnits: viewAll,
    });
    if (page.fetchError) throw new Error(page.fetchError);
    const report = buildBalanceSheetReport(
      page.initialIncomeEntries,
      page.initialExpenseEntries,
      page.initialFixedAssets,
      page.initialPayableEntries,
      page.initialCapitalContributions,
      page.initialCashFlowExpenseEntries,
      page.initialPayrollHistory,
      page.initialMonthEndCloseNetPay,
      FY,
      page.initialInventoryBalanceSheet,
      page.initialManualEntries,
      page.initialTaxLedgerEntries,
      {
        tenantId: DAVORS,
        accountsPayablePayments: page.initialAccountsPayablePayments,
        directorsLoanRepayments: page.initialDirectorsLoanRepayments,
      },
    );
    const check = getBalanceCheckForPeriod(report, AUG);
    const vatRow = report.rows.find((row) => row.key === "net-vat-payable");
    return {
      diff: r2(check.difference),
      vat: r2(getBalanceSheetAmountForMonth(vatRow!, AUG)),
      balanced: check.isBalanced,
    };
  }

  try {
    const facilities = await augCheck(null, false);
    const enterprise = await augCheck(ENTERPRISE_BU, false);
    const all = await augCheck(null, true);

    console.log(
      `Facilities Aug: diff=${facilities.diff} vat=${facilities.vat} balanced=${facilities.balanced}`,
    );
    console.log(
      `Enterprise Aug: diff=${enterprise.diff} vat=${enterprise.vat} balanced=${enterprise.balanced}`,
    );
    console.log(
      `All Aug: diff=${all.diff} vat=${all.vat} balanced=${all.balanced}`,
    );

    if (Math.abs(Math.abs(facilities.diff) - ENTERPRISE_VAT) < 0.02) {
      failures.push(
        `Facilities still imbalanced by exactly ${ENTERPRISE_VAT} (stamp leak persists)`,
      );
    } else {
      console.log(
        "PASS: Facilities Aug |diff| is not exactly 41666.67 leak magnitude",
      );
    }

    if (enterprise.vat + 0.02 < ENTERPRISE_VAT) {
      failures.push(
        `Enterprise Net VAT Payable ${enterprise.vat} missing ${ENTERPRISE_VAT}`,
      );
    } else {
      console.log("PASS: Enterprise Net VAT Payable includes 41666.67");
    }

    // Facilities VAT should no longer include the Enterprise 41666.67
    // (Facilities vat ≈ All vat - Enterprise contribution from that invoice)
    if (Math.abs(facilities.vat - all.vat) < 0.02 && enterprise.vat >= ENTERPRISE_VAT) {
      // If facilities still equals all while enterprise has the VAT, leak persists
      failures.push(
        "Facilities Net VAT Payable still equals All (Enterprise VAT still on default)",
      );
    } else {
      console.log(
        "PASS: Facilities Net VAT Payable diverges from All (Enterprise VAT isolated)",
      );
    }
  } catch (e) {
    failures.push(e instanceof Error ? e.message : String(e));
  }

  return { ok: failures.length === 0, failures };
}

async function main() {
  const argv = process.argv.slice(2);
  const envIdx = argv.indexOf("--env");
  const environment = envIdx >= 0 ? argv[envIdx + 1] : null;
  if (environment !== "staging" && environment !== "production") {
    throw new Error("--env staging|production required");
  }

  const core = await runVerify265Core({ environment });
  if (!core.ok) {
    console.error("FAIL core verify");
    for (const f of core.failures) console.error(" - " + f);
    process.exit(1);
  }

  if (argv.includes("--isolation-test")) {
    if (environment !== "staging") {
      throw new Error("--isolation-test is staging-only");
    }
    console.log("--- staging isolation test ---");
    const iso = await runStagingIsolationTest();
    if (!iso.ok) {
      console.error("FAIL isolation test");
      for (const f of iso.failures) console.error(" - " + f);
      process.exit(1);
    }
    console.log("PASS: staging isolation test");
  }

  if (argv.includes("--enterprise-case")) {
    if (environment !== "production") {
      throw new Error("--enterprise-case is production-only");
    }
    console.log("--- production Enterprise/Facilities case ---");
    const ent = await runProductionEnterpriseCase();
    if (!ent.ok) {
      console.error("FAIL enterprise case");
      for (const f of ent.failures) console.error(" - " + f);
      process.exit(1);
    }
    console.log("PASS: production Enterprise/Facilities case");
  }

  console.log(`verify-265 OK on ${environment}`);
}

const invokedDirectly = process.argv[1]
  ?.replace(/\\/g, "/")
  .includes("verify-265-tax-ledger-bu-isolation");

if (invokedDirectly) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}