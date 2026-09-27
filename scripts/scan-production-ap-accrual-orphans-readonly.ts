// @ts-nocheck
import { resolve } from "node:path";
import pg from "pg";
import { loadEnvForce } from "./lib/env";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes("--allow-production")) {
    throw new Error("Pass --allow-production for production read-only scan");
  }
  let envFile = ".env.local.backup";
  const envIdx = args.indexOf("--env-file");
  if (envIdx >= 0 && args[envIdx + 1]) envFile = args[envIdx + 1];

  loadEnvForce(resolve(process.cwd(), envFile));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const ref = url.match(/https:\/\/([^.]+)\./)?.[1] ?? "";
  if (ref !== PRODUCTION_REF) {
    throw new Error(`Expected production ref ${PRODUCTION_REF}, got ${ref}`);
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL missing");

  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log(`Production read-only scan via ${envFile}`);

  const { rows: accrualOrphans } = await client.query(`
    SELECT er.tenant_id, t.name AS tenant_name, er.id, er.date, er.amount, er.receipt_no
    FROM expense_register er
    LEFT JOIN tenants t ON t.id = er.tenant_id
    WHERE er.receipt_no LIKE 'AP-ACCRUAL-%'
      AND NOT EXISTS (
        SELECT 1 FROM accounts_payable ap
        WHERE ap.id::text = substring(er.receipt_no from 13)
      )
    ORDER BY er.tenant_id, er.date
  `);

  console.log(`\nOrphan AP-ACCRUAL expense_register rows: ${accrualOrphans.length}`);
  for (const r of accrualOrphans) {
    console.log(
      JSON.stringify({
        tenant_id: r.tenant_id,
        tenant_name: r.tenant_name,
        date: r.date,
        amount: r.amount,
        expense_id: r.id,
        receipt_no: r.receipt_no,
      }),
    );
  }

  const { rows: taxOrphans } = await client.query(`
    SELECT tl.tenant_id, t.name AS tenant_name, tl.id, tl.entry_date, tl.tax_amount, tl.source_id
    FROM tax_ledger_entries tl
    LEFT JOIN tenants t ON t.id = tl.tenant_id
    WHERE tl.source_type = 'accounts_payable'
      AND NOT EXISTS (
        SELECT 1 FROM accounts_payable ap WHERE ap.id::text = tl.source_id
      )
    ORDER BY tl.tenant_id, tl.entry_date
  `);

  console.log(`\nTax ledger rows with missing AP source: ${taxOrphans.length}`);
  for (const r of taxOrphans) {
    console.log(
      JSON.stringify({
        tenant_id: r.tenant_id,
        tenant_name: r.tenant_name,
        entry_date: r.entry_date,
        tax_amount: r.tax_amount,
        tax_id: r.id,
        source_id: r.source_id,
      }),
    );
  }

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
