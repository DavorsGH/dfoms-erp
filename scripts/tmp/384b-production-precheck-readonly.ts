/**
 * One-off read-only precheck for 384b on production. Not for commit.
 * npx tsx scripts/tmp/384b-production-precheck-readonly.ts --env-file .env.local.production-backup-2026-08-25
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { resolveDatabaseUrl } from "../resolve-database-url.mjs";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    let value = trimmed.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[trimmed.slice(0, i).trim()] = value;
  }
}

async function main() {
  const envIdx = process.argv.indexOf("--env-file");
  const envFile =
    envIdx >= 0 && process.argv[envIdx + 1]
      ? process.argv[envIdx + 1]
      : ".env.local.production-backup-2026-08-25";
  loadEnvForce(resolve(envFile));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(PRODUCTION_REF)) {
    throw new Error(`Refusing non-production URL (expected ${PRODUCTION_REF})`);
  }

  const databaseUrl = resolveDatabaseUrl();
  if (!databaseUrl) throw new Error("DATABASE_URL not configured");

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("localhost")
      ? undefined
      : { rejectUnauthorized: false },
  });
  await client.connect();
  console.log(`Connected: production ${PRODUCTION_REF}\n`);

  const enumRows = await client.query(`
    SELECT e.enumlabel
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'app_role'
    ORDER BY e.enumsortorder
  `);
  const labels = enumRows.rows.map((r) => r.enumlabel);
  console.log("=== app_role enum ===");
  console.log(
    `finance_admin present: ${labels.includes("finance_admin")} (total ${labels.length} values)`,
  );

  const polFa = await client.query(`
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
        coalesce(qual, '') ILIKE '%finance_admin%'
        OR coalesce(with_check, '') ILIKE '%finance_admin%'
      )
    ORDER BY tablename, policyname
  `);
  console.log(`\n=== Policies naming finance_admin: ${polFa.rows.length} ===`);
  for (const r of polFa.rows) {
    console.log(`  ${r.tablename}.${r.policyname}`);
  }

  const fnChecks = [
    "can_delete_employee_records",
    "can_access_operations_site_for_read",
    "finance_admin_expected_employee_pay",
    "trg_employees_finance_admin_pay_guard",
  ];
  console.log("\n=== 384b-only functions (exist on prod?) ===");
  for (const name of fnChecks) {
    const { rows } = await client.query(
      `SELECT count(*)::int AS c FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = $1`,
      [name],
    );
    console.log(`  ${name}: ${rows[0].c > 0 ? "YES" : "NO"}`);
  }

  const policyExprs: Array<{ table: string; name: string }> = [
    { table: "employees", name: "employees_rbac_delete" },
    { table: "work_orders", name: "work_orders_rbac_select" },
    { table: "complaint_register", name: "complaint_register_rbac_select" },
    { table: "sites", name: "sites_rbac_select" },
  ];
  console.log("\n=== Key policy expressions (raw) ===");
  for (const { table, name } of policyExprs) {
    const { rows } = await client.query(
      `SELECT cmd, qual, with_check FROM pg_policies
       WHERE schemaname = 'public' AND tablename = $1 AND policyname = $2`,
      [table, name],
    );
    if (!rows.length) {
      console.log(`MISSING ${table}.${name}`);
      continue;
    }
    console.log(`\n${table}.${name} [${rows[0].cmd}]`);
    console.log(`USING: ${rows[0].qual ?? "(null)"}`);
    if (rows[0].with_check) console.log(`WITH CHECK: ${rows[0].with_check}`);
  }

  const schemaChecks: Array<{ kind: string; name: string }> = [
    { kind: "table", name: "employee_employment_history" },
    { kind: "table", name: "salary_rate_config" },
    { kind: "table", name: "compensation_policy" },
    { kind: "table", name: "allowance_types" },
    { kind: "table", name: "hr_payroll_settings" },
    { kind: "table", name: "roster_rotation_metadata" },
    { kind: "table", name: "user_business_unit_access" },
  ];
  const empCols = [
    "basic_salary",
    "housing_allowance",
    "transport_allowance",
    "other_allowances",
    "welfare_deduction_rate",
    "payment_method",
    "bank_name",
    "account_number",
    "momo_number",
    "momo_name",
  ];

  console.log("\n=== Schema objects for 384b triggers/helpers ===");
  for (const { kind, name } of schemaChecks) {
    const { rows } = await client.query(
      `SELECT count(*)::int AS c FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = $1 AND c.relkind = 'r'`,
      [name],
    );
    console.log(`  table ${name}: ${rows[0].c ? "OK" : "MISSING"}`);
  }
  for (const col of empCols) {
    const { rows } = await client.query(
      `SELECT count(*)::int AS c FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'employees' AND column_name = $1`,
      [col],
    );
    console.log(`  employees.${col}: ${rows[0].c ? "OK" : "MISSING"}`);
  }
  const uhbu = await client.query(
    `SELECT count(*)::int AS c FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'user_has_business_unit_access'`,
  );
  console.log(
    `  function user_has_business_unit_access(): ${uhbu.rows[0].c ? "OK" : "MISSING"}`,
  );

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
