import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnv(filePath: string) {
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

async function main() {
  let envFile = ".env.local";
  const idx = process.argv.indexOf("--env-file");
  if (idx >= 0 && process.argv[idx + 1]) envFile = process.argv[idx + 1]!;
  loadEnv(resolve(envFile));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error("Missing Supabase env");
  }

  const admin = createClient(url, key, { auth: { persistSession: false } });

  const { data: tenants, error: tenantsError } = await admin
    .from("tenants")
    .select("id, name")
    .order("name");
  if (tenantsError) throw tenantsError;

  const { data: buRows, error: buError } = await admin
    .from("business_units")
    .select("id, tenant_id, name");
  if (buError) throw buError;

  const buCountByTenant = new Map<string, number>();
  for (const row of buRows ?? []) {
    const tid = String(row.tenant_id);
    buCountByTenant.set(tid, (buCountByTenant.get(tid) ?? 0) + 1);
  }

  const { data: sales, error: salesError } = await admin
    .from("income_register")
    .select("tenant_id, business_unit_id")
    .eq("entry_type", "product_sale")
    .eq("is_sale_return", false);
  if (salesError) throw salesError;

  type Agg = {
    tenantName: string;
    businessUnitCount: number;
    productSaleRows: number;
    nullBuProductSales: number;
    nullBuWithBuConfigured: number;
  };

  const byTenant = new Map<string, Agg>();
  for (const tenant of tenants ?? []) {
    byTenant.set(String(tenant.id), {
      tenantName: String(tenant.name ?? tenant.id),
      businessUnitCount: buCountByTenant.get(String(tenant.id)) ?? 0,
      productSaleRows: 0,
      nullBuProductSales: 0,
      nullBuWithBuConfigured: 0,
    });
  }

  for (const row of sales ?? []) {
    const tid = String(row.tenant_id);
    const agg = byTenant.get(tid);
    if (!agg) continue;
    agg.productSaleRows += 1;
    if (row.business_unit_id == null) {
      agg.nullBuProductSales += 1;
      if (agg.businessUnitCount > 0) {
        agg.nullBuWithBuConfigured += 1;
      }
    }
  }

  const rows = [...byTenant.values()]
    .filter(
      (row) => row.nullBuProductSales > 0 || row.businessUnitCount === 0,
    )
    .sort((a, b) => b.nullBuProductSales - a.nullBuProductSales);

  console.log(JSON.stringify({ urlHost: new URL(url).host, rows }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
