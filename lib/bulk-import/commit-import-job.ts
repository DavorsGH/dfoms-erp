import "server-only";

import type { Client } from "pg";
import {
  buildEmployeeCommitInsert,
  buildFinishedProductCommitInsert,
  buildServiceCatalogCommitInsert,
} from "@/lib/bulk-import/build-commit-payload";
import {
  allocateEmployeeIdsForCommit,
  resolveAssignedSiteCodeForCommit,
  resolveDepartmentCodeForCommit,
  resolvePositionTitleForCommit,
  resolveProjectCodeForCommit,
  resolveSupervisorIdForCommit,
  type DepartmentCodeResolverCache,
  type PositionTitleResolverCache,
  type ProjectCodeResolverCache,
  type SiteCodeResolverCache,
  type SupervisorIdResolverCache,
} from "@/lib/bulk-import/resolve-employee-for-commit";
import {
  resolveSupplierIdForCommit,
  type SupplierIdResolverCache,
} from "@/lib/bulk-import/resolve-supplier-for-commit";
import { FINISHED_PRODUCT_PURCHASED_SOURCING_TYPE } from "@/lib/bulk-import/target-fields";
import type { BulkImportType } from "@/lib/bulk-import/types";
import {
  buildEmploymentHistoryInsert,
  snapshotFromPayload,
} from "@/app/dashboard/employees/employment-history-utils";

export type CommitImportRow = {
  id: string;
  mapped_data: Record<string, unknown>;
};

async function insertFinishedProduct(
  client: Client,
  tenantId: string,
  mappedData: Record<string, unknown>,
  supplierCache: SupplierIdResolverCache,
) {
  const sourcingRaw = String(mappedData.sourcing_type ?? "").trim().toLowerCase();
  const isPurchased = sourcingRaw === FINISHED_PRODUCT_PURCHASED_SOURCING_TYPE;
  const supplierName = String(mappedData.supplier_name ?? "").trim();

  const resolvedSupplierId = isPurchased && supplierName
    ? await resolveSupplierIdForCommit({
        client,
        tenantId,
        supplierName,
        cache: supplierCache,
      })
    : null;

  const payload = buildFinishedProductCommitInsert(
    mappedData,
    tenantId,
    resolvedSupplierId,
  );

  await client.query(
    `
      INSERT INTO public.finished_products (
        tenant_id,
        product_code,
        product_name,
        unit_of_measure,
        current_stock,
        standard_selling_price,
        sourcing_type,
        supplier_id,
        manufacturing_date,
        expiration_date
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `,
    [
      payload.tenant_id,
      payload.product_code,
      payload.product_name,
      payload.unit_of_measure,
      payload.current_stock,
      payload.standard_selling_price,
      payload.sourcing_type,
      payload.supplier_id,
      payload.manufacturing_date,
      payload.expiration_date,
    ],
  );
}

