/**
 * READ-ONLY: DF-INV-0003 portal vs staff deletion probe (staging + production).
 *   npx tsx scripts/_probe-df-inv-0003-readonly.ts
 */
import { connectPg } from "./lib/pg-connect";

const INVOICE = "DF-INV-0003";

type Target = {
  label: string;
  requiredProjectRef: string;
  envFiles: string[];
};

const TARGETS: Target[] = [
  {
    label: "PRODUCTION",
    requiredProjectRef: "tvcurcnmasnocwdxzgvz",
    envFiles: [".env.local.backup", ".env.local"],
  },
  {
    label: "STAGING",
    requiredProjectRef: "wieflwbfdmjtsdnwbfii",
    envFiles: [".env.staging.local", ".env.local"],
  },
];

function dumpRows(title: string, rows: unknown[]) {
  console.log(`\n--- ${title} (${rows.length} row(s)) ---`);
  if (rows.length === 0) {
    console.log("(no rows)");
    return;
  }
  console.log(JSON.stringify(rows, null, 2));
}

async function probe(target: Target) {
  console.log(`\n========== ${target.label} (${target.requiredProjectRef}) ==========`);
  let client;
  let envFile: string;
  let candidateIndex: number;
  try {
    ({ client, envFile, candidateIndex } = await connectPg({
      requiredProjectRef: target.requiredProjectRef,
      envFiles: target.envFiles,
    }));
  } catch (err) {
    console.log(`CONNECT FAILED: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  console.log(`Connected via ${envFile} candidate#${candidateIndex}`);

  try {
    const tenants = await client.query(
      `select id, name from tenants where name ilike '%davor%' or name ilike '%facilit%' order by name`,
    );
    dumpRows("Davors-ish tenants", tenants.rows);

    const q1 = await client.query(
      `SELECT id, tenant_id, invoice_number, status, total_amount_due, amount_received
       FROM client_invoices WHERE invoice_number = $1`,
      [INVOICE],
    );
    dumpRows("1) client_invoices DF-INV-0003", q1.rows);

    const q2 = await client.query(
      `SELECT id, tenant_id, invoice_no, client_id, client_invoice_id, entry_type, service_category,
              amount, amount_received, outstanding_balance, payment_status, due_date
       FROM income_register WHERE invoice_no = $1`,
      [INVOICE],
    );
    dumpRows("2) income_register DF-INV-0003", q2.rows);

    const q3 = await client.query(
      `SELECT
         conrelid::regclass AS child_table,
         conname,
         pg_get_constraintdef(oid) AS def
       FROM pg_constraint
       WHERE confrelid = 'public.client_invoices'::regclass
         AND contype = 'f'
       ORDER BY 1, 2`,
    );
    dumpRows("3) FKs TO client_invoices", q3.rows);

    const q4 = await client.query(
      `SELECT conname, pg_get_constraintdef(oid) AS def
       FROM pg_constraint
       WHERE conrelid = 'public.income_register'::regclass AND contype = 'f'
       ORDER BY 1`,
    );
    dumpRows("4) income_register FKs", q4.rows);

    const q5 = await client.query(
      `SELECT t.tgname, pg_get_triggerdef(t.oid) AS def
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'client_invoices' AND NOT t.tgisinternal
       ORDER BY 1`,
    );
    dumpRows("5) triggers on client_invoices (non-internal)", q5.rows);

    // Orphan check: income_register rows with invoice_no matching deleted client invoices pattern
    const orphan = await client.query(
      `SELECT count(*)::int AS orphan_null_fk
       FROM income_register
       WHERE invoice_no = $1 AND client_invoice_id IS NULL`,
      [INVOICE],
    );
    dumpRows("extra) DF-INV-0003 income_register with null client_invoice_id", orphan.rows);

    // How many income_register rows have invoice_no but null FK for Davors
    const orphanTenant = await client.query(
      `SELECT count(*)::int AS null_fk_with_invoice_no
       FROM income_register
       WHERE tenant_id = '00000001-0000-4000-8000-000000000001'
         AND invoice_no IS NOT NULL
         AND client_invoice_id IS NULL`,
    );
    dumpRows("extra) Davors income_register invoice_no set but client_invoice_id null", orphanTenant.rows);
  } finally {
    await client.end();
  }
}

async function main() {
  for (const t of TARGETS) {
    await probe(t);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
