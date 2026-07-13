import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvFile(filePath) {
  const contents = readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

async function main() {
  const payrollMonth = process.argv[2] ?? "2026-07-01";
  loadEnvFile(resolve(process.cwd(), ".env.local"));

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase credentials in .env.local");
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const setupSql = readFileSync(
    resolve(process.cwd(), "scripts/release-locked-payroll-period.sql"),
    "utf8",
  );

  const databaseUrl =
    process.env.DATABASE_URL ??
    process.env.SUPABASE_DB_URL ??
    process.env.POSTGRES_URL;

  if (databaseUrl) {
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query(setupSql);
    await client.end();
    console.log("Installed admin_delete_payroll_history_for_month.");
  } else {
    console.log(
      "No DATABASE_URL found. Ensure scripts/release-locked-payroll-period.sql was run in Supabase SQL editor.",
    );
  }

  const { error: rpcError } = await admin.rpc(
    "admin_delete_payroll_history_for_month",
    { p_month: payrollMonth },
  );

  if (rpcError) {
    throw new Error(rpcError.message);
  }

  const { count, error: countError } = await admin
    .from("payroll_history")
    .select("id", { count: "exact", head: true })
    .eq("payroll_month", payrollMonth);

  if (countError) {
    throw new Error(countError.message);
  }

  console.log(
    `Cleared stale payroll history for ${payrollMonth}. Remaining rows: ${count ?? 0}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
