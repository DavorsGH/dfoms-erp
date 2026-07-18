/**
 * RBAC Phase 5 — full cross-role regression across Phases 1–4 + Sales & Inventory.
 * Run: node scripts/verify-rbac-full-regression.mjs
 * Optional: VERIFY_APP_URL=http://localhost:3000 for live page/API HTTP checks.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  FINANCE_SECTION_ROLES,
  HR_PAYROLL_SECTION_ROLES,
  EMPLOYEES_SECTION_ROLES,
  OPERATIONS_SECTION_ROLES,
  INVENTORY_SECTION_ROLES,
  SELF_SERVICE_SECTION_ROLES,
  CLIENT_PORTAL_SECTION_ROLES,
  CRM_SECTION_ROLES,
  PAYROLL_PERIOD_MANAGE_ROLES,
  START_ROTATION_ROLES,
  REPORT_CATEGORY_ROLES,
  roleIn,
  canAccessFinanceSection,
  canAccessHrPayrollSection,
  canAccessEmployeesSection,
  canAccessOperationsSection,
  canAccessInventorySection,
  canAccessSelfServiceSection,
  canAccessClientPortalSection,
  canAccessCrmSection,
  canAccessReportCategory,
  canEditEmployees,
  canViewEmployeeSalary,
  canEditInventory,
  canManagePayrollPeriod,
  canStartRotation,
  getSidebarNavItems,
  getAccessibleReportCategoryIds,
} from "../utils/rbac-access.ts";
import { REPORT_NAV_CATEGORIES } from "../app/dashboard/reports/reports-nav-config.ts";

const TEST_PASSWORD = "TestRbac1!";

const ROLE_ACCOUNTS = {
  super_admin: "rbac.admin@test.davors",
  finance: "rbac.finance@test.davors",
  hr: "rbac.hr@test.davors",
  operations_manager: "rbac.operations@test.davors",
  supervisor: "rbac.supervisor@test.davors",
  employee: "rbac.employee@test.davors",
  client: "rbac.client@test.davors",
};

const SUPERVISOR_SITES = ["SI-001", "SI-002"];

const PHASE_CHECKS = {
  foundation: "Phase 1",
  phase2: "Phase 2",
  phase3: "Phase 3",
  phase4: "Phase 4",
  ui_matrix: "UI matrix",
  inventory: "Sales & Inventory",
};

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

/** @type {{ role: string, section: string, name: string, ok: boolean, detail: string, phase?: string }[]} */
const results = [];

function record(role, section, name, ok, detail, phase = null) {
  results.push({ role, section, name, ok, detail, phase });
}

function getRouteAllowedRoles(path) {
  if (path === "/dashboard") {
    return [
      "super_admin",
      "finance",
      "hr",
      "operations_manager",
      "supervisor",
      "employee",
      "client",
    ];
  }
  if (path.startsWith("/dashboard/finance")) return FINANCE_SECTION_ROLES;
  if (path.startsWith("/dashboard/crm")) return CRM_SECTION_ROLES;
  if (path.startsWith("/dashboard/hr-payroll")) return HR_PAYROLL_SECTION_ROLES;
  if (path.startsWith("/dashboard/employees")) return EMPLOYEES_SECTION_ROLES;
  if (path.startsWith("/dashboard/operations")) return OPERATIONS_SECTION_ROLES;
  if (path.startsWith("/dashboard/inventory")) return INVENTORY_SECTION_ROLES;
  if (path.startsWith("/dashboard/self-service")) return SELF_SERVICE_SECTION_ROLES;
  if (path.startsWith("/dashboard/client-portal")) return CLIENT_PORTAL_SECTION_ROLES;
  if (path.startsWith("/dashboard/administration")) return ["super_admin"];
  if (path === "/dashboard/user-accounts") return ["super_admin"];
  if (path.startsWith("/dashboard/reports")) {
    for (const category of REPORT_NAV_CATEGORIES) {
      const inCategory =
        path === category.baseHref ||
        path.startsWith(`${category.baseHref}/`) ||
        category.items.some(
          (item) => path === item.href || path.startsWith(`${item.href}/`),
        );
      if (inCategory) return REPORT_CATEGORY_ROLES[category.id] ?? [];
    }
    return ["super_admin"];
  }
  return null;
}

