/**
 * Apply scripts/260_change_leave_approver_business_unit.sql to staging.
 *
 * Usage: npx tsx scripts/apply-260-change-leave-approver-bu-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const STAGING_PROJECT_REF = "wieflwbfdmjtsdnwbfii";

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

async function listOverloads(client: pg.Client) {
  const { rows } = await client.query(
    `
      SELECT pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'change_leave_approver'
      ORDER BY p.oid
    `,
  );
  return rows as Array<{ args: string }>;
}

async function main() {
  loadEnvForce(resolve(".env.staging.local"));
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!supabaseUrl.includes(STAGING_PROJECT_REF)) {
    throw new Error(`Expected staging project ${STAGING_PROJECT_REF}`);
  }
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL not configured for staging");
  }

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("localhost")
      ? undefined
      : { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const before = await listOverloads(client);
    console.log("--- before ---");
    for (const row of before) {
      console.log(`change_leave_approver(${row.args})`);
    }

    const sql = readFileSync(
      resolve("scripts/260_change_leave_approver_business_unit.sql"),
      "utf8",
    );
    await client.query(sql);

    const after = await listOverloads(client);
    console.log("--- after ---");
    for (const row of after) {
      console.log(`change_leave_approver(${row.args})`);
    }

    const hasBu = after.some((row) =>
      row.args.toLowerCase().includes("p_business_unit_id"),
    );
    if (!hasBu) {
      throw new Error("Expected p_business_unit_id in change_leave_approver after apply");
    }
    console.log("OK: change_leave_approver includes p_business_unit_id");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
