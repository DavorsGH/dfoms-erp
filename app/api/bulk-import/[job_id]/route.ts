import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  BULK_IMPORT_GATE_ROLES,
  requireBulkImportAccess,
} from "@/lib/bulk-import/bulk-import-route-auth";
import type { BulkImportType } from "@/lib/bulk-import/types";
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

const CANCELLABLE_JOB_STATUSES = new Set(["pending", "validated"]);

async function getTenantSupabase() {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

export async function DELETE(
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
    .select("id, tenant_id, import_type, status")
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

  const status = String(job.status ?? "").trim();
  if (!CANCELLABLE_JOB_STATUSES.has(status)) {
    return NextResponse.json(
      { error: "Only pending or validated import jobs can be cancelled." },
      { status: 409 },
    );
  }

  const { error: deleteError } = await supabase
    .from("bulk_import_jobs")
    .delete()
    .eq("id", trimmedJobId)
    .eq("tenant_id", sectionAuth.tenantId);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