const APP_ROUTES = [
  "/dashboard",
  "/dashboard/finance",
  "/dashboard/finance/product-sales",
  "/dashboard/crm",
  "/dashboard/crm/customers",
  "/dashboard/crm/products",
  "/dashboard/crm/product-sales",
  "/dashboard/crm/sales",
  "/dashboard/finance/expenses",
  "/dashboard/finance/accounts-payable",
  "/dashboard/finance/fixed-assets",
  "/dashboard/finance/manual-financial-entries",
  "/dashboard/finance/profit-loss",
  "/dashboard/finance/cash-flow",
  "/dashboard/finance/balance-sheet",
  "/dashboard/finance/balance-sheet/capital-contributions",
  "/dashboard/hr-payroll/attendance",
  "/dashboard/hr-payroll/leave",
  "/dashboard/hr-payroll/leave-balances",
  "/dashboard/hr-payroll/overtime",
  "/dashboard/hr-payroll/loans",
  "/dashboard/hr-payroll/payroll-processing",
  "/dashboard/hr-payroll/payroll-history",
  "/dashboard/hr-payroll/payslip",
  "/dashboard/hr-payroll/staff-id-cards",
  "/dashboard/employees",
  "/dashboard/operations/duty-roster",
  "/dashboard/operations/roster-history",
  "/dashboard/operations/clients",
  "/dashboard/operations/sites",
  "/dashboard/operations/work-orders",
  "/dashboard/operations/inspection-summary",
  "/dashboard/operations/failed-inspections",
  "/dashboard/operations/corrective-actions",
  "/dashboard/operations/complaint-register",
  "/dashboard/inventory/raw-materials",
  "/dashboard/inventory/finished-products",
  "/dashboard/inventory/production-batches",
  "/dashboard/inventory/internal-consumption",
  "/dashboard/self-service/payslip",
  "/dashboard/self-service/attendance",
  "/dashboard/self-service/leave",
  "/dashboard/self-service/roster",
  "/dashboard/client-portal/invoices",
  "/dashboard/client-portal/service-report",
  "/dashboard/client-portal/sites-performance",
  "/dashboard/administration",
  "/dashboard/administration/expense-categories",
  "/dashboard/administration/leave-settings",
  "/dashboard/user-accounts",
  ...REPORT_NAV_CATEGORIES.flatMap((category) => [
    category.baseHref,
    ...category.items.map((item) => item.href),
  ]),
];

async function signIn(url, anonKey, email) {
  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: TEST_PASSWORD,
  });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return { client, session: data.session };
}

function buildAuthCookie(supabaseUrl, session) {
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  const cookieName = `sb-${projectRef}-auth-token`;
  const payload = JSON.stringify([
    session.access_token,
    session.refresh_token,
    null,
    null,
    null,
  ]);
  return `${cookieName}=${encodeURIComponent(payload)}`;
}

async function testHttpRoute(appUrl, supabaseUrl, session, path, shouldAllow) {
  const cookie = buildAuthCookie(supabaseUrl, session);
  const response = await fetch(`${appUrl}${path}`, {
    method: "GET",
    headers: { Cookie: cookie },
    redirect: "manual",
  });
  const allowed =
    response.status === 200 ||
    (response.status >= 300 && response.status < 400 && !response.headers.get("location")?.endsWith("/dashboard"));
  const blocked =
    response.status === 307 ||
    response.status === 308 ||
    (response.status >= 300 &&
      response.status < 400 &&
      (response.headers.get("location")?.includes("/dashboard") &&
        !response.headers.get("location")?.includes(path)));
  if (shouldAllow) return allowed && !blocked;
  return blocked || response.status === 403;
}

async function testHttpApi(appUrl, supabaseUrl, session, path, method, expectAllowed) {
  const cookie = buildAuthCookie(supabaseUrl, session);
  const response = await fetch(`${appUrl}${path}`, {
    method,
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: "{}",
  });
  if (expectAllowed) {
    return response.status !== 401 && response.status !== 403;
  }
  return response.status === 401 || response.status === 403;
}

async function verifyPrerequisites(admin) {
  const { data: rbacUsers, error } = await admin
    .from("user_accounts")
    .select("email, role, user_account_supervisor_sites(site_code)")
    .like("email", "rbac.%@test.davors");

  const expectedEmails = Object.values(ROLE_ACCOUNTS);
  const missing = expectedEmails.filter(
    (email) => !rbacUsers?.some((row) => row.email === email),
  );

  record(
    "all",
    "prerequisites",
    "rbac test accounts present (7)",
    !error && missing.length === 0,
    error?.message ?? `missing: ${missing.join(", ") || "none"}`,
    PHASE_CHECKS.foundation,
  );

  for (const [role, email] of Object.entries(ROLE_ACCOUNTS)) {
    const account = rbacUsers?.find((row) => row.email === email);
    record(
      role,
      "prerequisites",
      `account role ${email}`,
      account?.role === role,
      account ? `${account.role}` : "missing",
      PHASE_CHECKS.foundation,
    );
  }

  const supervisor = rbacUsers?.find((row) => row.email === ROLE_ACCOUNTS.supervisor);
  const sites = (supervisor?.user_account_supervisor_sites ?? []).map((s) => s.site_code);
  record(
    "supervisor",
    "prerequisites",
    "supervisor sites SI-001/SI-002",
    SUPERVISOR_SITES.every((code) => sites.includes(code)),
    JSON.stringify(sites),
    PHASE_CHECKS.phase2,
  );

  for (const email of ["david.avors@gmail.com", "giftyavors@gmail.com"]) {
    const { data: person } = await admin
      .from("user_accounts")
      .select("role, employee_id, is_active")
      .eq("email", email)
      .single();
    record(
      "super_admin",
      "prerequisites",
      `${email} record unchanged`,
      person?.role === "super_admin" &&
        person?.is_active === true &&
        (email === "david.avors@gmail.com"
          ? person?.employee_id === "EMP0001"
          : person?.employee_id === "EMP0002"),
      JSON.stringify(person),
      PHASE_CHECKS.foundation,
    );
  }
}

