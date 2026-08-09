import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BulkImportType } from "@/lib/bulk-import/types";

/** Committed re-upload matches within this window trigger a soft upload warning. */
export const BULK_IMPORT_REUPLOAD_LOOKBACK_DAYS = 30;

/**
 * Server-side SHA-256 of the raw uploaded file bytes (before spreadsheet parsing).
 */
export function computeBulkImportFileHash(content: ArrayBuffer): string {
  return createHash("sha256").update(Buffer.from(content)).digest("hex");
}

export type BulkImportReuploadMatch = {
  matchingJobId: string;
  matchingCommittedAt: string;
};

export async function findCommittedBulkImportReuploadMatch(input: {
  supabase: SupabaseClient;
  tenantId: string;
  importType: BulkImportType;
  fileHash: string;
  lookbackDays?: number;
}): Promise<BulkImportReuploadMatch | null> {
  const lookbackDays = input.lookbackDays ?? BULK_IMPORT_REUPLOAD_LOOKBACK_DAYS;
  const since = new Date(
    Date.now() - lookbackDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data, error } = await input.supabase
    .from("bulk_import_jobs")
    .select("id, committed_at")
    .eq("tenant_id", input.tenantId)
    .eq("import_type", input.importType)
    .eq("file_hash", input.fileHash)
    .eq("status", "committed")
    .gte("committed_at", since)
    .order("committed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const matchingJobId = String(data?.id ?? "").trim();
  const matchingCommittedAt = String(data?.committed_at ?? "").trim();
  if (!matchingJobId || !matchingCommittedAt) {
    return null;
  }

  return { matchingJobId, matchingCommittedAt };
}
