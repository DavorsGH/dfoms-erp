/**
 * Read-only: check production for staff_portal_invite_business_unit_access table.
 *   npx tsx scripts/probe-production-invite-bu-table-readonly.ts --allow-production
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";

function loadEnv(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[t.slice(0, i).trim()] = v;
  }
}

async function main() {
  if (!process.argv.includes("--allow-production")) {
    throw new Error("Pass --allow-production");
  }

  loadEnv(resolve(".env.local.production-backup-2026-08-25"));
  const url = process.env.DATABASE_URL || process.env.PRODUCTION_DATABASE_URL;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url) {
    throw new Error("No DATABASE_URL in production env file");
  }
  if (!supabaseUrl.includes(PRODUCTION_REF)) {
    throw new Error(`Refusing: expected production ref ${PRODUCTION_REF}`);
  }

  const client = new pg.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const columns = await client.query(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'staff_portal_invite_business_unit_access'
        ORDER BY ordinal_position
      `,
    );
    console.log(
      JSON.stringify(
        {
          environment: "production",
          production_ref: PRODUCTION_REF,
          table_exists: columns.rows.length > 0,
          column_count: columns.rows.length,
          columns: columns.rows.map((row) => row.column_name),
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
