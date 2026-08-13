/**
 * One-time production backfill: tenants.email/phone from super_admin + employee.
 *
 *   npx tsx scripts/backfill-tenant-workspace-contact-production.ts --env-file .env.local.backup
 *   npx tsx scripts/backfill-tenant-workspace-contact-production.ts --env-file .env.local.backup --execute
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildSignupWorkspaceContactPatch,
  resolveWorkspaceContactEmail,
} from "../utils/workspace-contact-utils";
import {
  DAVORS_TENANT_ID,
  ERP_SUITE_SIGNUP_SOURCE,
} from "../utils/tenant-signup";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";

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

function envFileFromArgs() {
  const idx = process.argv.indexOf("--env-file");
  return idx >= 0 ? process.argv[idx + 1] : ".env.local.backup";
}

const execute = process.argv.includes("--execute");

async function resolveSuperAdminEmail(admin, account) {
  const accountEmail = resolveWorkspaceContactEmail(account.email);
  if (accountEmail) return accountEmail;

  const { data, error } = await admin.auth.admin.getUserById(account.auth_uid);
  if (error) {
    return null;
  }
  return resolveWorkspaceContactEmail(data.user?.email);
}

async function main() {
  const envFile = envFileFromArgs();
  loadEnvForce(resolve(envFile));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url.includes(PRODUCTION_REF)) {
    throw new Error(`Refusing non-production URL from ${envFile}`);
  }
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  const admin = createClient(url, key, { auth: { persistSession: false } });

  const { data: nullEmailTenants, error: tenantsError } = await admin
    .from("tenants")
    .select("id, name, slug, email, phone, created_at")
    .is("email", null)
    .order("created_at", { ascending: true });

  if (tenantsError) throw tenantsError;

  const { data: organicSubscriptions, error: organicError } = await admin
    .from("crm_subscriptions")
    .select(
      "linked_tenant_id, customer:customers!crm_subscriptions_customer_id_fkey(source, client_name)",
    )
    .not("linked_tenant_id", "is", null);

  if (organicError) throw organicError;

  const organicTenantIds = new Set(
    (organicSubscriptions ?? [])
      .filter((sub) => {
        const customer = Array.isArray(sub.customer) ? sub.customer[0] : sub.customer;
        return customer?.source === ERP_SUITE_SIGNUP_SOURCE;
      })
      .map((sub) => sub.linked_tenant_id)
      .filter(Boolean),
  );

  const candidates = [];

  for (const tenant of nullEmailTenants ?? []) {
    const { data: superAdmins, error: adminError } = await admin
      .from("user_accounts")
      .select("auth_uid, email, employee_id, is_active")
      .eq("tenant_id", tenant.id)
      .eq("role", "super_admin")
      .order("is_active", { ascending: false });

    if (adminError) throw adminError;

    const activeSuperAdmin =
      (superAdmins ?? []).find((row) => row.is_active) ?? superAdmins?.[0] ?? null;

    if (!activeSuperAdmin) {
      candidates.push({
        tenant_id: tenant.id,
        tenant_name: tenant.name,
        organic_signup: organicTenantIds.has(tenant.id),
        resolvable: false,
        skip_reason: "no super_admin user_accounts row",
        will_set_email: null,
        will_set_phone: null,
        current_phone: tenant.phone,
      });
      continue;
    }

    const adminEmail = await resolveSuperAdminEmail(admin, activeSuperAdmin);
    if (!adminEmail) {
      candidates.push({
        tenant_id: tenant.id,
        tenant_name: tenant.name,
        organic_signup: organicTenantIds.has(tenant.id),
        resolvable: false,
        skip_reason: "super_admin has no resolvable auth email",
        will_set_email: null,
        will_set_phone: null,
        current_phone: tenant.phone,
      });
      continue;
    }

    let employeeContact = null;
    if (activeSuperAdmin.employee_id) {
      const { data: employee, error: employeeError } = await admin
        .from("employees")
        .select("phone, momo_number")
        .eq("tenant_id", tenant.id)
        .eq("employee_id", activeSuperAdmin.employee_id)
        .maybeSingle();

      if (employeeError) throw employeeError;
      employeeContact = employee;
    }

    const patch = buildSignupWorkspaceContactPatch(adminEmail, employeeContact);
    const willSetPhone =
      !tenant.phone?.trim() && patch.phone ? patch.phone : null;

    candidates.push({
      tenant_id: tenant.id,
      tenant_name: tenant.name,
      organic_signup: organicTenantIds.has(tenant.id),
      resolvable: true,
      skip_reason: null,
      super_admin_email: adminEmail,
      will_set_email: patch.email,
      will_set_phone: willSetPhone,
      current_phone: tenant.phone,
      employee_id: activeSuperAdmin.employee_id ?? null,
    });
  }

  const toBackfill = candidates.filter((row) => row.resolvable);

  console.log(
    JSON.stringify(
      {
        mode: execute ? "execute" : "dry_run",
        environment: "production",
        supabase_ref: PRODUCTION_REF,
        scanned_null_email_tenants: (nullEmailTenants ?? []).length,
        resolvable_count: toBackfill.length,
        skipped_count: candidates.length - toBackfill.length,
        candidates,
        to_backfill: toBackfill.map((row) => ({
          tenant_id: row.tenant_id,
          tenant_name: row.tenant_name,
          organic_signup: row.organic_signup,
          will_set_email: row.will_set_email,
          will_set_phone: row.will_set_phone,
        })),
      },
      null,
      2,
    ),
  );

  if (!execute) {
    console.error("\nDry run only. Re-run with --execute to apply updates.");
    return;
  }

  const results = [];
  for (const row of toBackfill) {
    const updatePayload = { email: row.will_set_email };
    if (row.will_set_phone) {
      updatePayload.phone = row.will_set_phone;
    }

    const { error: updateError } = await admin
      .from("tenants")
      .update(updatePayload)
      .eq("id", row.tenant_id)
      .is("email", null);

    if (updateError) {
      results.push({
        tenant_id: row.tenant_id,
        tenant_name: row.tenant_name,
        status: "error",
        error: updateError.message,
      });
      continue;
    }

    results.push({
      tenant_id: row.tenant_id,
      tenant_name: row.tenant_name,
      status: "updated",
      email: row.will_set_email,
      phone: row.will_set_phone,
    });
  }

  const { data: remainingOrganicNullEmail } = await admin
    .from("tenants")
    .select("id, name, email")
    .is("email", null)
    .in("id", [...organicTenantIds]);

  const remainingResolvable = [];
  for (const tenant of remainingOrganicNullEmail ?? []) {
    const { data: superAdmins } = await admin
      .from("user_accounts")
      .select("auth_uid, email, is_active")
      .eq("tenant_id", tenant.id)
      .eq("role", "super_admin");

    const activeSuperAdmin =
      (superAdmins ?? []).find((row) => row.is_active) ?? superAdmins?.[0] ?? null;
    if (!activeSuperAdmin) continue;

    const adminEmail = await resolveSuperAdminEmail(admin, activeSuperAdmin);
    if (adminEmail) {
      remainingResolvable.push({
        tenant_id: tenant.id,
        tenant_name: tenant.name,
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        execution_results: results,
        post_check: {
          organic_null_email_remaining: (remainingOrganicNullEmail ?? []).length,
          organic_null_email_with_resolvable_admin_remaining:
            remainingResolvable.length,
          remaining_organic_null_email_tenants: remainingOrganicNullEmail ?? [],
          remaining_organic_resolvable: remainingResolvable,
        },
      },
      null,
      2,
    ),
  );

  if (remainingResolvable.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
