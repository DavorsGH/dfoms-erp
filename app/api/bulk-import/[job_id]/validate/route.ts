import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ROW_INSERT_BATCH_SIZE } from "@/lib/bulk-import/parse-spreadsheet-upload";
import {
  BULK_IMPORT_GATE_ROLES,
  requireBulkImportAccess,
} from "@/lib/bulk-import/bulk-import-route-auth";
import { buildSupplierNameMatchCounts } from "@/lib/bulk-import/supplier-name";
import { buildTenantNameMatchCounts } from "@/lib/bulk-import/tenant-name-lookup";
import { validateImportRows } from "@/lib/bulk-import/validate-import-rows";
import type {
  BulkImportColumnMapping,
  BulkImportType,
  BulkImportValidationResponse,
} from "@/lib/bulk-import/types";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { createClient } from "@/utils/supabase/server";

const VALID_IMPORT_TYPES = new Set<BulkImportType>(["product", "service", "employee"]);

async function getTenantSupabase() {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

function parseColumnMapping(value: unknown): BulkImportColumnMapping | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const mapping: BulkImportColumnMapping = {};
  for (const [header, targetField] of Object.entries(value)) {
    if (typeof targetField !== "string" || !targetField.trim()) {
      continue;
    }

    mapping[header] = targetField.trim();
  }

  return mapping;
}

