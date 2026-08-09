// @ts-nocheck
/**
 * Read-only follow-up: analyze only the 60 expense IDs correlated to the 3 bulk jobs.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";

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

const tenantId = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const jobIds = [
  "d83bf87a-3cd7-4d0b-bb2d-0a9779adeaef",
  "75ad77c8-06b1-4bf9-84e2-d1b7f8c275bd",
  "2f912314-8fb1-4d65-b919-02a8616e07db",
];

function expenseKey(row: {
  date: unknown;
  vendor: unknown;
  price: unknown;
  expense_category: unknown;
  payment_method: unknown;
}): string {
  return [
    String(row.date).slice(0, 10),
    String(row.vendor ?? "").trim().toLowerCase(),
    Number(row.price).toFixed(2),
    String(row.expense_category ?? "").trim().toLowerCase(),
    String(row.payment_method ?? "").trim().toLowerCase(),
  ].join("|");
}

async function main() {
  loadEnv(resolve(process.cwd(), ".env.staging.local"));
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const jobs = await client.query(
      `SELECT id, committed_at, file_name, created_at FROM bulk_import_jobs WHERE id = ANY($1::uuid[]) ORDER BY created_at`,
      [jobIds],
    );
    const importRows = await client.query(
      `SELECT job_id, row_number, mapped_data FROM bulk_import_rows WHERE job_id = ANY($1::uuid[]) ORDER BY job_id, row_number`,
      [jobIds],
    );
    const allExpenses = await client.query(
      `SELECT id, date::text AS date, expense_category, vendor, price, amount, payment_method, receipt_no, wht_amount, input_vat_amount FROM expense_register WHERE tenant_id = $1`,
      [tenantId],
    );

    const matchedIds = new Set<string>();
    const jobMatches = new Map<string, string[]>();

    for (const job of jobs.rows) {
      const rows = importRows.rows.filter((r) => r.job_id === job.id);
      const ids: string[] = [];
      for (const row of rows) {
        const k = expenseKey({
          date: row.mapped_data.date,
          vendor: row.mapped_data.vendor,
          price: row.mapped_data.price,
          expense_category: row.mapped_data.expense_category,
          payment_method: row.mapped_data.payment_method,
        });
        const candidates = allExpenses.rows.filter(
          (expense) => expenseKey(expense) === k && !matchedIds.has(expense.id),
        );
        candidates.sort((a, b) => String(a.id).localeCompare(String(b.id)));
        const chosen = candidates[0];
        if (chosen) {
          matchedIds.add(String(chosen.id));
          ids.push(String(chosen.id));
        }
      }
      jobMatches.set(String(job.id), ids);
    }

    const bulkExpenses = allExpenses.rows.filter((e) => matchedIds.has(String(e.id)));
    const groups = new Map<string, typeof bulkExpenses>();
    for (const expense of bulkExpenses) {
      const k = expenseKey(expense);
      const group = groups.get(k) ?? [];
      group.push(expense);
      groups.set(k, group);
    }

    const dupGroups = [...groups.entries()]
      .filter(([, rows]) => rows.length > 1)
      .sort((a, b) => b[1].length - a[1].length);

    console.log("=== BULK-IMPORT-ONLY ANALYSIS (60 job-matched expense IDs) ===");
    console.log("Jobs:");
    for (const job of jobs.rows) {
      console.log(
        JSON.stringify({
          id: job.id,
          file_name: job.file_name,
          created_at: job.created_at,
          committed_at: job.committed_at,
          matched_expense_count: jobMatches.get(String(job.id))?.length ?? 0,
        }),
      );
    }

    console.log(`\nMatched expense count: ${matchedIds.size}`);
    console.log(`Duplicate groups among bulk imports: ${dupGroups.length}`);

    let extraExpenses = 0;
    for (const [k, rows] of dupGroups) {
      extraExpenses += rows.length - 1;
      console.log(`\nGROUP ${k} (count=${rows.length})`);
      for (const row of [...rows].sort((a, b) =>
        String(a.receipt_no).localeCompare(String(b.receipt_no)),
      )) {
        const jobId = [...jobMatches.entries()].find(([, ids]) =>
          ids.includes(String(row.id)),
        )?.[0];
        console.log(
          JSON.stringify({
            id: row.id,
            receipt_no: row.receipt_no,
            amount: row.amount,
            wht_amount: row.wht_amount,
            input_vat_amount: row.input_vat_amount,
            job_id: jobId,
          }),
        );
      }
    }

    console.log(`\nExtra bulk-import expense rows (copies beyond first): ${extraExpenses}`);

    const tax = await client.query(
      `
        SELECT id, source_id::text AS source_id, direction, tax_component, tax_amount, created_at
        FROM tax_ledger_entries
        WHERE tenant_id = $1
          AND source_type = 'expense_register'
          AND source_id = ANY($2::uuid[])
        ORDER BY source_id, direction
      `,
      [tenantId, [...matchedIds]],
    );

    console.log(`Tax ledger legs on all 60 bulk-import expenses: ${tax.rows.length}`);

    const duplicateCopyIds = new Set<string>();
    for (const [, rows] of dupGroups) {
      for (const row of rows.slice(1)) {
        duplicateCopyIds.add(String(row.id));
      }
    }

    const dupTax = tax.rows.filter((row) => duplicateCopyIds.has(String(row.source_id)));
    console.log(
      `Tax ledger legs on duplicate copies only (2nd+3rd commits): ${dupTax.length}`,
    );

    const byDirection: Record<string, number> = {};
    for (const row of dupTax) {
      byDirection[row.direction] = (byDirection[row.direction] ?? 0) + 1;
    }
    console.log("Duplicate-copy ledger legs by direction:", byDirection);

    console.log("\nTax legs per job:");
    for (const job of jobs.rows) {
      const ids = jobMatches.get(String(job.id)) ?? [];
      const legs = tax.rows.filter((row) => ids.includes(String(row.source_id)));
      console.log(`${job.id}: ${legs.length} legs`);
    }

    const rowsWithTax = bulkExpenses.filter(
      (row) =>
        Number(row.wht_amount) > 0 || Number(row.input_vat_amount) > 0,
    );
    console.log(
      `\nBulk expenses with wht_amount>0 or input_vat_amount>0: ${rowsWithTax.length}`,
    );
    console.log(
      `Expected tax legs if one leg per tax type: up to ${rowsWithTax.length * 2}, actual on 60 rows: ${tax.rows.length}`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
