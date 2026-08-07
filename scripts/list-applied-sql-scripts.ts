/**
 * Compare scripts/*.sql inventory vs applied_sql_scripts for an environment.
 *
 * Usage:
 *   npx tsx scripts/list-applied-sql-scripts.ts --env staging
 *   npx tsx scripts/list-applied-sql-scripts.ts --env staging --critical 69,128,167
 */
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { assert, loadEnvFromArgv } from "./lib/env";

function parseArgs(argv: string[]) {
  const envIdx = argv.indexOf("--env");
  assert(envIdx >= 0 && argv[envIdx + 1], "--env staging|production|local required");
  const environment = argv[envIdx + 1];
  assert(
    ["local", "staging", "production"].includes(environment),
    "--env must be local, staging, or production",
  );
  const criticalIdx = argv.indexOf("--critical");
  const critical =
    criticalIdx >= 0 && argv[criticalIdx + 1]
      ? argv[criticalIdx + 1].split(",").map((s) => s.trim())
      : ["59", "60", "69", "128", "167"];
  return { environment, criticalNumbers: critical };
}

function listNumberedSqlScripts() {
  return readdirSync(resolve(process.cwd(), "scripts"))
    .filter((name) => /^\d+[_-].*\.sql$/i.test(name))
    .sort((a, b) => {
      const na = Number.parseInt(/^\d+/.exec(a)?.[0] ?? "0", 10);
      const nb = Number.parseInt(/^\d+/.exec(b)?.[0] ?? "0", 10);
      return na - nb || a.localeCompare(b);
    });
}

async function main() {
  loadEnvFromArgv(process.argv.slice(2));
  const { environment, criticalNumbers } = parseArgs(process.argv.slice(2));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(url && serviceKey, "Missing Supabase URL / service role key");

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  const { data: applied, error } = await admin
    .from("applied_sql_scripts")
    .select("script_name, script_number, applied_at, applied_by, checksum")
    .eq("environment", environment)
    .order("script_number", { ascending: true });

  if (error) {
    if (error.message.includes("applied_sql_scripts")) {
      throw new Error(
        "applied_sql_scripts table missing — apply scripts/167_applied_sql_scripts_registry.sql first.",
      );
    }
    throw new Error(error.message);
  }

  const appliedNames = new Set((applied ?? []).map((row) => row.script_name));
  const allScripts = listNumberedSqlScripts();
  const missing = allScripts.filter((name) => !appliedNames.has(name));

  console.log(`=== SQL script apply status (${environment}) ===`);
  console.log(`Recorded applies: ${applied?.length ?? 0}`);
  console.log(`Numbered scripts in repo: ${allScripts.length}`);
  console.log(`Missing from registry: ${missing.length}`);

  if ((applied ?? []).length > 0) {
    console.log("\nApplied:");
    for (const row of applied ?? []) {
      console.log(
        `  [${row.script_number ?? "—"}] ${row.script_name} @ ${row.applied_at} by ${row.applied_by ?? "?"}`,
      );
    }
  }

  const criticalMissing = missing.filter((name) =>
    criticalNumbers.some((num) => name.startsWith(`${num}_`) || name.startsWith(`${num}-`)),
  );

  if (criticalMissing.length > 0) {
    console.error("\nCRITICAL — not recorded as applied:");
    for (const name of criticalMissing) {
      console.error(`  ${name}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`\nPASS critical scripts (${criticalNumbers.join(", ")}) recorded or N/A.`);
  }

  if (missing.length > 0 && missing.length <= 30) {
    console.log("\nAll missing (sample):");
    for (const name of missing.slice(0, 30)) {
      console.log(`  ${name}`);
    }
  } else if (missing.length > 30) {
    console.log(`\n(first 20 missing of ${missing.length}):`);
    for (const name of missing.slice(0, 20)) {
      console.log(`  ${name}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
