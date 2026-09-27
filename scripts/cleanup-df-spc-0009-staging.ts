// @ts-nocheck
/**
 * Staging-only: remove Ghana Beverages test contract DF-SPC-0009 if present.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const CONTRACT_NUMBER = "DF-SPC-0009";

function loadEnv(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    process.env[t.slice(0, i).trim()] = v;
  }
}

async function main() {
  loadEnv(resolve(process.cwd(), ".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const ref = url.match(/https:\/\/([^.]+)\./)?.[1] ?? "";
  if (ref !== STAGING_REF) {
    throw new Error(`Refusing: not staging (ref=${ref})`);
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: contract, error: findError } = await admin
    .from("supplier_contracts")
    .select("id, tenant_id, contract_number, notes")
    .eq("contract_number", CONTRACT_NUMBER)
    .maybeSingle();

  if (findError) throw new Error(findError.message);
  if (!contract?.id) {
    console.log(`No contract ${CONTRACT_NUMBER} found — nothing to do.`);
    return;
  }

  const tenantId = contract.tenant_id;
  console.log(`Found ${CONTRACT_NUMBER} (${contract.id}) tenant=${tenantId}`);

  await admin.from("supplier_contract_deductions").delete().eq("contract_id", contract.id);

  const { data: aps } = await admin
    .from("accounts_payable")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("source_id", contract.id);

  for (const ap of aps ?? []) {
    const { error } = await admin.rpc("delete_accounts_payable", {
      p_tenant_id: tenantId,
      p_ap_id: ap.id,
    });
    if (error) throw new Error(error.message);
    console.log(`Deleted AP ${ap.id}`);
  }

  await admin.from("supplier_contract_amendments").delete().eq("contract_id", contract.id);
  const { error: delError } = await admin
    .from("supplier_contracts")
    .delete()
    .eq("id", contract.id);
  if (delError) throw new Error(delError.message);

  console.log(`Removed contract ${CONTRACT_NUMBER}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
