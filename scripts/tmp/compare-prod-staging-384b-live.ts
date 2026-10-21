// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { resolveDatabaseUrl } from "../resolve-database-url.mjs";

function loadEnvForce(filePath: string) {
  const saved = { ...process.env };
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("SUPABASE") || k.startsWith("DATABASE") || k.startsWith("NEXT_PUBLIC_SUPABASE") || k === "DB_PASSWORD")
      delete process.env[k];
  }
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    process.env[t.slice(0, i).trim()] = v;
  }
  return saved;
}

async function snapshot(envFile: string) {
  loadEnvForce(resolve(envFile));
  const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0];
  const client = new pg.Client({
    connectionString: resolveDatabaseUrl()!,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  const names = [
    ["employees", "employees_rbac_delete"],
    ["work_orders", "work_orders_rbac_select"],
    ["complaint_register", "complaint_register_rbac_select"],
    ["roster_config", "roster_config_client_select"],
    ["sites", "sites_rbac_select"],
  ] as const;
  const policies: Record<string, string | null> = {};
  for (const [table, name] of names) {
    const { rows } = await client.query(
      `SELECT qual FROM pg_policies WHERE schemaname='public' AND tablename=$1 AND policyname=$2`,
      [table, name],
    );
    policies[`${table}.${name}`] = rows[0]?.qual ?? null;
  }
  const { rows: fa } = await client.query(
    `SELECT count(*)::int c FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='app_role' AND e.enumlabel='finance_admin'`,
  );
  await client.end();
  return {
    ref,
    finance_admin_enum: (fa.rows[0]?.c ?? 0) > 0,
    policies,
  };
}

async function main() {
  const prod = await snapshot(".env.local.production-backup-2026-08-25");
  const staging = await snapshot(".env.staging.local");

  console.log("=== Prod vs staging live policy qual (exact string) ===\n");
  for (const key of Object.keys(prod.policies)) {
    const p = prod.policies[key];
    const s = staging.policies[key];
    const same = p === s;
    console.log(`${same ? "SAME" : "DIFF"} ${key}`);
    if (!same) {
      console.log(`  PROD (${prod.ref}): ${p}`);
      console.log(`  STG  (${staging.ref}): ${s}`);
      console.log("");
    }
  }
  console.log(
    `\nfinance_admin enum: prod=${prod.finance_admin_enum} staging=${staging.finance_admin_enum}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
