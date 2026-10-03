/** Only pending jobs accept batched row inserts (before mapping / validate / commit). */
export const BULK_IMPORT_JOB_STATUS_ACCEPTING_ROWS = "pending" as const;

export type BulkImportJobRowUploadRecord = {
  tenant_id: string;
  status: string | null;
  uploaded_by: string | null;
};

export type BulkImportRowUploadAuthorizationResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

/**
 * Server-side gate for action "rows" (including re-upload rows-only).
 * Must run after requireBulkImportAccess and before inserting bulk_import_rows.
 */
export function authorizeBulkImportRowBatchUpload(input: {
  job: BulkImportJobRowUploadRecord;
  callerTenantId: string;
  callerUserId: string;
}): BulkImportRowUploadAuthorizationResult {
  if (String(input.job.tenant_id) !== input.callerTenantId) {
    return {
      ok: false,
      status: 403,
      error: "You do not have access to this import.",
    };
  }

  const status = String(input.job.status ?? "").trim();
  if (status !== BULK_IMPORT_JOB_STATUS_ACCEPTING_ROWS) {
    return {
      ok: false,
      status: 409,
      error:
        "This import is no longer accepting rows. Start a new import if you still need to upload data.",
    };
  }

  if (!input.job.uploaded_by) {
    return {
      ok: false,
      status: 403,
      error: "You do not have access to this import.",
    };
  }

  if (String(input.job.uploaded_by) !== input.callerUserId) {
    return {
      ok: false,
      status: 403,
      error: "You do not have access to this import.",
    };
  }

  return { ok: true };
}
