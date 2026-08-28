/**
 * READ-ONLY: look for Client Invoice / Platform Billing income asymmetries
 * that suggest a direct income_register delete (source still exists).
 *
 *   npx tsx scripts/_probe-auto-income-delete-asymmetry-prod-readonly.ts --env-file .env.local.backup --allow-production
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS = "00000001-0000-4000-8000-000000000001";

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
  let envFile = ".env.local.backup";
  let allowProduction = false;
  for (let i = 2; i < process.argv.length; i += 1) {
    if (process.argv[i] === "--env-file" && process.argv[i + 1]) {
      envFile = process.argv[i + 1]!;
      i += 1;
    } else if (process.argv[i] === "--allow-production") {
      allowProduction = true;
    }
  }
  return { envFile, allowProduction };
}

async function main() {
  const { envFile, allowProduction } = parseArgs();
  if (!allowProduction) throw new Error("Pass --allow-production");
  loadEnv(resolve(process.cwd(), envFile));

  const { client } = await connectPg({
    requiredProjectRef: PRODUCTION_REF,
    envFiles: [envFile, ".env.local.backup", ".env.local"],
  });

  const lines: string[] = [];
  const log = (s: string) => {
    lines.push(s);
    console.log(s);
  };

  try {
    log("=== Auto-income delete asymmetry probe (PRODUCTION READ-ONLY) ===");
    log(`Now UTC: ${new Date().toISOString()}`);

    // A) client_invoices with no matching income_register (possible direct income delete)
    const invoicesWithoutIncome = await client.query(`
      SELECT
        t.name AS tenant_name,
        ci.invoice_number,
        ci.status,
        ci.invoice_date::text,
        ci.total_amount_due::text,
        ci.id AS client_invoice_id
      FROM public.client_invoices ci
      LEFT JOIN public.tenants t ON t.id = ci.tenant_id
      WHERE ci.status IS DISTINCT FROM 'draft'
        AND ci.status IS DISTINCT FROM 'voided'
        AND NOT EXISTS (
          SELECT 1
          FROM public.income_register ir
          WHERE ir.tenant_id = ci.tenant_id
            AND (
              ir.client_invoice_id = ci.id
              OR (
                ir.service_category = 'Client Invoice'
                AND ir.invoice_no = ci.invoice_number
              )
            )
        )
      ORDER BY ci.invoice_date DESC NULLS LAST
      LIMIT 50
    `);
    log(
      `\nA) Non-draft/non-voided client_invoices with NO income_register match: ${invoicesWithoutIncome.rowCount}`,
    );
    for (const row of invoicesWithoutIncome.rows) {
      log(`  ${JSON.stringify(row)}`);
    }

    // B) Davors-focused
    const davorsA = invoicesWithoutIncome.rows.filter(
      (r) =>
        r.tenant_name === "Davors Facilities" ||
        String(r.client_invoice_id).includes(DAVORS),
    );
    // filter by joining tenant - re-query davors
    const davorsMissing = await client.query(
      `
      SELECT ci.invoice_number, ci.status, ci.invoice_date::text,
             ci.total_amount_due::text, ci.id
      FROM public.client_invoices ci
      WHERE ci.tenant_id = $1
        AND ci.status IS DISTINCT FROM 'draft'
        AND ci.status IS DISTINCT FROM 'voided'
        AND NOT EXISTS (
          SELECT 1 FROM public.income_register ir
          WHERE ir.tenant_id = ci.tenant_id
            AND (
              ir.client_invoice_id = ci.id
              OR (ir.service_category = 'Client Invoice' AND ir.invoice_no = ci.invoice_number)
            )
        )
      ORDER BY ci.invoice_date
    `,
      [DAVORS],
    );
    log(
      `\nA-Davors) client_invoices missing income_register: ${davorsMissing.rowCount}`,
    );
    for (const row of davorsMissing.rows) log(`  ${JSON.stringify(row)}`);

    // C) income Client Invoice without client_invoices (orphan income - known path)
    const orphanIncome = await client.query(`
      SELECT t.name, ir.invoice_no, ir.amount::text, ir.outstanding_balance::text,
             ir.client_invoice_id::text, ir.date::text, ir.id
      FROM public.income_register ir
      LEFT JOIN public.tenants t ON t.id = ir.tenant_id
      WHERE ir.service_category = 'Client Invoice'
        AND NOT EXISTS (
          SELECT 1 FROM public.client_invoices ci
          WHERE ci.tenant_id = ir.tenant_id
            AND ci.invoice_number = ir.invoice_no
        )
      ORDER BY ir.date DESC
      LIMIT 30
    `);
    log(
      `\nC) Client Invoice income_register with NO client_invoices row: ${orphanIncome.rowCount}`,
    );
    for (const row of orphanIncome.rows) log(`  ${JSON.stringify(row)}`);

    // D) Client invoices with VAT/WHT on income but missing tax_ledger (BS gap pattern)
    const missingTax = await client.query(
      `
      SELECT ir.invoice_no, ir.date::text, ir.output_vat_amount::text, ir.wht_amount::text,
             ir.client_invoice_id IS NOT NULL AS linked,
             (
               SELECT COUNT(*)::int FROM public.tax_ledger_entries t
               WHERE t.source_type = 'income_register'
                 AND t.source_id::text = ir.id::text
             ) AS tax_leg_count
      FROM public.income_register ir
      WHERE ir.tenant_id = $1
        AND ir.service_category = 'Client Invoice'
        AND COALESCE(ir.output_vat_amount, 0) > 0
      ORDER BY ir.date
    `,
      [DAVORS],
    );
    log(`\nD) Davors Client Invoice income with output VAT + tax leg count:`);
    for (const row of missingTax.rows) log(`  ${JSON.stringify(row)}`);

    // E) Platform Billing / PSK-INC overview (can't prove deletes without audit)
    const platformBilling = await client.query(`
      SELECT t.name, COUNT(*)::int AS n,
             MIN(ir.date)::text AS min_date, MAX(ir.date)::text AS max_date
      FROM public.income_register ir
      LEFT JOIN public.tenants t ON t.id = ir.tenant_id
      WHERE ir.service_category IN ('Platform Billing', 'ERP Suite')
         OR ir.invoice_no ILIKE 'PSK-INC-%'
      GROUP BY t.name
      ORDER BY t.name
    `);
    log(`\nE) Platform Billing / PSK-INC income counts by tenant:`);
    for (const row of platformBilling.rows) log(`  ${JSON.stringify(row)}`);

    log("\n=== NOTE ===");
    log(
      "Postgres has no row-level delete audit. 'Direct delete' is inferred when client_invoices exists without income, or tax legs vanish while income remains.",
    );
    log("=== END ===");
  } finally {
    await client.end();
  }

  writeFileSync(
    resolve(process.cwd(), "scripts/_probe-auto-income-delete-asymmetry-prod-readonly-out.txt"),
    lines.join("\n"),
    "utf8",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
