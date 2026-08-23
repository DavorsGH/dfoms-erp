/**
 * Copy pilot handbook screenshots from staging storage/DB to production.
 * Uses staging row file_paths (same section-key/uuid.png paths) and corrected section_keys.
 *
 *   ALLOW_PRODUCTION_MIGRATE=true npx tsx scripts/_migrate-handbook-screenshots-staging-to-production.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { HANDBOOK_SCREENSHOTS_BUCKET } from "../utils/handbook-screenshots-paths";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";

/** Staging pilot rows after section_key fix (6.7 for client invoices). */
const PRODUCTION_SCREENSHOT_ROWS = [
  { section_key: "7.7", file_path: "7.7/db66d05c-09a0-4850-98a4-53af6049cd28.png", display_order: 0 },
  { section_key: "7.2", file_path: "7.2/336ac3b4-7e0f-424d-9660-7b3af0a23dc2.png", display_order: 0 },
  { section_key: "6.2", file_path: "6.2/d6c8c669-e137-4676-b221-b8e1654f3533.png", display_order: 0 },
  { section_key: "6.7", file_path: "6.8/32c51023-3f86-4422-b34f-8dceccf8e221.png", display_order: 0 },
  { section_key: "5.1", file_path: "5.1/66d98004-424f-4deb-ac68-80df08508e69.png", display_order: 0 },
] as const;

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

function productionEnvFile(): string {
  for (const file of [".env.local.backup", ".env.vercel.production.local"]) {
    try {
      readFileSync(resolve(file), "utf8");
      return file;
    } catch {
      /* try next */
    }
  }
  return ".env.local.backup";
}

function createAdminFromEnvFile(envFile: string): SupabaseClient {
  loadEnvForce(resolve(envFile));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !serviceKey) {
    throw new Error(`Missing Supabase credentials in ${envFile}`);
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

async function countRows(admin: SupabaseClient) {
  const chunks = await admin.from("handbook_chunks").select("id", { count: "exact", head: true });
  const screenshots = await admin
    .from("handbook_screenshots")
    .select("id", { count: "exact", head: true });
  return { chunks: chunks.count ?? 0, screenshots: screenshots.count ?? 0 };
}

async function main() {
  if (process.env.ALLOW_PRODUCTION_MIGRATE !== "true") {
    throw new Error("Set ALLOW_PRODUCTION_MIGRATE=true to copy screenshots into production.");
  }

  const staging = createAdminFromEnvFile(".env.staging.local");
  const production = createAdminFromEnvFile(productionEnvFile());

  loadEnvForce(resolve(".env.staging.local"));
  const stagingRef = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname.split(".")[0];
  loadEnvForce(resolve(productionEnvFile()));
  const prodRef = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname.split(".")[0];

  if (stagingRef !== STAGING_REF) {
    throw new Error(`Expected staging ref ${STAGING_REF}, got ${stagingRef}`);
  }
  if (prodRef !== PRODUCTION_REF) {
    throw new Error(`Expected production ref ${PRODUCTION_REF}, got ${prodRef}`);
  }

  console.log("\n=== Before (production) ===");
  const before = await countRows(production);
  console.log(`handbook_chunks: ${before.chunks}`);
  console.log(`handbook_screenshots: ${before.screenshots}`);

  // Verify staging rows exist (source of truth for file paths)
  const { data: stagingRows, error: stagingListError } = await staging
    .from("handbook_screenshots")
    .select("section_key, file_path, display_order")
    .order("section_key");
  if (stagingListError) throw stagingListError;
  console.log("\nStaging handbook_screenshots:", stagingRows);

  console.log("\nCopying storage objects staging -> production …");
  for (const row of PRODUCTION_SCREENSHOT_ROWS) {
    const { data: blob, error: downloadError } = await staging.storage
      .from(HANDBOOK_SCREENSHOTS_BUCKET)
      .download(row.file_path);
    if (downloadError || !blob) {
      throw new Error(`Staging download failed for ${row.file_path}: ${downloadError?.message}`);
    }

    const bytes = Buffer.from(await blob.arrayBuffer());
    const { error: uploadError } = await production.storage
      .from(HANDBOOK_SCREENSHOTS_BUCKET)
      .upload(row.file_path, bytes, {
        upsert: true,
        contentType: "image/png",
      });
    if (uploadError) {
      throw new Error(`Production upload failed for ${row.file_path}: ${uploadError.message}`);
    }
    console.log(`  uploaded ${row.file_path}`);
  }

  if (before.screenshots > 0) {
    console.log("\nClearing existing production handbook_screenshots rows …");
    const { error: deleteError } = await production.from("handbook_screenshots").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (deleteError) throw deleteError;
  }

  console.log("\nInserting production handbook_screenshots rows …");
  const { data: inserted, error: insertError } = await production
    .from("handbook_screenshots")
    .insert(
      PRODUCTION_SCREENSHOT_ROWS.map((row) => ({
        section_key: row.section_key,
        file_path: row.file_path,
        caption: null,
        display_order: row.display_order,
      })),
    )
    .select("id, section_key, file_path, display_order");
  if (insertError) throw insertError;

  console.log("\n=== After (production) ===");
  const after = await countRows(production);
  console.log(`handbook_chunks: ${after.chunks}`);
  console.log(`handbook_screenshots: ${after.screenshots}`);
  console.log("Inserted rows:", inserted);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
