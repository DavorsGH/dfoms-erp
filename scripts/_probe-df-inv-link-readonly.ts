/**
 * READ-ONLY probe: DF-INV-0001..0004 income_register vs client_invoices link.
 */
import { connectPg } from "./lib/pg-connect";

type Target = {
  label: string;
  requiredProjectRef: string;
  envFiles: string[];
};

const TARGETS: Target[] = [
  {
    label: "STAGING",
    requiredProjectRef: "wieflwbfdmjtsdnwbfii",
    envFiles: [".env.staging.local"],
  },
  {
    label: "PRODUCTION",
    requiredProjectRef: "tvcurcnmasnocwdxzgvz",
    envFiles: [".env.local.backup"],
  },
];

const DETAIL_SQL = `
SELECT ir.invoice_no, ir.payment_status, ir.client_invoice_id, ci.id AS matched_invoice_id, ci.status AS invoice_status
FROM income_register ir
LEFT JOIN client_invoices ci
  ON ci.tenant_id = ir.tenant_id AND ci.invoice_number = ir.invoice_no
WHERE ir.service_category = 'Client Invoice'
  AND ir.invoice_no IN ('DF-INV-0004', 'DF-INV-0003', 'DF-INV-0002', 'DF-INV-0001')
ORDER BY ir.invoice_no
`;

const COUNT_SQL = `
SELECT
  COUNT(*) FILTER (WHERE client_invoice_id IS NULL) AS null_client_invoice_id,
  COUNT(*) FILTER (WHERE client_invoice_id IS NOT NULL) AS not_null_client_invoice_id,
  COUNT(*) AS total
FROM income_register
WHERE service_category = 'Client Invoice'
`;

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
    const detail = await client.query(DETAIL_SQL);
    console.log(`\n--- Detail (${detail.rows.length} row(s)) ---`);
    console.log(JSON.stringify(detail.rows, null, 2));

    const counts = await client.query(COUNT_SQL);
    console.log(`\n--- Client Invoice income_register client_invoice_id counts ---`);
    console.log(JSON.stringify(counts.rows[0], null, 2));
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
