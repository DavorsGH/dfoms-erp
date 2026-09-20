/**
 * Read-only: find production sales_rep accounts missing employee_id and suggest matches.
 *
 * Usage:
 *   npx tsx scripts/probe-production-sales-rep-account-linkage.ts --env production
 *   npx tsx scripts/probe-production-sales-rep-account-linkage.ts --env staging
 *
 * Does NOT update any data — report only.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

for (const envFile of [".env.production.local", ".env.staging.local", ".env.local"]) {
  try {
    for (const line of readFileSync(resolve(process.cwd(), envFile), "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i === -1) continue;
      const key = t.slice(0, i).trim();
      let val = t.slice(i + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // optional
  }
}

const envIdx = process.argv.indexOf("--env");
const environment = envIdx >= 0 ? process.argv[envIdx + 1] : "production";

async function main() {
  const url =
    environment === "production"
      ? process.env.PRODUCTION_DATABASE_URL ||
        process.env.DATABASE_URL ||
        process.env.SUPABASE_DB_URL
      : process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;

  if (!url) {
    console.error(`No database URL for --env ${environment}`);
    process.exit(1);
  }

  const client = new pg.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  console.log(`\n=== Sales rep account linkage probe (${environment}) ===\n`);

  const unlinked = await client.query<{
    auth_uid: string | null;
    email: string | null;
    tenant_id: string | null;
    employee_id: string | null;
  }>(`
    SELECT auth_uid, email, tenant_id, employee_id
    FROM user_accounts
    WHERE role = 'sales_rep'
    ORDER BY email NULLS LAST
  `);

  console.log(`Total sales_rep accounts: ${unlinked.rowCount}`);

  const missingLink = unlinked.rows.filter(
    (row) => !row.employee_id?.trim(),
  );
  console.log(`Missing employee_id: ${missingLink.length}\n`);

  for (const account of missingLink) {
    console.log("--- Unlinked account ---");
    console.log(JSON.stringify(account, null, 2));

    const emailLocal = account.email?.split("@")[0]?.toLowerCase() ?? "";

    const nameCandidates = await client.query<{
      employee_id: string;
      staff_id: string;
      full_name: string;
      email: string | null;
      employment_status: string | null;
    }>(
      `
      SELECT employee_id, staff_id, full_name, email, employment_status
      FROM employees e
      WHERE ($1::uuid IS NOT NULL AND e.tenant_id = $1)
        AND (
          lower(coalesce(e.email, '')) = lower(coalesce($2, ''))
          OR lower(e.full_name) ILIKE '%gifty%andy%avors%'
          OR lower(e.full_name) ILIKE '%' || lower($3) || '%'
        )
      ORDER BY
        CASE WHEN lower(coalesce(e.email, '')) = lower(coalesce($2, '')) THEN 0 ELSE 1 END,
        CASE WHEN e.employment_status = 'Active' THEN 0 ELSE 1 END,
        e.full_name
      LIMIT 10
      `,
      [account.tenant_id, account.email, emailLocal],
    );

    if (nameCandidates.rowCount === 0) {
      console.log("  No employee match candidates found.\n");
      continue;
    }

    console.log("  Suggested employee matches:");
    for (const row of nameCandidates.rows) {
      console.log(
        `    ${row.employee_id} — ${row.staff_id} — ${row.full_name}` +
          (row.email ? ` (${row.email})` : "") +
          ` status=${row.employment_status ?? "?"}`,
      );
    }
    const best = nameCandidates.rows[0];
    console.log(
      `\n  RECOMMENDED (review before apply): UPDATE user_accounts SET employee_id = '${best.employee_id}' WHERE auth_uid = '${account.auth_uid}';\n`,
    );
    continue;
  }

  const linked = unlinked.rows.filter((row) => row.employee_id?.trim());
  if (linked.length > 0) {
    console.log("\nAlready linked sales_rep accounts:");
    for (const row of linked) {
      const emp = await client.query<{ full_name: string; staff_id: string }>(
        `SELECT full_name, staff_id FROM employees WHERE employee_id = $1 LIMIT 1`,
        [row.employee_id],
      );
      console.log(
        `  ${row.email ?? row.auth_uid} → ${row.employee_id}` +
          (emp.rows[0] ? ` (${emp.rows[0].staff_id} — ${emp.rows[0].full_name})` : ""),
      );
    }
  }

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