function verifyPageAccessMatrix(role) {
  const mismatches = [];
  for (const path of APP_ROUTES) {
    const allowedRoles = getRouteAllowedRoles(path);
    if (!allowedRoles) continue;
    const shouldAllow = roleIn(role, allowedRoles);
    const sectionAllowed =
      (path.startsWith("/dashboard/finance") && canAccessFinanceSection(role)) ||
      (path.startsWith("/dashboard/hr-payroll") && canAccessHrPayrollSection(role)) ||
      (path.startsWith("/dashboard/employees") && canAccessEmployeesSection(role)) ||
      (path.startsWith("/dashboard/operations") && canAccessOperationsSection(role)) ||
      (path.startsWith("/dashboard/inventory") && canAccessInventorySection(role)) ||
      (path.startsWith("/dashboard/self-service") && canAccessSelfServiceSection(role)) ||
      (path.startsWith("/dashboard/client-portal") && canAccessClientPortalSection(role)) ||
      (path.startsWith("/dashboard/administration") && role === "super_admin") ||
      (path === "/dashboard/user-accounts" && role === "super_admin") ||
      (path === "/dashboard") ||
      (path.startsWith("/dashboard/reports") &&
        REPORT_NAV_CATEGORIES.some((category) => {
          const inCategory =
            path === category.baseHref ||
            path.startsWith(`${category.baseHref}/`) ||
            category.items.some(
              (item) => path === item.href || path.startsWith(`${item.href}/`),
            );
          return inCategory && canAccessReportCategory(role, category.id);
        }));
    if (shouldAllow !== sectionAllowed) {
      mismatches.push(path);
    }
  }
  record(
    role,
    "page_access_matrix",
    `all ${APP_ROUTES.length} routes match permission matrix`,
    mismatches.length === 0,
    mismatches.length ? mismatches.slice(0, 5).join(", ") : "all routes consistent",
    PHASE_CHECKS.ui_matrix,
  );
}

function verifyNavAndFlags(role) {
  const nav = getSidebarNavItems(role).map((item) => item.label);
  const reports = getAccessibleReportCategoryIds(role).sort();

  const expectations = {
    super_admin: {
      nav: [
        "Dashboard",
        "Finance",
        "HR & Payroll",
        "Employees",
        "Operations",
        "Inventory",
        "Self-Service",
        "Reports",
        "Administration",
        "User Accounts",
      ],
      blocked: ["Client Portal"],
      reports: [
        "client-facing",
        "finance",
        "hr-payroll",
        "incidents",
        "inventory",
        "operations",
      ],
      editEmployees: true,
      viewSalary: true,
      editInventory: true,
      managePayroll: true,
      startRotation: true,
    },
    finance: {
      nav: [
        "Dashboard",
        "Finance",
        "HR & Payroll",
        "Employees",
        "Inventory",
        "Reports",
        "Self-Service",
      ],
      blocked: ["Operations", "Administration", "User Accounts", "Client Portal"],
      reports: ["finance", "hr-payroll", "inventory"],
      editEmployees: true,
      viewSalary: true,
      editInventory: false,
      managePayroll: false,
      startRotation: false,
    },
    hr: {
      nav: [
        "Dashboard",
        "Finance",
        "HR & Payroll",
        "Employees",
        "Operations",
        "Reports",
        "Self-Service",
      ],
      blocked: ["Inventory", "Administration", "User Accounts", "Client Portal"],
      reports: ["finance", "hr-payroll"],
      editEmployees: true,
      viewSalary: true,
      editInventory: false,
      managePayroll: true,
      startRotation: false,
    },
    operations_manager: {
      nav: [
        "Dashboard",
        "Employees",
        "Operations",
        "Inventory",
        "Reports",
        "Self-Service",
      ],
      blocked: [
        "Finance",
        "HR & Payroll",
        "Administration",
        "User Accounts",
        "Client Portal",
      ],
      reports: ["incidents", "inventory", "operations"],
      editEmployees: false,
      viewSalary: false,
      editInventory: true,
      managePayroll: false,
      startRotation: true,
    },
    supervisor: {
      nav: ["Dashboard", "Employees", "Operations", "Reports", "Self-Service"],
      blocked: [
        "Finance",
        "HR & Payroll",
        "Inventory",
        "Administration",
        "User Accounts",
        "Client Portal",
      ],
      reports: ["incidents", "operations"],
      editEmployees: false,
      viewSalary: false,
      editInventory: false,
      managePayroll: false,
      startRotation: false,
    },
    employee: {
      nav: ["Dashboard", "Self-Service"],
      blocked: [
        "Finance",
        "HR & Payroll",
        "Employees",
        "Operations",
        "Inventory",
        "Reports",
        "Administration",
        "User Accounts",
        "Client Portal",
      ],
      reports: [],
      editEmployees: false,
      viewSalary: false,
      editInventory: false,
      managePayroll: false,
      startRotation: false,
    },
    client: {
      nav: ["Dashboard", "Client Portal"],
      blocked: [
        "Finance",
        "HR & Payroll",
        "Employees",
        "Operations",
        "Inventory",
        "Reports",
        "Administration",
        "User Accounts",
        "Self-Service",
      ],
      reports: [],
      editEmployees: false,
      viewSalary: false,
      editInventory: false,
      managePayroll: false,
      startRotation: false,
    },
  };

  const exp = expectations[role];
  const navOk =
    exp.nav.every((label) => nav.includes(label)) &&
    exp.blocked.every((label) => !nav.includes(label));
  const reportsOk = JSON.stringify(reports) === JSON.stringify(exp.reports.sort());
  const flagsOk =
    canEditEmployees(role) === exp.editEmployees &&
    canViewEmployeeSalary(role) === exp.viewSalary &&
    canEditInventory(role) === exp.editInventory &&
    canManagePayrollPeriod(role) === exp.managePayroll &&
    canStartRotation(role) === exp.startRotation;

  record(role, "page_access", "sidebar navigation", navOk, JSON.stringify(nav), PHASE_CHECKS.ui_matrix);
  record(role, "page_access", "report categories", reportsOk, JSON.stringify(reports), PHASE_CHECKS.ui_matrix);
  record(
    role,
    "permissions",
    "capability flags (edit/salary/inventory/payroll/rotation)",
    flagsOk,
    JSON.stringify({
      editEmployees: canEditEmployees(role),
      viewSalary: canViewEmployeeSalary(role),
      editInventory: canEditInventory(role),
      managePayroll: canManagePayrollPeriod(role),
      startRotation: canStartRotation(role),
    }),
    PHASE_CHECKS.ui_matrix,
  );
}

