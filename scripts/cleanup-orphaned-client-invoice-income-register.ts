/**
 * List (default) or delete orphaned Client Invoice income_register rows.
 *
 * Orphan = service_category 'Client Invoice', invoice_no set, no matching
 * client_invoices row for that tenant/invoice_number. On production also
 * requires client_invoice_id IS NULL when that column exists.
 *
 * Dry-run (default):
 *   npx tsx scripts/cleanup-orphaned-client-invoice-income-register.ts --env=production
 *   npx tsx scripts/cleanup-orphaned-client-invoice-income-register.ts --env=staging
 *
 * Apply (deletes income rows + tax_ledger_entries for those source ids):
 *   npx tsx scripts/cleanup-orphaned-client-invoice-income-register.ts --env=production --apply
 */
import { connectPg } from "./lib/pg-connect";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";

type OrphanRow = {
  income_id: string;
  tenant_id: string;
  tenant_name: string | null;
  invoice_no: string;
  client_id: string | null;
  customer_name: string | null;
  amount: string;
  amount_received: string;
  outstanding_balance: string | null;
  payment_status: string | null;
  date: string | null;
  tax_ledger_entry_count: string;
};

function parseArgs(argv: string[]) {
  const envArg = argv.find((a) => a.startsWith("--env="))?.slice("--env=".length);
  const apply = argv.includes("--apply");
  if (envArg !== "staging" && envArg !== "production") {
    throw new Error("Pass --env=staging or --env=production");
  }
  return { env: envArg as "staging" | "production", apply };
}

async function main() {
  const { env, apply } = parseArgs(process.argv.slice(2));
  const requiredProjectRef = env === "staging" ? STAGING_REF : PRODUCTION_REF;
  const envFiles =
    env === "staging"
      ? [".env.staging.local"]
      : [".env.local.backup", ".env.local"];

  const { client, envFile } = await connectPg({
    requiredProjectRef,
    envFiles,
  });
  console.log(`Connected ${env} via ${envFile} (apply=${apply})`);

  try {
    const col = await client.query(`
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'income_register'
        AND column_name = 'client_invoice_id'
    `);
    const hasClientInvoiceId = col.rowCount === 1;

    const orphanSql = `
      SELECT
        ir.id AS income_id,
        ir.tenant_id,
        t.name AS tenant_name,
        ir.invoice_no,
        ir.client_id,
        ir.customer_name,
        ir.amount::text,
        ir.amount_received::text,
        ir.outstanding_balance::text,
        ir.payment_status,
        ir.date::text,
        (
          SELECT COUNT(*)::text
          FROM public.tax_ledger_entries tle
          WHERE tle.source_type = 'income_register'
            AND tle.source_id::text = ir.id::text
        ) AS tax_ledger_entry_count
      FROM public.income_register ir
      LEFT JOIN public.tenants t ON t.id = ir.tenant_id
      WHERE ir.invoice_no IS NOT NULL
        AND trim(ir.invoice_no) <> ''
        AND ir.service_category = 'Client Invoice'
        ${hasClientInvoiceId ? "AND ir.client_invoice_id IS NULL" : ""}
        AND NOT EXISTS (
          SELECT 1
          FROM public.client_invoices ci
          WHERE ci.tenant_id = ir.tenant_id
            AND ci.invoice_number = ir.invoice_no
        )
      ORDER BY t.name NULLS LAST, ir.invoice_no
    `;

    const { rows } = await client.query<OrphanRow>(orphanSql);

    console.log(`\nOrphan count: ${rows.length}`);
    console.log(
      "income_id\ttenant\tinvoice_no\tclient_id\tamount\tostanding\tpayment_status\ttax_legs",
    );
    for (const row of rows) {
      console.log(
        [
          row.income_id,
          row.tenant_name ?? row.tenant_id,
          row.invoice_no,
          row.client_id ?? "",
          row.amount,
          row.outstanding_balance ?? "",
          row.payment_status ?? "",
          row.tax_ledger_entry_count,
        ].join("\t"),
      );
    }

    if (!apply) {
      console.log(
        "\nDry-run only. Re-run with --apply to delete these income_register rows and their tax_ledger_entries.",
      );
      return;
    }

    if (rows.length === 0) {
      console.log("Nothing to delete.");
      return;
    }

    await client.query("BEGIN");
    const ids = rows.map((r) => r.income_id);
    const taxDel = await client.query(
      `
      DELETE FROM public.tax_ledger_entries
      WHERE source_type = 'income_register'
        AND source_id::text = ANY($1::text[])
    `,
      [ids],
    );
    const incomeDel = await client.query(
      `
      DELETE FROM public.income_register
      WHERE id = ANY($1::uuid[])
    `,
      [ids],
    );
    await client.query("COMMIT");

    console.log(
      `\nDeleted tax_ledger_entries=${taxDel.rowCount ?? 0}, income_register=${incomeDel.rowCount ?? 0}`,
    );
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    }
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
