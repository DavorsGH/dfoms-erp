/**
 * Staging: fixed_assets.asset_id via generate_next_code('ASSET') for Davors + Caanta.
 * Usage: node scripts/test-asset-id-staging.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const DAVORS = "00000001-0000-4000-8000-000000000001";
const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";

function loadEnvForce(filePath) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

loadEnvForce(resolve(process.cwd(), ".env.staging.local"));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
assert(supabaseUrl && serviceRoleKey, "Missing staging env");
assert(supabaseUrl.includes("wieflwbfdmjtsdnwbfii"), "Refusing non-staging");

const uiSource = readFileSync(
  resolve("app/dashboard/finance/fixed-assets.tsx"),
  "utf8",
);
const apiSource = readFileSync(
  resolve("app/dashboard/finance/asset-id-api.ts"),
  "utf8",
);
assert(uiSource.includes("allocateAssetId"), "fixed-assets.tsx missing allocateAssetId");
assert(!uiSource.includes("generateNextAssetId"), "UI still uses generateNextAssetId");
assert(apiSource.includes('"ASSET"'), "asset-id-api missing ASSET entity");

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function snapshot(tenantId) {
  const { data, error } = await supabase
    .from("fixed_assets")
    .select("asset_id, asset_name, purchase_date, original_cost")
    .eq("tenant_id", tenantId)
    .order("asset_id");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ ...row }));
}

const beforeDavors = await snapshot(DAVORS);
const beforeCaanta = await snapshot(CAANTA);
console.log("Before Davors assets:", beforeDavors.length);
console.log("Before Caanta assets:", beforeCaanta.length);
assert(beforeDavors.length === 19, `Expected 19 Davors assets, got ${beforeDavors.length}`);

const tag = `ASSET-${Date.now().toString(36).toUpperCase()}`;

async function createAsset(tenantId, expectedPrefix) {
  const { data: assetId, error: codeError } = await supabase.rpc(
    "generate_next_code",
    { p_tenant_id: tenantId, p_entity_type: "ASSET", p_padding: 4 },
  );
  if (codeError || !assetId) {
    throw new Error(codeError?.message ?? "ASSET allocate failed");
  }
  assert(
    new RegExp(`^${expectedPrefix}-ASSET-\\d{4}$`).test(assetId),
    `Expected ${expectedPrefix}-ASSET-####, got ${assetId}`,
  );
  assert(!/^DF\d{4}$/i.test(assetId), `Got legacy DF#### format: ${assetId}`);

  const { data, error } = await supabase
    .from("fixed_assets")
    .insert({
      tenant_id: tenantId,
      asset_id: assetId,
      asset_name: `${tag} ${expectedPrefix}`,
      purchase_date: new Date().toISOString().slice(0, 10),
      original_cost: 1,
      quantity: 1,
      total_cost: 1,
      useful_life_years: 5,
      depreciation_method: "Straight-Line",
      notes: "STAGING TEST — generate_next_code ASSET",
    })
    .select("asset_id, asset_name, tenant_id")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

const davorsAsset = await createAsset(DAVORS, "DF");
const caantaAsset = await createAsset(CAANTA, "CAN");
console.log("Inserted Davors:", davorsAsset);
console.log("Inserted Caanta:", caantaAsset);

const afterDavors = await snapshot(DAVORS);
const afterCaanta = await snapshot(CAANTA);

for (const prior of beforeDavors) {
  const match = afterDavors.find((row) => row.asset_id === prior.asset_id);
  assert(match, `Missing prior Davors asset ${prior.asset_id}`);
  assert(
    match.asset_name === prior.asset_name &&
      match.purchase_date === prior.purchase_date &&
      Number(match.original_cost) === Number(prior.original_cost),
    `Prior Davors asset ${prior.asset_id} changed`,
  );
}

for (const prior of beforeCaanta) {
  const match = afterCaanta.find((row) => row.asset_id === prior.asset_id);
  assert(match, `Missing prior Caanta asset ${prior.asset_id}`);
}

const seq = await supabase
  .from("id_sequences")
  .select("tenant_id, entity_type, next_value")
  .eq("entity_type", "ASSET")
  .in("tenant_id", [DAVORS, CAANTA]);
if (seq.error) throw new Error(seq.error.message);

console.log("id_sequences ASSET:", seq.data);
console.log("SUCCESS:", {
  davors_asset_id: davorsAsset.asset_id,
  caanta_asset_id: caantaAsset.asset_id,
  prior_davors_unchanged: beforeDavors.length,
});