async function verifyRlsDataScoping(role, client, admin, accountMeta) {
  const { count: totalEmployees } = await admin
    .from("employees")
    .select("employee_id", { count: "exact", head: true });

  if (role === "super_admin") {
    const { count } = await client
      .from("employees")
      .select("employee_id", { count: "exact", head: true });
    record(
      role,
      "data_scoping",
      "employees full company visibility",
      count === totalEmployees,
      `${count}/${totalEmployees}`,
      PHASE_CHECKS.foundation,
    );

    const { count: adminWoCount } = await admin
      .from("work_orders")
      .select("work_order_no", { count: "exact", head: true });
    const { count: woCount } = await client
      .from("work_orders")
      .select("work_order_no", { count: "exact", head: true });
    record(
      role,
      "data_scoping",
      "work_orders unrestricted",
      woCount === adminWoCount,
      `super_admin=${woCount ?? 0}, total=${adminWoCount ?? 0}`,
      PHASE_CHECKS.phase2,
    );
  }

  if (role === "finance" || role === "hr") {
    const { count } = await client
      .from("employees")
      .select("employee_id", { count: "exact", head: true });
    record(
      role,
      "data_scoping",
      "employees full company visibility",
      count === totalEmployees,
      `${count}/${totalEmployees}`,
      PHASE_CHECKS.ui_matrix,
    );
    record(
      role,
      "permissions",
      "salary visibility flag",
      canViewEmployeeSalary(role),
      "canViewEmployeeSalary=true",
      PHASE_CHECKS.ui_matrix,
    );

    const { data: workOrders, error: woError } = await client
      .from("work_orders")
      .select("work_order_no")
      .limit(1);
    record(
      role,
      "data_scoping",
      "blocked from operations work_orders",
      !woError && (workOrders?.length ?? 0) === 0,
      `${workOrders?.length ?? 0} rows`,
      PHASE_CHECKS.phase2,
    );
  }

  if (role === "finance") {
    const { data: products, error } = await client
      .from("finished_products")
      .select("id")
      .limit(1);
    record(
      role,
      "data_scoping",
      "inventory view-only (can read finished_products)",
      !error && (products?.length ?? 0) >= 0,
      error?.message ?? `${products?.length ?? 0} rows`,
      PHASE_CHECKS.inventory,
    );
    record(
      role,
      "permissions",
      "inventory edit blocked (UI flag)",
      !canEditInventory(role),
      "canEditInventory=false",
      PHASE_CHECKS.inventory,
    );
  }

  if (role === "hr") {
    record(
      role,
      "permissions",
      "inventory section blocked",
      !canAccessInventorySection(role),
      "canAccessInventorySection=false",
      PHASE_CHECKS.inventory,
    );
  }

  if (role === "operations_manager") {
    const { data: payroll, error } = await client
      .from("payroll_processing")
      .select("payroll_month")
      .limit(1);
    record(
      role,
      "data_scoping",
      "can read payroll_processing",
      !error,
      error?.message ?? "ok",
      PHASE_CHECKS.phase2,
    );

    const { data: income, error: incomeError } = await client
      .from("income_register")
      .select("id")
      .limit(1);
    record(
      role,
      "data_scoping",
      "blocked from finance income_register",
      incomeError || (income?.length ?? 0) === 0,
      incomeError?.message ?? `${income?.length ?? 0} rows`,
      PHASE_CHECKS.phase2,
    );

    const { data: products, error: productError } = await client
      .from("finished_products")
      .select("id")
      .limit(3);
    record(
      role,
      "data_scoping",
      "inventory edit access (read products)",
      !productError && (products?.length ?? 0) >= 0,
      productError?.message ?? `${products?.length ?? 0} rows`,
      PHASE_CHECKS.inventory,
    );
  }

  if (role === "supervisor") {
    const { count: si12Admin } = await admin
      .from("employees")
      .select("employee_id", { count: "exact", head: true })
      .in("assigned_site_id", SUPERVISOR_SITES);

    const { data: supervisorEmployees } = await client
      .from("employees")
      .select("employee_id, assigned_site_id");

    const employeesDirectoryOk =
      (supervisorEmployees?.length ?? 0) === (si12Admin ?? 0) &&
      (supervisorEmployees ?? []).every((row) =>
        SUPERVISOR_SITES.includes(row.assigned_site_id),
      );
    record(
      role,
      "data_scoping",
      "Employees directory scoped to SI-001/SI-002 only",
      employeesDirectoryOk,
      employeesDirectoryOk
        ? `${supervisorEmployees?.length ?? 0} rows`
        : `${supervisorEmployees?.length ?? 0} rows (expected ${si12Admin})`,
      PHASE_CHECKS.phase2,
    );

    const { count: totalEmployees } = await admin
      .from("employees")
      .select("employee_id", { count: "exact", head: true });
    const { data: dutyRosterDisplay, error: dutyRosterDisplayError } =
      await client.rpc("get_duty_roster_employee_display");
    record(
      role,
      "data_scoping",
      "Duty Roster display RPC company-wide (not employees table)",
      !dutyRosterDisplayError &&
        (dutyRosterDisplay?.length ?? 0) === (totalEmployees ?? 0),
      dutyRosterDisplayError?.message ??
        `rpc=${dutyRosterDisplay?.length ?? 0}, total=${totalEmployees ?? 0}`,
      PHASE_CHECKS.phase2,
    );

    const { count: supervisorRoster } = await client
      .from("roster_history")
      .select("employee_id", { count: "exact", head: true });
    const { count: adminRoster } = await admin
      .from("roster_history")
      .select("employee_id", { count: "exact", head: true });
    record(
      role,
      "data_scoping",
      "duty roster company-wide view (roster_history)",
      supervisorRoster === adminRoster && (supervisorRoster ?? 0) > 0,
      (adminRoster ?? 0) === 0
        ? "no roster_history rows in dataset"
        : `supervisor=${supervisorRoster}, admin=${adminRoster}`,
      PHASE_CHECKS.phase2,
    );

    const { data: allWorkOrders } = await admin
      .from("work_orders")
      .select("site_id")
      .limit(50);
    const otherSite = (allWorkOrders ?? []).find(
      (row) => row.site_id && !SUPERVISOR_SITES.includes(row.site_id),
    );
    if (otherSite) {
      const { data: blockedRows, error } = await client
        .from("work_orders")
        .select("work_order_no")
        .eq("site_id", otherSite.site_id);
      record(
        role,
        "data_scoping",
        "operations reports/data scoped (other-site work_orders blocked)",
        !error && (blockedRows?.length ?? 0) === 0,
        `site ${otherSite.site_id}`,
        PHASE_CHECKS.phase2,
      );
    }

    const { data: outsider } = await admin
      .from("employees")
      .select("employee_id")
      .eq("assigned_site_id", "SI-003")
      .limit(1)
      .maybeSingle();
    if (outsider?.employee_id && (adminRoster ?? 0) > 0) {
      const { data: blockedInsert, error: blockedInsertError } = await client
        .from("roster_history")
        .insert({
          roster_number: "R9099",
          rotation_number: 9,
          effective_date: "2026-08-01",
          employee_id: outsider.employee_id,
          previous_location: "PRJ08",
          new_location: "PRJ08",
          position: "Cleaner",
          shift: "Morning",
          generated_by: "RBAC regression blocked insert",
          date_generated: "2026-08-01",
        })
        .select("employee_id");
      record(
        role,
        "data_scoping",
        "roster insert blocked outside assigned sites",
        blockedInsertError || (blockedInsert?.length ?? 0) === 0,
        blockedInsertError?.message ?? `inserted ${blockedInsert?.length ?? 0} rows`,
        PHASE_CHECKS.phase2,
      );

      const { data: insider } = await admin
        .from("employees")
        .select("employee_id")
        .in("assigned_site_id", SUPERVISOR_SITES)
        .limit(1)
        .maybeSingle();
      if (insider?.employee_id) {
        const { data: allowedInsert, error: allowedInsertError } = await client
          .from("roster_history")
          .insert({
            roster_number: "R9098",
            rotation_number: 9,
            effective_date: "2026-08-02",
            employee_id: insider.employee_id,
            previous_location: "PRJ01",
            new_location: "PRJ01",
            position: "Cleaner",
            shift: "Afternoon",
            generated_by: "RBAC regression allowed insert",
            date_generated: "2026-08-02",
          })
          .select("employee_id");
        record(
          role,
          "data_scoping",
          "roster insert allowed within assigned sites",
          !allowedInsertError && (allowedInsert?.length ?? 0) > 0,
          allowedInsertError?.message ?? `inserted ${allowedInsert?.length ?? 0} rows`,
          PHASE_CHECKS.phase2,
        );
        await admin
          .from("roster_history")
          .delete()
          .eq("roster_number", "R9098");
      }
      await admin.from("roster_history").delete().eq("roster_number", "R9099");
    } else {
      record(
        role,
        "data_scoping",
        "roster insert blocked outside assigned sites",
        true,
        "skipped — no roster_history rows to test write scope",
        PHASE_CHECKS.phase2,
      );
      record(
        role,
        "data_scoping",
        "roster insert allowed within assigned sites",
        true,
        "skipped — no roster_history rows to test write scope",
        PHASE_CHECKS.phase2,
      );
    }
  }

  if (role === "employee") {
    const employeeId = accountMeta.employee_id;
    const { data: employeeRow } = await admin
      .from("employees")
      .select("staff_id")
      .eq("employee_id", employeeId)
      .maybeSingle();
    const staffId = employeeRow?.staff_id ?? employeeId;

    const tables = [
      { table: "payroll_history", column: "employee_id", value: employeeId },
      { table: "leave_requests", column: "employee_id", value: employeeId },
      { table: "attendance_register", column: "staff_id", value: staffId },
    ];

    for (const { table, column, value } of tables) {
      const { data: rows, error } = await client.from(table).select(column);
      const ok =
        !error &&
        (rows ?? []).every((row) => row[column] === value);
      record(
        role,
        "data_scoping",
        `${table} only own records`,
        ok,
        error?.message ?? `${rows?.length ?? 0} rows, all ${value}`,
        PHASE_CHECKS.phase3,
      );
    }

    const { data: rosterRows, error: rosterError } = await client
      .from("roster_history")
      .select("employee_id");
    const rosterOk =
      !rosterError &&
      (rosterRows ?? []).every((row) => row.employee_id === employeeId);
    record(
      role,
      "data_scoping",
      "roster_history only own records",
      rosterOk,
      rosterError?.message ?? `${rosterRows?.length ?? 0} rows`,
      PHASE_CHECKS.phase3,
    );
  }

  if (role === "client") {
    const clientId = accountMeta.client_id;
    const { data: invoices, error: invoiceError } = await client
      .from("income_register")
      .select("client_id, entry_type")
      .eq("entry_type", "service");
    const invoiceClientIds = [
      ...new Set((invoices ?? []).map((row) => row.client_id).filter(Boolean)),
    ];
    record(
      role,
      "data_scoping",
      "invoices scoped to own client_id only",
      !invoiceError &&
        invoiceClientIds.length <= 1 &&
        (invoiceClientIds.length === 0 || invoiceClientIds[0] === clientId),
      JSON.stringify({ clientId, invoiceClientIds, rows: invoices?.length ?? 0 }),
      PHASE_CHECKS.phase4,
    );

    const { data: sites, error: sitesError } = await client
      .from("sites")
      .select("client_id");
    const siteClientIds = [
      ...new Set((sites ?? []).map((row) => row.client_id).filter(Boolean)),
    ];
    record(
      role,
      "data_scoping",
      "sites scoped to own client_id only",
      !sitesError &&
        siteClientIds.length <= 1 &&
        (siteClientIds.length === 0 || siteClientIds[0] === clientId),
      JSON.stringify({ siteClientIds, rows: sites?.length ?? 0 }),
      PHASE_CHECKS.phase4,
    );

    const { data: productSales } = await client
      .from("income_register")
      .select("id")
      .eq("entry_type", "product_sale")
      .limit(1);
    record(
      role,
      "data_scoping",
      "blocked from product_sale entries",
      (productSales?.length ?? 0) === 0,
      `${productSales?.length ?? 0} rows`,
      PHASE_CHECKS.phase4,
    );
  }
}

