/**
 * Read-only: compare staging live defs vs scripts/384b_finance_admin_role.sql expectations.
 *   npx tsx scripts/diff-384b-staging-readonly.ts --env-file .env.vercel.production.local
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { resolveDatabaseUrl } from "../resolve-database-url.mjs";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";

const FUNCTIONS = [
  "can_access_finance_income_data()",
  "can_access_client_record(text)",
  "can_access_employee_record(text)",
  "can_write_employee_records()",
  "can_access_hr_payroll_data()",
  "can_view_duty_roster_company_wide()",
  "can_access_pos_held_carts()",
  "update_sales_opportunity(uuid,text,text,numeric,integer,date,text,text,text)",
  "delete_sales_opportunity(uuid)",
  "set_commission_status(uuid,text)",
];

const POLICIES: Array<{ table: string; name: string }> = [
  { table: "employees", name: "employees_rbac_delete" },
  { table: "sites", name: "sites_rbac_select" },
  { table: "sites", name: "sites_rbac_write" },
  { table: "projects", name: "projects_client_select" },
  { table: "roster_config", name: "roster_config_client_select" },
  { table: "roster_history", name: "roster_history_rbac_select" },
  { table: "roster_rotation_metadata", name: "roster_rotation_metadata_select" },
  { table: "corrective_actions", name: "corrective_actions_rbac_select" },
  { table: "work_orders", name: "work_orders_rbac_select" },
  { table: "work_orders", name: "work_orders_rbac_insert" },
  { table: "work_orders", name: "work_orders_rbac_update" },
  { table: "work_orders", name: "work_orders_rbac_delete" },
  { table: "complaint_register", name: "complaint_register_rbac_select" },
  { table: "failed_inspections", name: "failed_inspections_rbac_select" },
  { table: "incident_register", name: "incident_register_rbac_select" },
  { table: "inspection_summary", name: "inspection_summary_rbac_select" },
  { table: "manual_financial_entries", name: "manual_financial_entries_tenant_write" },
  { table: "accounts_payable_payments", name: "accounts_payable_payments_tenant_insert" },
  { table: "accounts_payable_payments", name: "accounts_payable_payments_tenant_update" },
  { table: "accounts_payable_payments", name: "accounts_payable_payments_tenant_delete" },
  { table: "client_invoice_payments", name: "client_invoice_payments_finance_write" },
  { table: "client_invoice_payments", name: "client_invoice_payments_finance_update" },
  { table: "client_invoice_payments", name: "client_invoice_payments_finance_delete" },
  { table: "directors_loan_entries", name: "directors_loan_entries_tenant_insert" },
  { table: "directors_loan_entries", name: "directors_loan_entries_tenant_update" },
  { table: "directors_loan_entries", name: "directors_loan_entries_tenant_select" },
  { table: "suppliers", name: "suppliers_tenant_select" },
  { table: "purchase_orders", name: "purchase_orders_tenant_select" },
  { table: "product_purchases", name: "product_purchases_tenant_select" },
  { table: "internal_consumption", name: "internal_consumption_tenant_select" },
];

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

function normalizeSql(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim()
    .toLowerCase();
}

function stripFinanceAdminTokens(s: string): string {
  return s
    .replace(/'finance_admin'::app_role,?\s*/gi, "")
    .replace(/'finance_admin'::public\.app_role,?\s*/gi, "")
    .replace(/when 'finance_admin'::app_role then true\s*/gi, "")
    .replace(/when current_user_role\(\) = 'finance_admin'::app_role then true\s*/gi, "")
    .replace(
      /and current_user_role\(\)\s*(<>|is distinct from)\s*'finance_admin'::app_role\s*/gi,
      "",
    )
    .replace(/can_access_operations_site_for_read\(/gi, "can_access_operations_site(")
    .replace(/can_delete_employee_records\(\)/gi, "can_write_employee_records()");
}

async function main() {
  const envIdx = process.argv.indexOf("--env-file");
  const envFile =
    envIdx >= 0 && process.argv[envIdx + 1]
      ? process.argv[envIdx + 1]
      : ".env.vercel.production.local";
  loadEnvForce(resolve(envFile));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(PRODUCTION_REF)) {
    throw new Error(`Refusing non-production URL: ${url}`);
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

  console.log("=== Functions (live vs 384b body after normalize) ===\n");
  const sql384 = readFileSync(
    resolve(process.cwd(), "scripts/384b_finance_admin_role.sql"),
    "utf8",
  );

  for (const sig of FUNCTIONS) {
    const fnName = sig.replace(/\(.*/, "");
    const { rows } = await client.query(
      `SELECT pg_get_functiondef(p.oid) AS def
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = $1
       ORDER BY p.oid DESC LIMIT 1`,
      [fnName],
    );
    const live = rows[0]?.def ?? "(missing)";
    const re = new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${fnName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?\\$\\$;`,
      "i",
    );
    const m = sql384.match(re);
    const planned = m ? m[0] : "(not in 384b)";
    const liveN = normalizeSql(stripFinanceAdminTokens(live));
    const planN = normalizeSql(stripFinanceAdminTokens(planned));
    if (liveN === planN) {
      console.log(`OK ${sig} (only finance_admin delta expected)`);
    } else {
      console.log(`DIFF ${sig}`);
      console.log("--- live (stripped) ---");
      console.log(liveN.slice(0, 800));
      console.log("--- 384b (stripped) ---");
      console.log(planN.slice(0, 800));
      console.log("");
    }
  }

  console.log("\n=== Policies (live USING/WITH CHECK vs 384b) ===\n");
  for (const { table, name } of POLICIES) {
    const { rows } = await client.query(
      `SELECT cmd, qual, with_check
       FROM pg_policies
       WHERE schemaname = 'public' AND tablename = $1 AND policyname = $2`,
      [table, name],
    );
    if (!rows.length) {
      console.log(`MISSING live policy ${table}.${name}`);
      continue;
    }
    const liveExpr = normalizeSql(
      stripFinanceAdminTokens(
        `${rows[0].qual ?? ""} | ${rows[0].with_check ?? ""}`,
      ),
    );
    const policyRe = new RegExp(
      `(DROP POLICY IF EXISTS ${name}[\\s\\S]*?(?:CREATE POLICY ${name}[\\s\\S]*?\\);|ALTER POLICY ${name}[\\s\\S]*?;))`,
      "i",
    );
    const pm = sql384.match(policyRe);
    let planExpr = "(not in 384b)";
    if (pm) {
      planExpr = pm[1];
    }
    const planN = normalizeSql(stripFinanceAdminTokens(planExpr));
    if (liveExpr === planN || planN === "(not in 384b)") {
      console.log(`OK ${table}.${name}`);
    } else {
      console.log(`DIFF ${table}.${name} [${rows[0].cmd}]`);
      console.log("--- live ---");
      console.log(liveExpr.slice(0, 1200));
      console.log("--- 384b fragment ---");
      console.log(planN.slice(0, 1200));
      console.log("");
    }
  }

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

