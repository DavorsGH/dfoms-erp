/**
 * Read-only audit of the newest organic ERP signup tenant (production).
 *
 *   npx tsx scripts/probe-newest-organic-tenant-production.ts --env-file .env.local.backup
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const ERP_SUITE_SIGNUP_SOURCE = "erp_suite_signup";
const CANONICAL_PAYMENT_METHODS = [
  "Bank Transfer",
  "Cash",
  "Cheque",
  "Credit",
  "Mobile Money",
  "POS",
];

function loadEnvForce(filePath: string) {
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

  const { data: subscriptions, error: subErr } = await admin
    .from("crm_subscriptions")
    .select(
      "id, linked_tenant_id, subscription_status, trial_end_date, created_at, customer:customers!crm_subscriptions_customer_id_fkey(client_id, client_name, source, tenant_id)",
    )
    .not("linked_tenant_id", "is", null)
    .order("created_at", { ascending: false });

  if (subErr) throw subErr;

  const organicSubs = (subscriptions ?? []).filter((sub) => {
    const customer = Array.isArray(sub.customer) ? sub.customer[0] : sub.customer;
    if (!customer || customer.tenant_id !== DAVORS) return false;
    if (customer.source !== ERP_SUITE_SIGNUP_SOURCE) return false;
    const tenantId = sub.linked_tenant_id;
    if (!tenantId || tenantId === DAVORS) return false;
    const name = (customer.client_name ?? "").toLowerCase();
    if (name.includes("paystack live test")) return false;
    if (name.includes("live test co")) return false;
    if (name.includes("test tenant")) return false;
    return true;
  });

  if (organicSubs.length === 0) {
    throw new Error("No organic signup subscriptions found");
  }

  const newest = organicSubs[0];
  const tenantId = newest.linked_tenant_id;
  const customer = Array.isArray(newest.customer)
    ? newest.customer[0]
    : newest.customer;

  const { data: tenant, error: tenantErr } = await admin
    .from("tenants")
    .select(
      "id, name, slug, status, logo_url, address, phone, email, created_at, updated_at",
    )
    .eq("id", tenantId)
    .maybeSingle();
  if (tenantErr) throw tenantErr;
  if (!tenant) throw new Error(`Tenant ${tenantId} not found`);

  const [
    paymentMethods,
    taxSettings,
    userAccounts,
    employees,
    approvers,
    leaveApprovers,
    leavePolicies,
    salaryRates,
    compensationPolicies,
    allowanceTypes,
    sites,
    inventoryConfig,
  ] = await Promise.all([
    admin
      .from("payment_methods")
      .select("id, name, created_at")
      .eq("tenant_id", tenantId)
      .order("name"),
    admin
      .from("tax_settings")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    admin
      .from("user_accounts")
      .select(
        "auth_uid, email, role, is_active, employee_id, created_at, employees(full_name, phone, momo_number, position, employment_type, employment_status, date_hired, staff_id)",
      )
      .eq("tenant_id", tenantId)
      .order("created_at"),
    admin
      .from("employees")
      .select(
        "employee_id, full_name, phone, momo_number, position, employment_type, employment_status, date_hired, staff_id, created_at",
      )
      .eq("tenant_id", tenantId)
      .order("created_at"),
    admin
      .from("approvers")
      .select("employee_id, created_at, employees(full_name)")
      .eq("tenant_id", tenantId),
    admin
      .from("leave_approver_config")
      .select(
        "effective_from, approver_user_account_id, notes, created_at, user_accounts(email, employees(full_name))",
      )
      .eq("tenant_id", tenantId)
      .order("effective_from", { ascending: false })
      .order("created_at", { ascending: false }),
    admin
      .from("leave_entitlement_policy")
      .select("position, employment_type, leave_type, entitled_days")
      .eq("tenant_id", tenantId)
      .order("position")
      .order("employment_type")
      .order("leave_type"),
    admin
      .from("salary_rate_config")
      .select("position, employment_type, shift, basic_salary, effective_date")
      .eq("tenant_id", tenantId),
    admin
      .from("compensation_policy")
      .select("position, employment_type, shift, allowance_type_id, amount")
      .eq("tenant_id", tenantId),
    admin
      .from("allowance_types")
      .select("id, code, name, is_active")
      .eq("tenant_id", tenantId)
      .order("sort_order"),
    admin
      .from("sites")
      .select("site_code, site_name, required_staff, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at"),
    admin
      .from("inventory_balance_config")
      .select("go_live_date, opening_inventory_value")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  // Resolve leave entitlement via SQL RPC if available, else compute fallback in app
  let leaveEntitlementResolved = null;
  const ownerEmployee = (employees.data ?? []).find(
    (e) => e.employment_status === "Active",
  );
  const position = ownerEmployee?.position ?? "Administrator";
  const employmentType = ownerEmployee?.employment_type ?? "Full-Time";

  const { data: rpcLeave, error: rpcErr } = await admin.rpc(
    "resolve_leave_entitlement",
    {
      p_tenant_id: tenantId,
      p_position: position,
      p_employment_type: employmentType,
      p_leave_type: "Annual Leave",
    },
  );
  if (!rpcErr) {
    leaveEntitlementResolved = {
      position,
      employment_type: employmentType,
      annual_leave_days: rpcLeave,
      rpc_used: true,
    };
  }

  for (const leaveType of ["Sick Leave", "Unpaid Leave"]) {
    const { data: days } = await admin.rpc("resolve_leave_entitlement", {
      p_tenant_id: tenantId,
      p_position: position,
      p_employment_type: employmentType,
      p_leave_type: leaveType,
    });
    if (leaveEntitlementResolved) {
      leaveEntitlementResolved[
        leaveType === "Sick Leave" ? "sick_leave_days" : "unpaid_leave_days"
      ] = days;
    }
  }

  const paymentMethodNames = (paymentMethods.data ?? []).map((r) => r.name);
  const missingPaymentMethods = CANONICAL_PAYMENT_METHODS.filter(
    (n) => !paymentMethodNames.includes(n),
  );
  const extraPaymentMethods = paymentMethodNames.filter(
    (n) => !CANONICAL_PAYMENT_METHODS.includes(n),
  );

  const superAdmin = (userAccounts.data ?? []).find(
    (u) => u.role === "super_admin",
  );
  const superAdminEmployee = superAdmin?.employees
    ? Array.isArray(superAdmin.employees)
      ? superAdmin.employees[0]
      : superAdmin.employees
    : null;

  const bannerState = {
    sales_tax_basis_reviewed: Boolean(taxSettings.data?.sales_tax_basis_reviewed_at),
    product_sales_tax_rate_reviewed: Boolean(
      taxSettings.data?.product_sales_tax_rate_reviewed_at,
    ),
    gra_tin_configured: Boolean(taxSettings.data?.gra_tin?.trim()),
    tax_settings_row_exists: Boolean(taxSettings.data),
    sales_tax_basis: taxSettings.data?.sales_tax_basis ?? null,
    product_sales_tax_rate: taxSettings.data?.product_sales_tax_rate ?? null,
    sales_tax_basis_reviewed_at:
      taxSettings.data?.sales_tax_basis_reviewed_at ?? null,
    product_sales_tax_rate_reviewed_at:
      taxSettings.data?.product_sales_tax_rate_reviewed_at ?? null,
    gra_tin: taxSettings.data?.gra_tin ?? null,
  };

  const workspacePrefill = {
    tenant_email: tenant.email?.trim() || null,
    tenant_phone: tenant.phone?.trim() || null,
    super_admin_email: superAdmin?.email ?? null,
    super_admin_employee_phone: superAdminEmployee?.phone?.trim() || null,
    super_admin_employee_momo: superAdminEmployee?.momo_number?.trim() || null,
    email_prefill_would_apply: !tenant.email?.trim() && Boolean(superAdmin?.email),
    phone_prefill_would_apply:
      !tenant.phone?.trim() &&
      Boolean(
        superAdminEmployee?.phone?.trim() || superAdminEmployee?.momo_number?.trim(),
      ),
  };

  console.log(
    JSON.stringify(
      {
        environment: "production",
        supabase_ref: PRODUCTION_REF,
        audited_at: new Date().toISOString(),
        newest_organic_signup: {
          tenant,
          crm_customer: customer,
          subscription: {
            id: newest.id,
            subscription_status: newest.subscription_status,
            trial_end_date: newest.trial_end_date,
            created_at: newest.created_at,
          },
          organic_signup_rank: 1,
          total_organic_signups_found: organicSubs.length,
          recent_organic_signups: organicSubs.slice(0, 5).map((s) => {
            const c = Array.isArray(s.customer) ? s.customer[0] : s.customer;
            return {
              tenant_id: s.linked_tenant_id,
              client_name: c?.client_name,
              subscription_created_at: s.created_at,
            };
          }),
        },
        payment_methods: {
          count: paymentMethodNames.length,
          names: paymentMethodNames,
          canonical_complete: missingPaymentMethods.length === 0,
          missing: missingPaymentMethods,
          extra: extraPaymentMethods,
        },
        tax_settings: {
          row: taxSettings.data,
          banner_state: bannerState,
          app_fallback_when_no_row: {
            sales_tax_basis: "service_only",
            product_sales_tax_rate: 0,
          },
        },
        owner_employee: {
          employees: employees.data ?? [],
          super_admin_linked: Boolean(superAdmin?.employee_id),
          super_admin_employee_id: superAdmin?.employee_id ?? null,
        },
        approvers: {
          expense_approvers: approvers.data ?? [],
          leave_approver_config: leaveApprovers.data ?? [],
        },
        salary_settings: {
          salary_rate_config_count: (salaryRates.data ?? []).length,
          salary_rate_config: salaryRates.data ?? [],
          allowance_types_count: (allowanceTypes.data ?? []).length,
          allowance_types: allowanceTypes.data ?? [],
          compensation_policy_count: (compensationPolicies.data ?? []).length,
          compensation_policy: compensationPolicies.data ?? [],
        },
        leave_entitlement: {
          saved_policy_rows: leavePolicies.data ?? [],
          resolved_via_rpc: leaveEntitlementResolved,
          expected_fallback: { annual: 15, sick: 0, unpaid: 0 },
        },
        workspace: workspacePrefill,
        sites: {
          count: (sites.data ?? []).length,
          rows: sites.data ?? [],
          all_required_staff_zero_or_set:
            (sites.data ?? []).length === 0 ||
            (sites.data ?? []).every(
              (s) => s.required_staff === 0 || s.required_staff != null,
            ),
        },
        inventory_balance_config: inventoryConfig.data ?? null,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
