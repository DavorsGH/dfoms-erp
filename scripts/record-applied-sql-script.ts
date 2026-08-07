/**
 * Record that a scripts/*.sql file was applied to an environment.
 *
 * Usage:
 *   npx tsx scripts/record-applied-sql-script.ts --env staging --script 69_drop_legacy_cross_tenant_rls_policies.sql
 *   npx tsx scripts/record-applied-sql-script.ts --env staging --script 69_drop_legacy_cross_tenant_rls_policies.sql --notes "verified via audit"
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { assert, loadEnvFromArgv } from "./lib/env";

function parseArgs(argv: string[]) {
  const envIdx = argv.indexOf("--env");
  const scriptIdx = argv.indexOf("--script");
  const notesIdx = argv.indexOf("--notes");
  assert(envIdx >= 0 && argv[envIdx + 1], "--env staging|production|local required");
  assert(scriptIdx >= 0 && argv[scriptIdx + 1], "--script <filename> required");
  const environment = argv[envIdx + 1];
  assert(
    ["local", "staging", "production"].includes(environment),
    "--env must be local, staging, or production",
  );
  return {
    environment,
    scriptName: basename(argv[scriptIdx + 1]),
    notes: notesIdx >= 0 ? argv[notesIdx + 1] : null,
  };
}

function scriptNumber(name: string): number | null {
  const match = /^(\d+)[_.-]/.exec(name);
  return match ? Number.parseInt(match[1], 10) : null;
}

async function main() {
  loadEnvFromArgv(process.argv.slice(2));
  const { environment, scriptName, notes } = parseArgs(process.argv.slice(2));

  const scriptPath = resolve(process.cwd(), "scripts", scriptName);
  assert(existsSync(scriptPath), `Script not found: scripts/${scriptName}`);

  const contents = readFileSync(scriptPath, "utf8");
  const checksum = createHash("sha256").update(contents).digest("hex");
  const number = scriptNumber(scriptName);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(url && serviceKey, "Missing Supabase URL / service role key");

  if (environment === "staging") {
    assert(url.includes("wieflwbfdmjtsdnwbfii"), "Refusing non-staging URL for --env staging");
  }
  if (environment === "production") {
    assert(url.includes("tvcurcnmasnocwdxzgvz"), "Refusing non-production URL for --env production");
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  const appliedBy =
    process.env.USER ??
    process.env.USERNAME ??
    process.env.GITHUB_ACTOR ??
    "unknown";

  const { data, error } = await admin
    .from("applied_sql_scripts")
    .upsert(
      {
        script_name: scriptName,
        script_number: number,
        environment,
        applied_at: new Date().toISOString(),
        applied_by: appliedBy,
        notes,
        checksum,
      },
      { onConflict: "script_name,environment" },
    )
    .select("script_name, environment, applied_at, checksum")
    .single();

  if (error) {
    if (/applied_sql_scripts|schema cache/i.test(error.message)) {
      throw new Error(
        "applied_sql_scripts table missing — apply scripts/167_applied_sql_scripts_registry.sql first.",
      );
    }
    throw new Error(error.message);
  }
  console.log("Recorded apply:", data);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
