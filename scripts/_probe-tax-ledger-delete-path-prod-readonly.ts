/**
 * READ-ONLY: trace state of DF-INV-0001 / DF-INV-0004 tax deletion.
 *
 *   npx tsx scripts/_probe-tax-ledger-delete-path-prod-readonly.ts
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const INCOME_IDS = [
  "1b09a1e5-30d3-4b51-98b5-05bc4a2f470d",
  "fd539e43-29cd-4d08-9dd6-b2bb1fa53252",
];
const INVOICE_NOS = ["DF-INV-0001", "DF-INV-0002", "DF-INV-0004"];

async function main() {
  const { client, envFile } = await connectPg({
    requiredProjectRef: PRODUCTION_REF,
    envFiles: [".env.local.backup", ".env.local"],
  });

  const lines: string[] = [];
  const log = (s: string) => {
    console.log(s);
    lines.push(s);
  };

  log(`=== Tax ledger delete-path probe (PRODUCTION READ-ONLY) ===`);
  log(`Connected via ${envFile}`);
  log(`Now UTC: ${new Date().toISOString()}`);

  try {
    const cols = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'income_register'
        AND column_name IN (
          'updated_at','created_at','is_system_adjustment','client_invoice_id',
          'output_vat_amount','wht_amount','payment_status'
        )
      ORDER BY column_name
    `);
    log(`\nA) income_register columns present: ${cols.rows.map((r) => r.column_name).join(", ")}`);

    const ci = await client.query(
      `
      SELECT id::text, invoice_number, status, tax_due::text, wht_amount::text,
             wht_rate::text, vat_nhil_getfund_rate::text,
             total_amount_due::text, amount_received::text,
             invoice_date::text, updated_at::text, created_at::text
      FROM public.client_invoices
      WHERE tenant_id = $1
        AND invoice_number = ANY($2::text[])
      ORDER BY invoice_number
    `,
      [DAVORS, INVOICE_NOS],
    );
    log(`\nB) client_invoices:`);
    for (const r of ci.rows) log(JSON.stringify(r));

    const ir = await client.query(
      `
      SELECT id::text, invoice_no, payment_status, amount::text,
             output_vat_amount::text, wht_amount::text, wht_rate::text,
             output_tax_component, is_system_adjustment,
             client_invoice_id::text, client_id,
             outstanding_balance::text, amount_received::text,
             date::text, service_category
      FROM public.income_register
      WHERE tenant_id = $1
        AND (
          id = ANY($2::uuid[])
          OR invoice_no = ANY($3::text[])
        )
      ORDER BY invoice_no NULLS LAST, id
    `,
      [DAVORS, INCOME_IDS, INVOICE_NOS],
    );
    log(`\nC) income_register:`);
    for (const r of ir.rows) log(JSON.stringify(r));

    const allIncomeIds = ir.rows.map((r) => String(r.id));
    const tax2 = await client.query(
      `
      SELECT id::text, source_id::text, direction, tax_component,
             tax_amount::text, status, entry_date::text,
             notes, created_at::text
      FROM public.tax_ledger_entries
      WHERE tenant_id = $1::uuid
        AND source_type = 'income_register'
        AND source_id::text = ANY($2::text[])
      ORDER BY source_id, direction
    `,
      [DAVORS, allIncomeIds],
    );
    log(`\nD) tax_ledger_entries for those income ids (count=${tax2.rows.length}):`);
    for (const r of tax2.rows) log(JSON.stringify(r));
    if (tax2.rows.length === 0) log("(none — confirms wipe)");

    const trig = await client.query(`
      SELECT tgname, pg_get_triggerdef(oid) AS def
      FROM pg_trigger
      WHERE NOT tgisinternal
        AND tgrelid IN (
          'public.income_register'::regclass,
          'public.tax_ledger_entries'::regclass,
          'public.client_invoices'::regclass
        )
      ORDER BY tgname
    `);
    log(`\nE) triggers on income_register / tax_ledger / client_invoices:`);
    for (const r of trig.rows) log(`${r.tgname}: ${r.def}`);

    // Any audit / soft-delete tables?
    const auditTables = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND (
          table_name ILIKE '%audit%'
          OR table_name ILIKE '%tax_ledger%hist%'
          OR table_name ILIKE '%deleted%'
        )
      ORDER BY table_name
    `);
    log(`\nF) audit-ish tables: ${auditTables.rows.map((r) => r.table_name).join(", ") || "(none)"}`);

    // Platform: Client Invoice income with VAT>0 but 0 tax legs (live bug surface)
    const asym = await client.query(`
      SELECT t.name AS tenant, ir.invoice_no, ir.id::text AS income_id,
             ir.payment_status, ir.output_vat_amount::text, ir.wht_amount::text,
             ir.is_system_adjustment, ir.client_invoice_id IS NOT NULL AS linked,
             (
               SELECT COUNT(*)::int
               FROM public.tax_ledger_entries tle
               WHERE tle.source_type = 'income_register'
                 AND tle.source_id = ir.id
             ) AS tax_legs,
             ci.status AS ci_status
      FROM public.income_register ir
      LEFT JOIN public.tenants t ON t.id = ir.tenant_id
      LEFT JOIN public.client_invoices ci ON ci.id = ir.client_invoice_id
      WHERE ir.service_category = 'Client Invoice'
        AND COALESCE(ir.output_vat_amount, 0) + COALESCE(ir.wht_amount, 0) > 0.005
        AND COALESCE(ir.is_system_adjustment, false) = false
        AND NOT EXISTS (
          SELECT 1 FROM public.tax_ledger_entries tle
          WHERE tle.source_type = 'income_register' AND tle.source_id = ir.id
        )
      ORDER BY t.name, ir.invoice_no
      LIMIT 50
    `);
    log(`\nG) Platform Client Invoice income with tax amounts but ZERO tax legs (${asym.rows.length}):`);
    for (const r of asym.rows) log(JSON.stringify(r));

    // payments on these invoices
    const pays = await client.query(
      `
      SELECT cip.id::text, ci.invoice_number, cip.amount::text,
             cip.payment_date::text, cip.created_at::text
      FROM public.client_invoice_payments cip
      JOIN public.client_invoices ci ON ci.id = cip.invoice_id
      WHERE ci.tenant_id = $1
        AND ci.invoice_number = ANY($2::text[])
      ORDER BY ci.invoice_number, cip.created_at
    `,
      [DAVORS, INVOICE_NOS],
    );
    log(`\nH) client_invoice_payments:`);
    for (const r of pays.rows) log(JSON.stringify(r));
    if (pays.rows.length === 0) log("(none)");

    log(`\n=== END ===`);
  } finally {
    await client.end();
  }

  writeFileSync(
    resolve(process.cwd(), "scripts/_probe-tax-ledger-delete-path-prod-readonly-out.txt"),
    lines.join("\n") + "\n",
    "utf8",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
