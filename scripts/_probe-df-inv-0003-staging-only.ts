import { connectPg } from "./lib/pg-connect";

async function main() {
  const { client, envFile, candidateIndex } = await connectPg({
    requiredProjectRef: "wieflwbfdmjtsdnwbfii",
    envFiles: [".env.staging.local", ".env.local"],
  });
  console.log(`STAGING via ${envFile} candidate#${candidateIndex}`);
  try {
    const cols = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='income_register'
       ORDER BY ordinal_position`,
    );
    console.log("\n--- income_register columns ---");
    console.log(cols.rows.map((r: { column_name: string }) => r.column_name).join(", "));

    const q2 = await client.query(
      `SELECT id, tenant_id, invoice_no, client_id, entry_type, service_category,
              amount, amount_received, outstanding_balance, payment_status, due_date
       FROM income_register WHERE invoice_no = $1`,
      ["DF-INV-0003"],
    );
    console.log("\n--- 2) income_register DF-INV-0003 ---");
    console.log(JSON.stringify(q2.rows, null, 2));

    const q3 = await client.query(
      `SELECT conrelid::regclass AS child_table, conname, pg_get_constraintdef(oid) AS def
       FROM pg_constraint
       WHERE confrelid = 'public.client_invoices'::regclass AND contype = 'f'
       ORDER BY 1, 2`,
    );
    console.log("\n--- 3) FKs TO client_invoices ---");
    console.log(JSON.stringify(q3.rows, null, 2));

    const q4 = await client.query(
      `SELECT conname, pg_get_constraintdef(oid) AS def
       FROM pg_constraint
       WHERE conrelid = 'public.income_register'::regclass AND contype = 'f'
       ORDER BY 1`,
    );
    console.log("\n--- 4) income_register FKs ---");
    console.log(JSON.stringify(q4.rows, null, 2));

    const q5 = await client.query(
      `SELECT t.tgname, pg_get_triggerdef(t.oid) AS def
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'client_invoices' AND NOT t.tgisinternal
       ORDER BY 1`,
    );
    console.log("\n--- 5) triggers on client_invoices ---");
    console.log(JSON.stringify(q5.rows, null, 2));
  } finally {
    await client.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
