import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ROW_INSERT_BATCH_SIZE } from "@/lib/bulk-import/parse-spreadsheet-upload";
import { requireBulkImportAccess } from "@/lib/bulk-import/bulk-import-route-auth";
import {
  sanitizeImportHeaders,
  sanitizeImportRawData,
} from "@/lib/bulk-import/sanitize-import-raw-data";
import type { BulkImportType, BulkImportUploadResponse } from "@/lib/bulk-import/types";
import { findCommittedBulkImportReuploadMatch } from "@/lib/bulk-import/upload-file-hash";
import { authorizeBulkImportRowBatchUpload } from "@/lib/bulk-import/bulk-import-row-upload-authorization";
import {
  BULK_IMPORT_ROWS_RACE_CONFLICT_MESSAGE,
  isBulkImportRowsJobRowNumberUniqueViolation,
} from "@/lib/bulk-import/bulk-import-rows-insert-error";
import {
  validateBulkImportCumulativeRowCount,
  validateBulkImportRowNumbersInBatch,
} from "@/lib/bulk-import/validate-upload-rows-batch";
import {
  formatSpreadsheetApiBodyTooLargeError,
  isSpreadsheetApiBodyTooLarge,
  SPREADSHEET_UPLOAD_MAX_ROWS,
} from "@/lib/spreadsheet/spreadsheet-upload-validation";
import { SPREADSHEET_TOO_MANY_DATA_ROWS_MESSAGE } from "@/lib/spreadsheet/spreadsheet-validation-error";
import { createClient } from "@/utils/supabase/server";

const VALID_IMPORT_TYPES = new Set<BulkImportType>([
  "product",
  "service",
  "employee",
  "customer",
  "expense",
  "fixed_asset",
]);

const MAX_ROWS_PER_REQUEST = ROW_INSERT_BATCH_SIZE;

async function getTenantSupabase() {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

function apiBodyTooLargeResponse() {
  return NextResponse.json(
    { error: formatSpreadsheetApiBodyTooLargeError() },
    { status: 413 },
  );
}

function rejectRawFileUpload() {
  return NextResponse.json(
    {
      error:
        "Spreadsheet files must be imported using the in-browser uploader. Raw file uploads are not supported.",
    },
    { status: 413 },
  );
}

type InitBody = {
  action: "init";
  import_type: BulkImportType;
  file_name: string;
  file_hash: string;
  headers: unknown[];
  total_rows: number;
};

type RowsBody = {
  action: "rows";
  job_id: string;
  rows: Array<{ row_number: number; raw_data: Record<string, unknown> }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    return rejectRawFileUpload();
  }

  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader) {
    const contentLength = Number.parseInt(contentLengthHeader, 10);
    if (
      Number.isFinite(contentLength) &&
      isSpreadsheetApiBodyTooLarge(contentLength)
    ) {
      return apiBodyTooLargeResponse();
    }
  }

  let body: unknown;
  try {
    const text = await request.text();
    if (isSpreadsheetApiBodyTooLarge(text.length)) {
      return apiBodyTooLargeResponse();
    }
    body = JSON.parse(text) as unknown;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!isRecord(body) || typeof body.action !== "string") {
    return NextResponse.json({ error: "Invalid upload request." }, { status: 400 });
  }

  if (body.action === "init") {
    return handleInitUpload(body as InitBody);
  }

  if (body.action === "rows") {
    return handleRowsUpload(body as RowsBody);
  }

  return NextResponse.json({ error: "Invalid upload action." }, { status: 400 });
}

async function handleInitUpload(body: InitBody) {
  const importType = String(body.import_type ?? "").trim() as BulkImportType;
  if (!VALID_IMPORT_TYPES.has(importType)) {
    return NextResponse.json(
      {
        error:
          "import_type must be product, service, employee, customer, expense, or fixed_asset.",
      },
      { status: 400 },
    );
  }

  const auth = await requireBulkImportAccess(importType);
  if (!auth.ok) {
    return auth.response;
  }

  const supabase = await getTenantSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const fileName = String(body.file_name ?? "").trim();
  const fileHash = String(body.file_hash ?? "").trim();
  const totalRows = Number(body.total_rows);

  if (!fileName || !fileHash) {
    return NextResponse.json({ error: "Invalid upload metadata." }, { status: 400 });
  }

  if (!Number.isInteger(totalRows) || totalRows < 0) {
    return NextResponse.json({ error: "Invalid row count." }, { status: 400 });
  }

  if (totalRows > SPREADSHEET_UPLOAD_MAX_ROWS) {
    return NextResponse.json(
      { error: SPREADSHEET_TOO_MANY_DATA_ROWS_MESSAGE },
      { status: 400 },
    );
  }

  let headers: string[];
  try {
    headers = sanitizeImportHeaders(body.headers);
  } catch {
    return NextResponse.json({ error: "Invalid headers." }, { status: 400 });
  }

  let reuploadMatch: Awaited<ReturnType<typeof findCommittedBulkImportReuploadMatch>> =
    null;
  try {
    reuploadMatch = await findCommittedBulkImportReuploadMatch({
      supabase,
      tenantId: auth.tenantId,
      importType,
      fileHash,
    });
  } catch (error) {
    console.error("Bulk import reupload lookup failed", error);
    return NextResponse.json(
      { error: "Failed to check for a previous import of this file." },
      { status: 500 },
    );
  }

  const { data: job, error: jobError } = await supabase
    .from("bulk_import_jobs")
    .insert({
      tenant_id: auth.tenantId,
      import_type: importType,
      status: "pending",
      file_name: fileName,
      file_hash: fileHash,
      uploaded_by: user.id,
      total_rows: totalRows,
    })
    .select("id")
    .single();

  if (jobError || !job?.id) {
    return NextResponse.json(
      { error: jobError?.message ?? "Failed to create import job." },
      { status: 500 },
    );
  }

  const jobId = String(job.id);

  const response: BulkImportUploadResponse = {
    job_id: jobId,
    headers,
  };

  if (reuploadMatch) {
    response.possibleReupload = true;
    response.matchingJobId = reuploadMatch.matchingJobId;
    response.matchingCommittedAt = reuploadMatch.matchingCommittedAt;
  }

  return NextResponse.json(response);
}

