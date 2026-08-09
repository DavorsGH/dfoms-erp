export type BulkImportType =
  | "product"
  | "service"
  | "employee"
  | "customer"
  | "expense"
  | "fixed_asset";

export const BULK_IMPORT_IGNORE_COLUMN = "__ignore__";

/** Maps source file column header → target field name, or ignore sentinel. */
export type BulkImportColumnMapping = Record<string, string>;

export type BulkImportUploadResponse = {
  job_id: string;
  headers: string[];
  /** Present when a committed job with the same tenant, type, and file hash exists recently. */
  possibleReupload?: boolean;
  matchingJobId?: string;
  matchingCommittedAt?: string;
};

/** Conditional required rule for Phase 4 row validation. */
export type BulkImportFieldRequiredWhen = {
  dependsOnField: string;
  equals: string;
};

export type BulkImportTargetField = {
  key: string;
  label: string;
  required: boolean;
  /** Sample value shown on the bulk-import upload reference panel. */
  example: string;
  /** Shown in the mapping UI; also documents rules for Phase 4 validation. */
  mappingHint?: string;
  /** Phase 4: treat this field as required on a row when the dependency matches. */
  requiredWhen?: BulkImportFieldRequiredWhen;
};

export type BulkImportMappingSaveBody = {
  column_mapping: BulkImportColumnMapping;
};

export type BulkImportValidationResponse = {
  total_rows: number;
  valid_rows: number;
  error_rows: number;
  duplicate_rows: number;
  issue_rows: Array<{ row_number: number; error_message: string }>;
  /** Valid rows with non-blocking warning messages (e.g. possible duplicates). */
  warning_rows: Array<{ row_number: number; error_message: string }>;
};

export type BulkImportCommitResponse = {
  job_id: string;
  committed_count: number;
};
