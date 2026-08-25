/**
 * Restore missing tax_ledger_entries for Davors DF-INV-0001 / DF-INV-0004.
 *
 * Reconstructs legs from income_register tax columns (same shape as DF-INV-0002).
 * Default is dry-run (lists rows only). Pass --apply to insert.
 *
 * Dry-run:
 *   npx tsx scripts/restore-davors-client-invoice-tax-legs.ts --env=production
 *
 * Apply (only after explicit approval AND after script 246 is applied on
 * production — otherwise INSERT fails with uuid=text in the block trigger):
 *   npx tsx scripts/restore-davors-client-invoice-tax-legs.ts --env=production --apply
 */
import { connectPg } from "./lib/pg-connect";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS = "00000001-0000-4000-8000-000000000001";

const TARGETS = [
  {
    invoice_no: "DF-INV-0001",
    income_id: "1b09a1e5-30d3-4b51-98b5-05bc4a2f470d",
  },
  {
    invoice_no: "DF-INV-0004",
    income_id: "fd539e43-29cd-4d08-9dd6-b2bb1fa53252",
  },
] as const;

const REFERENCE_INCOME_ID = "bcf07d21-b34f-4a08-af3c-5c23e3006d40"; // DF-INV-0002

type IncomeRow = {
  id: string;
  invoice_no: string;
  date: string;
  amount: string;
  output_vat_amount: string;
  wht_amount: string;
  wht_rate: string | null;
  output_tax_component: string | null;
  customer_name: string | null;
  is_system_adjustment: boolean;
};

type PlannedLeg = {
  tenant_id: string;
  entry_date: string;
  period_month: string;
  direction: string;
  tax_component: string;
  rate_pct: number | null;
  taxable_base: number;
  tax_amount: number;
  status: string;
  source_type: string;
  source_id: string;
  counterparty_name: string | null;
  notes: string;
};