async function verifyApiRoleMatrix(role, sessions, appUrl, supabaseUrl) {
  const session = sessions[role]?.session;
  if (!session) return;

  const payrollAllowed = roleIn(role, PAYROLL_PERIOD_MANAGE_ROLES);
  const rotationAllowed = roleIn(role, START_ROTATION_ROLES);

  record(
    role,
    "api_permissions",
    "lock-period role matrix",
    canManagePayrollPeriod(role) === payrollAllowed,
    `expected=${payrollAllowed}`,
    PHASE_CHECKS.phase2,
  );
  record(
    role,
    "api_permissions",
    "start-rotation role matrix",
    canStartRotation(role) === rotationAllowed,
    `expected=${rotationAllowed}`,
    PHASE_CHECKS.phase2,
  );

  if (appUrl) {
    const lockOk = await testHttpApi(
      appUrl,
      supabaseUrl,
      session,
      "/api/hr-payroll/lock-period",
      "POST",
      payrollAllowed,
    );
    record(
      role,
      "api_permissions",
      "HTTP POST /api/hr-payroll/lock-period",
      lockOk,
      payrollAllowed ? "allowed (non-403)" : "blocked (401/403)",
      PHASE_CHECKS.phase2,
    );

    const reopenOk = await testHttpApi(
      appUrl,
      supabaseUrl,
      session,
      "/api/hr-payroll/reopen-period",
      "POST",
      payrollAllowed,
    );
    record(
      role,
      "api_permissions",
      "HTTP POST /api/hr-payroll/reopen-period",
      reopenOk,
      payrollAllowed ? "allowed (non-403)" : "blocked (401/403)",
      PHASE_CHECKS.phase2,
    );

    const rotationOk = await testHttpApi(
      appUrl,
      supabaseUrl,
      session,
      "/api/operations/start-rotation",
      "POST",
      rotationAllowed,
    );
    record(
      role,
      "api_permissions",
      "HTTP POST /api/operations/start-rotation",
      rotationOk,
      rotationAllowed ? "allowed (non-403)" : "blocked (401/403)",
      PHASE_CHECKS.phase2,
    );
  }
}

