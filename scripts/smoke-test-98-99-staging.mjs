import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const ENV_FILE = resolve(process.cwd(), ".env.staging.local");
const RUN_TAG = `ZZSMK${Date.now().toString(36).toUpperCase()}`;
const today = new Date().toISOString().slice(0, 10);
const currentYear = new Date().getFullYear();

function loadEnvForce(filePath) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    process.env[trimmed.slice(0, separator).trim()] = trimmed
      .slice(separator + 1)
      .trim();
  }
}

function formatError(error) {
  if (!error) return "Unknown error";
  return [
    error.message,
    error.details ? `details=${error.details}` : null,
    error.hint ? `hint=${error.hint}` : null,
    error.code ? `code=${error.code}` : null,
  ]
    .filter(Boolean)
    .join(" | ");
}

function relation(value) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function summarizeRows(rows, keys) {
  return rows.slice(0, 3).map((row) =>
    Object.fromEntries(keys.map((key) => [key, row[key] ?? null])),
  );
}

loadEnvForce(ENV_FILE);
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    "Staging environment is missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
  );
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const cleanup = [];
let failed = false;
let cleanupFailed = false;

async function query(label, builder, validate = () => {}) {
  const { data, error } = await builder;
  if (error) {
    throw new Error(`${label}: ${formatError(error)}`);
  }
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  validate(rows);
  console.log(`PASS READ  ${label}: ${rows.length} row(s)`);
  return rows;
}

async function insert(label, table, payload, select = "*") {
  const { data, error } = await supabase
    .from(table)
    .insert(payload)
    .select(select)
    .single();
  if (error) {
    throw new Error(`${label}: ${formatError(error)}`);
  }
  console.log(`PASS WRITE ${label}: ${JSON.stringify(data)}`);
  return data;
}

async function remove(label, table, tenantId, column, value) {
  const { error, count } = await supabase
    .from(table)
    .delete({ count: "exact" })
    .eq("tenant_id", tenantId)
    .eq(column, value);
  if (error) {
    cleanupFailed = true;
    console.error(`FAIL CLEANUP ${label}: ${formatError(error)}`);
    return;
  }
  console.log(`PASS CLEANUP ${label}: deleted ${count ?? "unknown"} row(s)`);
}