function parseArgs(argv: string[]) {
  const envArg = argv.find((a) => a.startsWith("--env="))?.slice("--env=".length);
  const apply = argv.includes("--apply");
  if (envArg !== "staging" && envArg !== "production") {
    throw new Error("Pass --env=staging or --env=production");
  }
  return { env: envArg as "staging" | "production", apply };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function periodMonth(entryDate: string) {
  return `${entryDate.slice(0, 7)}-01`;
}

function buildLegs(ir: IncomeRow): PlannedLeg[] {
  const amount = round2(Number(ir.amount));
  const vat = round2(Number(ir.output_vat_amount));
  const wht = round2(Number(ir.wht_amount));
  const whtRate =
    ir.wht_rate == null || ir.wht_rate === ""
      ? null
      : round2(Number(ir.wht_rate));
  const component = ir.output_tax_component ?? "vat_bundle";
  const entryDate = ir.date.slice(0, 10);
  const shared = {
    tenant_id: DAVORS,
    entry_date: entryDate,
    period_month: periodMonth(entryDate),
    status: "open",
    source_type: "income_register",
    source_id: ir.id,
    counterparty_name: ir.customer_name,
    notes: `Invoice ${ir.invoice_no}`,
  };

  const legs: PlannedLeg[] = [];
  if (wht > 0) {
    legs.push({
      ...shared,
      direction: "wht_receivable",
      tax_component: "wht",
      rate_pct: whtRate,
      taxable_base: amount,
      tax_amount: wht,
    });
  }
  if (vat > 0) {
    legs.push({
      ...shared,
      direction: "output",
      tax_component: component,
      rate_pct: 20, // matches DF-INV-0002 / invoice vat_nhil_getfund_rate
      taxable_base: round2(amount - vat),
      tax_amount: vat,
    });
  }
  return legs;
}

async function main() {
  const { env, apply } = parseArgs(process.argv.slice(2));
  if (env !== "production") {
    throw new Error(
      "This restore targets Davors production invoice ids. Use --env=production.",
    );
  }

  const { client, envFile } = await connectPg({
    requiredProjectRef: PRODUCTION_REF,
    envFiles: [".env.local.backup", ".env.local"],
  });
  console.log(`Connected production via ${envFile} (apply=${apply})`);
  console.log(`Now UTC: ${new Date().toISOString()}`);

  try {
    const ref = await client.query(
      `
      SELECT id::text, source_id::text, direction, tax_component,
             rate_pct::text, taxable_base::text, tax_amount::text,
             status, source_type, entry_date::text, period_month::text,
             counterparty_name, notes, created_at::text
      FROM public.tax_ledger_entries
      WHERE tenant_id = $1::uuid
        AND source_type = 'income_register'
        AND source_id::text = $2
      ORDER BY direction, tax_component
    `,
      [DAVORS, REFERENCE_INCOME_ID],
    );
    console.log(`\n=== Reference template DF-INV-0002 (${ref.rows.length} legs) ===`);
    for (const row of ref.rows) console.log(JSON.stringify(row));
    if (ref.rows.length !== 2) {
      throw new Error("Expected DF-INV-0002 to have exactly 2 tax legs.");
    }

    const incomeIds = TARGETS.map((t) => t.income_id);
    const income = await client.query<IncomeRow>(
      `
      SELECT id::text, invoice_no, date::text, amount::text,
             output_vat_amount::text, wht_amount::text, wht_rate::text,
             output_tax_component, customer_name, is_system_adjustment
      FROM public.income_register
      WHERE tenant_id = $1::uuid
        AND id = ANY($2::uuid[])
      ORDER BY invoice_no
    `,
      [DAVORS, incomeIds],
    );

    if (income.rows.length !== TARGETS.length) {
      throw new Error(
        `Expected ${TARGETS.length} income rows, found ${income.rows.length}`,
      );
    }

    const existing = await client.query(
      `
      SELECT source_id::text, COUNT(*)::int AS n
      FROM public.tax_ledger_entries
      WHERE tenant_id = $1::uuid
        AND source_type = 'income_register'
        AND source_id::text = ANY($2::text[])
      GROUP BY source_id
    `,
      [DAVORS, incomeIds],
    );
    const existingMap = new Map(
      existing.rows.map((r) => [String(r.source_id), Number(r.n)]),
    );

    const planned: PlannedLeg[] = [];
    console.log(`\n=== Planned inserts (from income_register tax fields) ===`);
    for (const ir of income.rows) {
      if (ir.is_system_adjustment) {
        throw new Error(`${ir.invoice_no} is flagged is_system_adjustment — abort`);
      }
      const legs = buildLegs(ir);
      const already = existingMap.get(ir.id) ?? 0;
      console.log(
        `\n${ir.invoice_no} income=${ir.id} existing_legs=${already} planned=${legs.length}`,
      );
      console.log(
        `  amount=${ir.amount} vat=${ir.output_vat_amount} wht=${ir.wht_amount} date=${ir.date}`,
      );
      for (const leg of legs) {
        console.log(JSON.stringify(leg));
        planned.push(leg);
      }
      if (already > 0) {
        throw new Error(
          `${ir.invoice_no} already has ${already} tax leg(s) — refusing to duplicate. Abort.`,
        );
      }
      if (legs.length !== 2) {
        throw new Error(`${ir.invoice_no}: expected 2 planned legs, got ${legs.length}`);
      }
    }

    console.log(`\nTotal rows that would be inserted: ${planned.length}`);

    if (!apply) {
      console.log(
        "\nDry-run only. Re-run with --apply after approval to insert these rows.",
      );
      return;
    }

    await client.query("BEGIN");
    for (const leg of planned) {
      await client.query(
        `
        INSERT INTO public.tax_ledger_entries (
          tenant_id, entry_date, period_month, direction, tax_component,
          rate_pct, taxable_base, tax_amount, status, source_type, source_id,
          counterparty_name, notes
        ) VALUES (
          $1::uuid, $2::date, $3::date, $4, $5,
          $6, $7, $8, $9, $10, $11,
          $12, $13
        )
      `,
        [
          leg.tenant_id,
          leg.entry_date,
          leg.period_month,
          leg.direction,
          leg.tax_component,
          leg.rate_pct,
          leg.taxable_base,
          leg.tax_amount,
          leg.status,
          leg.source_type,
          leg.source_id,
          leg.counterparty_name,
          leg.notes,
        ],
      );
    }
    await client.query("COMMIT");
    console.log(`\nInserted ${planned.length} tax_ledger_entries.`);
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