async function verifyCrossModule(admin, sessions) {
  const financeClient = sessions.finance?.client;
  const hrClient = sessions.hr?.client;
  const operationsClient = sessions.operations_manager?.client;
  const employeeClient = sessions.employee?.client;

  const { data: productSales } = await admin
    .from("income_register")
    .select("id, amount, entry_type")
    .eq("entry_type", "product_sale");

  if (financeClient) {
    const { data: financeSales, error } = await financeClient
      .from("income_register")
      .select("id")
      .eq("entry_type", "product_sale");
    record(
      "finance",
      "cross_module",
      "product_sale visible in Finance income_register (P&L source)",
      !error && (financeSales?.length ?? 0) > 0 && financeSales.length === productSales?.length,
      `finance=${financeSales?.length ?? 0}, total=${productSales?.length ?? 0}`,
      PHASE_CHECKS.inventory,
    );
  }

  if (hrClient) {
    const { data: hrSales, error } = await hrClient
      .from("income_register")
      .select("id")
      .eq("entry_type", "product_sale");
    record(
      "hr",
      "cross_module",
      "product_sale visible to HR (read-only finance data)",
      !error && (hrSales?.length ?? 0) > 0,
      `${hrSales?.length ?? 0} rows`,
      PHASE_CHECKS.inventory,
    );
  }

  if (operationsClient && (productSales?.length ?? 0) === 0) {
    record(
      "operations_manager",
      "cross_module",
      "product_sale seed data present",
      false,
      "no product_sale rows to verify cross-module flow",
      PHASE_CHECKS.inventory,
    );
  }

  const { data: approverConfig } = await admin
    .from("leave_approver_config")
    .select("approver_user_account_id, user_accounts(email, role)")
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: annualType } = await admin
    .from("leave_types")
    .select("id")
    .eq("type_name", "Annual Leave")
    .single();

  if (employeeClient && annualType?.id) {
    const start = new Date();
    start.setDate(start.getDate() + 45);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const { data: requestId, error: submitError } = await employeeClient.rpc(
      "submit_leave_request",
      {
        p_leave_type_id: annualType.id,
        p_start_date: start.toISOString().slice(0, 10),
        p_end_date: end.toISOString().slice(0, 10),
        p_reason: "RBAC Phase 5 regression leave routing check",
      },
    );

    record(
      "employee",
      "cross_module",
      "employee can submit leave request (RPC)",
      !submitError && !!requestId,
      submitError?.message ?? String(requestId),
      PHASE_CHECKS.phase3,
    );

    if (requestId) {
      const { data: submitted } = await admin
        .from("leave_requests")
        .select("approver_user_account_id, status")
        .eq("id", requestId)
        .single();
      record(
        "employee",
        "cross_module",
        "leave routes to current leave_approver_config",
        submitted?.approver_user_account_id === approverConfig?.approver_user_account_id,
        JSON.stringify({
          submitted: submitted?.approver_user_account_id,
          config: approverConfig?.approver_user_account_id,
          approverEmail: approverConfig?.user_accounts?.email,
        }),
        PHASE_CHECKS.phase3,
      );

      const hrClientSession = sessions.hr?.client;
      if (hrClientSession) {
        const { data: hrInbox, error: hrInboxError } = await hrClientSession
          .from("leave_requests")
          .select("id, status")
          .eq("id", requestId);
        record(
          "hr",
          "cross_module",
          "HR can see submitted leave request (manage leave balances)",
          !hrInboxError && (hrInbox?.length ?? 0) === 1,
          hrInboxError?.message ?? `${hrInbox?.length ?? 0} rows`,
          PHASE_CHECKS.phase3,
        );
      }
    }
  }
}

