/**
 * Migrate director's loan monthly stock + repayments → directors_loan_entries.
 *
 *   npx tsx scripts/migrate-directors-loan-ledger.ts --dry-run
 *   npx tsx scripts/migrate-directors-loan-ledger.ts --apply
 *   npx tsx scripts/migrate-directors-loan-ledger.ts --verify-applied
 *   npx tsx scripts/migrate-directors-loan-ledger.ts --dry-run --production-readonly
 *   npx tsx scripts/migrate-directors-loan-ledger.ts --env-file .env.local.backup --allow-production --apply
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import type { ManualFinancialEntryRecord } from "../app/dashboard/finance/manual-financial-entries-utils";
import type { ManualFinancialEntry } from "../app/dashboard/finance/cash-flow-utils";
import type { DirectorsLoanLedgerEntry } from "../app/dashboard/finance/directors-loan-ledger-utils";
import {
  PARITY_FY,
  buildReportBundle,
  compareReportBundles,
  compareSnapshots,
  patchManualEntriesForLedger,
  planLedgerInserts,
  simulateLedgerEntries,
  snapshotNewPath,
  snapshotOldPath,
  type ParityDiff,
  type PlannedLedgerInsert,
} from "./lib/directors-loan-migration-parity";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";

const argv = process.argv.slice(2);
const args = new Set(argv);

function getArgValue(flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= argv.length) return undefined;
  return argv[idx + 1];
}

function loadEnv(file: string) {
  for (const line of readFileSync(resolve(process.cwd(), file), "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
}

function resolveEnvFile(): string {
  const fromArg = getArgValue("--env-file");
  if (fromArg) return fromArg;
  if (args.has("--production-readonly")) return ".env.local.backup";
  return ".env.staging.local";
}

function manualEntriesForScope(
  patchedAll: ManualFinancialEntry[],
  scope: ScopeConfig,
): ManualFinancialEntry[] {
  if (scope.buMode === "all") {
    return patchedAll;
  }
  const raw = patchedAll as ManualFinancialEntryRecord[];
  if (scope.buMode === "default") {
    return raw.filter((r) => (r.business_unit_id ?? null) === null);
  }
  return raw.filter((r) => r.business_unit_id === scope.fetchOptions.activeBusinessUnitId);
}

type ScopeConfig = {
  label: string;
  buMode: "all" | "default" | "unit";
  fetchOptions: {
    viewAllBusinessUnits: boolean;
    activeBusinessUnitId: string | null;
  };
};

type TenantPlan = {
  tenantId: string;
  tenantName: string;
  planned: PlannedLedgerInsert[];
  manuals: ManualFinancialEntryRecord[];
  existingLedger: DirectorsLoanLedgerEntry[];
};

async function scopesForTenant(
  admin: SupabaseClient,
  tenantId: string,
): Promise<ScopeConfig[]> {
  const { data: units } = await admin
    .from("business_units")
    .select("id, name")
    .eq("tenant_id", tenantId);
  const scopes: ScopeConfig[] = [
    {
      label: "all",
      buMode: "all",
      fetchOptions: { viewAllBusinessUnits: true, activeBusinessUnitId: null },
    },
    {
      label: "default",
      buMode: "default",
      fetchOptions: { viewAllBusinessUnits: false, activeBusinessUnitId: null },
    },
  ];
  for (const unit of units ?? []) {
    scopes.push({
      label: String(unit.name ?? unit.id),
      buMode: "unit",
      fetchOptions: {
        viewAllBusinessUnits: false,
        activeBusinessUnitId: unit.id as string,
      },
    });
  }
  return scopes;
}

async function loadExistingLedger(
  admin: SupabaseClient,
  tenantId: string,
): Promise<DirectorsLoanLedgerEntry[]> {
  const { data } = await admin
    .from("directors_loan_entries")
    .select("*")
    .eq("tenant_id", tenantId);
  return (data as DirectorsLoanLedgerEntry[] | null) ?? [];
}

async function runParityForTenant(
  admin: SupabaseClient,
  tenantId: string,
  tenantName: string,
  planned: PlannedLedgerInsert[],
  existingLedger: DirectorsLoanLedgerEntry[],
  tenantManuals: ManualFinancialEntryRecord[],
): Promise<{
  diffs: ParityDiff[];
  oldPathSnapshots: Map<string, Record<string, number[]>>;
  newPathSnapshots: Map<string, Record<string, number[]>>;
}> {
  const simulatedActive = [
    ...existingLedger.filter((e) => !e.reversed_at),
    ...simulateLedgerEntries(planned),
  ];
  const patchedAll = patchManualEntriesForLedger(
    tenantManuals as ManualFinancialEntry[],
    planned,
    PARITY_FY,
    existingLedger,
  );
  const allDiffs: ParityDiff[] = [];
  const oldPathSnapshots = new Map<string, Record<string, number[]>>();
  const newPathSnapshots = new Map<string, Record<string, number[]>>();

  const scopes = await scopesForTenant(admin, tenantId);
  for (const scope of scopes) {
    const data = await fetchBalanceSheetPageData(admin, tenantId, {
      dateRange: null,
      ...scope.fetchOptions,
    });
    const oldLedger: DirectorsLoanLedgerEntry[] = [];
    const oldBundle = buildReportBundle(
      data,
      scope.buMode,
      PARITY_FY,
      oldLedger,
      undefined,
      scope.fetchOptions.activeBusinessUnitId,
    );
    const scopedManual = manualEntriesForScope(patchedAll, scope);
    const newBundle = buildReportBundle(
      data,
      scope.buMode,
      PARITY_FY,
      simulatedActive,
      scopedManual,
      scope.fetchOptions.activeBusinessUnitId,
    );
    const diffs = compareReportBundles(tenantName, scope.label, oldBundle, newBundle);
    allDiffs.push(...diffs);
    const snapKey = `${tenantId}:${scope.label}`;
    oldPathSnapshots.set(snapKey, snapshotOldPath(oldBundle));
    newPathSnapshots.set(snapKey, snapshotNewPath(newBundle));
  }
  return { diffs: allDiffs, oldPathSnapshots, newPathSnapshots };
}

function printParityFailure(allDiffs: ParityDiff[]) {
  console.log(`FAIL — ${allDiffs.length} difference(s):`);
  for (const d of allDiffs.slice(0, 80)) {
    console.log(
      `${d.tenant} | ${d.scope} | ${d.report} | ${d.label} | M${d.month} | old=${d.oldValue} new=${d.newValue} Δ=${d.delta}`,
    );
  }
  if (allDiffs.length > 80) console.log(`… and ${allDiffs.length - 80} more`);
}

async function collectTenantPlans(admin: SupabaseClient): Promise<TenantPlan[]> {
  const { data: tenants } = await admin.from("tenants").select("id, name");
  const plans: TenantPlan[] = [];
  for (const tenant of tenants ?? []) {
    const tenantId = tenant.id as string;
    const [{ data: manuals }, { data: repayments }, existingLedger] = await Promise.all([
      admin.from("manual_financial_entries").select("*").eq("tenant_id", tenantId),
      admin.from("directors_loan_repayments").select("*").eq("tenant_id", tenantId),
      loadExistingLedger(admin, tenantId),
    ]);

    const repaymentsWithBu = (repayments ?? []).map((r) => ({
      repayment_date: r.repayment_date as string,
      amount: Number(r.amount),
      business_unit_id: (r.business_unit_id as string | null | undefined) ?? null,
    }));

    const planned = planLedgerInserts(
      tenantId,
      (manuals ?? []) as ManualFinancialEntryRecord[],
      repaymentsWithBu,
      existingLedger,
    );

    plans.push({
      tenantId,
      tenantName: String(tenant.name),
      planned,
      manuals: (manuals ?? []) as ManualFinancialEntryRecord[],
      existingLedger,
    });
  }
  return plans;
}

async function runFullParity(
  admin: SupabaseClient,
  tenantPlans: TenantPlan[],
  options: { verifyOnly: boolean },
): Promise<{
  allDiffs: ParityDiff[];
  oldPathSnapshots: Map<string, Record<string, number[]>>;
}> {
  const allDiffs: ParityDiff[] = [];
  const oldPathSnapshots = new Map<string, Record<string, number[]>>();

  for (const plan of tenantPlans) {
    console.log(`\n=== ${plan.tenantName} (${plan.tenantId}) ===`);
    console.log(`Planned new ledger rows: ${plan.planned.length}`);
    for (const p of plan.planned) {
      console.log(
        `  ${p.entry_date} ${p.entry_type} ${p.amount} BU=${p.business_unit_id ?? "null"}`,
      );
    }

    const { diffs, oldPathSnapshots: tenantOldSnaps } = await runParityForTenant(
      admin,
      plan.tenantId,
      plan.tenantName,
      options.verifyOnly ? [] : plan.planned,
      plan.existingLedger,
      plan.manuals,
    );
    allDiffs.push(...diffs);
    for (const [k, v] of tenantOldSnaps) oldPathSnapshots.set(k, v);
  }

  return { allDiffs, oldPathSnapshots };
}

function assertParityPass(allDiffs: ParityDiff[], label: string) {
  console.log(`\n=== PARITY (${PARITY_FY}, Jan–Dec) — ${label} ===`);
  if (allDiffs.length === 0) {
    console.log("PASS — 0 differences across all tenants/scopes/months/lines.");
    return;
  }
  printParityFailure(allDiffs);
  throw new Error(`Parity failed (${label}).`);
}

function assertIdempotency(tenantPlans: TenantPlan[]) {
  for (const plan of tenantPlans) {
    if (plan.planned.length === 0) continue;
    if (plan.existingLedger.length > 0) {
      throw new Error(
        `Refusing apply: tenant ${plan.tenantName} (${plan.tenantId}) already has ${plan.existingLedger.length} directors_loan_entries row(s).`,
      );
    }
  }
}

type CreatedLedgerRow = PlannedLedgerInsert & { id: string };

async function applyAllInTransaction(
  client: pg.Client,
  tenantPlans: TenantPlan[],
): Promise<CreatedLedgerRow[]> {
  const created: CreatedLedgerRow[] = [];
  await client.query("BEGIN");
  try {
    for (const { tenantId, planned, manuals } of tenantPlans) {
      if (planned.length === 0) continue;
      for (const row of planned) {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO directors_loan_entries (
            tenant_id, business_unit_id, entry_date, entry_type, amount, description, reference
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id`,
          [
            row.tenant_id,
            row.business_unit_id,
            row.entry_date,
            row.entry_type,
            row.amount,
            row.description,
            row.reference,
          ],
        );
        created.push({ ...row, id: rows[0].id });
      }

      const patched = patchManualEntriesForLedger(
        manuals as ManualFinancialEntry[],
        planned,
        PARITY_FY,
        [],
      );
      for (const entry of patched) {
        const raw = entry as ManualFinancialEntryRecord;
        const y = Number(String(raw.period_month).slice(0, 4));
        if (y !== PARITY_FY) continue;
        if (raw.business_unit_id == null) {
          await client.query(
            `UPDATE manual_financial_entries
             SET directors_loan = 0,
                 loan_proceeds = $3,
                 loan_repayments = $4
             WHERE tenant_id = $1 AND period_month = $2 AND business_unit_id IS NULL`,
            [
              tenantId,
              raw.period_month,
              Number(raw.loan_proceeds) || 0,
              Number(raw.loan_repayments) || 0,
            ],
          );
        } else {
          await client.query(
            `UPDATE manual_financial_entries
             SET directors_loan = 0,
                 loan_proceeds = $4,
                 loan_repayments = $5
             WHERE tenant_id = $1 AND period_month = $2 AND business_unit_id = $3`,
            [
              tenantId,
              raw.period_month,
              raw.business_unit_id,
              Number(raw.loan_proceeds) || 0,
              Number(raw.loan_repayments) || 0,
            ],
          );
        }
      }
    }
    await client.query("COMMIT");
    return created;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function logMigrationEvent(
  admin: SupabaseClient,
  environment: "staging" | "production",
  createdRows: CreatedLedgerRow[],
) {
  const { error } = await admin.from("system_event_log").insert({
    event_type: "cron",
    event_name: "directors_loan_ledger_migration",
    status: "success",
    message: `Director's Loan ledger migration (${environment}): ${createdRows.length} row(s) created.`,
    metadata: {
      environment,
      row_count: createdRows.length,
      rows: createdRows.map((r) => ({
        id: r.id,
        tenant_id: r.tenant_id,
        business_unit_id: r.business_unit_id,
        entry_date: r.entry_date,
        entry_type: r.entry_type,
        amount: r.amount,
        reference: r.reference,
      })),
    },
  });
  if (error) {
    throw new Error(`system_event_log insert failed: ${error.message}`);
  }
}

function assertApplyEnvironment(url: string, envFile: string) {
  const productionApply = args.has("--allow-production");
  if (args.has("--apply")) {
    if (productionApply) {
      if (!args.has("--allow-production")) {
        throw new Error("Production apply requires --allow-production.");
      }
      if (envFile !== ".env.local.backup") {
        throw new Error(
          "Production apply requires --env-file .env.local.backup",
        );
      }
      if (!url.includes(PRODUCTION_REF)) {
        throw new Error("Refusing production --apply: URL is not production.");
      }
    } else if (!url.includes(STAGING_REF)) {
      throw new Error("Refusing staging --apply outside staging project.");
    }
  }
  if (args.has("--production-readonly") && args.has("--apply")) {
    throw new Error("Refusing --apply with --production-readonly.");
  }
  if (productionApply && !args.has("--apply")) {
    throw new Error("--allow-production is only valid with --apply.");
  }
}

async function main() {
  const verifyOnly = args.has("--verify-applied");
  const dryRun = !args.has("--apply") && !verifyOnly;
  const envFile = resolveEnvFile();
  loadEnv(envFile);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assertApplyEnvironment(url, envFile);

  const admin = createClient(url, key, { auth: { persistSession: false } });
  const tenantPlans = await collectTenantPlans(admin);
  const totalPlanned = tenantPlans.reduce((n, p) => n + p.planned.length, 0);

  const { allDiffs, oldPathSnapshots: preMigrationOldPath } = await runFullParity(
    admin,
    tenantPlans,
    { verifyOnly },
  );
  if (totalPlanned === 0 && (dryRun || args.has("--production-readonly"))) {
    console.log(
      "\nPARITY skipped — no planned ledger inserts (migration already applied on this database).",
    );
  } else {
    assertParityPass(allDiffs, dryRun ? "dry-run" : verifyOnly ? "verify-applied" : "pre-apply");
  }

  if (dryRun || args.has("--production-readonly")) {
    console.log(`\nDRY RUN complete. Total planned inserts: ${totalPlanned}`);
    return;
  }

  if (verifyOnly) {
    console.log("\nVERIFY APPLIED: parity old-path vs current ledger — PASS");
    return;
  }

  if (!args.has("--apply")) {
    return;
  }

  if (totalPlanned === 0) {
    console.log("Nothing to apply.");
    return;
  }

  const isProduction = url.includes(PRODUCTION_REF);
  console.log(`\n=== PRE-APPLY PARITY (immediate) ===`);
  const preWrite = await runFullParity(admin, tenantPlans, { verifyOnly: false });
  assertParityPass(preWrite.allDiffs, "pre-apply");

  assertIdempotency(tenantPlans);

  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!dbUrl) {
    throw new Error("DATABASE_URL is required for --apply (transactional writes).");
  }
  if (isProduction && !dbUrl.includes(PRODUCTION_REF)) {
    throw new Error("DATABASE_URL must match production for production apply.");
  }
  if (!isProduction && !dbUrl.includes(STAGING_REF)) {
    throw new Error("DATABASE_URL must match staging for staging apply.");
  }

  const pgClient = new pg.Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });
  await pgClient.connect();
  let createdRows: CreatedLedgerRow[] = [];
  try {
    createdRows = await applyAllInTransaction(pgClient, tenantPlans);
  } finally {
    await pgClient.end();
  }

  console.log(`\nApplied migration (${isProduction ? "production" : "staging"}).`);
  console.log(`Created ${createdRows.length} directors_loan_entries row(s).`);

  const plansAfterApply = await collectTenantPlans(admin);
  console.log(`\n=== POST-APPLY PARITY (old path before apply vs live after apply) ===`);
  const postApplySnaps = new Map<string, Record<string, number[]>>();
  for (const plan of plansAfterApply) {
    const scopes = await scopesForTenant(admin, plan.tenantId);
    for (const scope of scopes) {
      const data = await fetchBalanceSheetPageData(admin, plan.tenantId, {
        dateRange: null,
        ...scope.fetchOptions,
      });
      const bundle = buildReportBundle(
        data,
        scope.buMode,
        PARITY_FY,
        plan.existingLedger.filter((e) => !e.reversed_at),
        undefined,
        scope.fetchOptions.activeBusinessUnitId,
      );
      postApplySnaps.set(
        `${plan.tenantId}:${scope.label}`,
        snapshotNewPath(bundle),
      );
    }
  }

  const snapDiffs: ParityDiff[] = [];
  for (const [key, pre] of preMigrationOldPath) {
    const post = postApplySnaps.get(key);
    if (!post) continue;
    snapDiffs.push(...compareSnapshots(pre, post));
  }
  if (snapDiffs.length > 0) {
    console.error("Post-apply snapshot mismatch vs pre-migration old path:");
    for (const d of snapDiffs.slice(0, 40)) {
      console.error(`${d.key} M${d.month} old=${d.oldValue} new=${d.newValue} Δ=${d.delta}`);
    }
    process.exit(1);
  }
  console.log("Post-apply snapshot verification PASS (matches pre-migration reports).");

  await logMigrationEvent(
    admin,
    isProduction ? "production" : "staging",
    createdRows,
  );
  console.log("Logged system_event_log (directors_loan_ledger_migration).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

