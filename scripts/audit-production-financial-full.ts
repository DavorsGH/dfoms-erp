/**
 * Full read-only financial audit — ALL production tenants.
 *
 *   npx tsx scripts/audit-production-financial-full.ts --allow-production
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { connectPg } from "./lib/pg-connect";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  BALANCE_TOLERANCE,
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
} from "../app/dashboard/finance/balance-sheet-utils";
import {
  fetchPayrollLiveRecalcBundle,
  mergePayrollWagesWithLiveOpenMonths,
} from "../app/dashboard/hr-payroll/payroll-live-recalc-utils";
import { buildPayrollPeriodTaxLedgerSourceId } from "../app/dashboard/hr-payroll/payroll-statutory-ledger-sync";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const STOCK_TOL = 0.0001;
const PAYROLL_TOL = 0.02;

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

function r2(n: number) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function ymToIndex(ym: string, fy: number) {
  const [y, m] = ym.split("-").map(Number);
  if (y !== fy || !m || m < 1 || m > 12) return null;
  return m - 1;
}

function payrollMonthYm(month: string | Date | null) {
  if (!month) return null;
  const s = typeof month === "string" ? month.slice(0, 10) : month.toISOString().slice(0, 10);
  return s.slice(0, 7);
}

async function auditBalanceSheets(
  admin,
  tenants: Array<{ id: string; name: string }>,
  activeMonthsByTenant: Map<string, Set<string>>,
) {
  const imbalances: Array<{
    tenant: string;
    tenant_id: string;
    year: number;
    month: string;
    ym: string;
    diff: number;
    assets: number;
    liabilitiesEquity: number;
  }> = [];
  const errors: Array<{ tenant: string; error: string }> = [];

  for (const tenant of tenants) {
    process.stderr.write(`BS audit: ${tenant.name}...\n`);
    const data = await fetchBalanceSheetPageData(admin, tenant.id, { dateRange: null });
    if (data.fetchError) {
      errors.push({ tenant: tenant.name, error: data.fetchError });
      continue;
    }

    const liveBundle = await fetchPayrollLiveRecalcBundle(admin, { tenantId: tenant.id });
    const payrollHistory = mergePayrollWagesWithLiveOpenMonths(
      data.initialPayrollHistory,
      data.initialPayrollProcessingRows,
      liveBundle.employees,
      liveBundle.liveContext,
    );
    const cashFlowExpenseEntries = data.initialExpenseEntries.map((entry) => ({
      date: entry.date,
      expense_category: entry.expense_category,
      sub_category: entry.sub_category,
      amount: entry.amount,
      payment_status: entry.payment_status,
      description: entry.description ?? null,
      receipt_no: entry.receipt_no ?? null,
      notes: entry.notes ?? null,
    }));

    const active = activeMonthsByTenant.get(tenant.id) ?? new Set<string>();
    const years = new Set<number>();
    for (const ym of active) years.add(Number(ym.slice(0, 4)));

    for (const year of [...years].sort()) {
      const report = buildBalanceSheetReport(
        data.initialIncomeEntries,
        data.initialExpenseEntries,
        data.initialFixedAssets,
        data.initialPayableEntries,
        data.initialCapitalContributions,
        cashFlowExpenseEntries,
        payrollHistory,
        data.initialMonthEndCloseNetPay,
        year,
        data.initialInventoryBalanceSheet,
        data.initialManualEntries,
        data.initialTaxLedgerEntries,
        {
          tenantId: tenant.id,
          accountsPayablePayments: data.initialAccountsPayablePayments,
          directorsLoanRepayments: data.initialDirectorsLoanRepayments,
        },
      );

      for (let i = 0; i < 12; i += 1) {
        const ym = `${year}-${String(i + 1).padStart(2, "0")}`;
        if (!active.has(ym)) continue;
        const check = getBalanceCheckForPeriod(report, i);
        if (!check.isBalanced) {
          imbalances.push({
            tenant: tenant.name,
            tenant_id: tenant.id,
            year,
            month: MONTHS[i]!,
            ym,
            diff: r2(check.difference),
            assets: r2(check.totalAssets),
            liabilitiesEquity: r2(check.totalLiabilitiesAndEquity),
          });
        }
      }
    }
  }

  return { imbalances, errors };
}

async function sqlChecks(client) {
  const tenants = await client.query(`SELECT id, name FROM tenants ORDER BY name`);
  const tenantMap = new Map(tenants.rows.map((r) => [r.id, r.name]));

  const activeMonths = await client.query(`
    SELECT tenant_id, ym FROM (
      SELECT tenant_id, to_char(date::date, 'YYYY-MM') AS ym FROM income_register WHERE date IS NOT NULL
      UNION
      SELECT tenant_id, to_char(date::date, 'YYYY-MM') FROM expense_register WHERE date IS NOT NULL
      UNION
      SELECT tenant_id, to_char(payroll_month::date, 'YYYY-MM') FROM payroll_history WHERE payroll_month IS NOT NULL
      UNION
      SELECT tenant_id, to_char(entry_date::date, 'YYYY-MM') FROM tax_ledger_entries WHERE entry_date IS NOT NULL
      UNION
      SELECT tenant_id, to_char(period_month::date, 'YYYY-MM') FROM tax_ledger_entries WHERE period_month IS NOT NULL
      UNION
      SELECT tenant_id, to_char(period_month::date, 'YYYY-MM') FROM manual_financial_entries WHERE period_month IS NOT NULL
      UNION
      SELECT tenant_id, to_char(date::date, 'YYYY-MM') FROM capital_contributions WHERE date IS NOT NULL
      UNION
      SELECT tenant_id, to_char(purchase_date::date, 'YYYY-MM') FROM raw_material_purchases WHERE purchase_date IS NOT NULL
      UNION
      SELECT tenant_id, to_char(purchase_date::date, 'YYYY-MM') FROM product_purchases WHERE purchase_date IS NOT NULL
      UNION
      SELECT tenant_id, to_char(month::date, 'YYYY-MM') FROM month_end_close WHERE month IS NOT NULL
      UNION
      SELECT tenant_id, to_char(payment_date::date, 'YYYY-MM') FROM accounts_payable_payments WHERE payment_date IS NOT NULL
      UNION
      SELECT tenant_id, to_char(purchase_date::date, 'YYYY-MM') FROM fixed_assets WHERE purchase_date IS NOT NULL
    ) u
    GROUP BY tenant_id, ym
    ORDER BY tenant_id, ym
  `);
  const activeMonthsByTenant = new Map<string, Set<string>>();
  for (const row of activeMonths.rows) {
    if (!activeMonthsByTenant.has(row.tenant_id)) {
      activeMonthsByTenant.set(row.tenant_id, new Set());
    }
    activeMonthsByTenant.get(row.tenant_id)!.add(row.ym);
  }

  const orphanCogs = {
    incomeMissingCogsExpense: (
      await client.query(`
        SELECT i.tenant_id, i.invoice_no, i.cogs_expense_id
        FROM income_register i
        WHERE i.cogs_expense_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM expense_register e WHERE e.id = i.cogs_expense_id)
      `)
    ).rows.map((r) => ({ ...r, tenant: tenantMap.get(r.tenant_id) })),
    incomeMissingReversalExpense: (
      await client.query(`
        SELECT i.tenant_id, i.invoice_no, i.cogs_reversal_expense_id
        FROM income_register i
        WHERE i.cogs_reversal_expense_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM expense_register e WHERE e.id = i.cogs_reversal_expense_id)
      `)
    ).rows.map((r) => ({ ...r, tenant: tenantMap.get(r.tenant_id) })),
    unlinkedCogsExpenses: (
      await client.query(`
        SELECT e.tenant_id, e.receipt_no, e.amount, e.date
        FROM expense_register e
        WHERE (e.receipt_no LIKE 'COGS-%' OR e.receipt_no LIKE 'VOID-COGS-%')
          AND NOT EXISTS (
            SELECT 1 FROM income_register i
            WHERE i.cogs_expense_id = e.id OR i.cogs_reversal_expense_id = e.id
          )
      `)
    ).rows.map((r) => ({ ...r, tenant: tenantMap.get(r.tenant_id) })),
    cogsReceiptMismatch: (
      await client.query(`
        SELECT i.tenant_id, i.invoice_no, e.receipt_no AS expense_receipt, e.amount
        FROM income_register i
        JOIN expense_register e ON e.id = i.cogs_expense_id
        WHERE i.entry_type = 'product_sale'
          AND e.receipt_no IS DISTINCT FROM 'COGS-' || TRIM(i.invoice_no)
      `)
    ).rows.map((r) => ({ ...r, tenant: tenantMap.get(r.tenant_id) })),
    voidCogsReceiptMismatch: (
      await client.query(`
        SELECT i.tenant_id, i.invoice_no, e.receipt_no AS expense_receipt, e.amount
        FROM income_register i
        JOIN expense_register e ON e.id = i.cogs_reversal_expense_id
        WHERE i.entry_type = 'product_sale'
          AND i.sale_status = 'voided'
          AND e.receipt_no IS DISTINCT FROM 'VOID-COGS-' || TRIM(i.invoice_no)
      `)
    ).rows.map((r) => ({ ...r, tenant: tenantMap.get(r.tenant_id) })),
  };

  const voidCrossMonth = (
    await client.query(`
      SELECT i.tenant_id, i.invoice_no,
             i.date AS sale_date,
             e.date AS reversal_date,
             e.amount AS reversal_amount
      FROM income_register i
      JOIN expense_register e ON e.id = i.cogs_reversal_expense_id
      WHERE i.entry_type = 'product_sale'
        AND i.sale_status = 'voided'
        AND to_char(i.date::date, 'YYYY-MM') IS DISTINCT FROM to_char(e.date::date, 'YYYY-MM')
      ORDER BY i.tenant_id, i.date
    `)
  ).rows.map((r) => ({ ...r, tenant: tenantMap.get(r.tenant_id) }));

  const voidDateMismatchSameMonth = (
    await client.query(`
      SELECT COUNT(*)::int AS n
      FROM income_register i
      JOIN expense_register e ON e.id = i.cogs_reversal_expense_id
      WHERE i.entry_type = 'product_sale'
        AND i.sale_status = 'voided'
        AND e.date IS DISTINCT FROM i.date
        AND to_char(i.date::date, 'YYYY-MM') = to_char(e.date::date, 'YYYY-MM')
    `)
  ).rows[0]?.n ?? 0;

  const lockedMonths = (
    await client.query(`
      SELECT tenant_id, month, lock_status, employees_recorded, total_net_pay
      FROM month_end_close
      WHERE lock_status IN ('Locked', 'Partially Locked')
      ORDER BY tenant_id, month
    `)
  ).rows;

  const payrollAgg = (
    await client.query(`
      SELECT tenant_id,
             to_char(payroll_month::date, 'YYYY-MM') AS ym,
             COUNT(*)::int AS employee_rows,
             COALESCE(SUM(gross_pay), 0) AS gross,
             COALESCE(SUM(net_pay), 0) AS net,
             COALESCE(SUM(paye_tax), 0) AS paye,
             COALESCE(SUM(employee_ssnit), 0) AS emp_ssnit,
             COALESCE(SUM(employer_ssnit), 0) AS er_ssnit,
             COALESCE(SUM(tier2), 0) AS tier2
      FROM payroll_history
      GROUP BY tenant_id, to_char(payroll_month::date, 'YYYY-MM')
    `)
  ).rows;

  const payrollSalExpenses = (
    await client.query(`
      SELECT tenant_id, receipt_no, amount,
             substring(receipt_no from 'PAYROLL-SAL-(\\d{4}-\\d{2})') AS ym
      FROM expense_register
      WHERE receipt_no LIKE 'PAYROLL-SAL-%'
    `)
  ).rows;

  const payrollEssnitExpenses = (
    await client.query(`
      SELECT tenant_id, receipt_no, amount,
             substring(receipt_no from 'PAYROLL-ESSNIT-(\\d{4}-\\d{2})') AS ym
      FROM expense_register
      WHERE receipt_no LIKE 'PAYROLL-ESSNIT-%'
    `)
  ).rows;

  const taxBySource = (
    await client.query(`
      SELECT tenant_id, source_id, period_month,
             COUNT(*)::int AS leg_count,
             COALESCE(SUM(tax_amount), 0) AS total_tax
      FROM tax_ledger_entries
      WHERE source_type = 'payroll_period'
        AND direction = 'statutory_payable'
      GROUP BY tenant_id, source_id, period_month
    `)
  ).rows;

  const payrollByTenantYm = new Map<string, typeof payrollAgg[0]>();
  for (const row of payrollAgg) {
    payrollByTenantYm.set(`${row.tenant_id}|${row.ym}`, row);
  }
  const salByTenantYm = new Map<string, typeof payrollSalExpenses[0]>();
  for (const row of payrollSalExpenses) {
    if (row.ym) salByTenantYm.set(`${row.tenant_id}|${row.ym}`, row);
  }
  const essnitByTenantYm = new Map<string, typeof payrollEssnitExpenses[0]>();
  for (const row of payrollEssnitExpenses) {
    if (row.ym) essnitByTenantYm.set(`${row.tenant_id}|${row.ym}`, row);
  }
  const taxByTenantSource = new Map<string, typeof taxBySource[0]>();
  for (const row of taxBySource) {
    taxByTenantSource.set(`${row.tenant_id}|${row.source_id}`, row);
  }

  const payrollIdentityFailures: Array<Record<string, unknown>> = [];
  const invisiblePayroll: Array<Record<string, unknown>> = [];

  for (const lock of lockedMonths) {
    const ym = payrollMonthYm(lock.month);
    if (!ym) continue;
    const key = `${lock.tenant_id}|${ym}`;
    const hist = payrollByTenantYm.get(key);
    const sal = salByTenantYm.get(key);
    const essnit = essnitByTenantYm.get(key);
    let taxSourceId: string | null = null;
    try {
      taxSourceId = buildPayrollPeriodTaxLedgerSourceId(`${ym}-01`);
    } catch {
      taxSourceId = null;
    }
    const tax = taxSourceId ? taxByTenantSource.get(`${lock.tenant_id}|${taxSourceId}`) : null;

    const gross = r2(Number(hist?.gross ?? 0));
    const net = r2(Number(hist?.net ?? 0));
    const paye = r2(Number(hist?.paye ?? 0));
    const empSsnit = r2(Number(hist?.emp_ssnit ?? 0));
    const salAmount = r2(Number(sal?.amount ?? 0));
    const identityDiff = r2(gross - (net + paye + empSsnit));
    const salDiff = sal ? r2(salAmount - gross) : null;

    const hasHistory = (hist?.employee_rows ?? 0) > 0;
    const hasFinance = Boolean(sal) || Boolean(tax?.leg_count);

    if (hasHistory && Math.abs(identityDiff) > PAYROLL_TOL) {
      payrollIdentityFailures.push({
        tenant: tenantMap.get(lock.tenant_id),
        tenant_id: lock.tenant_id,
        month: ym,
        lock_status: lock.lock_status,
        gross,
        net,
        paye,
        employee_ssnit: empSsnit,
        identity_diff: identityDiff,
        payroll_sal_amount: salAmount || null,
        payroll_sal_diff: salDiff,
      });
    }

    if (hasHistory && sal && salDiff != null && Math.abs(salDiff) > PAYROLL_TOL) {
      payrollIdentityFailures.push({
        tenant: tenantMap.get(lock.tenant_id),
        tenant_id: lock.tenant_id,
        month: ym,
        lock_status: lock.lock_status,
        issue: "PAYROLL-SAL amount != payroll_history gross",
        gross,
        payroll_sal_amount: salAmount,
        diff: salDiff,
      });
    }

    if (hasHistory && !hasFinance) {
      invisiblePayroll.push({
        tenant: tenantMap.get(lock.tenant_id),
        tenant_id: lock.tenant_id,
        month: ym,
        lock_status: lock.lock_status,
        employee_rows: hist?.employee_rows ?? 0,
        gross,
        net,
        paye,
        employee_ssnit: empSsnit,
        has_payroll_sal: Boolean(sal),
        has_tax_ledger: Boolean(tax?.leg_count),
        has_essnit: Boolean(essnit),
      });
    }
  }

  const fpNoCostBasis = (
    await client.query(`
      WITH fp_cogs AS (
        SELECT i.tenant_id, i.product_id,
               SUM(ABS(e.amount)) AS total_cogs,
               COUNT(DISTINCT i.id)::int AS sale_count
        FROM income_register i
        JOIN expense_register e ON e.id = i.cogs_expense_id
        WHERE i.entry_type = 'product_sale'
          AND i.product_id IS NOT NULL
          AND COALESCE(e.amount, 0) <> 0
        GROUP BY i.tenant_id, i.product_id
      )
      SELECT c.tenant_id, fp.product_code, fp.product_name,
             c.total_cogs, c.sale_count,
             fp.current_stock,
             (SELECT COUNT(*)::int FROM production_batches pb WHERE pb.finished_product_id = fp.id) AS batch_count,
             (SELECT COUNT(*)::int FROM product_purchases pp WHERE pp.product_id = fp.id) AS purchase_count
      FROM fp_cogs c
      JOIN finished_products fp ON fp.id = c.product_id
      WHERE NOT EXISTS (SELECT 1 FROM production_batches pb WHERE pb.finished_product_id = fp.id)
        AND NOT EXISTS (SELECT 1 FROM product_purchases pp WHERE pp.product_id = fp.id)
      ORDER BY c.total_cogs DESC
    `)
  ).rows.map((r) => ({ ...r, tenant: tenantMap.get(r.tenant_id) }));

  const rmNoCostBasis = (
    await client.query(`
      SELECT DISTINCT rm.tenant_id, rm.material_code, rm.material_name, rm.current_stock,
             (SELECT COUNT(*)::int FROM raw_material_purchases rmp WHERE rmp.material_id = rm.id) AS purchase_count,
             (SELECT COUNT(*)::int FROM production_batch_materials pbm WHERE pbm.material_id = rm.id) AS production_use_count
      FROM raw_materials rm
      WHERE EXISTS (SELECT 1 FROM production_batch_materials pbm WHERE pbm.material_id = rm.id)
      AND NOT EXISTS (SELECT 1 FROM raw_material_purchases rmp WHERE rmp.material_id = rm.id)
      ORDER BY rm.tenant_id, rm.material_code
    `)
  ).rows.map((r) => ({ ...r, tenant: tenantMap.get(r.tenant_id) }));

  const fpStockDrift = (
    await client.query(
      `
      SELECT fp.tenant_id, fp.product_code, fp.product_name,
             fp.current_stock::float8 AS master_qty,
             COALESCE(SUM(fpb.current_stock), 0)::float8 AS balance_sum,
             (fp.current_stock - COALESCE(SUM(fpb.current_stock), 0))::float8 AS delta
      FROM finished_products fp
      LEFT JOIN finished_product_balances fpb
        ON fpb.product_id = fp.id AND fpb.tenant_id = fp.tenant_id
      GROUP BY fp.id, fp.tenant_id, fp.product_code, fp.product_name, fp.current_stock
      HAVING ABS(fp.current_stock - COALESCE(SUM(fpb.current_stock), 0)) > $1
      ORDER BY ABS(fp.current_stock - COALESCE(SUM(fpb.current_stock), 0)) DESC
      `,
      [STOCK_TOL],
    )
  ).rows.map((r) => ({ ...r, tenant: tenantMap.get(r.tenant_id) }));

  const rmStockDrift = (
    await client.query(
      `
      SELECT rm.tenant_id, rm.material_code, rm.material_name,
             rm.current_stock::float8 AS master_qty,
             COALESCE(SUM(rmb.current_stock), 0)::float8 AS balance_sum,
             (rm.current_stock - COALESCE(SUM(rmb.current_stock), 0))::float8 AS delta
      FROM raw_materials rm
      LEFT JOIN raw_material_balances rmb
        ON rmb.material_id = rm.id AND rmb.tenant_id = rm.tenant_id
      GROUP BY rm.id, rm.tenant_id, rm.material_code, rm.material_name, rm.current_stock
      HAVING ABS(rm.current_stock - COALESCE(SUM(rmb.current_stock), 0)) > $1
      ORDER BY ABS(rm.current_stock - COALESCE(SUM(rmb.current_stock), 0)) DESC
      `,
      [STOCK_TOL],
    )
  ).rows.map((r) => ({ ...r, tenant: tenantMap.get(r.tenant_id) }));

  return {
    tenants: tenants.rows,
    tenantMap,
    activeMonthsByTenant,
    orphanCogs,
    voidCrossMonth,
    voidDateMismatchSameMonth,
    payrollIdentityFailures,
    invisiblePayroll,
    fpNoCostBasis,
    rmNoCostBasis,
    fpStockDrift,
    rmStockDrift,
  };
}

function countOrphanIssues(orphanCogs) {
  return (
    orphanCogs.incomeMissingCogsExpense.length +
    orphanCogs.incomeMissingReversalExpense.length +
    orphanCogs.unlinkedCogsExpenses.length +
    orphanCogs.cogsReceiptMismatch.length +
    orphanCogs.voidCogsReceiptMismatch.length
  );
}

function printSection(title: string) {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
}

async function main() {
  const allowProduction = process.argv.includes("--allow-production");
  if (!allowProduction) throw new Error("Pass --allow-production");

  const { client, envFile } = await connectPg({
    requiredProjectRef: PRODUCTION_REF,
    envFiles: [".env.local.backup", ".env.vercel.production.local"],
  });
  console.log(`Production financial audit | ${PRODUCTION_REF} | via ${envFile}`);

  const sql = await sqlChecks(client);
  await client.end();

  loadEnv(resolve(".env.local.backup"));
  let url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(PRODUCTION_REF)) {
    loadEnv(resolve(".env.vercel.production.local"));
    url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  }
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const bs = await auditBalanceSheets(admin, sql.tenants, sql.activeMonthsByTenant);

  printSection("EXECUTIVE SUMMARY");
  const summary = {
    tenants_audited: sql.tenants.length,
    bs_imbalances: bs.imbalances.length,
    bs_fetch_errors: bs.errors.length,
    orphan_cogs_issues: countOrphanIssues(sql.orphanCogs),
    void_cross_month: sql.voidCrossMonth.length,
    void_same_month_date_mismatch: sql.voidDateMismatchSameMonth,
    payroll_identity_failures: sql.payrollIdentityFailures.length,
    invisible_payroll_locked_months: sql.invisiblePayroll.length,
    fp_no_cost_basis: sql.fpNoCostBasis.length,
    rm_no_cost_basis: sql.rmNoCostBasis.length,
    fp_stock_drift: sql.fpStockDrift.length,
    rm_stock_drift: sql.rmStockDrift.length,
  };
  console.log(summary);

  printSection("1. BALANCE SHEET INTEGRITY (active months only)");
  if (bs.errors.length) {
    console.log("Fetch errors:");
    for (const e of bs.errors) console.log(`  ${e.tenant}: ${e.error}`);
  }
  if (bs.imbalances.length === 0) {
    console.log("CLEAN — no BS imbalances in any tenant/month with financial activity.");
  } else {
    console.log(`FOUND ${bs.imbalances.length} imbalance(s):`);
    for (const row of bs.imbalances.sort(
      (a, b) => Math.abs(b.diff) - Math.abs(a.diff) || a.tenant.localeCompare(b.tenant),
    )) {
      console.log(
        `  ${row.tenant} | ${row.ym} | diff=${row.diff.toFixed(2)} | assets=${row.assets.toFixed(2)} L+E=${row.liabilitiesEquity.toFixed(2)}`,
      );
    }
    const byTenant = new Map<string, typeof bs.imbalances>();
    for (const row of bs.imbalances) {
      if (!byTenant.has(row.tenant)) byTenant.set(row.tenant, []);
      byTenant.get(row.tenant)!.push(row);
    }
    console.log("\nBy tenant:");
    for (const [tenant, rows] of [...byTenant.entries()].sort()) {
      console.log(
        `  ${tenant}: ${rows.map((r) => `${r.ym}=${r.diff.toFixed(2)}`).join(", ")}`,
      );
    }
  }

  printSection("2. ORPHAN COGS / DANGLING REFERENCES");
  const orphanTotal = countOrphanIssues(sql.orphanCogs);
  if (orphanTotal === 0) {
    console.log("CLEAN — no orphan COGS or broken income↔expense linkages.");
  } else {
    for (const [key, rows] of Object.entries(sql.orphanCogs)) {
      if (!rows.length) continue;
      console.log(`\n${key} (${rows.length}):`);
      for (const r of rows) console.log(`  `, r);
    }
  }

  printSection("3. PAYROLL LOCK CONSISTENCY");
  if (sql.payrollIdentityFailures.length === 0 && sql.invisiblePayroll.length === 0) {
    console.log("CLEAN — all locked/partially-locked months reconcile; no invisible payroll.");
  } else {
    if (sql.payrollIdentityFailures.length) {
      console.log(`\nIdentity failures (${sql.payrollIdentityFailures.length}):`);
      for (const r of sql.payrollIdentityFailures) console.log(`  `, r);
    }
    if (sql.invisiblePayroll.length) {
      console.log(`\nInvisible payroll — locked with history but no finance postings (${sql.invisiblePayroll.length}):`);
      for (const r of sql.invisiblePayroll) console.log(`  `, r);
    }
  }

  printSection("4. VOID REVERSAL DATE INTEGRITY");
  console.log(`Cross-month VOID-COGS vs sale: ${sql.voidCrossMonth.length}`);
  if (sql.voidCrossMonth.length) {
    for (const r of sql.voidCrossMonth) console.log(`  `, r);
  }
  console.log(
    `Same-month voids with different day (informational): ${sql.voidDateMismatchSameMonth}`,
  );
  if (sql.voidCrossMonth.length === 0) {
    console.log("CLEAN — no voided sale has VOID-COGS in a different calendar month.");
  }

  printSection("5. INVENTORY COST-BASIS INTEGRITY");
  if (sql.fpNoCostBasis.length === 0 && sql.rmNoCostBasis.length === 0) {
    console.log("CLEAN — no products/materials with COGS/consumption but zero cost-basis inflow.");
  } else {
    if (sql.fpNoCostBasis.length) {
      console.log(`\nFinished products with sale COGS but no production/purchase (${sql.fpNoCostBasis.length}):`);
      for (const r of sql.fpNoCostBasis) console.log(`  `, r);
    }
    if (sql.rmNoCostBasis.length) {
      console.log(`\nRaw materials with production use/outflow but no purchases (${sql.rmNoCostBasis.length}):`);
      for (const r of sql.rmNoCostBasis) console.log(`  `, r);
    }
  }

  printSection("6. STOCK TABLE CONSISTENCY");
  if (sql.fpStockDrift.length === 0 && sql.rmStockDrift.length === 0) {
    console.log("CLEAN — finished_products/raw_materials match sum of balance rows.");
  } else {
    if (sql.fpStockDrift.length) {
      console.log(`\nFinished product drift (${sql.fpStockDrift.length}):`);
      for (const r of sql.fpStockDrift.slice(0, 30)) console.log(`  `, r);
      if (sql.fpStockDrift.length > 30) console.log(`  ... +${sql.fpStockDrift.length - 30} more`);
    }
    if (sql.rmStockDrift.length) {
      console.log(`\nRaw material drift (${sql.rmStockDrift.length}):`);
      for (const r of sql.rmStockDrift.slice(0, 30)) console.log(`  `, r);
      if (sql.rmStockDrift.length > 30) console.log(`  ... +${sql.rmStockDrift.length - 30} more`);
    }
  }

  printSection("SEVERITY GROUPING");
  const critical: string[] = [];
  const warning: string[] = [];
  const info: string[] = [];

  if (bs.imbalances.length) {
    critical.push(
      `BS imbalances: ${bs.imbalances.length} tenant-month(s) across ${new Set(bs.imbalances.map((r) => r.tenant)).size} tenant(s)`,
    );
  }
  if (sql.invisiblePayroll.length) {
    critical.push(
      `Invisible payroll: ${sql.invisiblePayroll.length} locked month(s) in ${new Set(sql.invisiblePayroll.map((r) => r.tenant)).size} tenant(s)`,
    );
  }
  if (sql.voidCrossMonth.length) {
    critical.push(`Void cross-month: ${sql.voidCrossMonth.length} sale(s)`);
  }
  if (orphanTotal) {
    warning.push(`Orphan COGS / broken linkages: ${orphanTotal} row(s)`);
  }
  if (sql.payrollIdentityFailures.length) {
    warning.push(`Payroll identity mismatch: ${sql.payrollIdentityFailures.length} locked month(s)`);
  }
  if (sql.fpNoCostBasis.length || sql.rmNoCostBasis.length) {
    warning.push(
      `No cost basis: ${sql.fpNoCostBasis.length} FP + ${sql.rmNoCostBasis.length} RM`,
    );
  }
  if (sql.fpStockDrift.length || sql.rmStockDrift.length) {
    warning.push(
      `Stock table drift: ${sql.fpStockDrift.length} FP + ${sql.rmStockDrift.length} RM`,
    );
  }
  if (sql.voidDateMismatchSameMonth > 0) {
    info.push(
      `Void same-month day mismatch (non-boundary): ${sql.voidDateMismatchSameMonth} sale(s)`,
    );
  }

  if (!critical.length && !warning.length && !info.length) {
    console.log("ALL CHECKS CLEAN — no issues found across production tenants.");
  } else {
    if (critical.length) {
      console.log("\nCRITICAL:");
      for (const s of critical) console.log(`  • ${s}`);
    }
    if (warning.length) {
      console.log("\nWARNING:");
      for (const s of warning) console.log(`  • ${s}`);
    }
    if (info.length) {
      console.log("\nINFO:");
      for (const s of info) console.log(`  • ${s}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
