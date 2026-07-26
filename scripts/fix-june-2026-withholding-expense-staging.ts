/**
 * Align June 2026 PAYE / employee-SSNIT "correction" expenses with
 * recalculated open tax_ledger statutory amounts so BS balances after step 4.
 *
 * Staging by default. Production requires:
 *   --env-file .env.local.backup --allow-production
 *
 * Usage:
 *   npx tsx scripts/fix-june-2026-withholding-expense-staging.ts
 *   npx tsx scripts/fix-june-2026-withholding-expense-staging.ts --env-file .env.local.backup --allow-production
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const STAGING_PROJECT_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_PROJECT_REF = "tvcurcnmasnocwdxzgvz";
const TENANT = "00000001-0000-4000-8000-000000000001";

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function parseArgs(argv: string[]) {
  let envFile = ".env.staging.local";
  let allowProduction = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--env-file") {
      envFile = argv[++i] ?? envFile;
      continue;
    }
    if (arg === "--allow-production") {
      allowProduction = true;
      continue;
    }
  }
  return { envFile, allowProduction };
}

async function main() {
  const { envFile, allowProduction } = parseArgs(process.argv.slice(2));
  loadEnvForce(resolve(process.cwd(), envFile));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert(url, "Missing NEXT_PUBLIC_SUPABASE_URL");
  assert(key, "Missing service role key");

  const projectRef = new URL(url).hostname.split(".")[0];
  const isStaging = projectRef === STAGING_PROJECT_REF;
  const isProduction = projectRef === PRODUCTION_PROJECT_REF;
  if (isProduction) {
    assert(
      allowProduction,
      `Refusing production project ref "${projectRef}" without --allow-production.`,
    );
  } else if (!isStaging) {
    throw new Error(
      `Refusing unknown project ref "${projectRef}" (expected staging ${STAGING_PROJECT_REF} or production ${PRODUCTION_PROJECT_REF}).`,
    );
  } else if (allowProduction) {
    throw new Error(
      `Refusing --allow-production against staging project ref "${projectRef}".`,
    );
  }

  console.log(
    `=== Fix June withholding expenses (${isProduction ? "PRODUCTION" : "staging"}) ===`,
  );
  console.log(`env_file: ${envFile}`);
  console.log(`project_ref: ${projectRef}`);

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: ledger, error: ledgerError } = await admin
    .from("tax_ledger_entries")
    .select("tax_component, tax_amount, status, period_month")
    .eq("tenant_id", TENANT)
    .eq("status", "open")
    .eq("period_month", "2026-06-01")
    .eq("direction", "statutory_payable")
    .in("tax_component", ["paye", "ssnit_employee"]);

  if (ledgerError) throw new Error(ledgerError.message);

  const paye = Number(
    ledger?.find((r) => r.tax_component === "paye")?.tax_amount ?? 0,
  );
  const employeeSsnit = Number(
    ledger?.find((r) => r.tax_component === "ssnit_employee")?.tax_amount ?? 0,
  );
  assert(paye > 0 && employeeSsnit > 0, "Missing June open statutory ledger rows");

  const { data: expenses, error: expenseError } = await admin
    .from("expense_register")
    .select("id, amount, description")
    .eq("tenant_id", TENANT)
    .eq("date", "2026-06-29")
    .eq("expense_category", "Other")
    .eq("sub_category", "Payroll");

  if (expenseError) throw new Error(expenseError.message);

  const payeRow = expenses?.find((e) =>
    String(e.description).includes("PAYE tax withheld, June 2026"),
  );
  const ssnitRow = expenses?.find((e) =>
    String(e.description).includes("Employee SSNIT withheld, June 2026"),
  );
  assert(payeRow, "PAYE correction expense not found");
  assert(ssnitRow, "Employee SSNIT correction expense not found");

  const before = {
    paye: Number(payeRow.amount),
    employee_ssnit: Number(ssnitRow.amount),
  };

  const { error: payeUpdateError } = await admin
    .from("expense_register")
    .update({
      amount: paye,
      price: paye,
      description:
        "PAYE tax withheld, June 2026 — aligned to recalculated tax_ledger statutory_payable",
    })
    .eq("id", payeRow.id);
  if (payeUpdateError) throw new Error(payeUpdateError.message);

  const { error: ssnitUpdateError } = await admin
    .from("expense_register")
    .update({
      amount: employeeSsnit,
      price: employeeSsnit,
      description:
        "Employee SSNIT withheld, June 2026 — aligned to recalculated tax_ledger statutory_payable",
    })
    .eq("id", ssnitRow.id);
  if (ssnitUpdateError) throw new Error(ssnitUpdateError.message);

  console.log(
    JSON.stringify(
      {
        tenant_id: TENANT,
        project_ref: projectRef,
        before,
        after: { paye, employee_ssnit: employeeSsnit },
        expense_reduction:
          Math.round(
            (before.paye + before.employee_ssnit - paye - employeeSsnit) * 100,
          ) / 100,
      },
      null,
      2,
    ),
  );

  console.log(
    `\nDone. ${isProduction ? "Production" : "Staging"} withholding expense fix complete.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
