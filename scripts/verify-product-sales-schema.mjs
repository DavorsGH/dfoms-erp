import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

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

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const serviceSelect =
    "*, client:clients!client_id(client_id, client_name)";
  const productSelect =
    "*, client:clients!client_id(client_id, client_name), product:finished_products!product_id(product_code, product_name, unit_of_measure, standard_selling_price)";

  const [
    { error: serviceError },
    { error: productError },
    { error: receivableError },
  ] = await Promise.all([
    supabase
      .from("income_register")
      .select(serviceSelect)
      .or("entry_type.eq.service,entry_type.is.null")
      .limit(1),
    supabase
      .from("income_register")
      .select(productSelect)
      .eq("entry_type", "product_sale")
      .limit(1),
    supabase.from("income_register").select(serviceSelect).limit(1),
  ]);

  if (serviceError) {
    throw new Error(`Income Register service query failed: ${serviceError.message}`);
  }

  if (productError) {
    throw new Error(`Product Sales join query failed: ${productError.message}`);
  }

  if (receivableError) {
    throw new Error(`AR receivables query failed: ${receivableError.message}`);
  }

  console.log("Schema relationship checks passed.");
  console.log("- Income Register (service-only select): OK");
  console.log("- Product Sales (finished_products join): OK");
  console.log("- Accounts Receivable select: OK");
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
