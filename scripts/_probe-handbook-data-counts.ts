/**
 * Probe handbook RAG row counts on production (and optionally staging).
 *
 *   npx tsx scripts/_probe-handbook-data-counts.ts --env=production
 *   npx tsx scripts/_probe-handbook-data-counts.ts --env=staging
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[t.slice(0, i).trim()] = v;
  }
}

function envFileFor(name: string): string {
  if (name === "production") {
    // .env.local may point at staging on dev machines; backup holds production Supabase.
    const candidates = [".env.local.backup", ".env.vercel.production.local", ".env.local"];
    for (const file of candidates) {
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

async function probe(label: string, envFile: string) {
  loadEnvForce(resolve(envFile));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !serviceKey) {
    throw new Error(`Missing Supabase credentials in ${envFile}`);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const ref = new URL(url).hostname.split(".")[0];

  const chunks = await admin.from("handbook_chunks").select("id", { count: "exact", head: true });
  const screenshots = await admin
    .from("handbook_screenshots")
    .select("id", { count: "exact", head: true });

  const chunksCount = chunks.error ? `ERROR: ${chunks.error.message}` : String(chunks.count ?? 0);
  const screenshotsCount = screenshots.error
    ? `ERROR: ${screenshots.error.message}`
    : String(screenshots.count ?? 0);

  console.log(`\n=== ${label} (${ref}) ===`);
  console.log(`handbook_chunks:      ${chunksCount}`);
  console.log(`handbook_screenshots: ${screenshotsCount}`);

  if ((screenshots.count ?? 0) > 0) {
    const { data } = await admin
      .from("handbook_screenshots")
      .select("section_key, file_path, display_order")
      .order("section_key");
    console.log("screenshot rows:", data);
  }

  return {
    ref,
    chunks: chunks.count ?? 0,
    screenshots: screenshots.count ?? 0,
  };
}

async function main() {
  const envArg = process.argv.find((a) => a.startsWith("--env="));
  const envName = envArg?.split("=")[1] ?? "production";
  await probe(envName, envFileFor(envName));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
