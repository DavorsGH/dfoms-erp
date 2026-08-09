"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import ImageFileUploadButton from "@/components/image-file-upload-button";
import {
  getBulkImportTargetField,
  getBulkImportTargetFields,
} from "@/lib/bulk-import/target-fields";
import {
  BULK_IMPORT_IGNORE_COLUMN,
  type BulkImportTargetField,
  type BulkImportType,
  type BulkImportUploadResponse,
  type BulkImportValidationResponse,
  type BulkImportCommitResponse,
} from "@/lib/bulk-import/types";
import { inputClassName } from "../employees/employee-record-utils";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";

const IMPORT_ACCEPT =
  ".csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv";

const UNMAPPED_VALUE = "";

const FINISHED_PRODUCTS_HREF = "/dashboard/inventory/finished-products";
const SERVICES_HREF = "/dashboard/crm/services";
const EMPLOYEES_HREF = "/dashboard/employees";

const IMPORT_TYPE_LABELS: Record<BulkImportType, string> = {
  product: "product",
  service: "service",
  employee: "employee",
};

const IMPORT_TYPE_OPTIONS = ["product", "service", "employee"] as const satisfies readonly BulkImportType[];

const stepCardClassName =
  "rounded-lg border border-slate-200 bg-white p-6 shadow-sm";

function formatTargetFieldRequirement(field: BulkImportTargetField): string {
  if (field.required) {
    return "Required";
  }

  if (field.mappingHint) {
    return `Optional · ${field.mappingHint}`;
  }

  return "Optional";
}

const stepHeadingClassName =
  "text-lg font-semibold text-[#0f2744]";

