import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  parseSpreadsheetUpload,
  ROW_INSERT_BATCH_SIZE,
} from "@/lib/bulk-import/parse-spreadsheet-upload";
import { requireBulkImportAccess } from "@/lib/bulk-import/bulk-import-route-auth";
import type { BulkImportType, BulkImportUploadResponse } from "@/lib/bulk-import/types";
import {
  computeBulkImportFileHash,
  findCommittedBulkImportReuploadMatch,
} from "@/lib/bulk-import/upload-file-hash";
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

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const importType = String(formData.get("import_type") ?? "").trim() as BulkImportType;
  if (!VALID_IMPORT_TYPES.has(importType)) {
    return NextResponse.json(
      { error: "import_type must be product, service, employee, customer, expense, or fixed_asset." },
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

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required." }, { status: 400 });
  }

  const fileName = file.name.trim();
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension !== "csv" && extension !== "xlsx") {
    return NextResponse.json(
      { error: "Unsupported file type. Upload a .csv or .xlsx file." },
      { status: 400 },
    );
  }

  let parsed;
  let fileHash: string;
  try {
    const buffer = await file.arrayBuffer();
    fileHash = computeBulkImportFileHash(buffer);
    parsed = parseSpreadsheetUpload(fileName, buffer);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to parse upload file.";
    return NextResponse.json({ error: message }, { status: 400 });
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
    const message =
      error instanceof Error
        ? error.message
        : "Failed to check for a previous import of this file.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const { headers, dataRows } = parsed;

  const { data: job, error: jobError } = await supabase
    .from("bulk_import_jobs")
    .insert({
      tenant_id: auth.tenantId,
      import_type: importType,
      status: "pending",
      file_name: fileName,
      file_hash: fileHash,
      uploaded_by: user.id,
      total_rows: dataRows.length,
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

  if (dataRows.length > 0) {
    for (let offset = 0; offset < dataRows.length; offset += ROW_INSERT_BATCH_SIZE) {
      const batch = dataRows.slice(offset, offset + ROW_INSERT_BATCH_SIZE);
      const rowPayload = batch.map((rawData, batchIndex) => ({
        job_id: jobId,
        row_number: offset + batchIndex + 1,
        raw_data: rawData,
        status: "pending",
      }));

      const { error: rowsError } = await supabase
        .from("bulk_import_rows")
        .insert(rowPayload);

      if (rowsError) {
        await supabase.from("bulk_import_jobs").delete().eq("id", jobId);

        return NextResponse.json({ error: rowsError.message }, { status: 500 });
      }
    }
  }

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