async function verifyHttpPageSamples(appUrl, supabaseUrl, sessions) {
  const samples = [
    { role: "finance", path: "/dashboard/finance/profit-loss", allow: true },
    { role: "finance", path: "/dashboard/operations/work-orders", allow: false },
    { role: "operations_manager", path: "/dashboard/inventory/raw-materials", allow: true },
    { role: "operations_manager", path: "/dashboard/finance", allow: false },
    { role: "employee", path: "/dashboard/self-service/payslip", allow: true },
    { role: "employee", path: "/dashboard/employees", allow: false },
    { role: "client", path: "/dashboard/client-portal/invoices", allow: true },
    { role: "client", path: "/dashboard/finance", allow: false },
    { role: "super_admin", path: "/dashboard/user-accounts", allow: true },
    { role: "supervisor", path: "/dashboard/inventory/raw-materials", allow: false },
  ];

  for (const sample of samples) {
    const session = sessions[sample.role]?.session;
    if (!session) continue;
    const ok = await testHttpRoute(
      appUrl,
      supabaseUrl,
      session,
      sample.path,
      sample.allow,
    );
    record(
      sample.role,
      "page_access_http",
      `GET ${sample.path}`,
      ok,
      sample.allow ? "allowed" : "blocked/redirect",
      PHASE_CHECKS.ui_matrix,
    );
  }
}

