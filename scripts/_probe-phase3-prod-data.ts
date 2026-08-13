// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const DAVORS = "00000001-0000-4000-8000-000000000001";

for (const line of readFileSync(resolve(".env.local.backup"), "utf8").split(/\r?\n/)) {
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

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

async function main() {
  const ref = (process.env.NEXT_PUBLIC_SUPABASE_URL.match(/https?:\/\/([^.]+)\.supabase\.co/) || [])[1];
  console.log("ref", ref);

  const { data: tenants, error: tenantsErr } = await admin
    .from("tenants")
    .select("id, name, status, product_line")
    .limit(30);
  console.log("tenants sample", tenantsErr?.message, tenants);

  const { data: reTenants } = await admin
    .from("tenants")
    .select("id, name, product_line")
    .eq("product_line", "real_estate_only");
  console.log("real_estate_only tenants", reTenants);

  const { data: lessees } = await admin
    .from("lessees")
    .select("tenant_id, lessee_id, full_name, email")
    .limit(5);
  console.log("lessees", lessees);

  const { data: properties } = await admin
    .from("properties")
    .select("tenant_id, property_id, name")
    .limit(5);
  console.log("properties", properties);

  const { count: rentCount } = await admin
    .from("rent_ledger")
    .select("*", { count: "exact", head: true });
  console.log("rent_ledger total count", rentCount);

  const { count: leaseCount } = await admin
    .from("leases")
    .select("*", { count: "exact", head: true });
  console.log("leases total count", leaseCount);

  const { count: depositCount } = await admin
    .from("security_deposits")
    .select("*", { count: "exact", head: true });
  console.log("security_deposits total count", depositCount);
}

main().catch(console.error);