function ExpectedColumnsCard({
  importType,
  targetFields,
}: {
  importType: BulkImportType;
  targetFields: readonly BulkImportTargetField[];
}) {
  return (
    <div className={stepCardClassName}>
      <p className="mb-2 mt-0 block text-sm leading-5 text-slate-600">
        Include these columns in your spreadsheet for{" "}
        {IMPORT_TYPE_LABELS[importType]} import.
      </p>

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Column</th>
              <th className={scrollableTableThClassName}>Required</th>
              <th className={scrollableTableThClassName}>Example</th>
            </tr>
          </thead>
          <tbody>
            {targetFields.map((field) => (
              <tr key={field.key}>
                <td className="px-4 py-3 text-sm font-medium text-slate-800">
                  {field.label}
                </td>
                <td className="px-4 py-3 text-sm text-slate-600">
                  {formatTargetFieldRequirement(field)}
                </td>
                <td className="px-4 py-3 text-sm text-slate-600">
                  <span className="font-mono text-xs text-slate-700">
                    {field.example}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollableTable>
    </div>
  );
}

type MappingDraft = Record<string, string>;

function emptyMappingForHeaders(headers: string[]): MappingDraft {
  return Object.fromEntries(headers.map((header) => [header, UNMAPPED_VALUE]));
}

type BulkImportClientProps = {
  initialImportType?: BulkImportType;
};

export default function BulkImportClient({
  initialImportType = "product",
}: BulkImportClientProps) {
  const [importType, setImportType] = useState<BulkImportType>(initialImportType);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [savingMapping, setSavingMapping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [mappingSaved, setMappingSaved] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] =
    useState<BulkImportValidationResponse | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<BulkImportCommitResponse | null>(
    null,
  );
  const [jobId, setJobId] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<MappingDraft>({});

  const targetFields = useMemo(
    () => getBulkImportTargetFields(importType),
    [importType],
  );

  function resetMappingStep() {
    setJobId(null);
    setHeaders([]);
    setMapping({});
    setSaveMessage(null);
    setMappingSaved(false);
    setValidationResult(null);
    setCommitResult(null);
  }

  function resetValidationResult() {
    setValidationResult(null);
    setCommitResult(null);
  }

  function handleImportTypeChange(nextType: BulkImportType) {
    setImportType(nextType);
    resetMappingStep();
    setError(null);
  }

  function handleFileSelected(files: File[]) {
    setSelectedFiles(files);
    resetMappingStep();
    setError(null);
  }

  async function handleUpload(event: React.FormEvent) {
    event.preventDefault();

    const selectedFile = selectedFiles[0];
    if (!selectedFile) {
      setError("Choose a .csv or .xlsx file to upload.");
      return;
    }

    setUploading(true);
    setError(null);
    setSaveMessage(null);
    resetMappingStep();

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("import_type", importType);

      const response = await fetch("/api/bulk-import/upload", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as BulkImportUploadResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Upload failed.");
      }

      setJobId(payload.job_id);
      setHeaders(payload.headers ?? []);
      setMapping(emptyMappingForHeaders(payload.headers ?? []));
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Upload failed.",
      );
    } finally {
      setUploading(false);
    }
  }

  function handleMappingChange(header: string, value: string) {
    setMapping((current) => ({ ...current, [header]: value }));
    setSaveMessage(null);
    setMappingSaved(false);
    resetValidationResult();
  }

  async function handleSaveMapping() {
    if (!jobId) {
      return;
    }

    setSavingMapping(true);
    setError(null);
    setSaveMessage(null);
    resetValidationResult();

    const columnMapping = Object.fromEntries(
      Object.entries(mapping).flatMap(([header, value]) => {
        if (!value || value === UNMAPPED_VALUE) {
          return [];
        }

        return [[header, value]];
      }),
    );

    try {
      const response = await fetch(`/api/bulk-import/${jobId}/mapping`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ column_mapping: columnMapping }),
      });

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to save mapping.");
      }

      setSaveMessage("Mapping saved");
      setMappingSaved(true);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save mapping.",
      );
    } finally {
      setSavingMapping(false);
    }
  }

  async function handleValidate() {
    if (!jobId || !mappingSaved) {
      return;
    }

    setValidating(true);
    setError(null);
    resetValidationResult();

    try {
      const response = await fetch(`/api/bulk-import/${jobId}/validate`, {
        method: "POST",
      });

      const payload = (await response.json()) as BulkImportValidationResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Validation failed.");
      }

      setValidationResult(payload);
    } catch (validateError) {
      setError(
        validateError instanceof Error
          ? validateError.message
          : "Validation failed.",
      );
    } finally {
      setValidating(false);
    }
  }

  async function handleCommit() {
    if (!jobId || !validationResult || validationResult.error_rows > 0) {
      return;
    }

    setCommitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/bulk-import/${jobId}/commit`, {
        method: "POST",
      });

      const payload = (await response.json()) as BulkImportCommitResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Commit failed.");
      }

      setCommitResult(payload);
    } catch (commitError) {
      setError(
        commitError instanceof Error ? commitError.message : "Commit failed.",
      );
    } finally {
      setCommitting(false);
    }
  }

  return (
    <div className="space-y-8">
      <section>
        <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:grid-rows-[auto_auto] lg:items-start">
          <h2
            className={`order-1 lg:col-start-1 lg:row-start-1 ${stepHeadingClassName}`}
          >
            Step 1 — Upload file
          </h2>

          <div
            className={`order-2 lg:col-start-1 lg:row-start-2 ${stepCardClassName}`}
          >
            <form className="space-y-4" onSubmit={handleUpload}>
              <div>
                <span className="mb-2 mt-0 block text-sm font-medium leading-5 text-slate-700">
                  Import type
                </span>
                <div className="inline-flex rounded-md border border-slate-300 p-0.5">
                  {IMPORT_TYPE_OPTIONS.map((type) => {
                    const active = importType === type;
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => handleImportTypeChange(type)}
                        className={`rounded px-4 py-2 text-sm font-medium capitalize transition-colors ${
                          active
                            ? "bg-[#0f2744] text-white"
                            : "text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        {type}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <span className="mb-2 block text-sm font-medium text-slate-700">
                  Spreadsheet file
                </span>
                <ImageFileUploadButton
                  files={selectedFiles}
                  onChange={handleFileSelected}
                  multiple={false}
                  disabled={uploading}
                  accept={IMPORT_ACCEPT}
                  addLabel="Choose file"
                  changeLabel="Change file"
                  emptyHint="CSV or Excel (.xlsx)."
                />
              </div>

              <button
                type="submit"
                disabled={uploading || selectedFiles.length === 0}
                className="inline-flex items-center rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#16365c] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {uploading ? "Uploading and parsing…" : "Upload"}
              </button>
            </form>
          </div>

          <h2
            className={`order-3 lg:col-start-2 lg:row-start-1 ${stepHeadingClassName}`}
          >
            Expected Columns
          </h2>

          <div className="order-4 lg:col-start-2 lg:row-start-2">
            <ExpectedColumnsCard
              importType={importType}
              targetFields={targetFields}
            />
          </div>
        </div>
      </section>

      {jobId && headers.length > 0 ? (
        <section className={stepCardClassName}>
          <h2 className="mb-4 text-lg font-semibold text-[#0f2744]">
            Step 2 — Map columns
          </h2>
          <p className="mb-4 text-sm text-slate-600">
            Match each file column to a{" "}
            {importType === "product"
              ? "finished product"
              : importType === "service"
                ? "service catalog"
                : "employee"}{" "}
            field, or ignore columns you do not need.
          </p>

          <ScrollableTable>
            <table className={scrollableTableClassName}>
              <thead className={scrollableTableHeadClassName}>
                <tr>
                  <th className={scrollableTableThClassName}>File column</th>
                  <th className={scrollableTableThClassName}>Maps to</th>
                </tr>
              </thead>
              <tbody>
                {headers.map((header) => {
                  const mappedTargetKey = mapping[header] ?? UNMAPPED_VALUE;
                  const mappedTarget =
                    mappedTargetKey &&
                    mappedTargetKey !== UNMAPPED_VALUE &&
                    mappedTargetKey !== BULK_IMPORT_IGNORE_COLUMN
                      ? getBulkImportTargetField(importType, mappedTargetKey)
                      : undefined;

                  return (
                    <tr key={header}>
                      <td className="px-4 py-3 text-sm text-slate-800">{header}</td>
                      <td className="px-4 py-3">
                        <select
                          value={mappedTargetKey}
                          onChange={(event) =>
                            handleMappingChange(header, event.target.value)
                          }
                          className={inputClassName}
                          disabled={savingMapping}
                        >
                          <option value={UNMAPPED_VALUE}>Select field…</option>
                          {targetFields.map((field) => (
                            <option key={field.key} value={field.key}>
                              {field.label}
                              {field.required
                                ? " (required)"
                                : field.mappingHint
                                  ? ` (${field.mappingHint.toLowerCase()})`
                                  : ""}
                            </option>
                          ))}
                          <option value={BULK_IMPORT_IGNORE_COLUMN}>
                            Ignore this column
                          </option>
                        </select>
                        {mappedTarget?.mappingHint ? (
                          <p className="mt-1 text-xs text-amber-800">
                            {mappedTarget.mappingHint}
                          </p>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollableTable>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void handleSaveMapping()}
              disabled={savingMapping}
              className="inline-flex items-center rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#16365c] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {savingMapping ? "Saving…" : "Save mapping"}
            </button>
            {mappingSaved ? (
              <button
                type="button"
                onClick={() => void handleValidate()}
                disabled={validating}
                className="inline-flex items-center rounded-md border border-[#0f2744] bg-white px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {validating ? "Validating…" : "Validate"}
              </button>
            ) : null}
            {saveMessage ? (
              <p className="text-sm font-medium text-emerald-700">{saveMessage}</p>
            ) : null}
          </div>

          {validationResult ? (
            <div className="mt-6 space-y-4">
              <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <p className="font-medium text-[#0f2744]">Validation summary</p>
                <ul className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
                  <li>Total rows: {validationResult.total_rows}</li>
                  <li>Valid: {validationResult.valid_rows}</li>
                  <li>Errors: {validationResult.error_rows}</li>
                  <li>Duplicates: {validationResult.duplicate_rows}</li>
                </ul>
              </div>

              {validationResult.issue_rows.length > 0 ? (
                <div>
                  <h3 className="mb-2 text-sm font-medium text-slate-800">
                    Rows to fix
                  </h3>
                  <ScrollableTable>
                    <table className={scrollableTableClassName}>
                      <thead className={scrollableTableHeadClassName}>
                        <tr>
                          <th className={scrollableTableThClassName}>Row</th>
                          <th className={scrollableTableThClassName}>Issue</th>
                        </tr>
                      </thead>
                      <tbody>
                        {validationResult.issue_rows.map((issue) => (
                          <tr key={issue.row_number}>
                            <td className="px-4 py-3 text-sm text-slate-800">
                              {issue.row_number}
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-700">
                              {issue.error_message}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </ScrollableTable>
                </div>
              ) : null}

              {validationResult.error_rows > 0 ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  Fix the rows above in your spreadsheet, upload again, and
                  re-validate before committing.
                </p>
              ) : commitResult ? (
                <div className="space-y-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                  <p className="font-medium">
                    Import committed — {commitResult.committed_count} row
                    {commitResult.committed_count === 1 ? "" : "s"} written.
                  </p>
                  <Link
                    href={
                      importType === "product"
                        ? FINISHED_PRODUCTS_HREF
                        : importType === "service"
                          ? SERVICES_HREF
                          : EMPLOYEES_HREF
                    }
                    className="inline-flex items-center rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#16365c]"
                  >
                    {importType === "product"
                      ? "Go to Finished Products"
                      : importType === "service"
                        ? "Go to Services"
                        : "Go to Employee Directory"}
                  </Link>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void handleCommit()}
                    disabled={committing || validationResult.valid_rows === 0}
                    className="inline-flex items-center rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#16365c] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {committing ? "Committing…" : "Commit Import"}
                  </button>
                  {validationResult.valid_rows === 0 ? (
                    <p className="text-sm text-slate-600">
                      No valid rows to commit.
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}
        </section>
      ) : null}

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}
    </div>
  );
}
