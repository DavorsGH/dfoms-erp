import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { Client } from "pg";
import { commitImportJobInTransaction } from "@/lib/bulk-import/commit-import-job";
import type { BulkImportCommitResponse, BulkImportType } from "@/lib/bulk-import/types";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { resolveDatabaseUrl } from "@/utils/database-url";
import { CRM_SECTION_ROLES } from "@/utils/rbac-access";
import { assertTenantHasFeature } from "@/utils/tier-access";
import { createClient } from "@/utils/supabase/server";

const VALID_IMPORT_TYPES = new Set<BulkImportType>(["product", "service"]);

async function getTenantSupabase() {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

function parseMappedData(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ job_id: string }> },
) {
  const auth = await requireTenantRoleIn(CRM_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const feature = await assertTenantHasFeature(auth.tenantId, "crm_core");
  if (!feature.ok) {
    return feature.response;
  }

  const { job_id: jobId } = await context.params;
  const trimmedJobId = jobId?.trim();
  if (!trimmedJobId) {
    return NextResponse.json({ error: "job_id is required." }, { status: 400 });
  }

  const databaseUrl = resolveDatabaseUrl();
  if (!databaseUrl) {
    return NextResponse.json(
      { error: "Database connection is not configured for bulk import commit." },
      { status: 500 },
    );
  }

  const supabase = await getTenantSupabase();

  const { data: job, error: jobError } = await supabase
    .from("bulk_import_jobs")
    .select("id, tenant_id, import_type, status, error_rows")
    .eq("id", trimmedJobId)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();

  if (jobError) {
    return NextResponse.json({ error: jobError.message }, { status: 500 });
  }

  if (!job) {
    return NextResponse.json({ error: "Import job not found." }, { status: 404 });
  }

  if (String(job.tenant_id) !== auth.tenantId) {
    return NextResponse.json({ error: "Import job not found." }, { status: 404 });
  }

  const jobStatus = String(job.status ?? "").trim();
  if (jobStatus === "committed") {
    return NextResponse.json({ error: "Import job has already been committed." }, { status: 400 });
  }

  if (jobStatus !== "validated") {
    return NextResponse.json(
      { error: "Validate this import before committing." },
      { status: 400 },
    );
  }

  const errorRows = Number(job.error_rows ?? 0);
  if (errorRows > 0) {
    return NextResponse.json(
      { error: "Fix validation errors and re-validate before committing." },
      { status: 400 },
    );
  }

  const importType = String(job.import_type ?? "").trim() as BulkImportType;
  if (!VALID_IMPORT_TYPES.has(importType)) {
    return NextResponse.json(
      { error: "Import job has an invalid import_type." },
      { status: 400 },
    );
  }

  const { data: rows, error: rowsError } = await supabase
    .from("bulk_import_rows")
    .select("id, mapped_data, bulk_import_jobs!inner(tenant_id)")
    .eq("job_id", trimmedJobId)
    .eq("status", "valid")
    .eq("bulk_import_jobs.tenant_id", auth.tenantId)
    .order("row_number", { ascending: true });

  if (rowsError) {
    return NextResponse.json({ error: rowsError.message }, { status: 500 });
  }

  const validRows = (rows ?? []).map((row) => ({
    id: String(row.id),
    mapped_data: parseMappedData(row.mapped_data),
  }));

  const pgClient = new Client({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("localhost")
      ? undefined
      : { rejectUnauthorized: false },
  });

  try {
    await pgClient.connect();

    const committedCount = await commitImportJobInTransaction({
      client: pgClient,
      jobId: trimmedJobId,
      tenantId: auth.tenantId,
      importType,
      rows: validRows,
    });

    const response: BulkImportCommitResponse = {
      job_id: trimmedJobId,
      committed_count: committedCount,
    };

    return NextResponse.json(response);
  } catch (commitError) {
    const message =
      commitError instanceof Error
        ? commitError.message
        : "Bulk import commit failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await pgClient.end();
  }
}
