import "server-only";

import type { Client } from "pg";
import { toPlainStaffId } from "@/app/dashboard/employees/employee-ids-api";
import { normalizeTenantLookupKey } from "@/lib/bulk-import/tenant-name-lookup";

export const DEPARTMENT_CODE_ENTITY_TYPE = "DEPT";
export const PROJECT_CODE_ENTITY_TYPE = "PROJ";

export type DepartmentCodeResolverCache = Map<string, string>;
export type PositionTitleResolverCache = Map<string, string>;
export type ProjectCodeResolverCache = Map<string, string>;
export type SupervisorIdResolverCache = Map<string, string>;
export type SiteCodeResolverCache = Map<string, string>;

async function generateNextCodeInTransaction(
  client: Client,
  tenantId: string,
  entityType: string,
): Promise<string> {
  const result = await client.query(
    `SELECT public.generate_next_code($1, $2, 4) AS code`,
    [tenantId, entityType],
  );

  const code = String(result.rows[0]?.code ?? "").trim();
  if (!code) {
    throw new Error(`generate_next_code returned an empty ${entityType} code.`);
  }

  return code;
}

async function lookupSingleMatch<T>(
  client: Client,
  query: string,
  params: unknown[],
  mapRow: (row: Record<string, unknown>) => T,
): Promise<T | null> {
  const result = await client.query(query, params);
  if (result.rows.length > 1) {
    return null;
  }

  if (result.rows.length === 0) {
    return null;
  }

  return mapRow(result.rows[0] as Record<string, unknown>);
}

export async function resolveDepartmentCodeForCommit(input: {
  client: Client;
  tenantId: string;
  departmentName: string | null;
  cache: DepartmentCodeResolverCache;
}): Promise<string | null> {
  const { client, tenantId, departmentName, cache } = input;
  const trimmed = departmentName?.trim();
  if (!trimmed) {
    return null;
  }

  const key = normalizeTenantLookupKey(trimmed);
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const existing = await client.query(
    `
      SELECT dept_code
      FROM public.departments
      WHERE tenant_id = $1
        AND lower(trim(department_name)) = $2
      ORDER BY dept_code
    `,
    [tenantId, key],
  );

  if (existing.rows.length > 1) {
    throw new Error(
      `department_name "${trimmed}" matches multiple departments for this tenant`,
    );
  }

  if (existing.rows.length === 1) {
    const deptCode = String(existing.rows[0].dept_code);
    cache.set(key, deptCode);
    return deptCode;
  }

  const deptCode = await generateNextCodeInTransaction(
    client,
    tenantId,
    DEPARTMENT_CODE_ENTITY_TYPE,
  );

  await client.query(
    `
      INSERT INTO public.departments (tenant_id, dept_code, department_name)
      VALUES ($1, $2, $3)
    `,
    [tenantId, deptCode, trimmed],
  );

  cache.set(key, deptCode);
  return deptCode;
}

export async function resolvePositionTitleForCommit(input: {
  client: Client;
  tenantId: string;
  positionTitle: string | null;
  cache: PositionTitleResolverCache;
}): Promise<string | null> {
  const { client, tenantId, positionTitle, cache } = input;
  const trimmed = positionTitle?.trim();
  if (!trimmed) {
    return null;
  }

  const key = normalizeTenantLookupKey(trimmed);
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const existing = await client.query(
    `
      SELECT position_title
      FROM public.positions
      WHERE tenant_id = $1
        AND lower(trim(position_title)) = $2
      ORDER BY position_title
    `,
    [tenantId, key],
  );

  if (existing.rows.length > 1) {
    throw new Error(
      `position_title "${trimmed}" matches multiple positions for this tenant`,
    );
  }

  if (existing.rows.length === 1) {
    const title = String(existing.rows[0].position_title);
    cache.set(key, title);
    return title;
  }

  await client.query(
    `
      INSERT INTO public.positions (tenant_id, position_title)
      VALUES ($1, $2)
      ON CONFLICT (tenant_id, position_title) DO NOTHING
    `,
    [tenantId, trimmed],
  );

  const resolved = await lookupSingleMatch(
    client,
    `
      SELECT position_title
      FROM public.positions
      WHERE tenant_id = $1
        AND lower(trim(position_title)) = $2
      ORDER BY position_title
    `,
    [tenantId, key],
    (row) => String(row.position_title),
  );

  if (!resolved) {
    throw new Error(`Unable to resolve position_title "${trimmed}" after create.`);
  }

  cache.set(key, resolved);
  return resolved;
}

