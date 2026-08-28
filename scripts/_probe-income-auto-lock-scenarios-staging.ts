/**
 * Staging data probe: find one income row per lockdown scenario for browser QA.
 * READ-ONLY.
 *
 *   npx tsx scripts/_probe-income-auto-lock-scenarios-staging.ts
 */
import { connectPg } from "./lib/pg-connect";
import { detectAutoPostedIncomeRegisterEntry } from "../app/dashboard/finance/register-auto-posted-utils";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

async function main() {
  const { client, envFile } = await connectPg({
    requiredProjectRef: STAGING_REF,
    envFiles: [".env.staging.local"],
  });
  console.log(`Connected staging via ${envFile}`);

  try {
    const tenants = await client.query(`
      SELECT id::text, name FROM public.tenants ORDER BY name LIMIT 30
    `);
    console.log("\nTenants:");
    for (const t of tenants.rows) console.log(`  ${t.name}\t${t.id}`);

    const samples = await client.query(`
      WITH ranked AS (
        SELECT
          t.name AS tenant,
          ir.id::text,
          ir.invoice_no,
          ir.service_category,
          ir.entry_type::text AS entry_type,
          ir.is_system_adjustment,
          (ir.client_invoice_id IS NOT NULL) AS linked,
          ir.payment_status,
          ir.amount::text,
          CASE
            WHEN ir.is_system_adjustment IS TRUE THEN 'system_adjustment'
            WHEN ir.invoice_no ILIKE 'PAYROLL-DEDSAV-%' THEN 'payroll_dedsav'
            WHEN ir.client_invoice_id IS NOT NULL
              OR ir.service_category = 'Client Invoice' THEN 'client_invoice'
            WHEN ir.service_category IN ('Platform Billing', 'ERP Suite')
              OR ir.invoice_no ILIKE 'PSK-INC-%' THEN 'platform_billing'
            WHEN COALESCE(ir.is_system_adjustment, false) = false
              AND ir.client_invoice_id IS NULL
              AND COALESCE(ir.service_category, '') NOT IN (
                'Client Invoice', 'Platform Billing', 'ERP Suite',
                'Real Estate Management Fee'
              )
              AND COALESCE(ir.entry_type::text, '') IS DISTINCT FROM 'product_sale'
              AND COALESCE(ir.invoice_no, '') NOT ILIKE 'PSK-INC-%'
              AND COALESCE(ir.invoice_no, '') NOT ILIKE 'RE-MGMT-FEE-%'
              AND COALESCE(ir.invoice_no, '') NOT ILIKE 'PAYROLL-%'
              THEN 'manual_candidate'
            ELSE 'other'
          END AS scenario
        FROM public.income_register ir
        JOIN public.tenants t ON t.id = ir.tenant_id
        WHERE t.name = 'Davors Facilities'
      )
      SELECT DISTINCT ON (scenario)
        scenario, tenant, id, invoice_no, service_category, entry_type,
        is_system_adjustment, linked, payment_status, amount
      FROM ranked
      WHERE scenario IN (
        'client_invoice', 'platform_billing', 'system_adjustment',
        'payroll_dedsav', 'manual_candidate'
      )
      ORDER BY scenario, tenant
    `);

    console.log("\nSample rows for browser QA:");
    for (const row of samples.rows) {
      const det = detectAutoPostedIncomeRegisterEntry({
        invoice_no: row.invoice_no,
        is_system_adjustment: row.is_system_adjustment,
        client_invoice_id: row.linked ? "x" : null,
        service_category: row.service_category,
        entry_type: row.entry_type,
      });
      console.log(JSON.stringify({ ...row, detector: det }, null, 0));
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
