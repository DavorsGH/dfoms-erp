/**
 * Apply production migrations 180→181→182→176→177→178→179 with per-step verification.
 *
 * Usage: npx tsx scripts/apply-production-features-migrations.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";
const MIGRATIONS = [
  "180_payment_methods_tenant_seed.sql",
  "181_leave_approver_tenant_scope.sql",
  "182_signup_owner_employee_backfill.sql",
  "176_fixed_assets_credit_purchases.sql",
  "177_accounts_payable_payments.sql",
  "178_directors_loan_repayments.sql",
  "179_expense_categories_fixed_assets_seed.sql",
] as const;

async function verify180(client: Awaited<ReturnType<typeof connectPg>>["client"]) {
  const tenants = await client.query(`
    SELECT t.name, COUNT(pm.name)::int AS cnt
    FROM tenants t
    LEFT JOIN payment_methods pm ON pm.tenant_id = t.id
    GROUP BY t.id, t.name
    ORDER BY t.name
  `);
  const empty = tenants.rows.filter((r) => Number(r.cnt) === 0);
  if (empty.length > 0) {
    throw new Error(
      `180 verify: tenants still empty: ${empty.map((r) => r.name).join(", ")}`,
    );
  }
  const davors = await client.query(
    `SELECT name FROM payment_methods WHERE tenant_id = $1 ORDER BY name`,
    [DAVORS_TENANT_ID],
  );
  const names = davors.rows.map((r) => r.name);
  if (!names.includes("Credit")) {
    throw new Error(`180 verify: Davors missing Credit in payment_methods`);
  }
  console.log(
    `PASS 180: all tenants have payment_methods; Davors has ${names.length} methods incl. Credit`,
  );
}

async function verify181(client: Awaited<ReturnType<typeof connectPg>>["client"]) {
  const fn = await client.query(`
    SELECT pg_get_functiondef(p.oid) AS def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'current_leave_approver_auth_uid'
  `);
  const def = String(fn.rows[0]?.def ?? "");
  if (!/current_user_tenant_id/i.test(def)) {
    throw new Error("181 verify: current_leave_approver_auth_uid not tenant-scoped");
  }
  const pk = await client.query(`
    SELECT pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'approvers' AND c.contype = 'p'
  `);
  if (!String(pk.rows[0]?.def ?? "").includes("tenant_id")) {
    throw new Error("181 verify: approvers PK missing tenant_id");
  }
  console.log("PASS 181: leave approver tenant-scoped; approvers composite PK");
}

async function verify182(client: Awaited<ReturnType<typeof connectPg>>["client"]) {
  const rows = await client.query(`
    SELECT
      t.name,
      (SELECT COUNT(*)::int FROM employees e WHERE e.tenant_id = t.id) AS employees,
      (SELECT COUNT(*)::int FROM approvers a WHERE a.tenant_id = t.id) AS approvers,
      (SELECT COUNT(*)::int FROM leave_approver_config lac WHERE lac.tenant_id = t.id) AS leave_approvers
    FROM tenants t
    ORDER BY t.name
  `);
  console.log("182 tenant summary:", JSON.stringify(rows.rows, null, 2));
  console.log("PASS 182: backfill completed (see summary above)");
}

async function verify176179(client: Awaited<ReturnType<typeof connectPg>>["client"]) {
  const checks = await client.query(`
    SELECT 'fixed_assets.payment_method' AS check_name,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'fixed_assets'
          AND column_name = 'payment_method'
      ) AS ok
    UNION ALL
    SELECT 'accounts_payable_payments',
      EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'accounts_payable_payments'
      )
    UNION ALL
    SELECT 'directors_loan_repayments',
      EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'directors_loan_repayments'
      )
    UNION ALL
    SELECT 'expense_categories Fixed Assets seed',
      EXISTS (
        SELECT 1 FROM expense_categories ec
        WHERE ec.name = 'Fixed Assets'
        GROUP BY ec.name
        HAVING COUNT(*) >= 1
      );
  `);
  for (const row of checks.rows as Array<{ check_name: string; ok: boolean }>) {
    if (!row.ok) throw new Error(`176-179 verify failed: ${row.check_name}`);
    console.log(`PASS ${row.check_name}`);
  }
}

async function alreadyApplied(
  client: Awaited<ReturnType<typeof connectPg>>["client"],
  script: string,
): Promise<boolean> {
  switch (script) {
    case "180_payment_methods_tenant_seed.sql": {
      const r = await client.query(`
        SELECT COUNT(*)::int AS empty_cnt FROM tenants t
        WHERE NOT EXISTS (SELECT 1 FROM payment_methods pm WHERE pm.tenant_id = t.id)
      `);
      return Number(r.rows[0]?.empty_cnt ?? 1) === 0;
    }
    case "181_leave_approver_tenant_scope.sql": {
      const fn = await client.query(`
        SELECT pg_get_functiondef(p.oid) AS def
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'current_leave_approver_auth_uid'
      `);
      return /current_user_tenant_id/i.test(String(fn.rows[0]?.def ?? ""));
    }
    case "182_signup_owner_employee_backfill.sql":
      return false;
    case "176_fixed_assets_credit_purchases.sql": {
      const r = await client.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'fixed_assets'
            AND column_name = 'payment_method'
        ) AS ok
      `);
      return Boolean(r.rows[0]?.ok);
    }
    case "177_accounts_payable_payments.sql": {
      const r = await client.query(
        `SELECT to_regclass('public.accounts_payable_payments') AS tbl`,
      );
      return Boolean(r.rows[0]?.tbl);
    }
    case "178_directors_loan_repayments.sql": {
      const r = await client.query(
        `SELECT to_regclass('public.directors_loan_repayments') AS tbl`,
      );
      return Boolean(r.rows[0]?.tbl);
    }
    case "179_expense_categories_fixed_assets_seed.sql": {
      const r = await client.query(`
        SELECT COUNT(*)::int AS cnt FROM expense_categories WHERE name = 'Fixed Assets'
      `);
      return Number(r.rows[0]?.cnt ?? 0) > 0;
    }
    default:
      return false;
  }
}

async function main() {
  const { client, envFile } = await connectPg({
    envFiles: [".env.local.backup"],
    requiredProjectRef: PRODUCTION_REF,
  });
  console.log(`Connected to PRODUCTION using ${envFile}`);

  try {
    for (const script of MIGRATIONS) {
      console.log(`\n========== ${script} ==========`);
      if (await alreadyApplied(client, script)) {
        console.log(`SKIP ${script} — already applied`);
      } else {
        const sql = readFileSync(resolve(process.cwd(), "scripts", script), "utf8");
        await client.query(sql);
        console.log(`APPLIED ${script}`);
      }

      if (script.startsWith("180")) await verify180(client);
      else if (script.startsWith("181")) await verify181(client);
      else if (script.startsWith("182")) await verify182(client);
      else if (script.startsWith("179")) await verify176179(client);
      else if (script.startsWith("176")) {
        const r = await client.query(`
          SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'fixed_assets'
              AND column_name = 'payment_method'
          ) AS ok
        `);
        if (!r.rows[0]?.ok) throw new Error("176 verify failed");
        console.log("PASS 176: fixed_assets.payment_method column exists");
      } else if (script.startsWith("177")) {
        const r = await client.query(
          `SELECT to_regclass('public.accounts_payable_payments') AS tbl`,
        );
        if (!r.rows[0]?.tbl) throw new Error("177 verify failed");
        console.log("PASS 177: accounts_payable_payments table exists");
      } else if (script.startsWith("178")) {
        const r = await client.query(
          `SELECT to_regclass('public.directors_loan_repayments') AS tbl`,
        );
        if (!r.rows[0]?.tbl) throw new Error("178 verify failed");
        console.log("PASS 178: directors_loan_repayments table exists");
      }
    }

    console.log("\nALL PASS — production migrations 180→179 complete");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
