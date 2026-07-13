import type { SupabaseClient } from "@supabase/supabase-js";
import type { NamedLookup } from "../lookup-types";
import type { SiteLookup, EmployeeRecord } from "./employee-record-utils";
import {
  mapCasualTaxConfigRow,
  mapPayeBandRows,
  mapSsnitConfigRow,
  type CasualTaxRateConfig,
  type PayeTaxBand,
  type SalaryRateConfig,
  type SsnitRateConfig,
} from "./pay-estimate-utils";

export type DepartmentLookup = {
  code: string;
  name: string;
};

export type ProjectLookup = {
  code: string;
  name: string;
};

export type PositionLookup = {
  id: string;
  name: string;
};

async function fetchDepartments(
  supabase: SupabaseClient,
): Promise<DepartmentLookup[]> {
  const { data, error } = await supabase
    .from("departments")
    .select("dept_code, department_name")
    .order("department_name", { ascending: true });

  if (error || !data?.length) {
    return [];
  }

  return data.map((row) => {
    const record = row as Record<string, string>;
    return {
      code: record.dept_code,
      name: record.department_name,
    };
  });
}

async function fetchProjects(
  supabase: SupabaseClient,
): Promise<ProjectLookup[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("project_code, project_name")
    .order("project_name", { ascending: true });

  if (error || !data?.length) {
    return [];
  }

  return data.map((row) => {
    const record = row as Record<string, string>;
    return {
      code: record.project_code,
      name: record.project_name,
    };
  });
}

async function fetchPositions(
  supabase: SupabaseClient,
): Promise<PositionLookup[]> {
  const attempts = [
    { idColumn: "position_id", nameColumn: "position_name" },
    { idColumn: "position_id", nameColumn: "name" },
    { idColumn: "code", nameColumn: "name" },
  ] as const;

  for (const attempt of attempts) {
    const { data, error } = await supabase
      .from("positions")
      .select(`${attempt.idColumn}, ${attempt.nameColumn}`)
      .order(attempt.nameColumn, { ascending: true });

    if (error || !data?.length) {
      continue;
    }

    return data.map((row) => {
      const record = row as Record<string, string>;
      return {
        id: record[attempt.idColumn],
        name: record[attempt.nameColumn],
      };
    });
  }

  const { data, error } = await supabase
    .from("positions")
    .select("name")
    .order("name", { ascending: true });

  if (error || !data?.length) {
    return [];
  }

  return (data as NamedLookup[]).map((row) => ({
    id: row.name,
    name: row.name,
  }));
}

async function fetchNamedLookup(
  supabase: SupabaseClient,
  table: string,
): Promise<NamedLookup[]> {
  const { data, error } = await supabase
    .from(table)
    .select("name")
    .order("name", { ascending: true });

  if (error) {
    return [];
  }

  return (data as NamedLookup[] | null) ?? [];
}

async function fetchSites(supabase: SupabaseClient): Promise<SiteLookup[]> {
  const attempts = [
    { table: "sites", idColumn: "site_id" },
    { table: "sites", idColumn: "id" },
    { table: "project_setup", idColumn: "id" },
  ] as const;

  for (const attempt of attempts) {
    const { data, error } = await supabase
      .from(attempt.table)
      .select(`${attempt.idColumn}, name`)
      .order("name", { ascending: true });

    if (error || !data?.length) {
      continue;
    }

    return data.map((row) => {
      const record = row as Record<string, string>;
      return {
        id: record[attempt.idColumn],
        name: record.name,
      };
    });
  }

  return [];
}

export type EmployeeLookups = {
  departments: DepartmentLookup[];
  positions: PositionLookup[];
  projects: ProjectLookup[];
  shifts: NamedLookup[];
  sites: SiteLookup[];
};

export type EmployeePayConfig = {
  salaryRates: SalaryRateConfig[];
  ssnitConfig: SsnitRateConfig | null;
  casualTaxConfig: CasualTaxRateConfig | null;
  payeBands: PayeTaxBand[];
};

export async function loadEmployeeLookups(
  supabase: SupabaseClient,
): Promise<EmployeeLookups> {
  const [departments, positions, projects, shifts, sites] = await Promise.all([
    fetchDepartments(supabase),
    fetchPositions(supabase),
    fetchProjects(supabase),
    fetchNamedLookup(supabase, "shifts"),
    fetchSites(supabase),
  ]);

  return {
    departments,
    positions,
    projects,
    shifts,
    sites,
  };
}

export async function loadEmployeePayConfig(
  supabase: SupabaseClient,
): Promise<EmployeePayConfig> {
  const [
    { data: salaryRates, error: salaryRatesError },
    { data: ssnitRows, error: ssnitError },
    { data: casualRows, error: casualError },
    { data: payeRows, error: payeError },
  ] = await Promise.all([
    supabase
      .from("salary_rate_config")
      .select("*")
      .order("effective_date", { ascending: false }),
    supabase.from("ssnit_rate_config").select("*").limit(1),
    supabase.from("casual_tax_rate_config").select("*").limit(1),
    supabase
      .from("paye_tax_bands")
      .select("*")
      .order("band_from", { ascending: true }),
  ]);

  if (salaryRatesError || ssnitError || casualError || payeError) {
    // Config tables may be empty during initial setup; fall back gracefully.
  }

  return {
    salaryRates: (salaryRates as SalaryRateConfig[] | null) ?? [],
    ssnitConfig: mapSsnitConfigRow(
      (ssnitRows?.[0] as Record<string, unknown> | undefined) ?? null,
    ),
    casualTaxConfig: mapCasualTaxConfigRow(
      (casualRows?.[0] as Record<string, unknown> | undefined) ?? null,
    ),
    payeBands: mapPayeBandRows(
      (payeRows as Record<string, unknown>[] | null) ?? [],
    ),
  };
}

export function buildDepartmentNameMap(
  departments: DepartmentLookup[],
): Map<string, string> {
  return new Map(
    departments.map((department) => [department.code, department.name]),
  );
}

export function buildProjectNameMap(
  projects: ProjectLookup[],
): Map<string, string> {
  return new Map(projects.map((project) => [project.code, project.name]));
}

export function getDepartmentName(
  departmentMap: Map<string, string>,
  departmentCode: string | null | undefined,
  departmentRef?: EmployeeRecord["department_ref"],
): string {
  if (departmentRef?.department_name) {
    return departmentRef.department_name;
  }

  if (!departmentCode) {
    return "—";
  }

  return departmentMap.get(departmentCode) ?? departmentCode;
}

export function getProjectName(
  projectMap: Map<string, string>,
  projectCode: string | null | undefined,
  projectRef?: EmployeeRecord["project_ref"],
): string {
  if (projectRef?.project_name) {
    return projectRef.project_name;
  }

  if (!projectCode) {
    return "—";
  }

  return projectMap.get(projectCode) ?? projectCode;
}

export function getPositionName(
  positions: PositionLookup[],
  positionValue: string | null | undefined,
): string {
  if (!positionValue) {
    return "—";
  }

  const match = positions.find(
    (position) => position.id === positionValue || position.name === positionValue,
  );

  return match?.name ?? positionValue;
}
