/**
 * Apply scripts/258_month_end_close_tenant_month_unique.sql then probe upserts.
 *
 *   npx tsx scripts/apply-258-month-end-close-unique.ts .env.local.backup
 *   npx tsx scripts/apply-258-month-end-close-unique.ts .env.local
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

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
  const envFile = process.argv[2] ?? ".env.local.backup";
  loadEnvForce(resolve(envFile));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL missing in " + envFile);

  const userMatch = databaseUrl.match(/postgres\.([a-z0-9]+):/i);
  console.log("envFile", envFile);
  console.log("dbRef", userMatch?.[1] ?? "(unknown)");

  const sql = readFileSync(
    resolve("scripts/258_month_end_close_tenant_month_unique.sql"),
    "utf8",
  );
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query(sql);
    const { rows } = await client.query(`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'public.month_end_close'::regclass
        AND contype = 'u'
      ORDER BY conname
    `);
    console.log("unique_constraints", rows);
  } finally {
    await client.end();
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const TENANT = "00000001-0000-4000-8000-000000000001";
  const payload = {
    tenant_id: TENANT,
    month: "2099-04-01",
    lock_status: "Open",
    notes: "258-probe",
    employees_recorded: 0,
    total_net_pay: 0,
  };
  const { error } = await admin
    .from("month_end_close")
    .upsert(payload, { onConflict: "tenant_id,month" });
  console.log(
    "upsert tenant_id,month =>",
    error ? `${error.code} ${error.message}` : "OK",
  );
  await admin
    .from("month_end_close")
    .delete()
    .eq("tenant_id", TENANT)
    .eq("month", "2099-04-01");
  console.log("probe cleaned");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
