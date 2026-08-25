/**
 * Backfill income_register.client_invoice_id for Client Invoice rows that
 * match an existing client_invoices row by tenant_id + invoice_number.
 *
 * Ensures column/FK/index exist (idempotent with scripts/244_client_invoice_income_link.sql).
 * Default is dry-run: lists every row that would be linked. Pass --apply to write.
 *
 * Dry-run:
 *   npx tsx scripts/apply-244-client-invoice-income-link.ts --env=production
 *   npx tsx scripts/apply-244-client-invoice-income-link.ts --env=staging
 *
 * Apply:
 *   npx tsx scripts/apply-244-client-invoice-income-link.ts --env=production --apply
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";

type PendingLink = {
  income_id: string;
  tenant_id: string;
  tenant_name: string | null;
  invoice_no: string;
  client_invoice_id: string;
  client_invoices_status: string;
  income_payment_status: string | null;
  income_client_id: string | null;
  amount: string;
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
    const hasColumn = (col.rowCount ?? 0) === 1;

    if (!hasColumn && !apply) {
      console.log(
        "\nincome_register.client_invoice_id is missing. Dry-run cannot list links until the column exists.",
      );
      console.log(
        "Re-run with --apply to create the column/FK (script 244) and backfill.",
      );
      return;
    }

    if (apply) {
      const sql = readFileSync(
        resolve(process.cwd(), "scripts/244_client_invoice_income_link.sql"),
        "utf8",
      );
      console.log("\nApplying 244_client_invoice_income_link.sql …");
      await client.query(sql);
      console.log("Schema + backfill UPDATE applied.");
    }

    const pendingSql = `
      SELECT
        ir.id AS income_id,
        ir.tenant_id,
        t.name AS tenant_name,
        ir.invoice_no,
        ci.id AS client_invoice_id,
        ci.status AS client_invoices_status,
        ir.payment_status AS income_payment_status,
        ir.client_id AS income_client_id,
        ir.amount::text AS amount
      FROM public.income_register ir
      JOIN public.client_invoices ci
        ON ci.tenant_id = ir.tenant_id
       AND ci.invoice_number = ir.invoice_no
      LEFT JOIN public.tenants t ON t.id = ir.tenant_id
      WHERE ir.service_category = 'Client Invoice'
        AND ir.invoice_no IS NOT NULL
        AND trim(ir.invoice_no) <> ''
        AND ir.client_invoice_id IS NULL
      ORDER BY t.name NULLS LAST, ir.invoice_no
    `;

    // After --apply the UPDATE already ran; this list should be empty.
    // Before --apply (when column exists) this is the dry-run preview.
    // If we just applied, also show how many are now linked.
    const { rows: stillNull } = await client.query<PendingLink>(pendingSql);

    if (!apply) {
      console.log(`\nRows that would be linked (client_invoice_id currently NULL): ${stillNull.length}`);
      console.log(
        "income_id\ttenant\tinvoice_no\tclient_invoice_id\tci_status\tir_payment_status\tclient_id\tamount",
      );
      for (const row of stillNull) {
        console.log(
          [
            row.income_id,
            row.tenant_name ?? row.tenant_id,
            row.invoice_no,
            row.client_invoice_id,
            row.client_invoices_status,
            row.income_payment_status ?? "",
            row.income_client_id ?? "",
            row.amount,
          ].join("\t"),
        );
      }
      console.log(
        "\nDry-run only. Re-run with --apply to set client_invoice_id (and ensure column/FK).",
      );
      return;
    }

    const linked = await client.query(`
      SELECT COUNT(*)::int AS linked
      FROM public.income_register
      WHERE service_category = 'Client Invoice'
        AND client_invoice_id IS NOT NULL
    `);
    const stillOrphanLinkedMatch = stillNull.length;
    console.log(`\nLinked Client Invoice income rows now: ${linked.rows[0]?.linked ?? 0}`);
    console.log(
      `Still NULL but matchable (should be 0 after apply): ${stillOrphanLinkedMatch}`,
    );

    if (stillOrphanLinkedMatch > 0) {
      console.log("Remaining unmatched-null preview:");
      for (const row of stillNull) {
        console.log(
          `${row.invoice_no}\t${row.income_id}\t→ ${row.client_invoice_id}`,
        );
      }
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
