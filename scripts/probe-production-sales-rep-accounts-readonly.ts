/**
 * Read-only production probe: sales_rep account ↔ employee linkage.
 *
 * Usage:
 *   npx tsx scripts/probe-production-sales-rep-accounts-readonly.ts
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import pg from "pg";

for (const envFile of [".env.production.local", ".env.local"]) {
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
      process.env[key] = val;
    }
  } catch {
    // optional
  }
}

type UserAccountRow = {
  auth_uid: string;
  email: string | null;
  role: string | null;
  employee_id: string | null;
  tenant_id: string | null;
  client_id: string | null;
  is_active: boolean | null;
};

type EmployeeRow = {
  employee_id: string;
  staff_id: string;
  full_name: string;
  email: string | null;
  employment_status: string | null;
  tenant_id: string | null;
};

function section(title: string) {
  console.log(`\n${"=".repeat(72)}`);
  console.log(title);
  console.log("=".repeat(72));
}

function printJson(label: string, value: unknown) {
  console.log(`\n${label}:`);
  console.log(JSON.stringify(value, null, 2));
}

async function lookupEmployee(
  client: pg.Client,
  employeeId: string | null | undefined,
): Promise<EmployeeRow | null> {
  const id = employeeId?.trim();
  if (!id) return null;
  const { rows } = await client.query<EmployeeRow>(
    `
    SELECT employee_id, staff_id, full_name, email, employment_status, tenant_id
    FROM employees
    WHERE employee_id = $1
    LIMIT 1
    `,
    [id],
  );
  return rows[0] ?? null;
}

async function lookupUserByEmail(client: pg.Client, email: string) {
  const { rows } = await client.query<UserAccountRow>(
    `
    SELECT auth_uid, email, role, employee_id, tenant_id, client_id, is_active
    FROM user_accounts
    WHERE lower(trim(email)) = lower(trim($1))
    ORDER BY is_active DESC NULLS LAST
    `,
    [email],
  );
  return rows;
}

async function findEmployeeMatches(
  client: pg.Client,
  account: UserAccountRow,
): Promise<Array<EmployeeRow & { match_reason: string }>> {
  const email = account.email?.trim().toLowerCase() ?? "";
  const emailLocal = email.split("@")[0] ?? "";
  const tenantId = account.tenant_id;

  const { rows } = await client.query<EmployeeRow & { match_reason: string }>(
    `
    SELECT
      e.employee_id,
      e.staff_id,
      e.full_name,
      e.email,
      e.employment_status,
      e.tenant_id,
      CASE
        WHEN lower(trim(coalesce(e.email, ''))) = $2 THEN 'exact_email'
        WHEN $2 <> '' AND lower(trim(coalesce(e.email, ''))) LIKE '%' || split_part($2, '@', 1) || '%'
          THEN 'email_local_part_overlap'
        WHEN lower(e.full_name) = lower($3) THEN 'exact_full_name_from_email_local'
        WHEN length($3) >= 4 AND lower(e.full_name) LIKE '%' || lower($3) || '%'
          THEN 'partial_name_from_email_local'
        WHEN lower(replace(e.full_name, ' ', '')) LIKE '%' || lower(replace($3, '.', '')) || '%'
          AND length(replace($3, '.', '')) >= 4
          THEN 'normalized_name_from_email_local'
        ELSE 'other'
      END AS match_reason
    FROM employees e
    WHERE ($1::uuid IS NOT NULL AND e.tenant_id = $1)
      AND (
        lower(trim(coalesce(e.email, ''))) = $2
        OR ($2 <> '' AND lower(trim(coalesce(e.email, ''))) LIKE '%' || split_part($2, '@', 1) || '%')
        OR (length($3) >= 3 AND lower(e.full_name) LIKE '%' || lower($3) || '%')
        OR (length($3) >= 3 AND lower(replace(e.full_name, ' ', '')) LIKE '%' || lower(replace($3, '.', '')) || '%')
      )
    ORDER BY
      CASE
        WHEN lower(trim(coalesce(e.email, ''))) = $2 THEN 0
        WHEN lower(trim(coalesce(e.email, ''))) LIKE '%' || split_part($2, '@', 1) || '%' THEN 1
        WHEN e.employment_status = 'Active' THEN 2
        ELSE 3
      END,
      e.full_name
    LIMIT 15
    `,
    [tenantId, email, emailLocal],
  );

  return rows.filter((row) => row.match_reason !== "other");
}

async function main() {
  const url =
    process.env.PRODUCTION_DATABASE_URL ||
    process.env.DATABASE_URL ||
    process.env.SUPABASE_DB_URL;

  if (!url) {
    console.error("No PRODUCTION_DATABASE_URL / DATABASE_URL configured.");
    process.exit(1);
  }

  const client = new pg.Client({
    connectionString: url.replace(":6543/", ":5432/"),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  console.log("READ-ONLY production investigation (no writes).");

  // 1. Gifty's login
  section("1) user_accounts: giftyavors@gmail.com");
  const giftyRows = await lookupUserByEmail(client, "giftyavors@gmail.com");
  if (giftyRows.length === 0) {
    console.log("No user_accounts row found for giftyavors@gmail.com");
    const similar = await client.query<UserAccountRow>(
      `
      SELECT auth_uid, email, role, employee_id, tenant_id, client_id, is_active
      FROM user_accounts
      WHERE email ILIKE '%gifty%' OR email ILIKE '%avors%'
      ORDER BY email
      `,
    );
    printJson("Similar email rows (gifty/avors)", similar.rows);
  } else {
    for (const row of giftyRows) {
      printJson("user_accounts row", row);
      const linked = await lookupEmployee(client, row.employee_id);
      printJson("linked employees row", linked);
      const isEmp0002 = row.employee_id?.trim() === "EMP0002";
      const linkedIsGifty =
        linked?.full_name?.toLowerCase().includes("gifty") &&
        linked?.full_name?.toLowerCase().includes("avors");
      console.log(
        `\nVerdict: employee_id=${row.employee_id ?? "NULL"} | links to EMP0002=${isEmp0002} | employee name looks like Gifty Andy Avors=${Boolean(linkedIsGifty)}`,
      );
    }
  }

  // Also show EMP0002 employee record for reference
  const emp0002 = await lookupEmployee(client, "EMP0002");
  printJson("Reference employees row EMP0002", emp0002);

  // 2. avorsjason@gmail.com
  section("2) user_accounts: avorsjason@gmail.com");
  const jasonRows = await lookupUserByEmail(client, "avorsjason@gmail.com");
  if (jasonRows.length === 0) {
    console.log("No user_accounts row found for avorsjason@gmail.com");
  } else {
    for (const row of jasonRows) {
      printJson("user_accounts row", row);
      const linked = await lookupEmployee(client, row.employee_id);
      printJson("linked employees row", linked);
      console.log(
        `\nRole: ${row.role ?? "NULL"} | is sales_rep=${row.role === "sales_rep"} | employee_id=${row.employee_id ?? "NULL"}`,
      );
    }
  }

  // user_accounts columns available (no display_name?)
  const uaCols = await client.query<{ column_name: string }>(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_accounts'
    ORDER BY ordinal_position
    `,
  );
  printJson("user_accounts columns", uaCols.rows.map((r) => r.column_name));

  // 3. All sales_rep with null employee_id
  section("3) All production sales_rep accounts with null/missing employee_id");
  const unlinked = await client.query<UserAccountRow>(
    `
    SELECT auth_uid, email, role, employee_id, tenant_id, client_id, is_active
    FROM user_accounts
    WHERE role = 'sales_rep'
      AND (employee_id IS NULL OR btrim(employee_id) = '')
    ORDER BY lower(coalesce(email, ''))
    `,
  );
  console.log(`Count: ${unlinked.rowCount ?? 0}`);
  for (const row of unlinked.rows) {
    printJson("unlinked sales_rep", row);
  }

  const allSalesReps = await client.query<UserAccountRow & { employee_name: string | null }>(
    `
    SELECT
      ua.auth_uid,
      ua.email,
      ua.role,
      ua.employee_id,
      ua.tenant_id,
      ua.client_id,
      ua.is_active,
      e.full_name AS employee_name
    FROM user_accounts ua
    LEFT JOIN employees e ON e.employee_id = ua.employee_id
    WHERE ua.role = 'sales_rep'
    ORDER BY lower(coalesce(ua.email, ''))
    `,
  );
  section("3b) All production sales_rep accounts (linked + unlinked)");
  printJson("all sales_rep accounts", allSalesReps.rows);

  // 4. Plausible matches for each unlinked
  section("4) Plausible employee matches for each unlinked sales_rep");
  if ((unlinked.rowCount ?? 0) === 0) {
    console.log("No unlinked sales_rep accounts — nothing to match.");
  } else {
    for (const account of unlinked.rows) {
      console.log(`\n--- Account: ${account.email ?? account.auth_uid} ---`);
      printJson("account", account);
      const matches = await findEmployeeMatches(client, account);
      if (matches.length === 0) {
        console.log("No plausible employee matches found by email/name heuristics.");
        continue;
      }
      console.log("Candidate matches (with evidence):");
      for (const m of matches) {
        console.log(
          `  [${m.match_reason}] ${m.employee_id} | ${m.staff_id} | ${m.full_name} | email=${m.email ?? "—"} | status=${m.employment_status ?? "?"}`,
        );
      }
    }
  }

  await client.end();
  console.log("\nDone (read-only).");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