async function insertServiceCatalogRow(
  client: Client,
  tenantId: string,
  mappedData: Record<string, unknown>,
) {
  const payload = buildServiceCatalogCommitInsert(mappedData, tenantId);

  await client.query(
    `
      INSERT INTO public.service_catalog (
        tenant_id,
        service_name,
        description,
        default_rate,
        billing_unit,
        category
      )
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [
      payload.tenant_id,
      payload.service_name,
      payload.description,
      payload.default_rate,
      payload.billing_unit,
      payload.category,
    ],
  );
}

async function insertEmployeeRow(
  client: Client,
  tenantId: string,
  mappedData: Record<string, unknown>,
  changedBy: string,
  caches: {
    departmentCache: DepartmentCodeResolverCache;
    positionCache: PositionTitleResolverCache;
    projectCache: ProjectCodeResolverCache;
    supervisorCache: SupervisorIdResolverCache;
    siteCache: SiteCodeResolverCache;
  },
) {
  const departmentCode = await resolveDepartmentCodeForCommit({
    client,
    tenantId,
    departmentName: String(mappedData.department_name ?? ""),
    cache: caches.departmentCache,
  });
  const positionTitle = await resolvePositionTitleForCommit({
    client,
    tenantId,
    positionTitle: String(mappedData.position_title ?? ""),
    cache: caches.positionCache,
  });
  const projectCode = await resolveProjectCodeForCommit({
    client,
    tenantId,
    projectName: String(mappedData.contract_project_name ?? ""),
    cache: caches.projectCache,
  });
  const supervisorId = await resolveSupervisorIdForCommit({
    client,
    tenantId,
    supervisorName: String(mappedData.supervisor_name ?? ""),
    cache: caches.supervisorCache,
  });
  const assignedSiteCode = await resolveAssignedSiteCodeForCommit({
    client,
    tenantId,
    siteName: String(mappedData.assigned_site_name ?? ""),
    cache: caches.siteCache,
  });

  const { employeeId, staffId } = await allocateEmployeeIdsForCommit({
    client,
    tenantId,
  });

  const payload = buildEmployeeCommitInsert({
    mappedData,
    tenantId,
    employeeId,
    staffId,
    departmentCode,
    positionTitle,
    projectCode,
    supervisorId,
    assignedSiteCode,
  });

  await client.query(
    `
      INSERT INTO public.employees (
        tenant_id,
        employee_id,
        staff_id,
        full_name,
        gender,
        nationality,
        marital_status,
        phone,
        email,
        department,
        position,
        supervisor,
        employment_type,
        date_hired,
        appointment_end_date,
        employment_status,
        contract_project,
        shift,
        assigned_site_id,
        data_notes,
        basic_salary,
        housing_allowance,
        transport_allowance,
        other_allowances
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        0, 0, 0, 0
      )
    `,
    [
      payload.tenant_id,
      payload.employee_id,
      payload.staff_id,
      payload.full_name,
      payload.gender,
      payload.nationality,
      payload.marital_status,
      payload.phone,
      payload.email,
      payload.department,
      payload.position,
      payload.supervisor,
      payload.employment_type,
      payload.date_hired,
      payload.appointment_end_date,
      payload.employment_status,
      payload.contract_project,
      payload.shift,
      payload.assigned_site_id,
      payload.data_notes,
    ],
  );

  const leaveYear = new Date().getFullYear();
  await client.query(
    `
      INSERT INTO public.employee_leave_balances (
        tenant_id,
        employee_id,
        leave_type_id,
        year,
        entitled_days,
        days_used
      )
      SELECT
        $1,
        $2,
        lt.id,
        $3,
        public.resolve_leave_entitlement($1, $4, $5, lt.type_name),
        0
      FROM public.leave_types lt
      WHERE lt.type_name = ANY (
        ARRAY['Annual Leave'::text, 'Sick Leave'::text, 'Unpaid Leave'::text]
      )
      ON CONFLICT (employee_id, leave_type_id, year) DO NOTHING
    `,
    [
      payload.tenant_id,
      payload.employee_id,
      leaveYear,
      payload.position,
      payload.employment_type,
    ],
  );

  const historyInsert = buildEmploymentHistoryInsert({
    employeeId: payload.employee_id,
    snapshot: snapshotFromPayload({
      position: payload.position,
      department: payload.department,
      shift: payload.shift,
      employment_status: payload.employment_status,
      employment_type: payload.employment_type,
      basic_salary: 0,
      housing_allowance: 0,
      transport_allowance: 0,
      other_allowances: 0,
    }),
    changeReason: "Employee created",
    changedBy,
  });

  await client.query(
    `
      INSERT INTO public.employee_employment_history (
        tenant_id,
        employee_id,
        effective_date,
        employment_type,
        position,
        shift,
        department,
        rate_id,
        basic_salary,
        housing_allowance,
        transport_allowance,
        other_allowances,
        employee_status,
        change_reason,
        changed_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    `,
    [
      payload.tenant_id,
      historyInsert.employee_id,
      historyInsert.effective_date,
      historyInsert.employment_type,
      historyInsert.position,
      historyInsert.shift,
      historyInsert.department,
      historyInsert.rate_id,
      historyInsert.basic_salary,
      historyInsert.housing_allowance,
      historyInsert.transport_allowance,
      historyInsert.other_allowances,
      historyInsert.employee_status,
      historyInsert.change_reason,
      historyInsert.changed_by,
    ],
  );
}

export async function commitImportJobInTransaction(input: {
  client: Client;
  jobId: string;
  tenantId: string;
  importType: BulkImportType;
  rows: CommitImportRow[];
  changedBy?: string;
}): Promise<number> {
  const { client, jobId, tenantId, importType, rows, changedBy } = input;

  await client.query("BEGIN");

  try {
    const supplierCache: SupplierIdResolverCache = new Map();
    const departmentCache: DepartmentCodeResolverCache = new Map();
    const positionCache: PositionTitleResolverCache = new Map();
    const projectCache: ProjectCodeResolverCache = new Map();
    const supervisorCache: SupervisorIdResolverCache = new Map();
    const siteCache: SiteCodeResolverCache = new Map();

    for (const row of rows) {
      if (importType === "product") {
        await insertFinishedProduct(client, tenantId, row.mapped_data, supplierCache);
      } else if (importType === "service") {
        await insertServiceCatalogRow(client, tenantId, row.mapped_data);
      } else {
        await insertEmployeeRow(
          client,
          tenantId,
          row.mapped_data,
          changedBy ?? "Bulk import",
          {
            departmentCache,
            positionCache,
            projectCache,
            supervisorCache,
            siteCache,
          },
        );
      }

      await client.query(
        `
          UPDATE public.bulk_import_rows AS r
          SET status = 'committed', error_message = NULL
          FROM public.bulk_import_jobs AS j
          WHERE r.id = $1
            AND r.job_id = $2
            AND j.id = r.job_id
            AND j.tenant_id = $3
        `,
        [row.id, jobId, tenantId],
      );
    }

    await client.query(
      `
        UPDATE public.bulk_import_jobs
        SET status = 'committed', committed_at = now()
        WHERE id = $1 AND tenant_id = $2
      `,
      [jobId, tenantId],
    );

    await client.query("COMMIT");
    return rows.length;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
