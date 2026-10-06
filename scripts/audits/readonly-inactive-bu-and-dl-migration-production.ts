/**
 * Read-only production: inactive BU tags + director's loan migration footprint.
 * npx tsx scripts/audits/readonly-inactive-bu-and-dl-migration-production.ts
 */
import { connectPg } from "../lib/pg-connect";

const PROD_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS_TENANT = "00000001-0000-4000-8000-000000000001";

const ACTIVITY_TABLES: Array<{
  table: string;
  dateCol: string;
  amountCols?: string[];
}> = [
  { table: "income_register", dateCol: "date", amountCols: ["amount"] },
  { table: "expense_register", dateCol: "date", amountCols: ["amount"] },
  { table: "accounts_payable", dateCol: "invoice_date", amountCols: ["amount"] },
  { table: "product_purchases", dateCol: "purchase_date", amountCols: ["total_cost"] },
  { table: "raw_material_purchases", dateCol: "purchase_date", amountCols: ["total_cost"] },
  { table: "production_batches", dateCol: "production_date" },
  { table: "manual_financial_entries", dateCol: "period_month" },
  { table: "directors_loan_entries", dateCol: "entry_date", amountCols: ["amount"] },
  { table: "directors_loan_repayments", dateCol: "repayment_date", amountCols: ["amount"] },
  { table: "capital_contributions", dateCol: "date", amountCols: ["amount"] },
  { table: "finished_product_stock_adjustments", dateCol: "created_at" },
  { table: "raw_material_stock_adjustments", dateCol: "created_at" },
];

async function main() {
  const { client, envFile } = await connectPg({
    requiredProjectRef: PROD_REF,
    envFiles: [
      ".env.local.production-backup-2026-08-25",
      ".env.vercel.production.local",
      ".env.local.backup",
    ],
  });
  console.log(`Production read-only inactive BU audit (${envFile})\n`);

  const tenants = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM public.tenants ORDER BY name`,
  );

  for (const tenant of tenants.rows) {
    const bus = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM public.business_units WHERE tenant_id = $1::uuid ORDER BY name`,
      [tenant.id],
    );
    if (bus.rows.length === 0) continue;

    for (const bu of bus.rows) {
      let totalRows = 0;
      const samples: Array<Record<string, unknown>> = [];

      for (const spec of ACTIVITY_TABLES) {
        try {
          const r = await client.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM public.${spec.table}
             WHERE tenant_id = $1::uuid AND business_unit_id = $2::uuid`,
            [tenant.id, bu.id],
          );
          const n = r.rows[0]?.n ?? 0;
          totalRows += n;
          if (n > 0 && samples.length < 8) {
            const sel = spec.amountCols
              ? `id, ${spec.dateCol} AS dt, ${spec.amountCols.join(", ")}, created_at, business_unit_id, tenant_id`
              : `id, ${spec.dateCol} AS dt, created_at, business_unit_id, tenant_id`;
            const s = await client.query(
              `SELECT ${sel} FROM public.${spec.table}
               WHERE tenant_id = $1::uuid AND business_unit_id = $2::uuid
               ORDER BY created_at DESC NULLS LAST LIMIT 3`,
              [tenant.id, bu.id],
            );
            for (const row of s.rows) {
              samples.push({ table: spec.table, ...row });
            }
          }
        } catch {
          // table may not exist on prod
        }
      }

      if (totalRows === 0) continue;

      const { rows: incomeN } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM public.income_register
         WHERE tenant_id = $1::uuid AND business_unit_id = $2::uuid`,
        [tenant.id, bu.id],
      );
      const { rows: expenseN } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM public.expense_register
         WHERE tenant_id = $1::uuid AND business_unit_id = $2::uuid`,
        [tenant.id, bu.id],
      );
      const { rows: purchN } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM public.product_purchases
         WHERE tenant_id = $1::uuid AND business_unit_id = $2::uuid`,
        [tenant.id, bu.id],
      );

      const coreActivity =
        (incomeN[0]?.n ?? 0) + (expenseN[0]?.n ?? 0) + (purchN[0]?.n ?? 0);
      const dlOnlyCandidate = coreActivity === 0 && totalRows > 0;

      if (dlOnlyCandidate || bu.name.toLowerCase().includes("technolog")) {
        console.log(
          `\n=== ${tenant.name} | BU "${bu.name}" (${bu.id}) — rows=${totalRows}, core_activity(income+expense+product_purch)=${coreActivity} ===`,
        );
        for (const s of samples) {
          console.log(JSON.stringify(s));
        }
      }
    }
  }

  console.log("\n\n========== DAVORS TENANT: directors loan migration rows ==========\n");
  const dl = await client.query(
    `SELECT id, entry_date, entry_type, amount, business_unit_id, reference, description, created_at, created_by
     FROM public.directors_loan_entries
     WHERE tenant_id = $1::uuid
     ORDER BY entry_date, created_at`,
    [DAVORS_TENANT],
  );
  console.log(`directors_loan_entries count: ${dl.rows.length}`);
  for (const row of dl.rows) {
    console.log(row);
  }

  const rep = await client.query(
    `SELECT id, repayment_date, amount, business_unit_id, notes, created_at, created_by
     FROM public.directors_loan_repayments
     WHERE tenant_id = $1::uuid
     ORDER BY repayment_date`,
    [DAVORS_TENANT],
  );
  console.log(`\ndirectors_loan_repayments count: ${rep.rows.length}`);
  for (const row of rep.rows) {
    console.log(row);
  }

  const manuals = await client.query(
    `SELECT id, period_month, business_unit_id, loan_proceeds, loan_repayments, directors_loan
     FROM public.manual_financial_entries
     WHERE tenant_id = $1::uuid
       AND (
         coalesce(loan_proceeds, 0) <> 0
         OR coalesce(loan_repayments, 0) <> 0
         OR coalesce(directors_loan, 0) <> 0
       )`,
    [DAVORS_TENANT],
  );
  console.log(`\nmanual_financial_entries (loan fields non-zero): ${manuals.rows.length}`);
  for (const row of manuals.rows) {
    console.log(row);
  }

  const techBu = await client.query<{ id: string }>(
    `SELECT id FROM public.business_units
     WHERE tenant_id = $1::uuid AND name ILIKE '%Technolog%' LIMIT 1`,
    [DAVORS_TENANT],
  );
  if (techBu.rows[0]) {
    const tid = techBu.rows[0].id;
    console.log(`\n=== All rows tagged Davors Technologies (${tid}) on production ===`);
    for (const spec of ACTIVITY_TABLES) {
      try {
        const r = await client.query(
          `SELECT id, tenant_id, ${spec.dateCol} AS dt, created_at
           FROM public.${spec.table}
           WHERE tenant_id = $1::uuid AND business_unit_id = $2::uuid`,
          [DAVORS_TENANT, tid],
        );
        if (r.rows.length > 0) {
          console.log(`\n${spec.table}:`);
          for (const row of r.rows) {
            console.log(row);
          }
        }
      } catch {
        // skip
      }
    }
  }

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
