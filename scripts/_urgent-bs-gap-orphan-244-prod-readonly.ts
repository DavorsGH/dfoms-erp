/**
 * READ-ONLY urgent investigation: Davors BS gap after orphan delete + 244 backfill.
 *
 *   npx tsx scripts/_urgent-bs-gap-orphan-244-prod-readonly.ts --env-file .env.local.backup --allow-production
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { connectPg } from "./lib/pg-connect";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  getBalanceSheetAmountForMonth,
  FULL_YEAR_INDEX,
  BALANCE_TOLERANCE,
} from "../app/dashboard/finance/balance-sheet-utils";
// BalanceSheetReport.rows[].key === "cash" for Cash and Cash Equivalents
import { BS_INTEGRITY_EVENT_NAME } from "../utils/balance-sheet-integrity-constants";
import { auditTenantBalanceSheetIntegrity } from "../utils/balance-sheet-integrity";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";
const ORPHAN_INCOME_ID = "6cadedd7-8038-4a30-8fb8-439166f2fbe6";
const FY = 2026;
const REF_DATE = new Date("2026-12-31T23:59:59.000Z");
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const TARGET_GAPS = [2615.06, 5230.12, 36009.22, 34440.19, 1569.03];

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

function near(a: number, b: number, tol = 0.02) {
  return Math.abs(r2(a) - r2(b)) <= tol;
}

function parseArgs() {
  let envFile = ".env.local.backup";
  let allowProduction = false;
  for (let i = 2; i < process.argv.length; i += 1) {
    if (process.argv[i] === "--env-file" && process.argv[i + 1]) {
      envFile = process.argv[i + 1]!;
      i += 1;
    } else if (process.argv[i] === "--allow-production") {
      allowProduction = true;
    }
  }
  return { envFile, allowProduction };
}

function matchTargets(diff: number): string[] {
  const abs = Math.abs(r2(diff));
  const hits: string[] = [];
  for (const t of TARGET_GAPS) {
    if (near(abs, t)) hits.push(`abs==${t}`);
    if (near(abs, t * 2)) hits.push(`abs==2*${t}`);
    if (near(abs, t / 2)) hits.push(`abs==${t}/2`);
  }
  if (near(abs, 2615.06 * 2)) hits.push("abs==2*2615.06 (Aug pattern)");
  // combinations
  const combos: Array<[string, number]> = [
    ["36009.22-34440.19", 1569.03],
    ["36009.22-34440.19+2615.06", 1569.03 + 2615.06],
    ["34440.19-36009.22", -1569.03],
    ["1569.03+1045.99?", 1569.03 + 1046.03],
  ];
  for (const [label, v] of combos) {
    if (near(abs, Math.abs(v))) hits.push(`combo:${label}`);
  }
  return [...new Set(hits)];
}

async function main() {
  const { envFile, allowProduction } = parseArgs();
  loadEnv(resolve(process.cwd(), envFile));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!allowProduction) {
    throw new Error("Pass --allow-production");
  }
  if (!url.includes(PRODUCTION_REF) || !key) {
    throw new Error("Refusing: production credentials required");
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { client } = await connectPg({
    requiredProjectRef: PRODUCTION_REF,
    envFiles: [envFile, ".env.local.backup", ".env.local"],
  });

  const lines: string[] = [];
  const log = (s: string) => {
    lines.push(s);
    console.log(s);
  };

  try {
    log(`=== URGENT BS gap investigation (PRODUCTION READ-ONLY) ===`);
    log(`Now UTC: ${new Date().toISOString()}`);
    log("");

    // -------------------------------------------------------------------------
    // 1) TIMELINE — BS integrity cron + evidence of today's mutations
    // -------------------------------------------------------------------------
    log("--- 1) TIMELINE: balance-sheet-integrity cron + mutation evidence ---");

    const { data: cronEvents, error: cronErr } = await admin
      .from("system_event_log")
      .select("id, event_name, status, created_at, message, metadata")
      .eq("event_name", BS_INTEGRITY_EVENT_NAME)
      .order("created_at", { ascending: false })
      .limit(80);

    if (cronErr) {
      log(`system_event_log ERROR: ${cronErr.message}`);
    } else {
      const events = cronEvents ?? [];
      log(`Latest ${events.length} balance-sheet-integrity events:`);
      for (const e of events.slice(0, 25)) {
        const meta =
          typeof e.metadata === "object" && e.metadata
            ? JSON.stringify(e.metadata).slice(0, 280)
            : String(e.metadata ?? "").slice(0, 280);
        const metaObj =
          e.metadata && typeof e.metadata === "object"
            ? (e.metadata as Record<string, unknown>)
            : {};
        log(
          `  ${e.created_at}  status=${e.status}  kind=${metaObj.kind ?? "?"}  tenant=${metaObj.tenantId ?? metaObj.tenantName ?? "?"}  msg=${String(e.message ?? "").slice(0, 100)}  meta=${meta}`,
        );
      }

      const runSummaries = events.filter((e) => {
        const m = e.metadata as Record<string, unknown> | null;
        return m?.kind === "run" || m?.kind === "summary" || !m?.tenantId;
      });
      const davorsTenantEvents = events.filter((e) => {
        const m = e.metadata as Record<string, unknown> | null;
        return m?.tenantId === DAVORS_TENANT_ID;
      });
      const lastSuccessRun = events.find((e) => {
        const m = e.metadata as Record<string, unknown> | null;
        return (
          e.status === "success" &&
          (m?.kind === "run" || m?.kind === "summary" || m?.balanced != null)
        );
      });
      const lastDavorsSuccess = davorsTenantEvents.find(
        (e) => e.status === "success",
      );
      const lastDavorsAny = davorsTenantEvents[0];
      log("");
      log(
        `Last success run/summary: ${lastSuccessRun ? `${lastSuccessRun.created_at} status=${lastSuccessRun.status}` : "NOT FOUND in latest 80"}`,
      );
      log(
        `Last Davors tenant event: ${lastDavorsAny ? `${lastDavorsAny.created_at} status=${lastDavorsAny.status}` : "NONE"}`,
      );
      log(
        `Last Davors SUCCESS: ${lastDavorsSuccess ? lastDavorsSuccess.created_at : "NONE in latest 80"}`,
      );
      log(`Run/summary-ish events in batch: ${runSummaries.length}`);
    }

    // Schema change time for client_invoice_id (approximate via pg_attribute / no direct)
    const colMeta = await client.query(`
      SELECT
        a.attname,
        pg_catalog.format_type(a.atttypid, a.atttypmod) AS typ,
        a.attnotnull,
        (
          SELECT c.conname
          FROM pg_constraint c
          WHERE c.conrelid = 'public.income_register'::regclass
            AND c.conname = 'income_register_client_invoice_id_fkey'
        ) AS fk_name
      FROM pg_attribute a
      WHERE a.attrelid = 'public.income_register'::regclass
        AND a.attname = 'client_invoice_id'
        AND NOT a.attisdropped
    `);
    log(`client_invoice_id column present: ${colMeta.rowCount === 1}`);
    if (colMeta.rows[0]) log(`  ${JSON.stringify(colMeta.rows[0])}`);

    // Postgres has no audit of DELETE by default. Infer from absence + leftover refs.
    const orphanGone = await client.query(
      `SELECT 1 FROM public.income_register WHERE id = $1`,
      [ORPHAN_INCOME_ID],
    );
    log(
      `Orphan income ${ORPHAN_INCOME_ID} still in income_register: ${orphanGone.rowCount === 1 ? "YES" : "NO (deleted)"}`,
    );

    // Linked Client Invoice rows (post-244)
    const irCols = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'income_register'
      ORDER BY ordinal_position
    `);
    log(
      `income_register columns: ${irCols.rows.map((r) => r.column_name).join(", ")}`,
    );

    const linked = await client.query(`
      SELECT
        ir.id,
        ir.invoice_no,
        ir.tenant_id AS ir_tenant,
        t.name AS tenant_name,
        ir.client_invoice_id,
        ci.tenant_id AS ci_tenant,
        ci.invoice_number,
        (ir.tenant_id = ci.tenant_id) AS tenants_match,
        ir.amount::text,
        ir.outstanding_balance::text,
        ir.date::text
      FROM public.income_register ir
      JOIN public.client_invoices ci ON ci.id = ir.client_invoice_id
      LEFT JOIN public.tenants t ON t.id = ir.tenant_id
      WHERE ir.service_category = 'Client Invoice'
        AND ir.client_invoice_id IS NOT NULL
      ORDER BY ir.invoice_no
    `);
    log(`\nLinked Client Invoice income rows (client_invoice_id NOT NULL): ${linked.rowCount}`);
    for (const row of linked.rows) {
      log(
        `  ${row.invoice_no}  ir=${row.id}  tenants_match=${row.tenants_match}  ir_tenant=${row.ir_tenant}  ci_tenant=${row.ci_tenant}  amount=${row.amount}  date=${row.date}`,
      );
    }
    const crossTenant = linked.rows.filter((r) => r.tenants_match === false);
    log(`Cross-tenant links: ${crossTenant.length}`);

    // Davors-only linked
    const davorsLinked = linked.rows.filter(
      (r) => r.ir_tenant === DAVORS_TENANT_ID,
    );
    log(`Davors linked count: ${davorsLinked.length}`);

    // -------------------------------------------------------------------------
    // 2) ORPHAN DELETE residue + gap matching
    // -------------------------------------------------------------------------
    log("\n--- 2) ORPHAN DF-INV-0003 residue + gap figure match ---");

    const taxCols = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'tax_ledger_entries'
      ORDER BY ordinal_position
    `);
    log(`tax_ledger_entries columns: ${taxCols.rows.map((r) => r.column_name).join(", ")}`);

    const taxLegs = await client.query(
      `
      SELECT id, tenant_id, entry_date::text, direction, tax_component,
             tax_amount::text, status, source_type, source_id::text,
             counterparty_name, notes, created_at::text
      FROM public.tax_ledger_entries
      WHERE source_id::text = $1
         OR COALESCE(notes, '') ILIKE '%DF-INV-0003%'
         OR COALESCE(counterparty_name, '') ILIKE '%DF-INV-0003%'
         OR COALESCE(notes, '') ILIKE '%6cadedd7%'
      ORDER BY created_at
      LIMIT 50
    `,
      [ORPHAN_INCOME_ID],
    );
    log(`tax_ledger_entries referencing orphan id / DF-INV-0003: ${taxLegs.rowCount}`);
    for (const row of taxLegs.rows) log(`  ${JSON.stringify(row)}`);

    const taxNearGap = await client.query(
      `
      SELECT id, entry_date::text, direction, tax_component, tax_amount::text,
             status, source_type, source_id::text, counterparty_name, notes
      FROM public.tax_ledger_entries
      WHERE tenant_id = $1
        AND (
          ABS(tax_amount - 4184.09) < 0.02
          OR ABS(tax_amount - 1569.03) < 0.02
          OR ABS(tax_amount - 2615.06) < 0.02
          OR ABS(tax_amount - 5230.12) < 0.02
        )
      ORDER BY entry_date, direction
    `,
      [DAVORS_TENANT_ID],
    );
    log(`Davors tax_ledger near VAT/WHT/gap amounts: ${taxNearGap.rowCount}`);
    for (const row of taxNearGap.rows) log(`  ${JSON.stringify(row)}`);

    const allOpenTax = await client.query(
      `
      SELECT entry_date::text, direction, tax_component, tax_amount::text,
             status, source_type, source_id::text
      FROM public.tax_ledger_entries
      WHERE tenant_id = $1
        AND status = 'open'
      ORDER BY entry_date, direction
    `,
      [DAVORS_TENANT_ID],
    );
    log(`Davors ALL open tax_ledger_entries: ${allOpenTax.rowCount}`);
    for (const row of allOpenTax.rows) log(`  ${JSON.stringify(row)}`);

    const taxForLinkedInvoices = await client.query(
      `
      SELECT ir.invoice_no, ir.id AS income_id, ir.date::text,
             ir.output_vat_amount::text AS ir_vat, ir.wht_amount::text AS ir_wht,
             t.id AS tax_id, t.direction, t.tax_amount::text, t.status, t.entry_date::text
      FROM public.income_register ir
      LEFT JOIN public.tax_ledger_entries t
        ON t.source_type = 'income_register'
       AND t.source_id::text = ir.id::text
      WHERE ir.tenant_id = $1
        AND ir.service_category = 'Client Invoice'
      ORDER BY ir.date, ir.invoice_no, t.direction
    `,
      [DAVORS_TENANT_ID],
    );
    log(`Tax ledger join for Davors Client Invoice income (incl remitted/missing):`);
    for (const row of taxForLinkedInvoices.rows) log(`  ${JSON.stringify(row)}`);

    const anyTaxFor0001or0004 = await client.query(
      `
      SELECT *
      FROM public.tax_ledger_entries
      WHERE tenant_id = $1
        AND source_id::text IN (
          '1b09a1e5-30d3-4b51-98b5-05bc4a2f470d',
          'fd539e43-29cd-4d08-9dd6-b2bb1fa53252',
          '6cadedd7-8038-4a30-8fb8-439166f2fbe6'
        )
    `,
      [DAVORS_TENANT_ID],
    );
    log(
      `Any-status tax rows for 0001/0004/orphan income ids: ${anyTaxFor0001or0004.rowCount}`,
    );
    for (const row of anyTaxFor0001or0004.rows) log(`  ${JSON.stringify(row)}`);

    log(
      `Arithmetic check: 4184.09 - 1569.03 = ${(4184.09 - 1569.03).toFixed(2)} (reported Jul gap)`,
    );
    log(
      `Arithmetic check: 34440.19 - (36009.22 - 4184.09) = ${(34440.19 - (36009.22 - 4184.09)).toFixed(2)}`,
    );
    log(
      `Arithmetic check: 2 * 2615.06 = ${(2 * 2615.06).toFixed(2)} (reported Aug gap)`,
    );

    // Also scan open tax legs that might orphan after income delete (any source_id missing)
    const danglingTax = await client.query(
      `
      SELECT t.id, t.entry_date::text, t.direction, t.tax_component,
             t.tax_amount::text, t.status, t.source_type, t.source_id::text
      FROM public.tax_ledger_entries t
      WHERE t.tenant_id = $1
        AND t.source_type = 'income_register'
        AND t.source_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.income_register ir WHERE ir.id::text = t.source_id::text
        )
      ORDER BY t.entry_date
      LIMIT 50
    `,
      [DAVORS_TENANT_ID],
    );
    log(`Dangling tax_ledger_entries (income_register source missing): ${danglingTax.rowCount}`);
    for (const row of danglingTax.rows) log(`  ${JSON.stringify(row)}`);

    // WHT/VAT fields on linked Davors invoices for comparison
    const davorsTaxFields = await client.query(
      `
      SELECT invoice_no, date::text, amount::text, outstanding_balance::text,
             amount_received::text, wht_amount::text, output_vat_amount::text,
             net_of_tax_amount::text, client_invoice_id IS NOT NULL AS linked
      FROM public.income_register
      WHERE tenant_id = $1
        AND service_category = 'Client Invoice'
      ORDER BY date, invoice_no
    `,
      [DAVORS_TENANT_ID],
    );
    log(`Davors Client Invoice income rows now: ${davorsTaxFields.rowCount}`);
    for (const row of davorsTaxFields.rows) log(`  ${JSON.stringify(row)}`);

    // client_invoices for DF-INV-0003
    const ci0003 = await client.query(
      `
      SELECT id, tenant_id, invoice_number, status, created_at::text, updated_at::text
      FROM public.client_invoices
      WHERE tenant_id = $1 AND invoice_number = 'DF-INV-0003'
    `,
      [DAVORS_TENANT_ID],
    );
    log(`client_invoices DF-INV-0003 rows: ${ci0003.rowCount}`);
    for (const row of ci0003.rows) log(`  ${JSON.stringify(row)}`);

    // payments / receipts that might reference invoice 0003
    const payCols = await client.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('client_invoice_payments', 'client_receipts')
      ORDER BY table_name, ordinal_position
    `);
    log(`Payment table columns:`);
    for (const row of payCols.rows) log(`  ${row.table_name}.${row.column_name}`);

    if (ci0003.rows[0]) {
      const invId = ci0003.rows[0].id as string;
      try {
        const pays = await client.query(
          `
          SELECT *
          FROM public.client_invoice_payments
          WHERE invoice_id = $1
          LIMIT 20
        `,
          [invId],
        );
        log(`client_invoice_payments for DF-INV-0003: ${pays.rowCount}`);
        for (const row of pays.rows) log(`  ${JSON.stringify(row)}`);
      } catch (e) {
        log(`client_invoice_payments query error: ${e instanceof Error ? e.message : e}`);
      }
    } else {
      log("client_invoices DF-INV-0003 absent — payments would have cascaded with invoice if FK ON DELETE CASCADE");
      try {
        const pays = await client.query(
          `
          SELECT id, tenant_id, invoice_id, amount::text, payment_date::text
          FROM public.client_invoice_payments
          WHERE tenant_id = $1
          ORDER BY payment_date DESC NULLS LAST
          LIMIT 15
        `,
          [DAVORS_TENANT_ID],
        );
        log(`Recent Davors client_invoice_payments: ${pays.rowCount}`);
        for (const row of pays.rows) log(`  ${JSON.stringify(row)}`);
      } catch (e) {
        log(`client_invoice_payments recent error: ${e instanceof Error ? e.message : e}`);
      }
      try {
        const receipts = await client.query(
          `
          SELECT id, tenant_id, invoice_id, amount::text, receipt_date::text
          FROM public.client_receipts
          WHERE tenant_id = $1
          ORDER BY receipt_date DESC NULLS LAST
          LIMIT 15
        `,
          [DAVORS_TENANT_ID],
        );
        log(`Recent Davors client_receipts: ${receipts.rowCount}`);
        for (const row of receipts.rows) log(`  ${JSON.stringify(row)}`);
      } catch (e) {
        log(`client_receipts recent error: ${e instanceof Error ? e.message : e}`);
      }
    }

    // skip old brittle payment block
    if (false) {
      const payTables = { rows: [] as Array<{ table_name: string }> };
    log(`Payment-related tables present: placeholder`);
    }

    // Any income_register still mentioning 0003
    const income0003 = await client.query(
      `
      SELECT id, date::text, amount::text, amount_received::text, outstanding_balance::text,
             payment_status, client_invoice_id
      FROM public.income_register
      WHERE tenant_id = $1
        AND (invoice_no = 'DF-INV-0003' OR id = $2 OR COALESCE(description, '') ILIKE '%DF-INV-0003%')
    `,
      [DAVORS_TENANT_ID, ORPHAN_INCOME_ID],
    );
    log(`income_register still mentioning DF-INV-0003: ${income0003.rowCount}`);
    for (const row of income0003.rows) log(`  ${JSON.stringify(row)}`);

    // -------------------------------------------------------------------------
    // 3) 244 WHERE clause verification (documented + live re-check)
    // -------------------------------------------------------------------------
    log("\n--- 3) Migration 244 backfill WHERE clause + live verify ---");
    log(`Exact UPDATE WHERE (from scripts/244_client_invoice_income_link.sql):`);
    log(`  UPDATE income_register ir SET client_invoice_id = ci.id`);
    log(`  FROM client_invoices ci`);
    log(`  WHERE ir.client_invoice_id IS NULL`);
    log(`    AND ir.service_category = 'Client Invoice'`);
    log(`    AND ir.invoice_no IS NOT NULL AND trim(ir.invoice_no) <> ''`);
    log(`    AND ci.tenant_id = ir.tenant_id`);
    log(`    AND ci.invoice_number = ir.invoice_no`);

    const mismatch = await client.query(`
      SELECT
        ir.id AS income_id,
        ir.invoice_no,
        ir.tenant_id AS ir_tenant,
        ci.tenant_id AS ci_tenant,
        ci.id AS client_invoice_id,
        ti.name AS ir_tenant_name,
        tc.name AS ci_tenant_name
      FROM public.income_register ir
      JOIN public.client_invoices ci ON ci.id = ir.client_invoice_id
      LEFT JOIN public.tenants ti ON ti.id = ir.tenant_id
      LEFT JOIN public.tenants tc ON tc.id = ci.tenant_id
      WHERE ir.client_invoice_id IS NOT NULL
        AND ir.tenant_id IS DISTINCT FROM ci.tenant_id
    `);
    log(`Live cross-tenant mismatches: ${mismatch.rowCount}`);
    for (const row of mismatch.rows) log(`  ${JSON.stringify(row)}`);

    const invoiceNoMismatch = await client.query(`
      SELECT
        ir.id,
        ir.invoice_no,
        ci.invoice_number,
        ir.tenant_id
      FROM public.income_register ir
      JOIN public.client_invoices ci ON ci.id = ir.client_invoice_id
      WHERE ir.client_invoice_id IS NOT NULL
        AND ir.invoice_no IS DISTINCT FROM ci.invoice_number
    `);
    log(`invoice_no vs invoice_number mismatches: ${invoiceNoMismatch.rowCount}`);
    for (const row of invoiceNoMismatch.rows) log(`  ${JSON.stringify(row)}`);

    // -------------------------------------------------------------------------
    // 4) Davors FY2026 month diffs + cash + known-cause probes
    // -------------------------------------------------------------------------
    log("\n--- 4) Davors FY2026 live BS + known-cause probes ---");
    const page = await fetchBalanceSheetPageData(admin, DAVORS_TENANT_ID, {
      dateRange: null,
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
        tenantId: DAVORS_TENANT_ID,
        accountsPayablePayments: page.initialAccountsPayablePayments,
        directorsLoanRepayments: page.initialDirectorsLoanRepayments,
      },
    );

    const monthDiffs: Array<{
      month: string;
      idx: number;
      diff: number;
      assets: number;
      le: number;
      cash: number;
      hits: string[];
    }> = [];

    const cashRow =
      report.rows.find((row) => row.key === "cash") ?? null;

    for (let i = 0; i < 12; i += 1) {
      const check = getBalanceCheckForPeriod(report, i);
      const cash = cashRow
        ? r2(getBalanceSheetAmountForMonth(cashRow, i))
        : NaN;
      const diff = r2(check.difference);
      const hits = matchTargets(diff);
      const row = {
        month: MONTHS[i]!,
        idx: i,
        diff,
        assets: r2(check.totalAssets),
        le: r2(check.totalLiabilitiesAndEquity),
        cash,
        hits,
      };
      monthDiffs.push(row);
      log(
        `${row.month.padEnd(4)} diff=${row.diff.toFixed(2)} assets=${row.assets.toFixed(2)} L+E=${row.le.toFixed(2)} cash=${row.cash.toFixed(2)} balanced=${check.isBalanced} hits=[${hits.join(", ")}]`,
      );
    }
    const fy = getBalanceCheckForPeriod(report, FULL_YEAR_INDEX);
    const dec = getBalanceCheckForPeriod(report, 11);
    log(
      `FULL_YEAR diff=${r2(fy.difference).toFixed(2)}  Dec-vs-FY gap=${r2(fy.difference - dec.difference).toFixed(2)}`,
    );

    const jul = monthDiffs[6]!;
    const aug = monthDiffs[7]!;
    log("");
    log(
      `Jul abs gap ${Math.abs(jul.diff).toFixed(2)} vs reported 2615.06 → match=${near(Math.abs(jul.diff), 2615.06)}`,
    );
    log(
      `Aug abs gap ${Math.abs(aug.diff).toFixed(2)} vs reported 5230.12 → match=${near(Math.abs(aug.diff), 5230.12)}`,
    );
    log(
      `Aug/Jul ratio: ${jul.diff !== 0 ? r2(aug.diff / jul.diff).toFixed(4) : "n/a"} (expect ~2 if cumulative)`,
    );
    log(
      `Aug-Jul incremental: ${r2(aug.diff - jul.diff).toFixed(2)} (vs Jul ${jul.diff.toFixed(2)})`,
    );

    // Inventory month-aware
    const inv = page.initialInventoryBalanceSheet;
    log("\nInventory opening config:");
    log(
      JSON.stringify(
        {
          go_live_date: inv?.config?.go_live_date ?? null,
          opening_inventory_value: inv?.config?.opening_inventory_value ?? null,
        },
        null,
        2,
      ),
    );

    // System adjustment income
    const sysAdj = await client.query(
      `
      SELECT id, date::text, amount::text, amount_received::text, outstanding_balance::text,
             invoice_no, is_system_adjustment, payment_status
      FROM public.income_register
      WHERE tenant_id = $1
        AND COALESCE(is_system_adjustment, false) = true
      ORDER BY date
    `,
      [DAVORS_TENANT_ID],
    );
    log(`\nSystem-adjustment income rows: ${sysAdj.rowCount}`);
    for (const row of sysAdj.rows) log(`  ${JSON.stringify(row)}`);

    // Manual financial entries liabilities
    const manuals = await client.query(
      `
      SELECT *
      FROM public.manual_financial_entries
      WHERE tenant_id = $1
      LIMIT 100
    `,
      [DAVORS_TENANT_ID],
    );
    log(`\nManual financial entries: ${manuals.rowCount}`);
    for (const row of manuals.rows) log(`  ${JSON.stringify(row)}`);

    // Would cron catch now? Recompute like integrity audit for Davors
    const davorsAudit = await auditTenantBalanceSheetIntegrity(
      admin,
      { id: DAVORS_TENANT_ID, name: "Davors Facilities" },
      FY,
      REF_DATE,
    );
    log("\nLive integrity audit (would cron see now):");
    log(JSON.stringify(davorsAudit, null, 2).slice(0, 2000));

    // -------------------------------------------------------------------------
    // 5) PLATFORM-WIDE SWEEP
    // -------------------------------------------------------------------------
    log("\n--- 5) PLATFORM-WIDE FY2026 sweep (all tenants) ---");
    const { data: tenants, error: tErr } = await admin
      .from("tenants")
      .select("id, name, status")
      .order("name");
    if (tErr) throw tErr;

    type SweepRow = {
      name: string;
      id: string;
      status: string | null;
      worstMonth: string | null;
      worstAbs: number;
      imbalancedMonths: string[];
      julDiff: number;
      augDiff: number;
      fyDiff: number;
      fetchError?: string;
    };
    const sweep: SweepRow[] = [];

    for (const tenant of tenants ?? []) {
      const data = await fetchBalanceSheetPageData(admin, tenant.id, {
        dateRange: null,
      });
      if (data.fetchError) {
        sweep.push({
          name: tenant.name,
          id: tenant.id,
          status: tenant.status,
          worstMonth: null,
          worstAbs: 0,
          imbalancedMonths: [],
          julDiff: 0,
          augDiff: 0,
          fyDiff: 0,
          fetchError: data.fetchError,
        });
        continue;
      }
      const rep = buildBalanceSheetReport(
        data.initialIncomeEntries,
        data.initialExpenseEntries,
        data.initialFixedAssets,
        data.initialPayableEntries,
        data.initialCapitalContributions,
        data.initialCashFlowExpenseEntries,
        data.initialPayrollHistory,
        data.initialMonthEndCloseNetPay,
        FY,
        data.initialInventoryBalanceSheet,
        data.initialManualEntries,
        data.initialTaxLedgerEntries,
        {
          tenantId: tenant.id,
          accountsPayablePayments: data.initialAccountsPayablePayments,
          directorsLoanRepayments: data.initialDirectorsLoanRepayments,
        },
      );
      const imbalanced: string[] = [];
      let worstMonth: string | null = null;
      let worstAbs = 0;
      let julDiff = 0;
      let augDiff = 0;
      for (let i = 0; i < 12; i += 1) {
        const check = getBalanceCheckForPeriod(rep, i);
        const diff = r2(check.difference);
        if (i === 6) julDiff = diff;
        if (i === 7) augDiff = diff;
        if (!check.isBalanced || Math.abs(diff) > BALANCE_TOLERANCE) {
          imbalanced.push(`${MONTHS[i]}:${diff.toFixed(2)}`);
          if (Math.abs(diff) > worstAbs) {
            worstAbs = Math.abs(diff);
            worstMonth = MONTHS[i]!;
          }
        }
      }
      const fyCheck = getBalanceCheckForPeriod(rep, FULL_YEAR_INDEX);
      sweep.push({
        name: tenant.name,
        id: tenant.id,
        status: tenant.status,
        worstMonth,
        worstAbs: r2(worstAbs),
        imbalancedMonths: imbalanced,
        julDiff,
        augDiff,
        fyDiff: r2(fyCheck.difference),
      });
    }

    const imbalancedTenants = sweep.filter(
      (s) => s.imbalancedMonths.length > 0 || s.fetchError,
    );
    log(`Tenants scanned: ${sweep.length}`);
    log(`Tenants with any FY2026 month imbalance: ${imbalancedTenants.length}`);
    for (const s of sweep) {
      if (s.fetchError) {
        log(`  FAIL ${s.name} (${s.id}): fetchError=${s.fetchError}`);
        continue;
      }
      const flag = s.imbalancedMonths.length ? "IMBALANCE" : "OK";
      log(
        `  ${flag.padEnd(10)} ${s.name.padEnd(40)} Jul=${s.julDiff.toFixed(2)} Aug=${s.augDiff.toFixed(2)} FY=${s.fyDiff.toFixed(2)} worst=${s.worstMonth ?? "-"}/${s.worstAbs.toFixed(2)} months=[${s.imbalancedMonths.join("; ")}]`,
      );
    }

    // -------------------------------------------------------------------------
    // 6) Gap amount forensics
    // -------------------------------------------------------------------------
    log("\n--- 6) Gap amount forensics ---");
    log(`Reported Jul 2615.06, Aug 5230.12; 5230.12/2615.06=${(5230.12 / 2615.06).toFixed(6)}`);
    log(
      `Live Jul ${jul.diff.toFixed(2)}, Aug ${aug.diff.toFixed(2)}; ratio=${jul.diff !== 0 ? (aug.diff / jul.diff).toFixed(6) : "n/a"}`,
    );
    for (const t of TARGET_GAPS) {
      log(
        `  vs ${t}: JulMatch=${near(Math.abs(jul.diff), t)} AugMatch=${near(Math.abs(aug.diff), t)} AugMatch2x=${near(Math.abs(aug.diff), t * 2)}`,
      );
    }

    // Search income/expense/manual amounts near 2615.06
    const nearAmt = await client.query(
      `
      SELECT 'income' AS src, id::text, date::text, amount::numeric AS amt,
             outstanding_balance::numeric AS outstanding,
             COALESCE(invoice_no, '') AS ref,
             COALESCE(description, '') AS description
      FROM public.income_register
      WHERE tenant_id = $1
        AND (
          ABS(amount - 2615.06) < 0.02
          OR ABS(COALESCE(outstanding_balance,0) - 2615.06) < 0.02
          OR ABS(amount - 5230.12) < 0.02
          OR ABS(COALESCE(amount_received,0) - 2615.06) < 0.02
        )
      UNION ALL
      SELECT 'expense', id::text, date::text, amount::numeric, NULL,
             COALESCE(receipt_no, ''), COALESCE(description, '')
      FROM public.expense_register
      WHERE tenant_id = $1
        AND (ABS(amount - 2615.06) < 0.02 OR ABS(amount - 5230.12) < 0.02)
      UNION ALL
      SELECT 'manual', id::text, entry_date::text, amount::numeric, NULL,
             COALESCE(entry_type::text, ''), COALESCE(description, '')
      FROM public.manual_financial_entries
      WHERE tenant_id = $1
        AND (ABS(amount - 2615.06) < 0.02 OR ABS(amount - 5230.12) < 0.02)
      ORDER BY 1, 3
    `,
      [DAVORS_TENANT_ID],
    );
    log(`Rows with amount near 2615.06 / 5230.12: ${nearAmt.rowCount}`);
    for (const row of nearAmt.rows) log(`  ${JSON.stringify(row)}`);

    // Half of orphan VAT-ish?
    log(
      `1569.03 (orphan amount-outstanding) vs Jul gap: near=${near(1569.03, Math.abs(jul.diff))} vs Aug: near=${near(1569.03, Math.abs(aug.diff))}`,
    );
    log(
      `2615.06 - 1569.03 = ${(2615.06 - 1569.03).toFixed(2)} (residual if VAT mixed in)`,
    );

    log("\n=== END (read-only; no writes) ===");
  } finally {
    await client.end();
  }

  const out = resolve(
    process.cwd(),
    "scripts/_urgent-bs-gap-orphan-244-prod-readonly-out.txt",
  );
  writeFileSync(out, lines.join("\n"), "utf8");
  console.log(`\nWrote ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
