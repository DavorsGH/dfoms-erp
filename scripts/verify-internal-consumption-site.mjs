import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const INTERNAL_CONSUMPTION_SELECT =
  "id, product_id, quantity, consumption_date, reason, recorded_by, notes, created_at, site_id, product:finished_products!product_id(product_code, product_name, unit_of_measure), site:sites!site_id(site_code, site_name, client_id, project_id, client:clients!client_id(client_id, client_name))";

function loadEnvFile(filePath) {
  const contents = readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

function normalizeSite(raw) {
  if (!raw) return null;
  const site = Array.isArray(raw) ? raw[0] ?? null : raw;
  if (!site) return null;
  const client = Array.isArray(site.client) ? site.client[0] ?? null : site.client ?? null;
  return { ...site, client };
}

function buildReportRows(entries, siteId = null) {
  return entries
    .filter((entry) => !siteId || entry.site_id === siteId)
    .map((entry) => ({
      id: entry.id,
      siteId: entry.site_id,
      siteName: entry.site?.site_name ?? "—",
      clientName: entry.site?.client?.client_name ?? "—",
    }));
}

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const { data: columnProbe, error: columnError } = await supabase
    .from("internal_consumption")
    .select("site_id")
    .limit(1);

  if (columnError) {
    throw new Error(
      `internal_consumption.site_id not available (${columnError.message}). Run scripts/42_internal_consumption_site.sql first.`,
    );
  }

  const [{ data: products, error: productsError }, { data: sites, error: sitesError }] =
    await Promise.all([
      supabase
        .from("finished_products")
        .select("id, product_name, current_stock, unit_of_measure")
        .gt("current_stock", 0.01)
        .order("product_name", { ascending: true })
        .limit(1),
      supabase
        .from("sites")
        .select("site_code, site_name, client_id, project_id")
        .not("project_id", "is", null)
        .order("site_name", { ascending: true })
        .limit(1),
    ]);

  if (productsError) throw new Error(productsError.message);
  if (sitesError) throw new Error(sitesError.message);
  if (!products?.length) throw new Error("No finished product with stock available.");
  if (!sites?.length) throw new Error("No site with project_id available.");

  const product = products[0];
  const site = sites[0];
  const today = new Date().toISOString().slice(0, 10);
  const taggedReason = `verify-internal-consumption-site-${Date.now()}`;
  const untaggedReason = `verify-internal-consumption-generic-${Date.now()}`;
  const quantity = Math.min(0.01, Number(product.current_stock));

  console.log(
    `Recording tagged use at ${site.site_name} and untagged use of ${product.product_name}.`,
  );

  const { data: taggedRow, error: taggedError } = await supabase
    .from("internal_consumption")
    .insert({
      product_id: product.id,
      quantity,
      consumption_date: today,
      reason: taggedReason,
      recorded_by: "verify-internal-consumption-site",
      site_id: site.site_code,
    })
    .select("id")
    .single();

  if (taggedError) {
    throw new Error(`Tagged insert failed: ${taggedError.message}`);
  }

  const { data: untaggedRow, error: untaggedError } = await supabase
    .from("internal_consumption")
    .insert({
      product_id: product.id,
      quantity,
      consumption_date: today,
      reason: untaggedReason,
      recorded_by: "verify-internal-consumption-site",
      site_id: null,
    })
    .select("id")
    .single();

  if (untaggedError) {
    throw new Error(`Untagged insert failed: ${untaggedError.message}`);
  }

  const { data: fetchedRows, error: fetchError } = await supabase
    .from("internal_consumption")
    .select(INTERNAL_CONSUMPTION_SELECT)
    .in("id", [taggedRow.id, untaggedRow.id]);

  if (fetchError) throw new Error(fetchError.message);
  if ((fetchedRows ?? []).length !== 2) {
    throw new Error(`Expected 2 rows, found ${fetchedRows?.length ?? 0}.`);
  }

  const normalized = (fetchedRows ?? []).map((row) => ({
    ...row,
    site: normalizeSite(row.site),
  }));

  const tagged = normalized.find((row) => row.id === taggedRow.id);
  const untagged = normalized.find((row) => row.id === untaggedRow.id);

  if (!tagged?.site_id || tagged.site_id !== site.site_code) {
    throw new Error("Tagged entry did not persist site_id.");
  }
  if (untagged?.site_id) {
    throw new Error("Untagged entry should have null site_id.");
  }
  if (tagged.site?.site_name !== site.site_name) {
    throw new Error("Tagged entry site join did not resolve site name.");
  }
  if (!tagged.site?.client?.client_name) {
    throw new Error("Tagged entry client was not derived from site.");
  }
  if (untagged.site) {
    throw new Error("Untagged entry should not have a site relation.");
  }

  const allRows = buildReportRows(normalized);
  const siteFiltered = buildReportRows(normalized, site.site_code);

  if (allRows.length !== 2) {
    throw new Error(`All-rows report expected 2, got ${allRows.length}.`);
  }
  if (siteFiltered.length !== 1 || siteFiltered[0].id !== taggedRow.id) {
    throw new Error("Site filter did not isolate the tagged entry.");
  }

  const taggedReport = allRows.find((row) => row.id === taggedRow.id);
  const untaggedReport = allRows.find((row) => row.id === untaggedRow.id);

  if (taggedReport?.siteName === "—" || taggedReport?.clientName === "—") {
    throw new Error("Tagged entry report columns should show site and client.");
  }
  if (untaggedReport?.siteName !== "—" || untaggedReport?.clientName !== "—") {
    throw new Error("Untagged entry report columns should be blank.");
  }

  console.log("PASS: Tagged and untagged internal consumption saved.");
  console.log("PASS: Site and client derived from site_id for tagged entry.");
  console.log("PASS: Report shows site/client for tagged, blank for untagged.");
  console.log("PASS: Site filter isolates tagged entry.");
  console.log(`Tagged entry: ${taggedRow.id} (${site.site_name})`);
  console.log(`Untagged entry: ${untaggedRow.id}`);
}

main().catch((error) => {
  console.error(`\nVERIFY FAILED: ${error.message}`);
  process.exit(1);
});
