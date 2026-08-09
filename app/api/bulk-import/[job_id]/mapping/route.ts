import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  BULK_IMPORT_GATE_ROLES,
  requireBulkImportAccess,
} from "@/lib/bulk-import/bulk-import-route-auth";
import {
  getBulkImportTargetFieldKeys,
  isValidBulkImportTargetField,
} from "@/lib/bulk-import/target-fields";
import {
  BULK_IMPORT_IGNORE_COLUMN,
  type BulkImportMappingSaveBody,
  type BulkImportType,
} from "@/lib/bulk-import/types";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { createClient } from "@/utils/supabase/server";

const VALID_IMPORT_TYPES = new Set<BulkImportType>([
  "product",
  "service",
  "employee",
  "customer",
  "expense",
  "fixed_asset",
]);

async function getTenantSupabase() {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

function parseColumnMapping(body: unknown): BulkImportMappingSaveBody | null {
  if (body === null || typeof body !== "object" || !("column_mapping" in body)) {
    return null;
  }

  const rawMapping = (body as BulkImportMappingSaveBody).column_mapping;
  if (rawMapping === null || typeof rawMapping !== "object" || Array.isArray(rawMapping)) {
    return null;
  }

  const columnMapping: BulkImportMappingSaveBody["column_mapping"] = {};

  for (const [sourceHeader, targetField] of Object.entries(rawMapping)) {
    const header = sourceHeader.trim();
    if (!header) {
      continue;
    }

    if (typeof targetField !== "string") {
      return null;
    }

    const trimmedTarget = targetField.trim();
    if (!trimmedTarget || trimmedTarget === BULK_IMPORT_IGNORE_COLUMN) {
      continue;
    }

    columnMapping[header] = trimmedTarget;
  }

  return { column_mapping: columnMapping };
}

export async function PATCH(
  request: Request,
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

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsedBody = parseColumnMapping(rawBody);
  if (!parsedBody) {
    return NextResponse.json(
      { error: "column_mapping must be an object of header → field mappings." },
      { status: 400 },
    );
  }

  const supabase = await getTenantSupabase();

  const { data: job, error: jobError } = await supabase
    .from("bulk_import_jobs")
    .select("id, tenant_id, import_type")
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

  const allowedTargets = new Set(getBulkImportTargetFieldKeys(importType));

  for (const targetField of Object.values(parsedBody.column_mapping)) {
    if (!allowedTargets.has(targetField)) {
      return NextResponse.json(
        { error: `Invalid target field "${targetField}" for ${importType} import.` },
        { status: 400 },
      );
    }

    if (!isValidBulkImportTargetField(importType, targetField)) {
      return NextResponse.json(
        { error: `Invalid target field "${targetField}".` },
        { status: 400 },
      );
    }
  }

  const assignedTargets = Object.values(parsedBody.column_mapping);
  if (new Set(assignedTargets).size !== assignedTargets.length) {
    return NextResponse.json(
      { error: "Each target field can only be mapped once." },
      { status: 400 },
    );
  }

  const { error: updateError } = await supabase
    .from("bulk_import_jobs")
    .update({ column_mapping: parsedBody.column_mapping })
    .eq("id", trimmedJobId)
    .eq("tenant_id", sectionAuth.tenantId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
