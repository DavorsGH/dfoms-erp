/**
 * One-off: fix client-invoice screenshot section_key on staging (6.8 -> 6.7).
 *   npx tsx scripts/_fix-client-invoice-screenshot-section-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const ROW_ID = "61f1aae4-9dfd-4bd3-a9ad-f668ca7e653d";

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

async function main() {
  loadEnvForce(resolve(".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url.includes(STAGING_REF) || !serviceKey) {
    throw new Error("Expected staging credentials in .env.staging.local");
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: before, error: beforeError } = await admin
    .from("handbook_screenshots")
    .select("id, section_key, file_path")
    .eq("id", ROW_ID)
    .single();
  if (beforeError) throw beforeError;
  console.log("Before:", before);

  const { data: after, error } = await admin
    .from("handbook_screenshots")
    .update({ section_key: "6.7" })
    .eq("id", ROW_ID)
    .select("id, section_key, file_path")
    .single();
  if (error) throw error;
  console.log("After:", after);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