try {
  console.log(`STAGING URL host: ${new URL(supabaseUrl).host}`);
  console.log(`Smoke-test tag: ${RUN_TAG}`);

  const tenants = await query(
    "Tenant preflight",
    supabase.from("tenants").select("id, name").order("created_at"),
  );
  const davors =
    tenants.find((tenant) => /davors/i.test(tenant.name ?? "")) ?? tenants[0];
  assert(davors, "Tenant preflight: no tenant row found");
  const tenantId = davors.id;
  console.log(`Target tenant: ${davors.name} (${tenantId})`);

  const contextRows = await query(
    "Davors customer/site context",
    supabase
      .from("sites")
      .select(
        "tenant_id, site_code, site_name, client_id, client:customers!sites_client_id_fkey(client_id, client_name)",
      )
      .eq("tenant_id", tenantId)
      .not("client_id", "is", null)
      .limit(1),
    (rows) => {
      assert(rows.length > 0, "No Davors site with a client exists");
      assert(relation(rows[0].client)?.client_name, "Site client embed is blank");
    },
  );
  const site = contextRows[0];
  const client = relation(site.client);

  console.log("\n=== BASELINE APP READ PATHS ===");
  const baseline = {};
  baseline.workOrders = await query(
    "Work Orders",
    supabase
      .from("work_orders")
      .select(
        "*, client:customers!work_orders_client_id_fkey(client_id, client_name), site:sites!work_orders_site_id_fkey(site_code, site_name)",
      )
      .eq("tenant_id", tenantId)
      .order("date", { ascending: false })
      .limit(20),
    (rows) => {
      for (const row of rows) {
        if (row.client_id)
          assert(relation(row.client)?.client_name, `${row.work_order_no}: client embed blank`);
        if (row.site_id)
          assert(relation(row.site)?.site_name, `${row.work_order_no}: site embed blank`);
      }
    },
  );
  baseline.complaints = await query(
    "Complaint Register",
    supabase
      .from("complaint_register")
      .select(
        "*, client:customers!complaint_register_client_id_fkey(client_id, client_name), site:sites!complaint_register_site_id_fkey(site_code, site_name)",
      )
      .eq("tenant_id", tenantId)
      .order("date_received", { ascending: false })
      .limit(20),
    (rows) => {
      for (const row of rows) {
        if (row.client_id)
          assert(relation(row.client)?.client_name, `${row.complaint_no}: client embed blank`);
        if (row.site_id)
          assert(relation(row.site)?.site_name, `${row.complaint_no}: site embed blank`);
      }
    },
  );
  baseline.actions = await query(
    "Corrective Actions",
    supabase
      .from("corrective_actions")
      .select(
        "*, client:customers!corrective_actions_client_id_fkey(client_id, client_name)",
      )
      .eq("tenant_id", tenantId)
      .order("date_raised", { ascending: false })
      .limit(20),
    (rows) => {
      for (const row of rows) {
        if (row.client_id)
          assert(relation(row.client)?.client_name, `${row.action_no}: client embed blank`);
      }
    },
  );
  baseline.failedInspections = await query(
    "Failed Inspections",
    supabase
      .from("failed_inspections")
      .select(
        "*, client:customers!failed_inspections_client_id_fkey(client_id, client_name), site:sites!failed_inspections_site_id_fkey(site_code, site_name)",
      )
      .eq("tenant_id", tenantId)
      .order("date_identified", { ascending: false })
      .limit(20),
    (rows) => {
      for (const row of rows) {
        if (row.client_id)
          assert(relation(row.client)?.client_name, `${row.issue_no}: client embed blank`);
        if (row.site_id)
          assert(relation(row.site)?.site_name, `${row.issue_no}: site embed blank`);
      }
    },
  );
  baseline.incidents = await query(
    "Incident Register",
    supabase
      .from("incident_register")
      .select(
        "*, client:customers!incident_register_client_id_fkey(client_id, client_name), site:sites!incident_register_site_id_fkey(site_code, site_name), reporter:employees!incident_register_reported_by_fkey(employee_id, full_name)",
      )
      .eq("tenant_id", tenantId)
      .order("date", { ascending: false })
      .limit(20),
    (rows) => {
      for (const row of rows) {
        if (row.client_id)
          assert(relation(row.client)?.client_name, `${row.incident_no}: client embed blank`);
        if (row.site_id)
          assert(relation(row.site)?.site_name, `${row.incident_no}: site embed blank`);
        if (row.reported_by)
          assert(relation(row.reporter)?.full_name, `${row.incident_no}: reporter embed blank`);
      }
    },
  );
  baseline.employees = await query(
    "Employees Directory",
    supabase
      .from("employees")
      .select(
        "*, department_ref:departments!department(dept_code, department_name), project_ref:projects!contract_project(project_code, project_name)",
      )
      .eq("tenant_id", tenantId)
      .order("staff_id")
      .limit(20),
    (rows) => {
      assert(rows.length > 0, "Employees Directory returned no Davors employees");
      for (const row of rows) {
        assert(row.full_name, `${row.employee_id}: full_name is blank`);
        if (row.department)
          assert(
            relation(row.department_ref)?.department_name,
            `${row.employee_id}: department embed blank`,
          );
        if (row.contract_project)
          assert(
            relation(row.project_ref)?.project_name,
            `${row.employee_id}: project embed blank`,
          );
      }
    },
  );
  baseline.fixedAssets = await query(
    "Fixed Assets",
    supabase
      .from("fixed_assets")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("asset_id")
      .limit(20),
    (rows) => {
      for (const row of rows)
        assert(row.asset_name, `${row.asset_id}: asset_name is blank`);
    },
  );

  const approverSelect =
    "employee_id, employees!approvers_employee_id_fkey(full_name)";
  baseline.approvers = await query(
    "Approvers",
    supabase
      .from("approvers")
      .select(approverSelect)
      .eq("tenant_id", tenantId)
      .order("employee_id"),
    (rows) => {
      for (const row of rows)
        assert(
          relation(row.employees)?.full_name,
          `${row.employee_id}: approver employee embed blank`,
        );
    },
  );
  await query(
    "Expense Register",
    supabase
      .from("expense_register")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("date", { ascending: false })
      .limit(20),
  );
  await query(
    "Expense Register approver embed",
    supabase.from("approvers").select(approverSelect).eq("tenant_id", tenantId),
    (rows) => {
      for (const row of rows)
        assert(relation(row.employees)?.full_name, `${row.employee_id}: employee blank`);
    },
  );
  await query(
    "Overtime",
    supabase
      .from("overtime_register")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("date", { ascending: false })
      .limit(20),
  );
  await query(
    "Overtime approver embed",
    supabase.from("approvers").select(approverSelect).eq("tenant_id", tenantId),
    (rows) => {
      for (const row of rows)
        assert(relation(row.employees)?.full_name, `${row.employee_id}: employee blank`);
    },
  );
  baseline.leaveBalances = await query(
    "Leave Balances",
    supabase
      .from("employee_leave_balances")
      .select(
        "*, leave_types(type_name), employees!employee_leave_balances_employee_id_fkey(full_name, staff_id)",
      )
      .eq("tenant_id", tenantId)
      .eq("year", currentYear)
      .order("employee_id"),
    (rows) => {
      for (const row of rows) {
        assert(relation(row.employees)?.full_name, `${row.employee_id}: employee blank`);
        assert(relation(row.leave_types)?.type_name, `${row.employee_id}: leave type blank`);
      }
    },
  );
  baseline.leaveRequests = await query(
    "Leave Approvals",
    supabase
      .from("leave_requests")
      .select(
        "*, leave_types(type_name), employees!leave_requests_employee_id_fkey(full_name, staff_id)",
      )
      .eq("tenant_id", tenantId)
      .eq("status", "Pending")
      .order("submitted_at")
      .limit(20),
    (rows) => {
      for (const row of rows) {
        assert(relation(row.employees)?.full_name, `${row.id}: employee blank`);
        assert(relation(row.leave_types)?.type_name, `${row.id}: leave type blank`);
      }
    },
  );
  baseline.capital = await query(
    "Capital Contributions",
    supabase
      .from("capital_contributions")
      .select(
        "*, employees!capital_contributions_contributed_by_fkey(full_name)",
      )
      .eq("tenant_id", tenantId)
      .order("date", { ascending: false })
      .limit(20),
    (rows) => {
      for (const row of rows) {
        if (row.contributed_by)
          assert(relation(row.employees)?.full_name, `${row.id}: contributor blank`);
      }
    },
  );

  await query(
    "User Accounts employee embed",
    supabase
      .from("user_accounts")
      .select(
        "auth_uid, employee_id, employees!user_accounts_employee_id_fkey(full_name)",
      )
      .eq("tenant_id", tenantId)
      .not("employee_id", "is", null)
      .limit(20),
    (rows) => {
      for (const row of rows)
        assert(relation(row.employees)?.full_name, `${row.auth_uid}: employee blank`);
    },
  );
  await query(
    "Leave Settings nested user-account employee embed",
    supabase
      .from("leave_approver_config")
      .select(
        "*, user_accounts(email, employees!user_accounts_employee_id_fkey(full_name))",
      )
      .eq("tenant_id", tenantId)
      .limit(20),
    (rows) => {
      for (const row of rows) {
        const account = relation(row.user_accounts);
        if (account)
          assert(
            relation(account.employees)?.full_name,
            `${row.id}: nested employee blank`,
          );
      }
    },
  );

  console.log("\nExisting Davors samples:");
  console.log(
    JSON.stringify(
      {
        employees: summarizeRows(baseline.employees, [
          "employee_id",
          "staff_id",
          "full_name",
        ]),
        work_orders: summarizeRows(baseline.workOrders, [
          "work_order_no",
          "client_id",
          "site_id",
        ]),
        complaints: summarizeRows(baseline.complaints, [
          "complaint_no",
          "assigned_supervisor",
        ]),
        corrective_actions: summarizeRows(baseline.actions, [
          "action_no",
          "responsible_person",
        ]),
        failed_inspections: summarizeRows(baseline.failedInspections, [
          "issue_no",
          "assigned_person",
        ]),
        incidents: summarizeRows(baseline.incidents, [
          "incident_no",
          "reported_by",
        ]),
        fixed_assets: summarizeRows(baseline.fixedAssets, [
          "asset_id",
          "asset_name",
        ]),
      },
      null,
      2,
    ),
  );

  console.log("\n=== COMPOSITE-PK WRITE PATHS ===");
  const ids = {
    employee: `${RUN_TAG}EMP`,
    staff: `${RUN_TAG}STF`,
    workOrder: `${RUN_TAG}WO`,
    complaint: `${RUN_TAG}CMP`,
    action: `${RUN_TAG}CA`,
    failed: `${RUN_TAG}ISS`,
    incident: `${RUN_TAG}INC`,
    asset: `${RUN_TAG}FA`,
  };

  const testEmployee = await insert(
    "Employees",
    "employees",
    {
      tenant_id: tenantId,
      employee_id: ids.employee,
      staff_id: ids.staff,
      full_name: `[SMOKE TEST ${RUN_TAG}] Employee`,
      employment_type: "Full-Time",
      employment_status: "Active",
      data_notes: `[SMOKE TEST ${RUN_TAG}] DELETE ME`,
    },
    "tenant_id, employee_id, staff_id, full_name",
  );
  cleanup.push(() =>
    remove("Employees", "employees", tenantId, "employee_id", ids.employee),
  );
  assert(testEmployee.tenant_id === tenantId, "Employee returned wrong tenant_id");

  await insert("Work Orders", "work_orders", {
    tenant_id: tenantId,
    work_order_no: ids.workOrder,
    date: today,
    client_id: client.client_id,
    site_id: site.site_code,
    assigned_cleaner: ids.employee,
    supervisor: ids.employee,
    remarks: `[SMOKE TEST ${RUN_TAG}] DELETE ME`,
  });
  cleanup.push(() =>
    remove("Work Orders", "work_orders", tenantId, "work_order_no", ids.workOrder),
  );

  await insert("Complaint Register", "complaint_register", {
    tenant_id: tenantId,
    complaint_no: ids.complaint,
    date_received: today,
    client_id: client.client_id,
    site_id: site.site_code,
    assigned_supervisor: ids.employee,
    complaint_details: `[SMOKE TEST ${RUN_TAG}] DELETE ME`,
  });
  cleanup.push(() =>
    remove(
      "Complaint Register",
      "complaint_register",
      tenantId,
      "complaint_no",
      ids.complaint,
    ),
  );

  await insert("Failed Inspections", "failed_inspections", {
    tenant_id: tenantId,
    issue_no: ids.failed,
    date_identified: today,
    client_id: client.client_id,
    site_id: site.site_code,
    assigned_person: ids.employee,
    problem_description: `[SMOKE TEST ${RUN_TAG}] DELETE ME`,
  });
  cleanup.push(() =>
    remove(
      "Failed Inspections",
      "failed_inspections",
      tenantId,
      "issue_no",
      ids.failed,
    ),
  );

  await insert("Incident Register", "incident_register", {
    tenant_id: tenantId,
    incident_no: ids.incident,
    date: today,
    client_id: client.client_id,
    site_id: site.site_code,
    reported_by: ids.employee,
    description: `[SMOKE TEST ${RUN_TAG}] DELETE ME`,
  });
  cleanup.push(() =>
    remove(
      "Incident Register",
      "incident_register",
      tenantId,
      "incident_no",
      ids.incident,
    ),
  );

  await insert("Fixed Assets", "fixed_assets", {
    tenant_id: tenantId,
    asset_id: ids.asset,
    asset_name: `[SMOKE TEST ${RUN_TAG}] Fixed Asset`,
    purchase_date: today,
    original_cost: 1,
    quantity: 1,
    total_cost: 1,
    useful_life_years: 1,
    depreciation_method: "Straight Line",
    notes: `[SMOKE TEST ${RUN_TAG}] DELETE ME`,
  });
  cleanup.push(() =>
    remove("Fixed Assets", "fixed_assets", tenantId, "asset_id", ids.asset),
  );

  await insert("Corrective Actions", "corrective_actions", {
    tenant_id: tenantId,
    action_no: ids.action,
    related_work_order: ids.workOrder,
    related_issue_no: ids.failed,
    date_raised: today,
    client_id: client.client_id,
    responsible_person: ids.employee,
    issue_description: `[SMOKE TEST ${RUN_TAG}] DELETE ME`,
  });
  cleanup.push(() =>
    remove(
      "Corrective Actions",
      "corrective_actions",
      tenantId,
      "action_no",
      ids.action,
    ),
  );

  console.log("\n=== TEST-ROW RELATIONSHIP READBACK ===");
  await query(
    "Work Order composite employee/client/site FKs",
    supabase
      .from("work_orders")
      .select(
        "work_order_no, cleaner:employees!work_orders_assigned_cleaner_fkey(employee_id, full_name), supervisor_record:employees!work_orders_supervisor_fkey(employee_id, full_name), client:customers!work_orders_client_id_fkey(client_id, client_name), site:sites!work_orders_site_id_fkey(site_code, site_name)",
      )
      .eq("tenant_id", tenantId)
      .eq("work_order_no", ids.workOrder),
    (rows) => {
      assert(rows.length === 1, "Test work order not found");
      assert(relation(rows[0].cleaner)?.full_name, "Cleaner embed blank");
      assert(relation(rows[0].supervisor_record)?.full_name, "Supervisor embed blank");
      assert(relation(rows[0].client)?.client_name, "Client embed blank");
      assert(relation(rows[0].site)?.site_name, "Site embed blank");
    },
  );
  await query(
    "Complaint composite employee FK",
    supabase
      .from("complaint_register")
      .select(
        "complaint_no, supervisor_record:employees!complaint_register_assigned_supervisor_fkey(employee_id, full_name)",
      )
      .eq("tenant_id", tenantId)
      .eq("complaint_no", ids.complaint),
    (rows) =>
      assert(
        relation(rows[0]?.supervisor_record)?.full_name,
        "Complaint supervisor embed blank",
      ),
  );
  await query(
    "Failed Inspection composite employee FK",
    supabase
      .from("failed_inspections")
      .select(
        "issue_no, assignee:employees!failed_inspections_assigned_person_fkey(employee_id, full_name)",
      )
      .eq("tenant_id", tenantId)
      .eq("issue_no", ids.failed),
    (rows) =>
      assert(
        relation(rows[0]?.assignee)?.full_name,
        "Failed Inspection assignee embed blank",
      ),
  );
  await query(
    "Incident composite employee FK",
    supabase
      .from("incident_register")
      .select(
        "incident_no, reporter:employees!incident_register_reported_by_fkey(employee_id, full_name)",
      )
      .eq("tenant_id", tenantId)
      .eq("incident_no", ids.incident),
    (rows) =>
      assert(
        relation(rows[0]?.reporter)?.full_name,
        "Incident reporter embed blank",
      ),
  );
  await query(
    "Corrective Action internal composite FKs",
    supabase
      .from("corrective_actions")
      .select(
        "action_no, responsible:employees!corrective_actions_responsible_person_fkey(employee_id, full_name), work_order:work_orders!corrective_actions_related_work_order_fkey(work_order_no), failed_issue:failed_inspections!corrective_actions_related_issue_no_fkey(issue_no)",
      )
      .eq("tenant_id", tenantId)
      .eq("action_no", ids.action),
    (rows) => {
      assert(rows.length === 1, "Test corrective action not found");
      assert(relation(rows[0].responsible)?.full_name, "Responsible employee embed blank");
      assert(relation(rows[0].work_order)?.work_order_no === ids.workOrder, "Work-order embed broken");
      assert(relation(rows[0].failed_issue)?.issue_no === ids.failed, "Failed-issue embed broken");
    },
  );

  console.log("\nPASS: all requested staging read/write checks completed.");
} catch (error) {
  failed = true;
  console.error(`\nFAIL: ${error.message ?? error}`);
  console.error("Stopped immediately; no further smoke checks were attempted.");
} finally {
  console.log("\n=== CLEANUP (reverse dependency order) ===");
  for (const cleanupStep of cleanup.reverse()) {
    await cleanupStep();
  }

  const { data: leftovers, error: leftoverError } = await supabase
    .from("employees")
    .select("tenant_id, employee_id")
    .like("employee_id", "ZZSMK%");
  if (leftoverError) {
    cleanupFailed = true;
    console.error(`FAIL CLEANUP verification: ${formatError(leftoverError)}`);
  } else if (leftovers.length > 0) {
    cleanupFailed = true;
    console.error(
      `FAIL CLEANUP verification: ${leftovers.length} ZZSMK employee row(s) remain: ${JSON.stringify(leftovers)}`,
    );
  } else {
    console.log("PASS CLEANUP verification: no ZZSMK employee rows remain");
  }

  process.exitCode = failed || cleanupFailed ? 1 : 0;
}
