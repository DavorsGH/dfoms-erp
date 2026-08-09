/**
 * Read-only verification for Caanta duplicate expense bulk-import cleanup.
 * Does NOT delete anything.
 *
 * Usage:
 *   npx tsx scripts/verify-caanta-expense-bulk-import-cleanup-staging.ts --env-file .env.staging.local
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";
import { buildExpenseDuplicateKey } from "../lib/bulk-import/expense-duplicate-key";

const CAANTA_TENANT_ID = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";

const JOB_1 = "d83bf87a-3cd7-4d0b-bb2d-0a9779adeaef";
const JOB_2 = "75ad77c8-06b1-4bf9-84e2-d1b7f8c275bd";
const JOB_3 = "2f912314-8fb1-4d65-b919-02a8616e07db";

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

type ExpenseRow = {
  id: string;
  date: string;
  vendor: string | null;
  price: string;
  expense_category: string | null;
  payment_method: string | null;
  wht_amount: string | null;
  input_vat_amount: string | null;
  receipt_no: string | null;
};

type TaxLeg = {
  id: string;
  source_id: string;
  direction: string;
  tax_component: string;
  tax_amount: string;
};

async function matchJobExpenses(input: {
  client: Client;
  jobId: string;
  allExpenses: ExpenseRow[];
  consumedIds: Set<string>;
}): Promise<{ jobId: string; expenseIds: string[]; unmatchedRows: number[] }> {
  const importRows = await input.client.query<{
    row_number: number;
    mapped_data: Record<string, unknown>;
  }>(
    `
      SELECT row_number, mapped_data
      FROM public.bulk_import_rows
      WHERE job_id = $1
      ORDER BY row_number
    `,
    [input.jobId],
  );

  const expenseIds: string[] = [];
  const unmatchedRows: number[] = [];

  for (const row of importRows.rows) {
    const key = buildExpenseDuplicateKey({
      date: row.mapped_data.date,
      vendor: row.mapped_data.vendor,
      price: row.mapped_data.price,
      expense_category: row.mapped_data.expense_category,
      payment_method: row.mapped_data.payment_method,
    });

    if (!key) {
      unmatchedRows.push(row.row_number);
      continue;
    }

    const candidates = input.allExpenses.filter((expense) => {
      if (input.consumedIds.has(expense.id)) {
        return false;
      }

      return (
        buildExpenseDuplicateKey({
          date: expense.date,
          vendor: expense.vendor,
          price: expense.price,
          expense_category: expense.expense_category,
          payment_method: expense.payment_method,
        }) === key
      );
    });

    candidates.sort((a, b) => a.id.localeCompare(b.id));
    const chosen = candidates[0];
    if (!chosen) {
      unmatchedRows.push(row.row_number);
      continue;
    }

    input.consumedIds.add(chosen.id);
    expenseIds.push(chosen.id);
  }

  return { jobId: input.jobId, expenseIds, unmatchedRows };
}

function analyzeJobTaxLegs(expenses: ExpenseRow[], legs: TaxLeg[]) {
  const legsBySource = new Map<string, TaxLeg[]>();
  for (const leg of legs) {
    const group = legsBySource.get(leg.source_id) ?? [];
    group.push(leg);
    legsBySource.set(leg.source_id, group);
  }

  const issues: string[] = [];
  let expectedWhtLegs = 0;
  let expectedInputLegs = 0;
  let actualWhtLegs = 0;
  let actualInputLegs = 0;

  for (const expense of expenses) {
    const wht = Number(expense.wht_amount) || 0;
    const inputVat = Number(expense.input_vat_amount) || 0;
    const expenseLegs = legsBySource.get(expense.id) ?? [];

    if (wht > 0) {
      expectedWhtLegs += 1;
      const whtLegs = expenseLegs.filter((leg) => leg.direction === "wht_payable");
      actualWhtLegs += whtLegs.length;
      if (whtLegs.length !== 1) {
        issues.push(
          `${expense.id} wht_amount=${wht} but wht_payable legs=${whtLegs.length}`,
        );
      }
    } else if (expenseLegs.some((leg) => leg.direction === "wht_payable")) {
      issues.push(`${expense.id} wht_amount=0 but has wht_payable leg(s)`);
    }

    if (inputVat > 0) {
      expectedInputLegs += 1;
      const inputLegs = expenseLegs.filter(
        (leg) => leg.direction === "input" && leg.tax_component === "vat_bundle",
      );
      actualInputLegs += inputLegs.length;
      if (inputLegs.length !== 1) {
        issues.push(
          `${expense.id} input_vat_amount=${inputVat} but input/vat_bundle legs=${inputLegs.length}`,
        );
      }
    } else if (
      expenseLegs.some(
        (leg) => leg.direction === "input" && leg.tax_component === "vat_bundle",
      )
    ) {
      issues.push(`${expense.id} input_vat_amount=0 but has input/vat_bundle leg(s)`);
    }

    const extraLegs = expenseLegs.filter(
      (leg) =>
        !(
          (leg.direction === "wht_payable" && wht > 0) ||
          (leg.direction === "input" &&
            leg.tax_component === "vat_bundle" &&
            inputVat > 0)
        ),
    );
    if (extraLegs.length > 0) {
      issues.push(
        `${expense.id} has unexpected leg(s): ${extraLegs
          .map((leg) => `${leg.direction}/${leg.tax_component}`)
          .join(", ")}`,
      );
    }
  }

  return {
    expenseCount: expenses.length,
    totalLegs: legs.length,
    expectedWhtLegs,
    expectedInputLegs,
    actualWhtLegs,
    actualInputLegs,
    issues,
  };
}

async function main() {
  loadEnv(resolve(process.cwd(), ".env.staging.local"));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL missing from .env.staging.local");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const tenant = await client.query(
      `SELECT id, name FROM public.tenants WHERE id = $1`,
      [CAANTA_TENANT_ID],
    );
    console.log("=== Tenant ===");
    console.log(tenant.rows[0]);

    const jobs = await client.query(
      `
        SELECT id, status, committed_at, total_rows
        FROM public.bulk_import_jobs
        WHERE id = ANY($1::uuid[])
        ORDER BY committed_at
      `,
      [[JOB_1, JOB_2, JOB_3]],
    );
    console.log("\n=== Jobs ===");
    for (const job of jobs.rows) {
      console.log(JSON.stringify(job));
    }

    const allExpenses = (
      await client.query<ExpenseRow>(
        `
          SELECT
            id::text AS id,
            date::text AS date,
            vendor,
            price::text AS price,
            expense_category,
            payment_method,
            wht_amount::text AS wht_amount,
            input_vat_amount::text AS input_vat_amount,
            receipt_no
          FROM public.expense_register
          WHERE tenant_id = $1
        `,
        [CAANTA_TENANT_ID],
      )
    ).rows;

    console.log(`\n=== Caanta expense_register total (before cleanup): ${allExpenses.length}`);

    const consumedIds = new Set<string>();
    const job1 = await matchJobExpenses({
      client,
      jobId: JOB_1,
      allExpenses,
      consumedIds,
    });
    const job2 = await matchJobExpenses({
      client,
      jobId: JOB_2,
      allExpenses,
      consumedIds,
    });
    const job3 = await matchJobExpenses({
      client,
      jobId: JOB_3,
      allExpenses,
      consumedIds,
    });

    console.log("\n=== Matched expense IDs per job ===");
    for (const result of [job1, job2, job3]) {
      console.log(`\nJob ${result.jobId}`);
      console.log(`  matched: ${result.expenseIds.length}`);
      console.log(`  unmatched import rows: ${result.unmatchedRows.join(", ") || "(none)"}`);
      console.log(`  ids: ${result.expenseIds.join(", ")}`);
    }

    const deleteIds = [...job1.expenseIds, ...job2.expenseIds];
    const keepIds = job3.expenseIds;
    const overlapDeleteKeep = deleteIds.filter((id) => keepIds.includes(id));
    const overlapDeleteEachOther = job1.expenseIds.filter((id) =>
      job2.expenseIds.includes(id),
    );

    console.log("\n=== Safety checks ===");
    console.log(`Delete IDs (jobs 1+2): ${deleteIds.length}`);
    console.log(`Keep IDs (job 3): ${keepIds.length}`);
    console.log(`Overlap delete vs keep: ${overlapDeleteKeep.length}`);
    console.log(`Overlap job1 vs job2: ${overlapDeleteEachOther.length}`);

    if (job1.expenseIds.length !== 20 || job2.expenseIds.length !== 20 || job3.expenseIds.length !== 20) {
      console.error("\nFAIL: Expected 20 matched expenses per job.");
      process.exitCode = 1;
    }
    if (overlapDeleteKeep.length > 0 || overlapDeleteEachOther.length > 0) {
      console.error("\nFAIL: ID overlap detected — abort cleanup planning.");
      process.exitCode = 1;
    }

    const deleteExpenses = allExpenses.filter((row) => deleteIds.includes(row.id));
    const keepExpenses = allExpenses.filter((row) => keepIds.includes(row.id));

    const deleteLegs = (
      await client.query<TaxLeg>(
        `
          SELECT
            id::text AS id,
            source_id::text AS source_id,
            direction,
            tax_component,
            tax_amount::text AS tax_amount
          FROM public.tax_ledger_entries
          WHERE tenant_id = $1
            AND source_type = 'expense_register'
            AND source_id = ANY($2::uuid[])
          ORDER BY source_id, direction, tax_component
        `,
        [CAANTA_TENANT_ID, deleteIds],
      )
    ).rows;

    const keepLegs = (
      await client.query<TaxLeg>(
        `
          SELECT
            id::text AS id,
            source_id::text AS source_id,
            direction,
            tax_component,
            tax_amount::text AS tax_amount
          FROM public.tax_ledger_entries
          WHERE tenant_id = $1
            AND source_type = 'expense_register'
            AND source_id = ANY($2::uuid[])
          ORDER BY source_id, direction, tax_component
        `,
        [CAANTA_TENANT_ID, keepIds],
      )
    ).rows;

    console.log("\n=== Tax ledger on DELETE set (jobs 1+2) ===");
    console.log(`Leg count: ${deleteLegs.length}`);

    console.log("\n=== Job 3 tax ledger consistency ===");
    const job3Tax = analyzeJobTaxLegs(keepExpenses, keepLegs);
    console.log(JSON.stringify(job3Tax, null, 2));

    console.log("\n=== Job 2 tax ledger (for 22-vs-20 explanation) ===");
    const job2Expenses = allExpenses.filter((row) => job2.expenseIds.includes(row.id));
    const job2Legs = (
      await client.query<TaxLeg>(
        `
          SELECT
            id::text AS id,
            source_id::text AS source_id,
            direction,
            tax_component,
            tax_amount::text AS tax_amount
          FROM public.tax_ledger_entries
          WHERE tenant_id = $1
            AND source_type = 'expense_register'
            AND source_id = ANY($2::uuid[])
        `,
        [CAANTA_TENANT_ID, job2.expenseIds],
      )
    ).rows;
    const job2Tax = analyzeJobTaxLegs(job2Expenses, job2Legs);
    console.log(JSON.stringify(job2Tax, null, 2));

    console.log("\n=== Expected post-cleanup ===");
    console.log(
      `expense_register remaining for Caanta: ${allExpenses.length - deleteIds.length}`,
    );
    console.log(`tax_ledger_entries to delete: ${deleteLegs.length}`);
    console.log(`expense_register to delete: ${deleteIds.length}`);

    console.log("\n=== DELETE ID LIST (for script) ===");
    console.log(JSON.stringify({ deleteExpenseIds: deleteIds, keepExpenseIds: keepIds }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