export async function resolveProjectCodeForCommit(input: {
  client: Client;
  tenantId: string;
  projectName: string | null;
  cache: ProjectCodeResolverCache;
}): Promise<string | null> {
  const { client, tenantId, projectName, cache } = input;
  const trimmed = projectName?.trim();
  if (!trimmed) {
    return null;
  }

  const key = normalizeTenantLookupKey(trimmed);
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const existing = await client.query(
    `
      SELECT project_code
      FROM public.projects
      WHERE tenant_id = $1
        AND lower(trim(project_name)) = $2
      ORDER BY project_code
    `,
    [tenantId, key],
  );

  if (existing.rows.length > 1) {
    throw new Error(
      `contract_project_name "${trimmed}" matches multiple projects for this tenant`,
    );
  }

  if (existing.rows.length === 1) {
    const projectCode = String(existing.rows[0].project_code);
    cache.set(key, projectCode);
    return projectCode;
  }

  const projectCode = await generateNextCodeInTransaction(
    client,
    tenantId,
    PROJECT_CODE_ENTITY_TYPE,
  );

  await client.query(
    `
      INSERT INTO public.projects (tenant_id, project_code, project_name)
      VALUES ($1, $2, $3)
    `,
    [tenantId, projectCode, trimmed],
  );

  cache.set(key, projectCode);
  return projectCode;
}

export async function resolveSupervisorIdForCommit(input: {
  client: Client;
  tenantId: string;
  supervisorName: string | null;
  cache: SupervisorIdResolverCache;
}): Promise<string | null> {
  const { client, tenantId, supervisorName, cache } = input;
  const trimmed = supervisorName?.trim();
  if (!trimmed) {
    return null;
  }

  const key = normalizeTenantLookupKey(trimmed);
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const existing = await client.query(
    `
      SELECT employee_id
      FROM public.employees
      WHERE tenant_id = $1
        AND lower(trim(full_name)) = $2
      ORDER BY employee_id
    `,
    [tenantId, key],
  );

  if (existing.rows.length > 1) {
    throw new Error(
      `supervisor_name "${trimmed}" matches multiple employees for this tenant`,
    );
  }

  if (existing.rows.length === 0) {
    return null;
  }

  const employeeId = String(existing.rows[0].employee_id);
  cache.set(key, employeeId);
  return employeeId;
}

export async function resolveAssignedSiteCodeForCommit(input: {
  client: Client;
  tenantId: string;
  siteName: string | null;
  cache: SiteCodeResolverCache;
}): Promise<string | null> {
  const { client, tenantId, siteName, cache } = input;
  const trimmed = siteName?.trim();
  if (!trimmed) {
    return null;
  }

  const key = normalizeTenantLookupKey(trimmed);
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const existing = await client.query(
    `
      SELECT site_code
      FROM public.sites
      WHERE tenant_id = $1
        AND lower(trim(site_name)) = $2
      ORDER BY site_code
    `,
    [tenantId, key],
  );

  if (existing.rows.length > 1) {
    throw new Error(
      `assigned_site_name "${trimmed}" matches multiple sites for this tenant`,
    );
  }

  if (existing.rows.length === 0) {
    return null;
  }

  const siteCode = String(existing.rows[0].site_code);
  cache.set(key, siteCode);
  return siteCode;
}

export async function allocateEmployeeIdsForCommit(input: {
  client: Client;
  tenantId: string;
}): Promise<{ employeeId: string; staffId: string }> {
  const { client, tenantId } = input;

  const employeeId = await generateNextCodeInTransaction(client, tenantId, "EMP");
  const staffRaw = await generateNextCodeInTransaction(client, tenantId, "STAFF");

  return {
    employeeId,
    staffId: toPlainStaffId(staffRaw),
  };
}
