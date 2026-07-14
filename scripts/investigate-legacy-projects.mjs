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

const LEGACY_CODES = [
  "PRJ02",
  "PRJ03",
  "PRJ04",
  "PRJ05",
  "PRJ06",
  "PRJ07",
  "PRJ23",
];

async function countAndSample(supabase, table, column, code, select = "*") {
  const { count, error: countError } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq(column, code);

  if (countError) {
    return { count: null, error: countError.message, rows: [] };
  }

  if (!count) {
    return { count: 0, error: null, rows: [] };
  }

  const { data, error } = await supabase
    .from(table)
    .select(select)
    .eq(column, code)
    .limit(20);

  return { count, error: error?.message ?? null, rows: data ?? [] };
}

async function ilikeCountAndSample(supabase, table, column, pattern, select = "*") {
  const { count, error: countError } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .ilike(column, pattern);

  if (countError) {
    return { count: null, error: countError.message, rows: [] };
  }

  if (!count) {
    return { count: 0, error: null, rows: [] };
  }

  const { data, error } = await supabase
    .from(table)
    .select(select)
    .ilike(column, pattern)
    .limit(20);

  return { count, error: error?.message ?? null, rows: data ?? [] };
}

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const { data: projects, error: projectsError } = await supabase
    .from("projects")
    .select("id, project_code, project_name, required_staff")
    .in("project_code", LEGACY_CODES)
    .order("project_code");

  if (projectsError) throw new Error(projectsError.message);

  const projectByCode = new Map(projects.map((row) => [row.project_code, row]));

  console.log("=== LEGACY PROJECT ROWS (projects table) ===");
  console.table(projects);

  const { data: serviceTypes } = await supabase
    .from("service_types")
    .select("name")
    .order("name");

  const { data: positions } = await supabase
    .from("positions")
    .select("*")
    .order("name", { ascending: true });

  console.log("\n=== service_types table (Income Register dropdown source) ===");
  console.log((serviceTypes ?? []).map((row) => row.name).join(", ") || "(none)");

  console.log("\n=== positions table (Employee Position field source) ===");
  console.table(positions ?? []);

  for (const code of LEGACY_CODES) {
    const project = projectByCode.get(code);
    const name = project?.project_name ?? "?";
    console.log(`\n========== ${code} — ${name} ==========`);

    const checks = [
      ["employees", "contract_project", code],
      ["work_orders", "contract_project", code],
      ["attendance_register", "project_assignment", code],
      ["payroll_processing", "project_contract", code],
      ["payroll_history", "project_contract", code],
    ];

    for (const [table, column, value] of checks) {
      const result = await countAndSample(supabase, table, column, value, "*");
      if (result.error) {
        console.log(`  ${table}.${column}: ERROR — ${result.error}`);
        continue;
      }
      console.log(`  ${table}.${column}: ${result.count} row(s)`);
      if (result.rows.length) {
        console.log(JSON.stringify(result.rows, null, 2));
      }
    }

    if (project?.id) {
      const { count, error } = await supabase
        .from("sites")
        .select("*", { count: "exact", head: true })
        .eq("project_id", project.id);
      if (error) {
        console.log(`  sites.project_id: ERROR — ${error.message}`);
      } else {
        console.log(`  sites.project_id (${project.id}): ${count ?? 0} row(s)`);
        if (count) {
          const { data: siteRows } = await supabase
            .from("sites")
            .select("site_code, site_name, client_id, project_id")
            .eq("project_id", project.id);
          console.log(JSON.stringify(siteRows, null, 2));
        }
      }
    }

    const incomeByCategory = await countAndSample(
      supabase,
      "income_register",
      "service_category",
      name,
      "id, date, invoice_no, service_category, amount, customer_name",
    );
    if (incomeByCategory.error) {
      console.log(`  income_register.service_category='${name}': ERROR — ${incomeByCategory.error}`);
    } else {
      console.log(
        `  income_register.service_category exact match '${name}': ${incomeByCategory.count} row(s)`,
      );
      if (incomeByCategory.rows.length) {
        console.log(JSON.stringify(incomeByCategory.rows, null, 2));
      }
    }

    const woServiceType = await ilikeCountAndSample(
      supabase,
      "work_orders",
      "service_type",
      `%${name}%`,
      "work_order_no, date, service_type, client_id, site_id",
    );
    if (woServiceType.error) {
      console.log(`  work_orders.service_type ILIKE '%${name}%': ERROR — ${woServiceType.error}`);
    } else {
      console.log(
        `  work_orders.service_type ILIKE '%${name}%': ${woServiceType.count} row(s)`,
      );
      if (woServiceType.rows.length) {
        console.log(JSON.stringify(woServiceType.rows, null, 2));
      }
    }

    const employeesByPosition = await ilikeCountAndSample(
      supabase,
      "employees",
      "position",
      `%${name}%`,
      "staff_id, full_name, position, contract_project",
    );
    if (employeesByPosition.error) {
      console.log(`  employees.position ILIKE '%${name}%': ERROR — ${employeesByPosition.error}`);
    } else {
      console.log(
        `  employees.position ILIKE '%${name}%': ${employeesByPosition.count} row(s)`,
      );
      if (employeesByPosition.rows.length) {
        console.log(JSON.stringify(employeesByPosition.rows, null, 2));
      }
    }
  }

  console.log("\n=== ROSTER HISTORY via employees on legacy codes ===");
  const { data: legacyEmployees } = await supabase
    .from("employees")
    .select("employee_id, staff_id, full_name, contract_project")
    .in("contract_project", LEGACY_CODES);

  const legacyEmployeeIds = (legacyEmployees ?? []).map((row) => row.employee_id);
  if (legacyEmployeeIds.length) {
    const { count } = await supabase
      .from("roster_history")
      .select("*", { count: "exact", head: true })
      .in("employee_id", legacyEmployeeIds);
    console.log(`roster_history rows for legacy-contract employees: ${count ?? 0}`);
  } else {
    console.log("No employees on legacy contract codes — roster_history N/A");
  }

  console.log("\n=== ALL projects count for UI dropdown context ===");
  const { count: allProjectsCount } = await supabase
    .from("projects")
    .select("*", { count: "exact", head: true });
  console.log(`Total projects rows: ${allProjectsCount}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