async function handleRowsUpload(body: RowsBody) {
  const jobId = String(body.job_id ?? "").trim();
  const rows = body.rows;

  if (!jobId || !Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "Invalid row batch." }, { status: 400 });
  }

  if (rows.length > MAX_ROWS_PER_REQUEST) {
    return NextResponse.json(
      { error: `Row batches may contain at most ${MAX_ROWS_PER_REQUEST} rows.` },
      { status: 400 },
    );
  }

  const supabase = await getTenantSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: job, error: jobError } = await supabase
    .from("bulk_import_jobs")
    .select("id, tenant_id, import_type, status, total_rows, uploaded_by")
    .eq("id", jobId)
    .maybeSingle();

  if (jobError || !job) {
    return NextResponse.json({ error: "Import job not found." }, { status: 404 });
  }

  const auth = await requireBulkImportAccess(job.import_type as BulkImportType);
  if (!auth.ok) {
    return auth.response;
  }

  const uploadAuth = authorizeBulkImportRowBatchUpload({
    job: {
      tenant_id: String(job.tenant_id),
      status: job.status == null ? null : String(job.status),
      uploaded_by: job.uploaded_by == null ? null : String(job.uploaded_by),
    },
    callerTenantId: auth.tenantId,
    callerUserId: user.id,
  });

  if (!uploadAuth.ok) {
    return NextResponse.json(
      { error: uploadAuth.error },
      { status: uploadAuth.status },
    );
  }

  const { count: existingCount, error: countError } = await supabase
    .from("bulk_import_rows")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId);

  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 500 });
  }

  const alreadyStored = existingCount ?? 0;
  const totalRows = Number(job.total_rows ?? 0);

  const cumulativeCheck = validateBulkImportCumulativeRowCount({
    alreadyStored,
    batchSize: rows.length,
    declaredTotalRows: totalRows,
  });
  if (!cumulativeCheck.ok) {
    return NextResponse.json(
      { error: cumulativeCheck.error },
      { status: cumulativeCheck.status },
    );
  }

  const rowNumberCheck = validateBulkImportRowNumbersInBatch(rows, totalRows);
  if (!rowNumberCheck.ok) {
    return NextResponse.json(
      { error: rowNumberCheck.error },
      { status: rowNumberCheck.status },
    );
  }

  const { data: conflictingRows, error: conflictError } = await supabase
    .from("bulk_import_rows")
    .select("row_number")
    .eq("job_id", jobId)
    .in("row_number", rowNumberCheck.rowNumbers);

  if (conflictError) {
    return NextResponse.json({ error: conflictError.message }, { status: 500 });
  }

  if ((conflictingRows?.length ?? 0) > 0) {
    return NextResponse.json(
      {
        error:
          "Some row numbers in this batch were already uploaded for this import.",
      },
      { status: 409 },
    );
  }

  let rowPayload: Array<{
    job_id: string;
    row_number: number;
    raw_data: Record<string, unknown>;
    status: string;
  }>;

  try {
    rowPayload = rows.map((row) => {
      const rowNumber = Number(row.row_number);

      if (!isRecord(row.raw_data)) {
        throw new Error("Invalid row data in batch.");
      }

      return {
        job_id: jobId,
        row_number: rowNumber,
        raw_data: sanitizeImportRawData(row.raw_data),
        status: "pending",
      };
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid row batch.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const { error: rowsError } = await supabase
    .from("bulk_import_rows")
    .insert(rowPayload);

  if (rowsError) {
    if (isBulkImportRowsJobRowNumberUniqueViolation(rowsError)) {
      return NextResponse.json(
        { error: BULK_IMPORT_ROWS_RACE_CONFLICT_MESSAGE },
        { status: 409 },
      );
    }

    console.error("Bulk import row batch insert failed", rowsError);
    return NextResponse.json(
      { error: "Failed to store import rows." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, stored: rows.length });
}
