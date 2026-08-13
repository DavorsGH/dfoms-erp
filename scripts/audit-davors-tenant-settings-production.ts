/**
 * Read-only audit of Davors tenant settings (production).
 *
 *   npx tsx scripts/audit-davors-tenant-settings-production.ts --env-file .env.local.backup
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS = "00000001-0000-4000-8000-000000000001";

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

function assert(condition, message) {
  if (!condition) throw new Error(message);
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
  assert(url.includes(PRODUCTION_REF), `Refusing non-production URL from ${envFile}`);
  assert(key, "Missing SUPABASE_SERVICE_ROLE_KEY");

  const admin = createClient(url, key, { auth: { persistSession: false } });

  const [
    expenseCategories,
    depreciationMethods,
    paymentMethods,
    inventoryConfig,
    taxSettings,
    salaryRates,
    allowanceTypes,
    compensationPolicies,
    ssnitConfig,
    casualTaxConfig,
    payeBands,
    leavePolicies,
    leaveApprovers,
    positions,
    serviceTypes,
    rosterConfigs,
    sites,
    projects,
    approvers,
    tenantRow,
    userAccounts,
    employees,
  ] = await Promise.all([
    admin
      .from("expense_categories")
      .select("name")
      .eq("tenant_id", DAVORS)
      .order("name"),
    admin
      .from("depreciation_methods")
      .select("name")
      .eq("tenant_id", DAVORS)
      .order("name"),
    admin
      .from("payment_methods")
      .select("name")
      .eq("tenant_id", DAVORS)
      .order("name"),
    admin
      .from("inventory_balance_config")
      .select("go_live_date, opening_inventory_value")
      .eq("tenant_id", DAVORS)
      .maybeSingle(),
    admin
      .from("tax_settings")
      .select("sales_tax_basis, product_sales_tax_rate, vat_registered, gra_tin")
      .eq("tenant_id", DAVORS)
      .maybeSingle(),
    admin
      .from("salary_rate_config")
      .select("position, employment_type, shift, basic_salary, effective_date")
      .eq("tenant_id", DAVORS)
      .order("position")
      .order("employment_type")
      .order("effective_date", { ascending: false }),
    admin
      .from("allowance_types")
      .select("id, code, name, is_active, sort_order")
      .eq("tenant_id", DAVORS)
      .order("sort_order"),
    admin
      .from("compensation_policy")
      .select("position, employment_type, shift, allowance_type_id, amount")
      .eq("tenant_id", DAVORS),
    admin.from("ssnit_rate_config").select("*").eq("tenant_id", DAVORS),
    admin.from("casual_tax_rate_config").select("*").eq("tenant_id", DAVORS),
    admin
      .from("paye_tax_bands")
      .select("*")
      .eq("tenant_id", DAVORS)
      .order("band_order"),
    admin
      .from("leave_entitlement_policy")
      .select("position, employment_type, leave_type, entitled_days")
      .eq("tenant_id", DAVORS)
      .order("position")
      .order("employment_type")
      .order("leave_type"),
    admin
      .from("leave_approver_config")
      .select(
        "effective_from, approver_user_account_id, user_accounts(email, employees(full_name))",
      )
      .eq("tenant_id", DAVORS)
      .order("effective_from", { ascending: false })
      .order("created_at", { ascending: false }),
    admin
      .from("positions")
      .select("position_title")
      .eq("tenant_id", DAVORS)
      .order("position_title"),
    admin
      .from("service_types")
      .select("name")
      .eq("tenant_id", DAVORS)
      .order("name"),
    admin
      .from("roster_config")
      .select(
        "client_id, cycle_start_date, cycle_length_days, morning_time, afternoon_time, supervisor_time",
      )
      .eq("tenant_id", DAVORS),
    admin
      .from("sites")
      .select("site_code, site_name, client_id, required_staff")
      .eq("tenant_id", DAVORS)
      .order("site_name"),
    admin
      .from("projects")
      .select("project_name, client_id")
      .eq("tenant_id", DAVORS)
      .order("project_name"),
    admin
      .from("approvers")
      .select("employee_id, employees(full_name)")
      .eq("tenant_id", DAVORS),
    admin
      .from("tenants")
      .select(
        "id, name, status, logo_url, signature_url, signature_author_name, signature_author_title, address, phone, email, created_at",
      )
      .eq("id", DAVORS)
      .maybeSingle(),
    admin
      .from("user_accounts")
      .select(
        "auth_uid, email, role, is_active, employee_id, client_id, employees(full_name, phone, momo_number)",
      )
      .eq("tenant_id", DAVORS)
      .order("email"),
    admin
      .from("employees")
      .select("employee_id, full_name, phone, momo_number")
      .eq("tenant_id", DAVORS),
  ]);

  const allowanceTypeMap = Object.fromEntries(
    (allowanceTypes.data ?? []).map((t) => [t.id, t]),
  );

  const policiesWithNames = (compensationPolicies.data ?? []).map((p) => {
    const type = allowanceTypeMap[p.allowance_type_id];
    return {
      position: p.position,
      employment_type: p.employment_type,
      shift: p.shift,
      allowance: type ? `${type.code} (${type.name})` : p.allowance_type_id,
      amount: p.amount,
    };
  });

  const employeePhoneById = Object.fromEntries(
    (employees.data ?? []).map((e) => [e.employee_id, e]),
  );

  const userAccountRows = (userAccounts.data ?? []).map((row) => {
    const empRel = Array.isArray(row.employees)
      ? row.employees[0]
      : row.employees;
    const empFromJoin = empRel;
    const empFromLookup = row.employee_id
      ? employeePhoneById[row.employee_id]
      : null;
    const phone = empFromJoin?.phone ?? empFromLookup?.phone ?? null;
    const momo = empFromJoin?.momo_number ?? empFromLookup?.momo_number ?? null;
    return {
      name:
        empFromJoin?.full_name ??
        empFromLookup?.full_name ??
        row.email,
      email: row.email,
      role: row.role,
      employee_id: row.employee_id,
      employee_linked: Boolean(row.employee_id),
      is_active: row.is_active,
      phone: phone?.trim() || null,
      momo_number: momo?.trim() || null,
      has_phone: Boolean(phone?.trim() || momo?.trim()),
    };
  });

  const { data: allTenants } = await admin
    .from("tenants")
    .select("id, name, status, created_at")
    .order("created_at", { ascending: false });

  const { data: davorsSubscription } = await admin
    .from("crm_subscriptions")
    .select(
      "id, subscription_status, trial_end_date, billing_waived, billing_waived_reason, product:crm_products(name)",
    )
    .eq("linked_tenant_id", DAVORS)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const tenantMgmtVisibleRows = (allTenants ?? []).filter((t) => t.id !== DAVORS);

  const clientIds = [
    ...new Set((rosterConfigs.data ?? []).map((r) => r.client_id)),
  ];
  let clientNames = {};
  if (clientIds.length) {
    const { data: clients } = await admin
      .from("customers")
      .select("client_id, client_name")
      .in("client_id", clientIds);
    clientNames = Object.fromEntries(
      (clients ?? []).map((c) => [c.client_id, c.client_name]),
    );
  }

  const rosterWithClients = (rosterConfigs.data ?? []).map((r) => ({
    client: clientNames[r.client_id] ?? r.client_id,
    ...r,
  }));

  const currentLeaveApprover = (leaveApprovers.data ?? [])[0] ?? null;
  let leaveApproverLabel = null;
  if (currentLeaveApprover) {
    const ua = Array.isArray(currentLeaveApprover.user_accounts)
      ? currentLeaveApprover.user_accounts[0]
      : currentLeaveApprover.user_accounts;
    const emp = ua?.employees
      ? Array.isArray(ua.employees)
        ? ua.employees[0]
        : ua.employees
      : null;
    leaveApproverLabel = {
      effective_from: currentLeaveApprover.effective_from,
      email: ua?.email ?? null,
      name: emp?.full_name ?? ua?.email ?? null,
    };
  }

  const approverLabels = (approvers.data ?? []).map((a) => {
    const emp = Array.isArray(a.employees) ? a.employees[0] : a.employees;
    return {
      employee_id: a.employee_id,
      full_name: emp?.full_name ?? a.employee_id,
    };
  });

  console.log(
    JSON.stringify(
      {
        environment: "production",
        supabase_ref: PRODUCTION_REF,
        tenant_id: DAVORS,
        audited_at: new Date().toISOString(),
        finance: {
          expense_categories: (expenseCategories.data ?? []).map((r) => r.name),
          depreciation_methods: (depreciationMethods.data ?? []).map((r) => r.name),
          payment_methods: (paymentMethods.data ?? []).map((r) => r.name),
          inventory_go_live: inventoryConfig.data ?? null,
          tax_settings: taxSettings.data ?? null,
        },
        hr: {
          salary_rate_config: salaryRates.data ?? [],
          allowance_types: allowanceTypes.data ?? [],
          compensation_policy: policiesWithNames,
          ssnit_rate_config: ssnitConfig.data ?? [],
          casual_tax_rate_config: casualTaxConfig.data ?? [],
          paye_tax_bands: payeBands.data ?? [],
          leave_entitlement_policy: leavePolicies.data ?? [],
          leave_approver_current: leaveApproverLabel,
          leave_approver_history_count: (leaveApprovers.data ?? []).length,
          positions: (positions.data ?? []).map((p) => p.position_title),
          approvers: approverLabels,
        },
        operations: {
          service_types: (serviceTypes.data ?? []).map((r) => r.name),
          roster_config: rosterWithClients,
          sites_required_staff: (sites.data ?? []).map((s) => ({
            site_code: s.site_code,
            site_name: s.site_name,
            required_staff: s.required_staff,
          })),
          projects: projects.data ?? [],
        },
        user_accounts: userAccountRows,
        workspace: tenantRow.data ?? null,
        platform_tenant_management: {
          note: "Tenant Management lists customer tenants only — Davors platform tenant is excluded from this grid (.neq DAVORS_TENANT_ID). Not a fillable settings area for Davors itself.",
          davors_tenant_record: tenantRow.data ?? null,
          davors_subscription: davorsSubscription ?? null,
          visible_customer_tenant_count: tenantMgmtVisibleRows.length,
          sample_visible_tenants: tenantMgmtVisibleRows.slice(0, 5).map((t) => ({
            id: t.id,
            name: t.name,
            status: t.status,
          })),
        },
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