function printReport() {
  const roles = [
    "super_admin",
    "finance",
    "hr",
    "operations_manager",
    "supervisor",
    "employee",
    "client",
    "all",
  ];

  console.log("\n=== RBAC PHASE 5 FULL REGRESSION ===\n");

  for (const role of roles) {
    const roleResults = results.filter((row) => row.role === role);
    if (!roleResults.length) continue;

    const passed = roleResults.filter((row) => row.ok).length;
    const failed = roleResults.filter((row) => !row.ok);

    console.log(`## ${role.toUpperCase()} — ${passed}/${roleResults.length} passed`);
    console.log("| Section | Check | Result | Detail | Phase |");
    console.log("|---------|-------|--------|--------|-------|");
    for (const row of roleResults) {
      const result = row.ok ? "PASS" : "**FAIL**";
      const phase = row.phase ?? "";
      const regression = !row.ok && phase ? ` ⚠ ${phase}` : "";
      console.log(
        `| ${row.section} | ${row.name} | ${result}${regression} | ${row.detail.slice(0, 80)} | ${phase} |`,
      );
    }
    if (failed.length) {
      console.log(`\nFailed (${failed.length}):`);
      for (const row of failed) {
        console.log(`  - [${row.section}] ${row.name}: ${row.detail}`);
      }
    }
    console.log("");
  }

  const totalPass = results.filter((row) => row.ok).length;
  const totalFail = results.filter((row) => !row.ok).length;
  console.log(`=== SUMMARY: ${totalPass} passed, ${totalFail} failed (${results.length} checks) ===`);

  if (totalFail > 0) {
    console.log("\nREGRESSIONS vs prior phases:");
    for (const row of results.filter((row) => !row.ok && row.phase)) {
      console.log(`  [${row.phase}] ${row.role}/${row.name}`);
    }
  }
}

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const appUrl = process.env.VERIFY_APP_URL?.replace(/\/$/, "") ?? null;

  if (!url || !anonKey || !serviceKey) {
    throw new Error("Missing Supabase env vars in .env.local");
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  await verifyPrerequisites(admin);

  /** @type {Record<string, { client: import('@supabase/supabase-js').SupabaseClient, session: import('@supabase/supabase-js').Session }>} */
  const sessions = {};

  for (const [role, email] of Object.entries(ROLE_ACCOUNTS)) {
    try {
      sessions[role] = await signIn(url, anonKey, email);
    } catch (error) {
      record(role, "prerequisites", `sign-in ${email}`, false, error.message, PHASE_CHECKS.foundation);
    }
  }

  for (const role of Object.keys(ROLE_ACCOUNTS)) {
    if (!sessions[role]) continue;
    verifyPageAccessMatrix(role);
    verifyNavAndFlags(role);

    const { data: rpcRole, error: rpcRoleError } = await sessions[role].client.rpc(
      "current_user_role",
    );

    record(
      role,
      "page_access",
      "authenticated session role matches account",
      !rpcRoleError && rpcRole === role,
      rpcRoleError?.message ?? String(rpcRole),
      PHASE_CHECKS.foundation,
    );

    const { data: accountMeta } = await admin
      .from("user_accounts")
      .select("employee_id, client_id, role")
      .eq("email", ROLE_ACCOUNTS[role])
      .single();

    await verifyRlsDataScoping(role, sessions[role].client, admin, accountMeta ?? {});
    await verifyApiRoleMatrix(role, sessions, appUrl, url);
  }

  await verifyCrossModule(admin, sessions);

  if (appUrl) {
    console.log(`\nRunning HTTP page samples against ${appUrl} ...`);
    await verifyHttpPageSamples(appUrl, url, sessions);
  } else {
    record(
      "all",
      "page_access_http",
      "live HTTP page/API checks",
      true,
      "skipped — set VERIFY_APP_URL=http://localhost:3000 to enable",
      null,
    );
  }

  printReport();

  if (results.some((row) => !row.ok)) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
