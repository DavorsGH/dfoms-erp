/**
 * Apply scripts/259_phase2_revert_bu_uniques.sql then verify upserts.
 *
 *   npx tsx scripts/apply-259-phase2-revert-bu-uniques.ts .env.local.backup
 *   npx tsx scripts/apply-259-phase2-revert-bu-uniques.ts .env.local
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
  if (!databaseUrl) throw new Error("DATABASE_URL missing");
  const ref =
    databaseUrl.match(/postgres\.([a-z0-9]+)/i)?.[1] ?? "(unknown)";
  console.log("envFile", envFile, "dbRef", ref);

  // Prefer keeping the richer Davors tax_settings row before generic id-based delete
  const preClient = new pg.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });
  await preClient.connect();
  try {
    const { rows: dupes } = await preClient.query(`
      SELECT id, gra_tin IS NOT NULL AS has_tin, next_vat_due_date IS NOT NULL AS has_due
      FROM tax_settings
      WHERE tenant_id = '00000001-0000-4000-8000-000000000001'
      ORDER BY (gra_tin IS NOT NULL) DESC,
               (next_vat_due_date IS NOT NULL) DESC,
               id
    `);
    if (dupes.length > 1) {
      const keep = dupes[0].id;
      const drop = dupes.slice(1).map((r) => r.id);
      await preClient.query(
        `DELETE FROM tax_settings WHERE id = ANY($1::uuid[])`,
        [drop],
      );
      console.log("tax_settings dedupe keep", keep, "deleted", drop);
    } else {
      console.log("tax_settings dedupe not needed", dupes.length);
    }
  } finally {
    await preClient.end();
  }

  const sql = readFileSync(
    resolve("scripts/259_phase2_revert_bu_uniques.sql"),
    "utf8",
  );
  // Strip the DELETE block — already handled above with keep-richest logic
  const sqlWithoutDelete = sql.replace(
    /-- 1\) tax_settings[\s\S]*?DELETE FROM public\.tax_settings a[\s\S]*?AND a\.id < b\.id;\s*/m,
    "-- 1) tax_settings (dedupe applied by apply script)\n",
  );

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query(sqlWithoutDelete);
    const { rows } = await client.query(`
      SELECT c.conrelid::regclass::text AS table_name,
             c.conname,
             pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
      WHERE c.conrelid IN (
        'public.tax_settings'::regclass,
        'public.payroll_link'::regclass,
        'public.manual_financial_entries'::regclass
      )
        AND c.contype = 'u'
      ORDER BY 1, 2
    `);
    console.log("unique_constraints", rows);
  } finally {
    await client.end();
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const T = "00000001-0000-4000-8000-000000000001";

  {
    const { error } = await admin
      .from("tax_settings")
      .upsert({ tenant_id: T }, { onConflict: "tenant_id", ignoreDuplicates: true });
    console.log("probe tax_settings tenant_id =>", error ? error.message : "OK");
  }
  {
    const { error } = await admin.from("payroll_link").upsert(
      { tenant_id: T, payroll_month: "2099-06-01" },
      { onConflict: "tenant_id,payroll_month", ignoreDuplicates: true },
    );
    console.log(
      "probe payroll_link tenant_id,payroll_month =>",
      error ? error.message : "OK",
    );
    await admin
      .from("payroll_link")
      .delete()
      .eq("tenant_id", T)
      .eq("payroll_month", "2099-06-01");
  }
  {
    const { error } = await admin.from("manual_financial_entries").upsert(
      { tenant_id: T, period_month: "2099-06-01" },
      { onConflict: "tenant_id,period_month", ignoreDuplicates: true },
    );
    console.log(
      "probe manual_financial_entries tenant_id,period_month =>",
      error ? error.message : "OK",
    );
    await admin
      .from("manual_financial_entries")
      .delete()
      .eq("tenant_id", T)
      .eq("period_month", "2099-06-01");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
