// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const DAVORS = "00000001-0000-4000-8000-000000000001";
const TEST_SIGNATURE_PATHS = [
  `${DAVORS}/signature.png`,
  `${DAVORS}/signature.jpg`,
];

function loadEnvForce(filePath) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    let value = trimmed.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[trimmed.slice(0, i).trim()] = value;
  }
}

async function main() {
  loadEnvForce(resolve(".env.local"));
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data: tenant } = await admin
    .from("tenants")
    .select("signature_url")
    .eq("id", DAVORS)
    .maybeSingle();

  if (!TEST_SIGNATURE_PATHS.includes(tenant?.signature_url?.trim() ?? "")) {
    console.log("Staging signature was not a Phase 1 test seed; leaving unchanged.");
    return;
  }

  await admin.storage.from("tenant-logos").remove(TEST_SIGNATURE_PATHS);
  await admin
    .from("tenants")
    .update({ signature_url: null, updated_at: new Date().toISOString() })
    .eq("id", DAVORS);

  console.log("Reverted Phase 1 test signature seed on staging.");
}

main().catch(console.error);
