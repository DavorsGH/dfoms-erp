/**
 * Probe handbook_chunks totals + by-persona breakdown.
 *
 *   npx tsx scripts/_probe-handbook-persona-counts.ts --env=staging
 *   npx tsx scripts/_probe-handbook-persona-counts.ts --env=production
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvForce(filePath: string) {
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

function envFileFor(name: string): string {
  if (name === "production") {
    for (const file of [
      ".env.local.backup",
      ".env.vercel.production.local",
      ".env.local",
    ]) {
      try {
        readFileSync(resolve(file), "utf8");
        if (file !== ".env.local") return file;
        const content = readFileSync(resolve(file), "utf8");
        if (!content.includes("wieflwbfdmjtsdnwbfii")) return file;
      } catch {
        /* try next */
      }
    }
    return ".env.local.backup";
  }
  return ".env.staging.local";
}

async function main() {
  const envArg = process.argv.find((a) => a.startsWith("--env="));
  const envName = envArg?.split("=")[1] ?? "staging";
  const envFile = envFileFor(envName);
  loadEnvForce(resolve(envFile));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !serviceKey) {
    throw new Error(`Missing Supabase credentials in ${envFile}`);
  }

  const ref = new URL(url).hostname.split(".")[0];
  if (envName === "production" && ref !== "tvcurcnmasnocwdxzgvz") {
    throw new Error(`Expected production ref tvcurcnmasnocwdxzgvz, got ${ref}`);
  }
  if (envName === "staging" && ref !== "wieflwbfdmjtsdnwbfii") {
    throw new Error(`Expected staging ref wieflwbfdmjtsdnwbfii, got ${ref}`);
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  const { count, error } = await admin
    .from("handbook_chunks")
    .select("id", { count: "exact", head: true });
  if (error) throw new Error(error.message);

  const personas = ["staff", "landlord", "tenant", "facility_manager"] as const;
  const parts: string[] = [];
  for (const persona of personas) {
    const { count: c, error: e } = await admin
      .from("handbook_chunks")
      .select("id", { count: "exact", head: true })
      .eq("persona", persona);
    if (e) throw new Error(e.message);
    parts.push(`${persona}=${c ?? 0}`);
  }

  console.log(`=== ${envName} (${ref}) via ${envFile} ===`);
  console.log(`handbook_chunks total: ${count ?? 0}`);
  console.log(`by persona: ${parts.join(", ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