function parseRawData(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ job_id: string }> },
) {
  const gateAuth = await requireTenantRoleIn(BULK_IMPORT_GATE_ROLES);
  if (!gateAuth.ok) {
    return gateAuth.response;
  }

  const { job_id: jobId } = await context.params;
  const trimmedJobId = jobId?.trim();
  if (!trimmedJobId) {
    return NextResponse.json({ error: "job_id is required." }, { status: 400 });
  }

  const supabase = await getTenantSupabase();

  const { data: job, error: jobError } = await supabase
    .from("bulk_import_jobs")
    .select("id, tenant_id, import_type, column_mapping")
    .eq("id", trimmedJobId)
    .eq("tenant_id", gateAuth.tenantId)
    .maybeSingle();

  if (jobError) {
    return NextResponse.json({ error: jobError.message }, { status: 500 });
  }

  if (!job) {
    return NextResponse.json({ error: "Import job not found." }, { status: 404 });
  }

  const importType = String(job.import_type ?? "").trim() as BulkImportType;
  if (!VALID_IMPORT_TYPES.has(importType)) {
    return NextResponse.json(
      { error: "Import job has an invalid import_type." },
      { status: 400 },
    );
  }

  const sectionAuth = await requireBulkImportAccess(importType);
  if (!sectionAuth.ok) {
    return sectionAuth.response;
  }

  const columnMapping = parseColumnMapping(job.column_mapping);
  if (!columnMapping || Object.keys(columnMapping).length === 0) {
    return NextResponse.json(
      { error: "Save a column mapping before validating." },
      { status: 400 },
    );
  }

  const { data: rows, error: rowsError } = await supabase
    .from("bulk_import_rows")
    .select("id, row_number, raw_data")
    .eq("job_id", trimmedJobId)
    .order("row_number", { ascending: true });

  if (rowsError) {
    return NextResponse.json({ error: rowsError.message }, { status: 500 });
  }

  let existingProductCodes = new Set<string>();
  let existingServiceNames = new Set<string>();
  let supplierNameMatchCounts = new Map<string, number>();
  let employeeLookups;

  if (importType === "product") {
    const { data: suppliers, error: suppliersError } = await supabase
      .from("suppliers")
      .select("name")
      .eq("tenant_id", sectionAuth.tenantId);

    if (suppliersError) {
      return NextResponse.json({ error: suppliersError.message }, { status: 500 });
    }

    supplierNameMatchCounts = buildSupplierNameMatchCounts(
      (suppliers ?? []).map((row) => ({ name: String(row.name ?? "") })),
    );

    const { data: products, error: productsError } = await supabase
      .from("finished_products")
      .select("product_code")
      .eq("tenant_id", sectionAuth.tenantId);

    if (productsError) {
      return NextResponse.json({ error: productsError.message }, { status: 500 });
    }

    existingProductCodes = new Set(
      (products ?? [])
        .map((row) => String(row.product_code ?? "").trim().toLowerCase())
        .filter(Boolean),
    );
  } else if (importType === "service") {
    const { data: services, error: servicesError } = await supabase
      .from("service_catalog")
      .select("service_name")
      .eq("tenant_id", sectionAuth.tenantId);

    if (servicesError) {
      return NextResponse.json({ error: servicesError.message }, { status: 500 });
    }

    existingServiceNames = new Set(
      (services ?? [])
        .map((row) => String(row.service_name ?? "").trim().toLowerCase())
        .filter(Boolean),
    );
  } else {
    const [
      departmentsResult,
      positionsResult,
      projectsResult,
      employeesResult,
      sitesResult,
    ] = await Promise.all([
      supabase
        .from("departments")
        .select("department_name")
        .eq("tenant_id", sectionAuth.tenantId),
      supabase
        .from("positions")
        .select("position_title")
        .eq("tenant_id", sectionAuth.tenantId),
      supabase
        .from("projects")
        .select("project_name")
        .eq("tenant_id", sectionAuth.tenantId),
      supabase
        .from("employees")
        .select("full_name")
        .eq("tenant_id", sectionAuth.tenantId),
      supabase
        .from("sites")
        .select("site_name")
        .eq("tenant_id", sectionAuth.tenantId),
    ]);

    const lookupErrors = [
      departmentsResult.error,
      positionsResult.error,
      projectsResult.error,
      employeesResult.error,
      sitesResult.error,
    ].filter(Boolean);

    if (lookupErrors.length > 0) {
      return NextResponse.json(
        { error: lookupErrors[0]?.message ?? "Failed to load employee lookup data." },
        { status: 500 },
      );
    }

    employeeLookups = {
      departmentNameMatchCounts: buildTenantNameMatchCounts(
        (departmentsResult.data ?? []).map((row) => ({
          name: String(row.department_name ?? ""),
        })),
      ),
      positionTitleMatchCounts: buildTenantNameMatchCounts(
        (positionsResult.data ?? []).map((row) => ({
          name: String(row.position_title ?? ""),
        })),
      ),
      contractProjectNameMatchCounts: buildTenantNameMatchCounts(
        (projectsResult.data ?? []).map((row) => ({
          name: String(row.project_name ?? ""),
        })),
      ),
      supervisorNameMatchCounts: buildTenantNameMatchCounts(
        (employeesResult.data ?? []).map((row) => ({
          name: String(row.full_name ?? ""),
        })),
      ),
      assignedSiteNameMatchCounts: buildTenantNameMatchCounts(
        (sitesResult.data ?? []).map((row) => ({
          name: String(row.site_name ?? ""),
        })),
      ),
    };
  }

  const { validatedRows, summary, issueRows } = validateImportRows({
    importType,
    columnMapping,
    rows: (rows ?? []).map((row) => ({
      id: String(row.id),
      row_number: Number(row.row_number),
      raw_data: parseRawData(row.raw_data),
    })),
    existingProductCodes,
    existingServiceNames,
    supplierNameMatchCounts,
    employeeLookups,
  });

  for (let offset = 0; offset < validatedRows.length; offset += ROW_INSERT_BATCH_SIZE) {
    const batch = validatedRows.slice(offset, offset + ROW_INSERT_BATCH_SIZE);

    const updates = await Promise.all(
      batch.map((row) =>
        supabase
          .from("bulk_import_rows")
          .update({
            mapped_data: row.mapped_data,
            status: row.status,
            error_message: row.error_message,
          })
          .eq("id", row.id)
          .eq("job_id", trimmedJobId),
      ),
    );

    const failedUpdate = updates.find((result) => result.error);
    if (failedUpdate?.error) {
      return NextResponse.json({ error: failedUpdate.error.message }, { status: 500 });
    }
  }

  const { error: jobUpdateError } = await supabase
    .from("bulk_import_jobs")
    .update({
      status: "validated",
      valid_rows: summary.valid_rows,
      error_rows: summary.error_rows,
    })
    .eq("id", trimmedJobId)
    .eq("tenant_id", sectionAuth.tenantId);

  if (jobUpdateError) {
    return NextResponse.json({ error: jobUpdateError.message }, { status: 500 });
  }

  const response: BulkImportValidationResponse = {
    ...summary,
    issue_rows: issueRows,
  };

  return NextResponse.json(response);
}
