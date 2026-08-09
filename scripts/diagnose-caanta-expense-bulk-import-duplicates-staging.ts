// @ts-nocheck
/**
 * Read-only diagnostic: Caanta expense bulk-import duplicate commits on staging.
 *
 * Usage:
 *   npx tsx scripts/diagnose-caanta-expense-bulk-import-duplicates-staging.ts
 *   npx tsx scripts/diagnose-caanta-expense-bulk-import-duplicates-staging.ts --env-file .env.staging.local
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";

const DEFAULT_CAANTA_TENANT_ID = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";

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
  const args = process.argv.slice(2);
  let envFile = ".env.staging.local";
  let tenantId = DEFAULT_CAANTA_TENANT_ID;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--env-file" && args[i + 1]) {
      envFile = args[i + 1]!;
      i += 1;
    } else if (args[i] === "--tenant-id" && args[i + 1]) {
      tenantId = args[i + 1]!;
      i += 1;
    }
  }
  return { envFile, tenantId };
}

type JobRow = {
  id: string;
  tenant_id: string;
  import_type: string;
  status: string;
  file_name: string | null;
  total_rows: number | null;
  created_at: string;
  committed_at: string | null;
  uploaded_by: string | null;
};

type ImportRow = {
  id: string;
  job_id: string;
  row_number: number;
  status: string;
  mapped_data: Record<string, unknown>;
};

type ExpenseRow = {
  id: string;
  date: string;
  expense_category: string | null;
  sub_category: string | null;
  vendor: string | null;
  price: string | number | null;
  quantity: string | number | null;
  amount: string | number | null;
  payment_method: string | null;
  receipt_no: string | null;
  wht_amount: string | number | null;
  input_vat_amount: string | number | null;
  created_at: string | null;
};

type TaxLedgerRow = {
  id: string;
  source_id: string | null;
  source_type: string;
  direction: string;
  tax_component: string;
  tax_amount: string | number;
  created_at: string;
};

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizePrice(value: unknown): string {
  const n = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n.toFixed(2) : "";
}

function expenseMatchKey(row: {
  date: unknown;
  vendor: unknown;
  price: unknown;
  expense_category: unknown;
  payment_method: unknown;
}): string {
  return [
    normalizeText(row.date).slice(0, 10),
    normalizeText(row.vendor).toLowerCase(),
    normalizePrice(row.price),
    normalizeText(row.expense_category).toLowerCase(),
    normalizeText(row.payment_method).toLowerCase(),
  ].join("|");
}

function mappedDataMatchKey(mapped: Record<string, unknown>): string {
  return expenseMatchKey({
    date: mapped.date,
    vendor: mapped.vendor,
    price: mapped.price,
    expense_category: mapped.expense_category,
    payment_method: mapped.payment_method,
  });
}

async function tableHasColumn(
  client: Client,
  tableName: string,
  columnName: string,
): Promise<boolean> {
  const result = await client.query(
    `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = $2
      LIMIT 1
    `,
    [tableName, columnName],
  );
  return result.rows.length > 0;
}

async function main() {
  const { envFile, tenantId } = parseArgs();
  loadEnv(resolve(process.cwd(), envFile));

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(`DATABASE_URL missing from ${envFile}`);
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const tenantResult = await client.query(
      `SELECT id, name, slug FROM public.tenants WHERE id = $1`,
      [tenantId],
    );
    const tenant = tenantResult.rows[0];
    console.log("=== Tenant ===");
    console.log(tenant ?? { id: tenantId, note: "tenant row not found by id" });

    const jobsResult = await client.query<JobRow>(
      `
        SELECT
          id,
          tenant_id,
          import_type,
          status,
          file_name,
          total_rows,
          created_at,
          committed_at,
          uploaded_by
        FROM public.bulk_import_jobs
        WHERE tenant_id = $1
          AND import_type = 'expense'
          AND status = 'committed'
        ORDER BY created_at ASC
      `,
      [tenantId],
    );

    console.log("\n=== bulk_import_jobs (expense, committed) ===");
    console.log(`Count: ${jobsResult.rows.length}`);
    for (const job of jobsResult.rows) {
      console.log(JSON.stringify(job, null, 2));
    }

    if (jobsResult.rows.length === 0) {
      console.log("\nNo committed expense bulk import jobs found.");
      return;
    }

    const jobIds = jobsResult.rows.map((job) => job.id);
    const minCreated = jobsResult.rows[0]!.created_at;
    const maxCommitted =
      jobsResult.rows[jobsResult.rows.length - 1]!.committed_at ??
      jobsResult.rows[jobsResult.rows.length - 1]!.created_at;

    const importRowsResult = await client.query<ImportRow>(
      `
        SELECT id, job_id, row_number, status, mapped_data
        FROM public.bulk_import_rows
        WHERE job_id = ANY($1::uuid[])
        ORDER BY job_id, row_number
      `,
      [jobIds],
    );

    console.log("\n=== bulk_import_rows per job ===");
    for (const job of jobsResult.rows) {
      const rows = importRowsResult.rows.filter((row) => row.job_id === job.id);
      console.log(`\nJob ${job.id} (${job.file_name ?? "unknown file"})`);
      console.log(`  committed_at: ${job.committed_at}`);
      console.log(`  import rows: ${rows.length} (status committed: ${rows.filter((r) => r.status === "committed").length})`);
    }

    const expenseHasCreatedAt = await tableHasColumn(
      client,
      "expense_register",
      "created_at",
    );
    const createdAtSelect = expenseHasCreatedAt
      ? "created_at"
      : "NULL::timestamptz AS created_at";

    const expenseWindowResult = await client.query<ExpenseRow>(
      `
        SELECT
          id,
          date::text AS date,
          expense_category,
          sub_category,
          vendor,
          price,
          quantity,
          amount,
          payment_method,
          receipt_no,
          wht_amount,
          input_vat_amount,
          ${createdAtSelect}
        FROM public.expense_register
        WHERE tenant_id = $1
          AND (
            ${expenseHasCreatedAt ? "created_at >= $2::timestamptz - interval '1 hour'" : "TRUE"}
          )
          AND (
            ${expenseHasCreatedAt ? "created_at <= $3::timestamptz + interval '2 hours'" : "TRUE"}
          )
        ORDER BY ${expenseHasCreatedAt ? "created_at ASC, " : ""}date ASC, vendor ASC, price ASC
      `,
      expenseHasCreatedAt ? [tenantId, minCreated, maxCommitted] : [tenantId],
    );

    console.log("\n=== expense_register in commit time window ===");
    console.log(
      `Window: ${minCreated} → ${maxCommitted} (${expenseHasCreatedAt ? "created_at filter" : "no created_at column — broader match"})`,
    );
    console.log(`Rows in window: ${expenseWindowResult.rows.length}`);

    console.log("\n=== Per-job expense matches (mapped_data → expense_register) ===");
    const matchedExpenseIds = new Set<string>();
    const jobToExpenseIds = new Map<string, string[]>();

    for (const job of jobsResult.rows) {
      const importRows = importRowsResult.rows.filter((row) => row.job_id === job.id);
      const matchedForJob: ExpenseRow[] = [];
      const committedAt = job.committed_at ? new Date(job.committed_at) : null;

      for (const importRow of importRows) {
        const key = mappedDataMatchKey(importRow.mapped_data);
        const candidates = expenseWindowResult.rows.filter(
          (expense) => expenseMatchKey(expense) === key,
        );

        let chosen: ExpenseRow | undefined;
        if (committedAt && expenseHasCreatedAt) {
          const nearCommit = candidates
            .filter((expense) => expense.created_at)
            .map((expense) => ({
              expense,
              deltaMs: Math.abs(
                new Date(expense.created_at!).getTime() - committedAt.getTime(),
              ),
            }))
            .sort((a, b) => a.deltaMs - b.deltaMs);
          chosen = nearCommit[0]?.expense;
        } else {
          chosen = candidates.find((expense) => !matchedExpenseIds.has(expense.id));
        }

        if (chosen) {
          matchedForJob.push(chosen);
          matchedExpenseIds.add(chosen.id);
        }
      }

      jobToExpenseIds.set(
        job.id,
        matchedForJob.map((row) => row.id),
      );

      console.log(`\nJob ${job.id}`);
      console.log(`  file_name: ${job.file_name}`);
      console.log(`  committed_at: ${job.committed_at}`);
      console.log(`  mapped rows: ${importRows.length}`);
      console.log(`  matched expense rows: ${matchedForJob.length}`);
      if (matchedForJob.length > 0) {
        console.log(
          "  matched expense ids:",
          matchedForJob.map((row) => row.id).join(", "),
        );
      }
    }

    const allMatchedIds = [...matchedExpenseIds];
    const duplicateGroups = new Map<string, ExpenseRow[]>();
    for (const expense of expenseWindowResult.rows) {
      const key = expenseMatchKey(expense);
      const group = duplicateGroups.get(key) ?? [];
      group.push(expense);
      duplicateGroups.set(key, group);
    }

    const duplicateGroupsFiltered = [...duplicateGroups.entries()]
      .filter(([, rows]) => rows.length > 1)
      .sort((a, b) => b[1].length - a[1].length);

    console.log("\n=== Duplicate groups (date+vendor+price+expense_category+payment_method) ===");
    console.log(`Groups with count > 1: ${duplicateGroupsFiltered.length}`);

    let duplicateExpenseRowCount = 0;
    for (const [key, rows] of duplicateGroupsFiltered) {
      duplicateExpenseRowCount += rows.length - 1;
      console.log(`\nGroup key: ${key}`);
      console.log(`Count: ${rows.length}`);
      for (const row of rows) {
        console.log(
          JSON.stringify(
            {
              id: row.id,
              receipt_no: row.receipt_no,
              amount: row.amount,
              wht_amount: row.wht_amount,
              input_vat_amount: row.input_vat_amount,
              created_at: row.created_at,
            },
            null,
            2,
          ),
        );
      }
    }

    const taxLedgerResult = await client.query<TaxLedgerRow>(
      `
        SELECT
          id,
          source_id::text AS source_id,
          source_type,
          direction,
          tax_component,
          tax_amount,
          created_at
        FROM public.tax_ledger_entries
        WHERE tenant_id = $1
          AND source_type = 'expense_register'
          AND created_at >= $2::timestamptz - interval '1 hour'
          AND created_at <= $3::timestamptz + interval '2 hours'
        ORDER BY created_at ASC, source_id ASC, direction ASC, tax_component ASC
      `,
      [tenantId, minCreated, maxCommitted],
    );

    console.log("\n=== tax_ledger_entries (expense_register, time window) ===");
    console.log(`Total ledger rows in window: ${taxLedgerResult.rows.length}`);

    const ledgerBySource = new Map<string, TaxLedgerRow[]>();
    for (const row of taxLedgerResult.rows) {
      if (!row.source_id) continue;
      const group = ledgerBySource.get(row.source_id) ?? [];
      group.push(row);
      ledgerBySource.set(row.source_id, group);
    }

    const duplicateExpenseIds = new Set<string>();
    for (const [, rows] of duplicateGroupsFiltered) {
      for (const row of rows.slice(1)) {
        duplicateExpenseIds.add(row.id);
      }
    }

    let duplicateLedgerLegCount = 0;
    console.log("\n=== Tax ledger legs tied to duplicate expense rows (copies beyond first) ===");
    for (const expenseId of duplicateExpenseIds) {
      const legs = ledgerBySource.get(expenseId) ?? [];
      duplicateLedgerLegCount += legs.length;
      if (legs.length > 0) {
        console.log(`\nExpense ${expenseId} (${legs.length} ledger leg(s)):`);
        for (const leg of legs) {
          console.log(JSON.stringify(leg, null, 2));
        }
      }
    }

    const expectedUniqueRows = importRowsResult.rows.length / jobsResult.rows.length;
    const totalImportedRows = importRowsResult.rows.length;
    const uniqueGroups = duplicateGroupsFiltered.length;
    const assumedOriginalRows = uniqueGroups > 0 ? uniqueGroups : expectedUniqueRows;

    console.log("\n=== Summary counts ===");
    console.log(`Committed expense jobs: ${jobsResult.rows.length}`);
    console.log(`Total bulk_import_rows across jobs: ${totalImportedRows}`);
    console.log(`Expected unique expense rows (rows per job): ${expectedUniqueRows}`);
    console.log(`Expense rows in time window: ${expenseWindowResult.rows.length}`);
    console.log(`Duplicate groups (count > 1): ${duplicateGroupsFiltered.length}`);
    console.log(
      `Extra duplicate expense_register rows (sum of group_size - 1): ${duplicateExpenseRowCount}`,
    );
    console.log(
      `If 3 commits of same ${expectedUniqueRows}-row file: expected extras ≈ ${expectedUniqueRows * (jobsResult.rows.length - 1)}`,
    );
    console.log(
      `tax_ledger_entries on duplicate expense copies (extras only): ${duplicateLedgerLegCount}`,
    );
    console.log(`Matched expense ids from job correlation: ${allMatchedIds.length}`);
    console.log(
      JSON.stringify(
        Object.fromEntries(
          jobsResult.rows.map((job) => [job.id, jobToExpenseIds.get(job.id) ?? []]),
        ),
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
