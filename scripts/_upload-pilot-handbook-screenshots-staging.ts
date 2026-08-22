/**
 * Upload pilot handbook screenshots to staging.
 *
 * Usage:
 *   npx tsx scripts/_upload-pilot-handbook-screenshots-staging.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  getHandbookScreenshotStoragePath,
  HANDBOOK_SCREENSHOTS_BUCKET,
} from "../utils/handbook-screenshots-paths";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PILOT_DIR = resolve(process.cwd(), "scripts/_pilot-screenshots");

const EXPECTED_FILES = [
  "7_7-quotations-list.png",
  "7_2-product-sales-record-payment.png",
  "6_2-expense-register-add.png",
  "6_8-client-invoice-create.png",
  "5_1-dashboard-overview.png",
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

function parseSectionKey(filename: string): string {
  const stem = filename.replace(/\.png$/i, "");
  const prefix = stem.split("-")[0] ?? stem;
  return prefix.replace(/_/g, ".");
}

async function main() {
  loadEnvForce(resolve(".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url.includes(STAGING_REF) || !serviceKey) {
    throw new Error("Expected staging credentials in .env.staging.local");
  }

  const found = readdirSync(PILOT_DIR)
    .filter((name) => name.toLowerCase().endsWith(".png"))
    .sort();
  const missing = EXPECTED_FILES.filter((name) => !found.includes(name));
  const extra = found.filter(
    (name) => !EXPECTED_FILES.includes(name as (typeof EXPECTED_FILES)[number]),
  );

  if (missing.length || extra.length || found.length !== EXPECTED_FILES.length) {
    throw new Error(
      `Expected exactly ${EXPECTED_FILES.length} pilot PNGs.\n` +
        `Missing: ${missing.join(", ") || "none"}\n` +
        `Extra: ${extra.join(", ") || "none"}\n` +
        `Found (${found.length}): ${found.join(", ")}`,
    );
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const inserted: Array<{ id: string; section_key: string; file_path: string; source: string }> =
    [];

  for (const filename of EXPECTED_FILES) {
    const sectionKey = parseSectionKey(filename);
    const filePath = getHandbookScreenshotStoragePath(sectionKey);
    const bytes = readFileSync(join(PILOT_DIR, filename));

    const { error: uploadError } = await admin.storage
      .from(HANDBOOK_SCREENSHOTS_BUCKET)
      .upload(filePath, bytes, {
      upsert: false,
      contentType: "image/png",
    });
    if (uploadError) {
      throw new Error(`Upload failed for ${filename}: ${uploadError.message}`);
    }

    const { data: row, error: insertError } = await admin
      .from("handbook_screenshots")
      .insert({
        section_key: sectionKey,
        file_path: filePath,
        caption: null,
        display_order: 0,
      })
      .select("id, section_key, file_path")
      .single();

    if (insertError || !row) {
      throw new Error(`Insert failed for ${filename}: ${insertError?.message ?? "no row"}`);
    }

    inserted.push({ ...row, source: filename });
  }

  console.log("\n=== Pilot handbook screenshots uploaded (staging) ===\n");
  for (const row of inserted) {
    console.log(`${row.source}`);
    console.log(`  id:          ${row.id}`);
    console.log(`  section_key: ${row.section_key}`);
    console.log(`  file_path:   ${row.file_path}\n`);
  }
  console.log(`Total inserted: ${inserted.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
