/**
 * READ-ONLY post-restore BS verification: Davors Jul/Aug + platform FY2026 sweep
 * + scan for other tenants hit by the broken tax-ledger trigger wipe.
 *
 *   npx tsx scripts/_verify-tax-restore-bs-prod-readonly.ts --env-file .env.local.backup --allow-production
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { connectPg } from "./lib/pg-connect";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  FULL_YEAR_INDEX,
  BALANCE_TOLERANCE,
} from "../app/dashboard/finance/balance-sheet-utils";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const FY = 2026;
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

const BEFORE = {
  davorsJul: 2615.06,
  davorsAug: 5230.12,
};

const TARGET_INCOME = [
  "1b09a1e5-30d3-4b51-98b5-05bc4a2f470d",
  "fd539e43-29cd-4d08-9dd6-b2bb1fa53252",
];

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

function r2(n: number) {
  return Math.round(Number(n || 0) * 100) / 100;
}

async function monthDiffsForTenant(
  admin: ReturnType<typeof createClient>,
  tenantId: string,
) {
  const page = await fetchBalanceSheetPageData(admin, tenantId, {
    dateRange: null,
  });
  if (page.fetchError) {
    return { fetchError: page.fetchError, months: [] as number[], fyDiff: 0 };
  }

  const report = buildBalanceSheetReport(
    page.initialIncomeEntries,
    page.initialExpenseEntries,
    page.initialFixedAssets,
    page.initialPayableEntries,
    page.initialCapitalContributions,
    page.initialCashFlowExpenseEntries,
    page.initialPayrollHistory ?? [],
    page.initialMonthEndCloseNetPay,
    FY,
    page.initialInventoryBalanceSheet,
    page.initialManualEntries,
    page.initialTaxLedgerEntries,
    {
      tenantId,
      accountsPayablePayments: page.initialAccountsPayablePayments,
      directorsLoanRepayments: page.initialDirectorsLoanRepayments,
    },
  );

  const months: number[] = [];
  for (let i = 0; i < 12; i += 1) {
    months.push(r2(getBalanceCheckForPeriod(report, i).diff));
  }
  const fyDiff = r2(getBalanceCheckForPeriod(report, FULL_YEAR_INDEX).diff);
  return { fetchError: null as string | null, months, fyDiff, report };
}

async function main() {
  const { envFile, allowProduction } = parseArgs();
  if (!allowProduction) throw new Error("Pass --allow-production");
  loadEnv(resolve(process.cwd(), envFile));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!url.includes(PRODUCTION_REF) || !key) {
    throw new Error("Production credentials required");
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { client, envFile: usedEnv } = await connectPg({
    requiredProjectRef: PRODUCTION_REF,
    envFiles: [envFile, ".env.local.backup", ".env.local"],
  });

  const lines: string[] = [];
  const log = (s: string) => {
    lines.push(s);
    console.log(s);
  };

  try {
    log("=== Post-restore BS verification (PRODUCTION READ-ONLY) ===");
    log(`Connected via ${usedEnv}`);
    log(`Now UTC: ${new Date().toISOString()}`);
    log(
      `BEFORE (confirmed gap): Davors Jul=${BEFORE.davorsJul.toFixed(2)} Aug=${BEFORE.davorsAug.toFixed(2)}`,
    );

    // --- A) Confirm restored tax legs ---
    const legs = await client.query(
      `
      SELECT source_id::text, invoice_hint.invoice_no, direction, tax_component,
             tax_amount::text, entry_date::text, period_month::text, notes,
             created_at::text
      FROM public.tax_ledger_entries tle
      LEFT JOIN LATERAL (
        SELECT ir.invoice_no
        FROM public.income_register ir
        WHERE ir.id::text = tle.source_id
        LIMIT 1
      ) invoice_hint ON true
      WHERE tle.tenant_id = $1::uuid
        AND tle.source_type = 'income_register'
        AND tle.source_id::text = ANY($2::text[])
      ORDER BY tle.source_id, tle.direction
    `,
      [DAVORS, TARGET_INCOME],
    );
    log(`\nA) Restored tax legs for DF-INV-0001/0004: ${legs.rows.length}`);
    for (const row of legs.rows) log(JSON.stringify(row));

    // --- B) Davors month-by-month ---
    log("\nB) Davors FY2026 Balance Sheet (live):");
    const davors = await monthDiffsForTenant(admin, DAVORS);
    if (davors.fetchError) {
      log(`FETCH ERROR: ${davors.fetchError}`);
    } else {
      for (let i = 0; i < 12; i += 1) {
        const diff = davors.months[i]!;
        const ok = Math.abs(diff) < BALANCE_TOLERANCE;
        const mark =
          i === 6 || i === 7
            ? ok
              ? " ★ TARGET OK"
              : " ★ TARGET STILL OPEN"
            : "";
        log(
          `  ${MONTHS[i].padEnd(4)} diff=${diff.toFixed(2).padStart(10)} balanced=${ok}${mark}`,
        );
      }
      log(
        `  FULL_YEAR diff=${davors.fyDiff.toFixed(2)} balanced=${Math.abs(davors.fyDiff) < BALANCE_TOLERANCE}`,
      );

      const jul = davors.months[6]!;
      const aug = davors.months[7]!;
      log("\nB2) BEFORE → AFTER (Davors focus months):");
      log(
        `  Jul: ${BEFORE.davorsJul.toFixed(2)} → ${jul.toFixed(2)}  (closed=${Math.abs(jul) < BALANCE_TOLERANCE})`,
      );
      log(
        `  Aug: ${BEFORE.davorsAug.toFixed(2)} → ${aug.toFixed(2)}  (closed=${Math.abs(aug) < BALANCE_TOLERANCE})`,
      );
    }

    // --- C) Platform-wide FY2026 sweep ---
    log("\nC) Platform-wide FY2026 sweep (all tenants):");
    const { data: tenants, error: tenErr } = await admin
      .from("tenants")
      .select("id, name")
      .order("name");
    if (tenErr) {
      log(`tenants ERROR: ${tenErr.message}`);
    } else {
      const list = tenants ?? [];
      log(`Tenant count: ${list.length}`);

      let imbalanceCount = 0;
      for (const t of list) {
        const result = await monthDiffsForTenant(admin, t.id);
        if (result.fetchError) {
          imbalanceCount += 1;
          log(`  FETCH_ERR  ${t.name.padEnd(42)} err=${result.fetchError}`);
          continue;
        }
        const imbalanced: string[] = [];
        let worstAbs = 0;
        let worstMonth: string | null = null;
        for (let i = 0; i < 12; i += 1) {
          const diff = result.months[i]!;
          const abs = Math.abs(diff);
          if (abs >= BALANCE_TOLERANCE) {
            imbalanced.push(`${MONTHS[i]}:${diff.toFixed(2)}`);
            if (abs > worstAbs) {
              worstAbs = abs;
              worstMonth = MONTHS[i]!;
            }
          }
        }
        if (imbalanced.length > 0) imbalanceCount += 1;
        const flag = imbalanced.length ? "IMBALANCE" : "OK";
        log(
          `  ${flag.padEnd(10)} ${t.name.padEnd(42)} Jul=${result.months[6]!.toFixed(2)} Aug=${result.months[7]!.toFixed(2)} FY=${result.fyDiff.toFixed(2)} worst=${worstMonth ?? "-"}/${worstAbs.toFixed(2)} months=[${imbalanced.join("; ")}]`,
        );
      }
      log(`\nTenants with any FY2026 month imbalance / fetch error: ${imbalanceCount}`);
    }

    // --- D) Same-class wipe scan ---
    log(
      "\nD) Platform Client Invoice income with VAT/WHT > 0 but ZERO tax_ledger legs:",
    );
    const wipe = await client.query(`
      SELECT
        t.name AS tenant,
        ir.invoice_no,
        ir.id::text AS income_id,
        ir.date::text,
        ir.payment_status,
        ir.output_vat_amount::text,
        ir.wht_amount::text,
        ci.status AS ci_status,
        ci.updated_at::text AS ci_updated_at
      FROM public.income_register ir
      LEFT JOIN public.tenants t ON t.id = ir.tenant_id
      LEFT JOIN public.client_invoices ci ON ci.id = ir.client_invoice_id
      WHERE ir.service_category = 'Client Invoice'
        AND COALESCE(ir.is_system_adjustment, false) = false
        AND COALESCE(ir.output_vat_amount, 0) + COALESCE(ir.wht_amount, 0) > 0.005
        AND NOT EXISTS (
          SELECT 1
          FROM public.tax_ledger_entries tle
          WHERE tle.source_type = 'income_register'
            AND tle.source_id::text = ir.id::text
        )
      ORDER BY t.name NULLS LAST, ir.invoice_no
      LIMIT 100
    `);
    log(`Count: ${wipe.rows.length}`);
    for (const row of wipe.rows) log(JSON.stringify(row));
    if (wipe.rows.length === 0) {
      log("(none — no remaining same-class wipes across platform)");
    }

    log("\n=== END ===");
  } finally {
    await client.end();
  }

  writeFileSync(
    resolve(process.cwd(), "scripts/_verify-tax-restore-bs-prod-readonly-out.txt"),
    lines.join("\n") + "\n",
    "utf8",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
