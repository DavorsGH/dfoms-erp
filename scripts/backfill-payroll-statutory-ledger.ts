/**
 * One-time backfill: payroll period statutory legs → tax_ledger_entries.
 *
 * Staging by default (loads .env.staging.local, asserts staging project ref).
 * Production requires BOTH:
 *   --env-file .env.local.backup  (or another prod env file)
 *   --allow-production
 * and asserts the production project ref.
 *
 * Touches ONLY tax_ledger_entries via syncPayrollPeriodTaxLedger.
 * Does NOT post AP or expense_register rows.
 * Uses CURRENT payroll_history figures as-is (no June recalculation).
 *
 * Usage:
 *   npx tsx scripts/backfill-payroll-statutory-ledger.ts --tenant-id <uuid> --dry-run
 *   npx tsx scripts/backfill-payroll-statutory-ledger.ts --tenant-id <uuid>
 *   npx tsx scripts/backfill-payroll-statutory-ledger.ts --tenant-id <uuid> --env-file .env.local.backup --allow-production --dry-run
 *   npx tsx scripts/backfill-payroll-statutory-ledger.ts --tenant-id <uuid> --env-file .env.local.backup --allow-production
 *
 * Env alternate: BACKFILL_TENANT_ID=<uuid>
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import {
  PAYROLL_STATUS_LOCKED,
  PAYROLL_STATUS_PARTIALLY_LOCKED,
} from "../app/dashboard/hr-payroll/payroll-period-utils";
import { resolvePayrollLockFinancePeriod } from "../app/dashboard/hr-payroll/payroll-lock-finance-utils";
import {
  PAYROLL_PERIOD_SOURCE_TYPE,
  syncPayrollPeriodTaxLedger,
  type PayrollStatutoryLedgerResult,
} from "../app/dashboard/hr-payroll/payroll-statutory-ledger-sync";

const STAGING_PROJECT_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_PROJECT_REF = "tvcurcnmasnocwdxzgvz";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const LOCKED_STATUSES = [
  PAYROLL_STATUS_LOCKED,
  PAYROLL_STATUS_PARTIALLY_LOCKED,
] as const;

type HistorySourceRow = {
  payroll_month: string;
  gross_pay: number | null;
  employee_ssnit: number | null;
  employer_ssnit: number | null;
  tier2: number | null;
  paye_tax: number | null;
};

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function parseArgs(argv: string[]) {
  let tenantId: string | undefined;
  let dryRun = false;
  let envFile = ".env.staging.local";
  let allowProduction = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--tenant-id") {
      tenantId = argv[++i];
      continue;
    }
    if (arg.startsWith("--tenant-id=")) {
      tenantId = arg.slice("--tenant-id=".length);
      continue;
    }
    if (arg === "--env-file") {
      envFile = argv[++i] ?? envFile;
      continue;
    }
    if (arg === "--allow-production") {
      allowProduction = true;
      continue;
    }
    if (arg === "--allow-non-staging") {
      // Legacy alias from the staging-only era — treat as production allow.
      allowProduction = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: npx tsx scripts/backfill-payroll-statutory-ledger.ts --tenant-id <uuid> [--dry-run] [--env-file <path> --allow-production]",
      );
      process.exit(0);
    }
  }

  tenantId = tenantId ?? process.env.BACKFILL_TENANT_ID;
  return { tenantId, dryRun, envFile, allowProduction };
}

async function assertMigration114SchemaViaRest(admin: SupabaseClient) {
  const { error: remittedError } = await admin
    .from("tax_ledger_entries")
    .select("id, remitted_at")
    .limit(1);
  assert(
    !remittedError,
    `Migration 114 schema missing via REST (remitted_at): ${remittedError?.message}`,
  );

  const { error: payrollSourceError } = await admin
    .from("tax_ledger_entries")
    .select("id, source_type, tax_component, direction")
    .eq("source_type", PAYROLL_PERIOD_SOURCE_TYPE)
    .limit(1);
  assert(
    !payrollSourceError,
    `Migration 114 schema missing via REST (payroll_period source_type): ${payrollSourceError?.message}`,
  );

  console.log(
    "Schema gate: migration 114 REST probe OK (remitted_at + payroll_period filter)",
  );
}

function buildDatabaseUrlCandidates(projectRef: string): string[] {
  const candidates: string[] = [];
  const rebuildUrl = (rawUrl: string) => {
    const parsed = new URL(rawUrl);
    parsed.password = encodeURIComponent(decodeURIComponent(parsed.password));
    return parsed.toString();
  };

  const explicit =
    process.env.DATABASE_URL ??
    process.env.SUPABASE_DB_URL ??
    process.env.POSTGRES_URL;
  if (explicit) {
    candidates.push(explicit, rebuildUrl(explicit));
  }

  const password =
    process.env.SUPABASE_DB_PASSWORD ?? process.env.DB_PASSWORD ?? null;
  if (password) {
    const encoded = encodeURIComponent(password);
    candidates.push(
      `postgresql://postgres.${projectRef}:${encoded}@aws-0-eu-north-1.pooler.supabase.com:5432/postgres`,
      `postgresql://postgres:${encoded}@db.${projectRef}.supabase.co:5432/postgres`,
    );
  }

  return [...new Set(candidates.filter(Boolean))];
}

async function assertMigration114Schema(
  projectRef: string,
  admin: SupabaseClient,
) {
  const candidates = buildDatabaseUrlCandidates(projectRef);
  let lastError: unknown = null;

  for (const connectionString of candidates) {
    const client = new pg.Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    });
    try {
      await client.connect();
      try {
        const colResult = await client.query(
          `SELECT column_name
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'tax_ledger_entries'
             AND column_name = 'remitted_at'`,
        );
        const colRows = colResult.rows as Array<{ column_name: string }>;
        assert(
          colRows.length === 1,
          "Migration 114 schema missing: tax_ledger_entries.remitted_at",
        );

        const idxResult = await client.query(
          `SELECT indexname
           FROM pg_indexes
           WHERE schemaname = 'public'
             AND indexname = 'tax_ledger_entries_active_source_component_uidx'`,
        );
        const idxRows = idxResult.rows as Array<{ indexname: string }>;
        assert(
          idxRows.length === 1,
          "Migration 114 schema missing: tax_ledger_entries_active_source_component_uidx",
        );

        const checkResult = await client.query(
          `SELECT c.conname,
                  pg_get_constraintdef(c.oid) AS consrc
           FROM pg_constraint c
           JOIN pg_class t ON t.oid = c.conrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
           WHERE n.nspname = 'public'
             AND t.relname = 'tax_ledger_entries'
             AND c.contype = 'c'
             AND c.conname IN (
               'tax_ledger_entries_source_type_check',
               'tax_ledger_entries_tax_component_check',
               'tax_ledger_entries_direction_check',
               'tax_ledger_entries_direction_component_check'
             )`,
        );
        const checkRows = checkResult.rows as Array<{
          conname: string;
          consrc: string;
        }>;

        const byName = new Map(checkRows.map((r) => [r.conname, r.consrc]));
        assert(
          byName.has("tax_ledger_entries_source_type_check") &&
            String(byName.get("tax_ledger_entries_source_type_check")).includes(
              "payroll_period",
            ),
          "Migration 114 schema missing: source_type check allows payroll_period",
        );
        assert(
          byName.has("tax_ledger_entries_tax_component_check") &&
            String(byName.get("tax_ledger_entries_tax_component_check")).includes(
              "ssnit_employer_tier1",
            ) &&
            String(byName.get("tax_ledger_entries_tax_component_check")).includes(
              "ssnit_tier2",
            ),
          "Migration 114 schema missing: tax_component statutory checks",
        );
        assert(
          byName.has("tax_ledger_entries_direction_check") &&
            String(byName.get("tax_ledger_entries_direction_check")).includes(
              "statutory_payable",
            ),
          "Migration 114 schema missing: direction statutory_payable",
        );
        assert(
          byName.has("tax_ledger_entries_direction_component_check"),
          "Migration 114 schema missing: direction_component_check",
        );

        console.log("Schema gate: migration 114 checks/index/column OK (pg)");
        return;
      } finally {
        await client.end();
      }
    } catch (error) {
      lastError = error;
      try {
        await client.end();
      } catch {
        // ignore disconnect errors from failed auth attempts
      }
    }
  }

  console.warn(
    `Schema gate: direct Postgres unavailable (${
      lastError instanceof Error ? lastError.message : String(lastError)
    }); falling back to REST probe.`,
  );
  await assertMigration114SchemaViaRest(admin);
}

async function countAccountsPayable(
  admin: SupabaseClient,
  tenantId: string,
): Promise<number> {
  const { count, error } = await admin
    .from("accounts_payable")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  if (error) throw new Error(`AP count failed: ${error.message}`);
  return count ?? 0;
}

async function findLockedPayrollMonths(
  admin: SupabaseClient,
  tenantId: string,
): Promise<string[]> {
  const { data: closeRows, error: closeError } = await admin
    .from("month_end_close")
    .select("month, lock_status")
    .eq("tenant_id", tenantId)
    .in("lock_status", [...LOCKED_STATUSES]);

  if (closeError) {
    throw new Error(`month_end_close query failed: ${closeError.message}`);
  }

  const lockedMonths = new Set(
    (closeRows ?? [])
      .map((r) => String(r.month).slice(0, 10))
      .filter(Boolean),
  );

  if (lockedMonths.size === 0) {
    return [];
  }

  const { data: historyRows, error: historyError } = await admin
    .from("payroll_history")
    .select("payroll_month")
    .eq("tenant_id", tenantId)
    .in("payroll_month", [...lockedMonths]);

  if (historyError) {
    throw new Error(`payroll_history query failed: ${historyError.message}`);
  }

  const monthsWithHistory = new Set(
    (historyRows ?? [])
      .map((r) => String(r.payroll_month).slice(0, 10))
      .filter(Boolean),
  );

  return [...monthsWithHistory].sort();
}

async function loadHistoryRowsForMonth(
  admin: SupabaseClient,
  tenantId: string,
  payrollMonth: string,
): Promise<HistorySourceRow[]> {
  const { data, error } = await admin
    .from("payroll_history")
    .select(
      "payroll_month, gross_pay, employee_ssnit, employer_ssnit, tier2, paye_tax",
    )
    .eq("tenant_id", tenantId)
    .eq("payroll_month", payrollMonth);

  if (error) {
    throw new Error(
      `payroll_history load failed for ${payrollMonth}: ${error.message}`,
    );
  }

  return (data as HistorySourceRow[] | null) ?? [];
}

async function verifyPayrollPeriodLedger(
  admin: SupabaseClient,
  tenantId: string,
): Promise<{
  byPeriodComponentStatus: Array<{
    period_month: string | null;
    tax_component: string;
    status: string;
    count: number;
    total_tax_amount: number;
  }>;
  duplicateGroups: number;
  totalRows: number;
}> {
  const { data, error } = await admin
    .from("tax_ledger_entries")
    .select(
      "period_month, tax_component, status, tax_amount, source_type, source_id, direction",
    )
    .eq("tenant_id", tenantId)
    .eq("source_type", PAYROLL_PERIOD_SOURCE_TYPE);

  if (error) {
    throw new Error(`verify select failed: ${error.message}`);
  }

  const rows = data ?? [];
  const agg = new Map<
    string,
    {
      period_month: string | null;
      tax_component: string;
      status: string;
      count: number;
      total_tax_amount: number;
    }
  >();

  for (const row of rows) {
    const key = `${row.period_month ?? ""}|${row.tax_component}|${row.status}`;
    const existing = agg.get(key);
    const amount = Number(row.tax_amount) || 0;
    if (existing) {
      existing.count += 1;
      existing.total_tax_amount =
        Math.round((existing.total_tax_amount + amount) * 100) / 100;
    } else {
      agg.set(key, {
        period_month: row.period_month ?? null,
        tax_component: String(row.tax_component),
        status: String(row.status),
        count: 1,
        total_tax_amount: amount,
      });
    }
  }

  // Unique key: (tenant, source_type, source_id, direction, tax_component)
  // among non-reversed rows with non-null source_id — matches migration 114.
  const activeKeyCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.status === "reversed" || row.source_id == null) continue;
    const key = `${row.source_type}|${row.source_id}|${row.direction}|${row.tax_component}`;
    activeKeyCounts.set(key, (activeKeyCounts.get(key) ?? 0) + 1);
  }
  let duplicateGroups = 0;
  for (const count of activeKeyCounts.values()) {
    if (count > 1) duplicateGroups += 1;
  }

  return {
    byPeriodComponentStatus: [...agg.values()].sort((a, b) => {
      const pm = String(a.period_month).localeCompare(String(b.period_month));
      if (pm !== 0) return pm;
      const tc = a.tax_component.localeCompare(b.tax_component);
      if (tc !== 0) return tc;
      return a.status.localeCompare(b.status);
    }),
    duplicateGroups,
    totalRows: rows.length,
  };
}

function logSyncResult(
  payrollMonth: string,
  monthLabel: string,
  historyRowCount: number,
  result: PayrollStatutoryLedgerResult,
) {
  console.log(
    `\nPeriod ${payrollMonth} (${monthLabel}) — history_rows=${historyRowCount} source_id=${result.sourceId} dry_run=${result.dryRun}`,
  );
  console.log(
    `  totals: insert=${result.inserted} update=${result.updated} unchanged=${result.unchanged} delete=${result.deleted} skipped_paid=${result.skippedPaid}`,
  );
  if (result.legs.length === 0) {
    console.log("  legs: (none — all statutory amounts zero)");
    return;
  }
  for (const leg of result.legs) {
    console.log(
      `  leg: component=${leg.tax_component} amount=${leg.tax_amount.toFixed(2)} action=${leg.action}`,
    );
  }
}

async function runBackfill(
  admin: SupabaseClient,
  tenantId: string,
  dryRun: boolean,
): Promise<{
  periods: string[];
  results: Array<{ payrollMonth: string; result: PayrollStatutoryLedgerResult }>;
}> {
  const periods = await findLockedPayrollMonths(admin, tenantId);
  console.log(
    `\nLocked periods with payroll_history for tenant: ${periods.length}`,
  );
  if (periods.length === 0) {
    console.log("Nothing to backfill.");
    return { periods, results: [] };
  }
  console.log(`Months: ${periods.join(", ")}`);

  const results: Array<{
    payrollMonth: string;
    result: PayrollStatutoryLedgerResult;
  }> = [];

  for (const payrollMonth of periods) {
    const historyRows = await loadHistoryRowsForMonth(
      admin,
      tenantId,
      payrollMonth,
    );
    const financePeriod = resolvePayrollLockFinancePeriod(payrollMonth);
    assert(
      financePeriod,
      `Unable to resolve finance period for ${payrollMonth}`,
    );

    const result = await syncPayrollPeriodTaxLedger(
      admin,
      {
        payrollMonth: financePeriod.payrollMonth,
        monthLabel: financePeriod.monthLabel,
        periodEndDate: financePeriod.periodEndDate,
      },
      historyRows,
      tenantId,
      { dryRun },
    );

    logSyncResult(
      financePeriod.payrollMonth,
      financePeriod.monthLabel,
      historyRows.length,
      result,
    );
    results.push({ payrollMonth: financePeriod.payrollMonth, result });
  }

  const totals = results.reduce(
    (acc, { result }) => {
      acc.inserted += result.inserted;
      acc.updated += result.updated;
      acc.unchanged += result.unchanged;
      acc.deleted += result.deleted;
      acc.skippedPaid += result.skippedPaid;
      return acc;
    },
    { inserted: 0, updated: 0, unchanged: 0, deleted: 0, skippedPaid: 0 },
  );
  console.log(
    `\nRun summary (${dryRun ? "DRY-RUN" : "WRITE"}): periods=${results.length} insert=${totals.inserted} update=${totals.updated} unchanged=${totals.unchanged} delete=${totals.deleted} skipped_paid=${totals.skippedPaid}`,
  );

  return { periods, results };
}

async function main() {
  const { tenantId, dryRun, envFile, allowProduction } = parseArgs(
    process.argv.slice(2),
  );

  assert(
    tenantId && UUID_RE.test(tenantId),
    "Require --tenant-id <uuid> (or BACKFILL_TENANT_ID). Refusing all-tenants default.",
  );

  const envPath = resolve(process.cwd(), envFile);
  loadEnvForce(envPath);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert(url, "Missing NEXT_PUBLIC_SUPABASE_URL");
  assert(key, "Missing SUPABASE_SERVICE_ROLE_KEY");

  const projectRef = new URL(url).hostname.split(".")[0];
  const isStaging = projectRef === STAGING_PROJECT_REF;
  const isProduction = projectRef === PRODUCTION_PROJECT_REF;

  if (isProduction) {
    assert(
      allowProduction,
      `Refusing production project ref "${projectRef}" without --allow-production.`,
    );
  } else if (!isStaging) {
    throw new Error(
      `Refusing unknown project ref "${projectRef}" (expected staging ${STAGING_PROJECT_REF} or production ${PRODUCTION_PROJECT_REF}).`,
    );
  } else if (allowProduction) {
    throw new Error(
      `Refusing --allow-production against staging project ref "${projectRef}".`,
    );
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("=== Payroll statutory ledger backfill ===");
  console.log(`Env file: ${envFile}`);
  console.log(
    `Project ref: ${projectRef} (${isProduction ? "PRODUCTION" : "staging"} OK)`,
  );
  console.log(`Tenant: ${tenantId}`);
  console.log(`Mode: ${dryRun ? "DRY-RUN" : "WRITE"}`);
  console.log("Target table: tax_ledger_entries only (no AP / expense writes)");
  console.log(
    "Source: CURRENT payroll_history figures as-is (no June recalculation)",
  );

  await assertMigration114Schema(projectRef, admin);

  const apBefore = await countAccountsPayable(admin, tenantId);
  console.log(`AP row count before: ${apBefore}`);

  const { periods } = await runBackfill(admin, tenantId, dryRun);

  const apAfter = await countAccountsPayable(admin, tenantId);
  console.log(`AP row count after: ${apAfter}`);
  assert(
    apBefore === apAfter,
    `AP row count changed (${apBefore} → ${apAfter}) — unexpected`,
  );
  console.log("AP untouched: confirmed (count unchanged)");

  if (!dryRun || periods.length > 0) {
    const verify = await verifyPayrollPeriodLedger(admin, tenantId);
    console.log(
      `\nVerify payroll_period rows: total=${verify.totalRows} duplicate_unique_key_groups=${verify.duplicateGroups}`,
    );
    for (const row of verify.byPeriodComponentStatus) {
      console.log(
        `  period_month=${row.period_month} component=${row.tax_component} status=${row.status} count=${row.count} amount=${row.total_tax_amount.toFixed(2)}`,
      );
    }
    assert(
      verify.duplicateGroups === 0,
      `Found ${verify.duplicateGroups} duplicate active unique-key groups`,
    );
  }

  console.log(
    `\nDone. ${isProduction ? "Production backfill complete." : "Staging backfill complete."}`,
  );
}

main().catch((err) => {
  console.error("\nBackfill aborted:", err instanceof Error ? err.message : err);
  process.exit(1);
});
