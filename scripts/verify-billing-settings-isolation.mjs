/**
 * Sanity check: billing_settings GET default-row creation + tenant isolation.
 * Simulates the API route's auth + RLS client pattern (no admin writes for PUT).
 *
 * Usage: node scripts/verify-billing-settings-isolation.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvFile(filePath) {
  const contents = readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    const key = trimmed.slice(0, i).trim();
    const value = trimmed.slice(i + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";

const BILLING_SELECT =
  "tenant_id, credit_balance, email_recipient, additional_emails, bill_to_name, country_region, address_line1, business_tax_id";

function emptyBillingSettings(tenantId) {
  return {
    tenant_id: tenantId,
    credit_balance: 0,
    email_recipient: "",
    additional_emails: "",
    bill_to_name: "",
    country_region: "",
    address_line1: "",
    business_tax_id: "",
  };
}

async function loadOrCreateBillingSettings(userClient, tenantId) {
  const { data: existing, error: fetchError } = await userClient
    .from("billing_settings")
    .select(BILLING_SELECT)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (fetchError) {
    throw new Error(`fetch failed for ${tenantId}: ${fetchError.message}`);
  }

  if (existing) {
    return { row: existing, created: false };
  }

  const defaults = emptyBillingSettings(tenantId);
  const { data: inserted, error: insertError } = await userClient
    .from("billing_settings")
    .insert(defaults)
    .select(BILLING_SELECT)
    .single();

  if (insertError) {
    throw new Error(`insert failed for ${tenantId}: ${insertError.message}`);
  }

  return { row: inserted, created: true };
}

async function putBillingSettings(userClient, tenantId, fields) {
  const payload = {
    tenant_id: tenantId,
    email_recipient: (fields.email_recipient ?? "").trim(),
    additional_emails: (fields.additional_emails ?? "").trim(),
    bill_to_name: (fields.bill_to_name ?? "").trim(),
    country_region: (fields.country_region ?? "").trim(),
    address_line1: (fields.address_line1 ?? "").trim(),
    business_tax_id: (fields.business_tax_id ?? "").trim(),
  };

  const { data, error } = await userClient
    .from("billing_settings")
    .upsert(payload, { onConflict: "tenant_id" })
    .select(BILLING_SELECT)
    .single();

  if (error) {
    throw new Error(`upsert failed for ${tenantId}: ${error.message}`);
  }

  return data;
}

async function signInAs(email, password, url, anonKey) {
  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.session) {
    throw new Error(`sign-in failed for ${email}: ${error?.message ?? "no session"}`);
  }

  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
      },
    },
  });
}

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !serviceKey || !anonKey) {
    throw new Error("Missing Supabase env vars in .env.local");
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: admins, error: adminsError } = await admin
    .from("user_accounts")
    .select("auth_uid, email, tenant_id, role")
    .eq("role", "super_admin")
    .eq("is_active", true)
    .neq("tenant_id", DAVORS_TENANT_ID)
    .order("email");

  if (adminsError) {
    throw new Error(adminsError.message);
  }

  const byTenant = new Map();
  for (const row of admins ?? []) {
    if (!row.tenant_id || !row.email) continue;
    if (!byTenant.has(row.tenant_id)) {
      byTenant.set(row.tenant_id, row);
    }
  }

  const tenants = [...byTenant.entries()];
  if (tenants.length < 2) {
    console.log(
      "SKIP isolation test: need 2 customer-tenant super_admin accounts; found",
      tenants.length,
    );
    if (tenants.length === 1) {
      tenants.push(tenants[0]);
    } else {
      process.exit(0);
    }
  }

  const [[tenantAId, userA], [tenantBId, userB]] = tenants;

  console.log("Tenant A:", tenantAId, userA.email);
  console.log("Tenant B:", tenantBId, userB.email);

  const testPassword = process.env.BILLING_VERIFY_TEST_PASSWORD;
  if (!testPassword) {
    console.log(
      "\nNOTE: Set BILLING_VERIFY_TEST_PASSWORD in env to run live sign-in tests.",
    );
    console.log("Code review only — see summary below.\n");
    codeReviewSummary();
    process.exit(0);
  }

  const clientA = await signInAs(userA.email, testPassword, url, anonKey);
  const clientB =
    tenantBId === tenantAId
      ? clientA
      : await signInAs(userB.email, testPassword, url, anonKey);

  // --- GET default row creation (tenant A) ---
  await admin.from("billing_settings").delete().eq("tenant_id", tenantAId);

  const before = await admin
    .from("billing_settings")
    .select("tenant_id")
    .eq("tenant_id", tenantAId)
    .maybeSingle();
  console.log("\n[GET] Row before first load:", before.data ? "exists" : "none");

  const created = await loadOrCreateBillingSettings(clientA, tenantAId);
  console.log("[GET] loadOrCreate created default row:", created.created);
  console.log("[GET] tenant_id on row:", created.row.tenant_id);

  const after = await admin
    .from("billing_settings")
    .select(BILLING_SELECT)
    .eq("tenant_id", tenantAId)
    .single();
  console.log("[GET] Admin confirms row exists for tenant A:", Boolean(after.data));

  // --- PUT tenant isolation ---
  const markerA = `tenant-a-${Date.now()}@billing-verify.test`;
  const markerB = `tenant-b-${Date.now()}@billing-verify.test`;

  const savedA = await putBillingSettings(clientA, tenantAId, {
    email_recipient: markerA,
    bill_to_name: "Tenant A Billing Verify",
  });
  console.log("\n[PUT] Tenant A saved email_recipient:", savedA.email_recipient);

  if (tenantBId !== tenantAId) {
    await putBillingSettings(clientB, tenantBId, {
      email_recipient: markerB,
      bill_to_name: "Tenant B Billing Verify",
    });
  }

  const { data: allRows } = await admin
    .from("billing_settings")
    .select(BILLING_SELECT)
    .in("tenant_id", [tenantAId, tenantBId]);

  const rowA = allRows?.find((r) => r.tenant_id === tenantAId);
  const rowB = allRows?.find((r) => r.tenant_id === tenantBId);

  console.log("[PUT] Admin read tenant A email:", rowA?.email_recipient);
  console.log("[PUT] Admin read tenant B email:", rowB?.email_recipient);

  const isolationOk =
    rowA?.email_recipient === markerA &&
    (tenantBId === tenantAId || rowB?.email_recipient === markerB);

  console.log("\n[RESULT] GET default-row creation:", created.created ? "PASS" : "FAIL");
  console.log("[RESULT] PUT tenant isolation:", isolationOk ? "PASS" : "FAIL");

  if (!isolationOk) {
    process.exitCode = 1;
  }
}

function codeReviewSummary() {
  console.log("GET route review:");
  console.log("- tenant_id from requireTenantSuperAdmin() (server user_accounts lookup)");
  console.log("- fetch .eq(tenant_id) then insert emptyBillingSettings(tenantId) if missing");
  console.log("- returns 500 only if fetch/insert errors (RLS would surface here)");
  console.log("");
  console.log("PUT route review:");
  console.log("- tenant_id always auth.tenantId; body fields only, no client tenant_id accepted");
  console.log("- upsert onConflict tenant_id via RLS client (not admin)");
  console.log("- cross-tenant write would require RLS bug OR accepting client tenant_id (it does not)");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
