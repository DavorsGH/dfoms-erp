// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

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
loadEnvForce(resolve(".env.local.backup"));
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data: tenants } = await admin
  .from("tenants")
  .select("id, name, signature_url")
  .not("signature_url", "is", null)
  .limit(10);
console.log("tenants with signature_url:", (tenants ?? []).map((t) => ({
  id: t.id.slice(0, 8),
  name: t.name,
  sigLen: t.signature_url?.length ?? 0,
})));

const DAVORS = "00000001-0000-4000-8000-000000000001";
const { data: files } = await admin.storage.from("tenant-logos").list(DAVORS);
console.log("davors tenant-logos files:", (files ?? []).map((f) => f.name));

const { count: qCount } = await admin
  .from("client_quotations")
  .select("*", { count: "exact", head: true });
const { count: rCount } = await admin
  .from("client_receipts")
  .select("*", { count: "exact", head: true });
console.log({ quotationCount: qCount, receiptCount: rCount });

const { data: anyQuo } = await admin
  .from("client_quotations")
  .select("id, quotation_number, status")
  .limit(5);
console.log("any quotations:", anyQuo);
}

main().catch(console.error);
