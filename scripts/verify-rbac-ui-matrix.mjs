import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  getSidebarNavItems,
  canEditEmployees,
  canViewEmployeeSalary,
  canEditInventory,
  canManagePayrollPeriod,
  canStartRotation,
  getAccessibleReportCategoryIds,
} from "../utils/rbac-access.ts";

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

const ACCOUNTS = [
  {
    email: "rbac.finance@test.davors",
    role: "finance",
    expectedNav: ["Dashboard", "Finance", "HR & Payroll", "Employees", "Inventory", "Reports", "Self-Service"],
    blockedNav: ["Operations", "Administration", "User Accounts"],
    employeeCount: 25,
    workOrderCount: 0,
    canEditEmployees: true,
    canViewSalary: true,
    canEditInventory: false,
    canManagePayroll: false,
    canStartRotation: false,
    reportCategories: ["finance", "hr-payroll", "inventory"],
  },
  {
    email: "rbac.hr@test.davors",
    role: "hr",
    expectedNav: ["Dashboard", "Finance", "HR & Payroll", "Employees", "Operations", "Reports", "Self-Service"],
    blockedNav: ["Inventory", "Administration", "User Accounts"],
    employeeCount: 25,
    workOrderCount: 0,
    canEditEmployees: true,
    canViewSalary: true,
    canEditInventory: false,
    canManagePayroll: true,
    canStartRotation: false,
    reportCategories: ["finance", "hr-payroll"],
  },
  {
    email: "rbac.operations@test.davors",
    role: "operations_manager",
    expectedNav: ["Dashboard", "Employees", "Operations", "Inventory", "Reports", "Self-Service"],
    blockedNav: ["Finance", "HR & Payroll", "Administration", "User Accounts"],
    employeeCount: 25,
    workOrderCount: null,
    canEditEmployees: false,
    canViewSalary: false,
    canEditInventory: true,
    canManagePayroll: false,
    canStartRotation: true,
    reportCategories: ["operations", "inventory", "incidents"],
  },
  {
    email: "rbac.supervisor@test.davors",
    role: "supervisor",
    expectedNav: ["Dashboard", "Employees", "Operations", "Reports", "Self-Service"],
    blockedNav: ["Finance", "HR & Payroll", "Inventory", "Administration", "User Accounts"],
    employeeCount: 25,
    workOrderCount: 0,
    canEditEmployees: false,
    canViewSalary: false,
    canEditInventory: false,
    canManagePayroll: false,
    canStartRotation: false,
    reportCategories: ["operations", "incidents"],
  },
  {
    email: "rbac.employee@test.davors",
    role: "employee",
    expectedNav: ["Dashboard", "Self-Service"],
    blockedNav: ["Finance", "HR & Payroll", "Employees", "Operations", "Inventory", "Reports", "Administration", "User Accounts", "Client Portal"],
    employeeCount: null,
    workOrderCount: 0,
    canEditEmployees: false,
    canViewSalary: false,
    canEditInventory: false,
    canManagePayroll: false,
    canStartRotation: false,
    reportCategories: [],
  },
  {
    email: "rbac.client@test.davors",
    role: "client",
    expectedNav: ["Dashboard", "Client Portal"],
    blockedNav: ["Finance", "HR & Payroll", "Employees", "Operations", "Inventory", "Reports", "Administration", "User Accounts", "Self-Service"],
    employeeCount: null,
    workOrderCount: 0,
    canEditEmployees: false,
    canViewSalary: false,
    canEditInventory: false,
    canManagePayroll: false,
    canStartRotation: false,
    reportCategories: [],
  },
];

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
  if (!url || !anonKey) throw new Error("Missing Supabase env vars");

  const results = [];

  for (const account of ACCOUNTS) {
    const client = await signIn(url, anonKey, account.email);
    const { data: userAccount } = await client
      .from("user_accounts")
      .select("role")
      .single();

    const role = userAccount?.role ?? null;
    const nav = getSidebarNavItems(role).map((item) => item.label);
    const navOk =
      account.expectedNav.every((label) => nav.includes(label)) &&
      account.blockedNav.every((label) => !nav.includes(label));

    const { count: employeeCount } = await client
      .from("employees")
      .select("employee_id", { count: "exact", head: true });

    const { data: workOrders, error: woError } = await client
      .from("work_orders")
      .select("work_order_no")
      .limit(5);

    const workOrderCount = woError ? -1 : (workOrders?.length ?? 0);
    const workOrdersOk =
      account.workOrderCount === null
        ? !woError
        : workOrderCount === account.workOrderCount;

    const employeesOk =
      account.employeeCount === null
        ? true
        : employeeCount === account.employeeCount;

    const flagsOk =
      canEditEmployees(role) === account.canEditEmployees &&
      canViewEmployeeSalary(role) === account.canViewSalary &&
      canEditInventory(role) === account.canEditInventory &&
      canManagePayrollPeriod(role) === account.canManagePayroll &&
      canStartRotation(role) === account.canStartRotation;

    const reportsOk =
      JSON.stringify(getAccessibleReportCategoryIds(role).sort()) ===
      JSON.stringify(account.reportCategories.sort());

    results.push({
      email: account.email,
      roleOk: role === account.role,
      navOk,
      nav,
      employeesOk,
      employeeCount,
      workOrdersOk,
      workOrderCount,
      flagsOk,
      reportsOk,
      ok:
        role === account.role &&
        navOk &&
        employeesOk &&
        workOrdersOk &&
        flagsOk &&
        reportsOk,
    });
  }

  console.log(JSON.stringify(results, null, 2));
  if (results.some((row) => !row.ok)) process.exit(1);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
