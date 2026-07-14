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

const TEST_PASSWORD = "TestRbac1!";

async function signIn(url, anonKey, email) {
  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email,
    password: TEST_PASSWORD,
  });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return client;
}

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey || !serviceKey) {
    throw new Error("Missing Supabase env vars");
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const checks = [];

  const { data: clientAccount } = await admin
    .from("user_accounts")
    .select("client_id, role, email")
    .eq("email", "rbac.client@test.davors")
    .single();

  checks.push({
    name: "rbac.client@test.davors linked to client",
    ok: clientAccount?.role === "client" && !!clientAccount?.client_id,
    detail: JSON.stringify(clientAccount),
  });

  const client = await signIn(url, anonKey, "rbac.client@test.davors");
  const finance = await signIn(url, anonKey, "rbac.finance@test.davors");

  const { data: clientInvoices, error: invoiceError } = await client
    .from("income_register")
    .select("id, client_id, entry_type")
    .eq("entry_type", "service");

  const { count: financeInvoiceCount } = await finance
    .from("income_register")
    .select("id", { count: "exact", head: true });

  const allClientIds = [
    ...new Set((clientInvoices ?? []).map((row) => row.client_id).filter(Boolean)),
  ];

  checks.push({
    name: "client income_register scoped to own client_id",
    ok:
      !invoiceError &&
      allClientIds.length <= 1 &&
      (allClientIds.length === 0 ||
        allClientIds[0] === clientAccount?.client_id),
    detail: invoiceError?.message ?? JSON.stringify({
      rows: clientInvoices?.length ?? 0,
      clientIds: allClientIds,
      financeTotal: financeInvoiceCount ?? 0,
    }),
  });

  const { data: clientSites, error: sitesError } = await client
    .from("sites")
    .select("site_code, client_id");

  const allSiteClientIds = [
    ...new Set((clientSites ?? []).map((row) => row.client_id).filter(Boolean)),
  ];

  checks.push({
    name: "client sites scoped to own client_id",
    ok:
      !sitesError &&
      allSiteClientIds.length <= 1 &&
      (allSiteClientIds.length === 0 ||
        allSiteClientIds[0] === clientAccount?.client_id),
    detail: sitesError?.message ?? `${clientSites?.length ?? 0} sites`,
  });

  const { data: productSales } = await client
    .from("income_register")
    .select("id")
    .eq("entry_type", "product_sale")
    .limit(1);

  checks.push({
    name: "client blocked from product_sale income entries",
    ok: (productSales?.length ?? 0) === 0,
    detail: `${productSales?.length ?? 0} rows`,
  });

  const { data: david } = await admin
    .from("user_accounts")
    .select("role, employee_id, is_active")
    .eq("email", "david.avors@gmail.com")
    .single();

  checks.push({
    name: "david unchanged",
    ok:
      david?.role === "super_admin" &&
      david?.employee_id === "EMP0001" &&
      david?.is_active === true,
    detail: JSON.stringify(david),
  });

  console.log(JSON.stringify(checks, null, 2));

  if (checks.some((check) => !check.ok)) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
