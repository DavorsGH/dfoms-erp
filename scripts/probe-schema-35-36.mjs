import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvFile(filePath) {
  const contents = readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

async function probe(label, fn) {
  try {
    const result = await fn();
    console.log(`OK  ${label}`);
    if (result !== undefined) console.log("    ", JSON.stringify(result));
    return true;
  } catch (error) {
    console.log(`FAIL ${label}`);
    console.log("    ", error.message ?? error);
    return false;
  }
}

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error("Supabase URL/key missing from .env.local");
  }

  const supabase = createClient(url, key);

  const checks = [];

  checks.push(
    await probe("income_register.client_id column", async () => {
      const { data, error } = await supabase
        .from("income_register")
        .select("id, client_id")
        .limit(3);
      if (error) throw error;
      return data;
    }),
  );

  checks.push(
    await probe("income_register -> clients join", async () => {
      const { data, error } = await supabase
        .from("income_register")
        .select("id, client_id, client:clients!client_id(client_id, client_name)")
        .limit(3);
      if (error) throw error;
      return data;
    }),
  );

  checks.push(
    await probe("projects.site_id column", async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("project_code, site_id")
        .limit(5);
      if (error) throw error;
      return data;
    }),
  );

  checks.push(
    await probe("projects -> sites join", async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("project_code, site_id, site:sites!site_id(site_code, site_name)")
        .not("required_staff", "is", null)
        .limit(5);
      if (error) throw error;
      return data;
    }),
  );

  checks.push(
    await probe("roster_config.client_id column", async () => {
      const { data, error } = await supabase
        .from("roster_config")
        .select("id, client_id, cycle_start_date")
        .limit(5);
      if (error) throw error;
      return data;
    }),
  );

  const passed = checks.filter(Boolean).length;
  console.log(`\n${passed}/${checks.length} probes passed`);
  process.exit(passed === checks.length ? 0 : 1);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
