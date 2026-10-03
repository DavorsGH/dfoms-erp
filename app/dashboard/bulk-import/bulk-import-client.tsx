"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { ASSISTANT_BUBBLE_SIZE_PX } from "@/components/ai-assistant/use-assistant-bubble-position";
import ImageFileUploadButton from "@/components/image-file-upload-button";
import { LoadingSpinner } from "@/components/loading-indicator";
import { useAlert } from "@/components/feedback/feedback-context";
import {
  buildAutoColumnMapping,
  countRequiredFieldMapping,
  downloadBulkImportTemplateCsv,
} from "@/lib/bulk-import/bulk-import-wizard-utils";
import {
  downloadBulkImportReviewReportCsv,
  groupBulkImportReviewIssues,
  resolveReviewIssueMessageForDisplay,
  type BulkImportReviewIssue,
} from "@/lib/bulk-import/bulk-import-review-issue";
import { yieldToBrowser } from "@/lib/bulk-import/yield-to-browser";
import { parseSpreadsheetForBulkImport } from "@/lib/spreadsheet/parse-spreadsheet-in-worker";
import { withBulkImportHeaderRowIndex } from "@/lib/bulk-import/column-mapping-meta";
import {
  getBulkImportColumnAliasLookup,
  getBulkImportIgnoreColumnHint,
  getEmployeeImportIgnoreHeaderHints,
  shouldSkipBulkImportHeaderAutoMap,
} from "@/lib/bulk-import/import-column-aliases";
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
import {
  inspectSpreadsheetFileForImport,
  readSpreadsheetImportJsonResponse,
  spreadsheetImportAlertFromError,
  spreadsheetImportUploadFailedAlert,
  type SpreadsheetImportAlert,
} from "@/lib/spreadsheet/spreadsheet-import-alerts";
import {
  SPREADSHEET_FILE_ACCEPT,
  SPREADSHEET_UPLOAD_HINT,
} from "@/lib/spreadsheet/spreadsheet-upload-validation";
import { inputClassName } from "../employees/employee-record-utils";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import SpreadsheetImportSheetOptions from "@/components/spreadsheet-import-sheet-options";
import { readSpreadsheetFileToRows } from "@/lib/spreadsheet/safe-spreadsheet-parse";
import {
  uploadBulkImportParsedSpreadsheet,
  uploadBulkImportRowsForExistingJob,
} from "@/lib/bulk-import/bulk-import-client-upload";
import {
  loadSpreadsheetWorkbookFromFile,
  summarizeSpreadsheetSheet,
  type SpreadsheetSheetSummary,
} from "@/lib/spreadsheet/parse-spreadsheet-client";
import BulkImportWizardDialog from "./bulk-import-wizard-dialog";

const IMPORT_ACCEPT = SPREADSHEET_FILE_ACCEPT;
const UNMAPPED_VALUE = "";
const ERRORS_PAGE_SIZE = 25;

const FINISHED_PRODUCTS_HREF = "/dashboard/inventory/finished-products";
const SERVICES_HREF = "/dashboard/crm/services";
const EMPLOYEES_HREF = "/dashboard/employees";
const CUSTOMERS_HREF = "/dashboard/crm/customers";
const EXPENSES_HREF = "/dashboard/finance/expenses";
const FIXED_ASSETS_HREF = "/dashboard/finance/fixed-assets";

const IMPORT_TYPE_LABELS: Record<BulkImportType, string> = {
  product: "product",
  service: "service",
  employee: "employee",
  customer: "customer",
  expense: "expense",
  fixed_asset: "fixed asset",
};

const IMPORT_TYPE_FIELD_LABELS: Record<BulkImportType, string> = {
  product: "finished product",
  service: "service catalog",
  employee: "employee",
  customer: "customer",
  expense: "expense register",
  fixed_asset: "fixed asset",
};

const IMPORT_TYPE_DESTINATION: Record<
  BulkImportType,
  { href: string; label: string }
> = {
  product: { href: FINISHED_PRODUCTS_HREF, label: "Go to Finished Products" },
  service: { href: SERVICES_HREF, label: "Go to Services" },
  employee: { href: EMPLOYEES_HREF, label: "Go to Employee Directory" },
  customer: { href: CUSTOMERS_HREF, label: "Go to Customer List" },
  expense: { href: EXPENSES_HREF, label: "Go to Expense Register" },
  fixed_asset: { href: FIXED_ASSETS_HREF, label: "Go to Fixed Assets" },
};

const IMPORT_TYPE_OPTIONS = [
  "product",
  "service",
  "employee",
  "customer",
  "expense",
  "fixed_asset",
] as const satisfies readonly BulkImportType[];

/** Display labels for import-type toggles (internal `import_type` values unchanged). */
const IMPORT_TYPE_BUTTON_LABELS: Record<BulkImportType, string> = {
  product: "Product",
  service: "Service",
  employee: "Employee",
  customer: "Customer",
  expense: "Expense",
  fixed_asset: "Fixed Asset",
};

/** Keep primary footer actions clear of the floating assistant bubble (right side). */
const WIZARD_FOOTER_CHAT_CLEARANCE_CSS = `max(1rem, calc(${ASSISTANT_BUBBLE_SIZE_PX}px + 1.5rem + env(safe-area-inset-right, 0px)))`;

const WIZARD_STEPS = [
  { id: 1, label: "Upload" },
  { id: 2, label: "Map columns" },
  { id: 3, label: "Review" },
  { id: 4, label: "Import" },
] as const;

type WizardStep = (typeof WIZARD_STEPS)[number]["id"];

const wizardCardClassName =
  "flex max-h-[min(72dvh,48rem)] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm";

type WizardPrimaryActionButtonProps = {
  onClick: () => void;
  disabled: boolean;
  loading: boolean;
  loadingLabel: string;
  children: string;
};

function WizardPrimaryActionButton({
  onClick,
  disabled,
  loading,
  loadingLabel,
  children,
}: WizardPrimaryActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading}
      className="inline-flex min-h-10 min-w-[7.5rem] items-center justify-center gap-2 rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white hover:bg-[#16365c] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {loading ? (
        <>
          <LoadingSpinner
            size="sm"
            className="shrink-0 border-white/35 border-t-white"
          />
          <span>{loadingLabel}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}

function formatTargetFieldRequirement(field: BulkImportTargetField): string {
  if (field.required) {
    return "Required";
  }

  if (field.mappingHint) {
    return `Optional · ${field.mappingHint}`;
  }

  return "Optional";
}

type PendingParsedUpload = {
  headers: string[];
  dataRows: Record<string, unknown>[];
};

type PendingReupload = {
  jobId: string;
  headers: string[];
  matchingCommittedAt: string;
  matchingJobId?: string;
  parsed: PendingParsedUpload;
  fileBuffer: ArrayBuffer;
  fileName: string;
};

type MappingDraft = Record<string, string>;

function formatBulkImportTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }

  return parsed.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function WizardProgress({ currentStep }: { currentStep: WizardStep }) {
  return (
    <ol className="mb-6 flex flex-wrap items-center gap-2 text-xs sm:text-sm">
      {WIZARD_STEPS.map((step, index) => {
        const active = currentStep === step.id;
        const complete = currentStep > step.id;

        return (
          <li key={step.id} className="flex items-center gap-2">
            <span
              className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-xs font-semibold ${
                active
                  ? "bg-[#0f2744] text-white"
                  : complete
                    ? "bg-emerald-100 text-emerald-900"
                    : "bg-slate-100 text-slate-600"
              }`}
            >
              {step.id}
            </span>
            <span
              className={
                active ? "font-medium text-[#0f2744]" : "text-slate-600"
              }
            >
              {step.label}
            </span>
            {index < WIZARD_STEPS.length - 1 ? (
              <span className="hidden text-slate-300 sm:inline" aria-hidden>
                →
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

type BulkImportClientProps = {
  initialImportType?: BulkImportType;
};

export default function BulkImportClient({
  initialImportType = "product",
}: BulkImportClientProps) {
  const { alert: showAlert } = useAlert();
  const showImportAlert = useCallback(
    (payload: SpreadsheetImportAlert) => {
      showAlert({
        variant: "error",
        title: payload.title,
        message: payload.message,
      });
    },
    [showAlert],
  );

  const [importType, setImportType] = useState<BulkImportType>(initialImportType);
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileUploadBlocked, setFileUploadBlocked] = useState(false);
  const [loadingWorkbook, setLoadingWorkbook] = useState(false);
  const [fileBuffer, setFileBuffer] = useState<ArrayBuffer | null>(null);
  const [sheetSummaries, setSheetSummaries] = useState<SpreadsheetSheetSummary[]>(
    [],
  );
  const [selectedSheetName, setSelectedSheetName] = useState("");
  const [headerRowIndexBySheet, setHeaderRowIndexBySheet] = useState<
    Record<string, number>
  >({});
  const [uploading, setUploading] = useState(false);
  const [savingMapping, setSavingMapping] = useState(false);
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
  const [pendingReupload, setPendingReupload] = useState<PendingReupload | null>(
    null,
  );
  const [cancellingReupload, setCancellingReupload] = useState(false);
  const [showExpectedColumns, setShowExpectedColumns] = useState(false);
  const [showAllErrors, setShowAllErrors] = useState(false);
  const [showAllWarnings, setShowAllWarnings] = useState(false);
  const [errorsPage, setErrorsPage] = useState(0);
  const [warningsPage, setWarningsPage] = useState(0);
  const [uploadStatusMessage, setUploadStatusMessage] = useState<string | null>(
    null,
  );
  const [createMissingPositionsOnImport, setCreateMissingPositionsOnImport] =
    useState(true);

  const primaryActionInFlightRef = useRef(false);

  const targetFields = useMemo(
    () => getBulkImportTargetFields(importType),
    [importType],
  );

  const requiredMappingStats = useMemo(
    () =>
      countRequiredFieldMapping(
        mapping,
        targetFields,
        UNMAPPED_VALUE,
        BULK_IMPORT_IGNORE_COLUMN,
      ),
    [mapping, targetFields],
  );

  const groupedErrorReview = useMemo(
    () =>
      validationResult
        ? groupBulkImportReviewIssues(validationResult.issue_rows, importType)
        : [],
    [validationResult, importType],
  );

  const groupedWarningReview = useMemo(
    () =>
      validationResult
        ? groupBulkImportReviewIssues(validationResult.warning_rows, importType)
        : [],
    [validationResult, importType],
  );

  const pagedErrors = useMemo(() => {
    if (!validationResult) {
      return [];
    }

    const start = errorsPage * ERRORS_PAGE_SIZE;
    return validationResult.issue_rows.slice(start, start + ERRORS_PAGE_SIZE);
  }, [validationResult, errorsPage]);

  const pagedWarnings = useMemo(() => {
    if (!validationResult) {
      return [];
    }

    const start = warningsPage * ERRORS_PAGE_SIZE;
    return validationResult.warning_rows.slice(start, start + ERRORS_PAGE_SIZE);
  }, [validationResult, warningsPage]);

  const totalErrorPages = validationResult
    ? Math.max(1, Math.ceil(validationResult.issue_rows.length / ERRORS_PAGE_SIZE))
    : 1;

  const totalWarningPages = validationResult
    ? Math.max(
        1,
        Math.ceil(validationResult.warning_rows.length / ERRORS_PAGE_SIZE),
      )
    : 1;

  const uploadBlocked =
    selectedFiles.length === 0 ||
    fileUploadBlocked ||
    loadingWorkbook ||
    !selectedSheetName ||
    pendingReupload !== null;

  const wizardBusy =
    uploading ||
    savingMapping ||
    validating ||
    committing ||
    loadingWorkbook ||
    cancellingReupload;

  const wizardInputsLocked = wizardBusy;

  function formatReviewIssueMessage(issue: BulkImportReviewIssue): string {
    return resolveReviewIssueMessageForDisplay(issue, {
      createMissingPositions: createMissingPositionsOnImport,
    });
  }

  function resetMappingStep() {
    setJobId(null);
    setHeaders([]);
    setMapping({});
    setValidationResult(null);
    setCommitResult(null);
    setPendingReupload(null);
    setWizardStep(1);
  }

  function resetSpreadsheetSelection() {
    setFileBuffer(null);
    setSheetSummaries([]);
    setSelectedSheetName("");
    setHeaderRowIndexBySheet({});
  }

  function resolvedHeaderRowIndex(sheetName: string): number {
    if (headerRowIndexBySheet[sheetName] !== undefined) {
      return headerRowIndexBySheet[sheetName];
    }

    const summary = sheetSummaries.find((sheet) => sheet.name === sheetName);
    return summary?.detectedHeaderRowIndex ?? 0;
  }

  async function refreshSheetDataRowCount(
    file: File,
    sheetName: string,
    headerRowIndex: number,
  ) {
    const rows = await readSpreadsheetFileToRows(file, {
      sheetName,
      rawCells: true,
    });
    const { dataRowCount } = summarizeSpreadsheetSheet(rows, headerRowIndex);
    setSheetSummaries((previous) =>
      previous.map((sheet) =>
        sheet.name === sheetName ? { ...sheet, dataRowCount } : sheet,
      ),
    );
  }

  function advanceToMapping(nextJobId: string, nextHeaders: string[]) {
    setJobId(nextJobId);
    setHeaders(nextHeaders);
    setMapping(
      buildAutoColumnMapping(nextHeaders, targetFields, UNMAPPED_VALUE, {
        extraAliases: getBulkImportColumnAliasLookup(importType),
        skipHeader: (header) =>
          shouldSkipBulkImportHeaderAutoMap(importType, header),
        forceIgnoreHeaders:
          importType === "employee"
            ? new Set(getEmployeeImportIgnoreHeaderHints().keys())
            : undefined,
      }),
    );
    setPendingReupload(null);
    setValidationResult(null);
    setCommitResult(null);
    setWizardStep(2);
  }

  function handleImportTypeChange(nextType: BulkImportType) {
    if (wizardInputsLocked || nextType === importType) {
      return;
    }

    setImportType(nextType);
    resetMappingStep();
    resetSpreadsheetSelection();
    setFileUploadBlocked(false);
    setSelectedFiles([]);
  }

  async function handleFileSelected(files: File[]) {
    const file = files[0];

    if (!file) {
      setSelectedFiles([]);
      setFileUploadBlocked(false);
      resetMappingStep();
      resetSpreadsheetSelection();
      return;
    }

    const inspection = inspectSpreadsheetFileForImport(file);
    setSelectedFiles([file]);
    resetMappingStep();
    resetSpreadsheetSelection();

    if (!inspection.ok) {
      setFileUploadBlocked(true);
      showImportAlert(inspection.alert);
      return;
    }

    setFileUploadBlocked(false);
    setLoadingWorkbook(true);

    try {
      const loaded = await loadSpreadsheetWorkbookFromFile(file);
      setFileBuffer(loaded.buffer);
      setSheetSummaries(loaded.sheetSummaries);
      setSelectedSheetName(loaded.defaultSheetName);
    } catch (loadError) {
      console.error("Bulk import workbook load failed", loadError);
      showImportAlert(
        spreadsheetImportAlertFromError(loadError, "parse"),
      );
      setFileUploadBlocked(true);
      setSelectedFiles([]);
    } finally {
      setLoadingWorkbook(false);
    }
  }

  async function handleUpload() {
    if (primaryActionInFlightRef.current || uploading) {
      return;
    }

    const selectedFile = selectedFiles[0];
    if (!selectedFile || !fileBuffer || !selectedSheetName) {
      showImportAlert(spreadsheetImportUploadFailedAlert());
      return;
    }

    const inspection = inspectSpreadsheetFileForImport(selectedFile);
    if (!inspection.ok) {
      setFileUploadBlocked(true);
      showImportAlert(inspection.alert);
      return;
    }

    primaryActionInFlightRef.current = true;
    setUploading(true);
    setUploadStatusMessage("Reading file…");
    resetMappingStep();
    setCreateMissingPositionsOnImport(true);

    try {
      await yieldToBrowser();
      const { parsed } = await parseSpreadsheetForBulkImport({
        fileName: selectedFile.name,
        buffer: fileBuffer,
        sheetName: selectedSheetName,
        headerRowIndex: resolvedHeaderRowIndex(selectedSheetName),
      });

      setUploadStatusMessage(
        `Uploading rows 0 of ${parsed.dataRows.length.toLocaleString()}…`,
      );
      const uploadResult = await uploadBulkImportParsedSpreadsheet({
        importType,
        fileName: selectedFile.name,
        fileBuffer,
        parsed,
        onProgress: (progress) => {
          setUploadStatusMessage(
            `Uploading rows ${progress.uploadedRows.toLocaleString()} of ${progress.totalRows.toLocaleString()}…`,
          );
        },
      });

      if (!uploadResult.ok) {
        showImportAlert(uploadResult.alert);
        return;
      }

      const payload = uploadResult.response;

      if (payload.possibleReupload) {
        setPendingReupload({
          jobId: payload.job_id,
          headers: payload.headers ?? parsed.headers,
          matchingCommittedAt: payload.matchingCommittedAt ?? "",
          matchingJobId: payload.matchingJobId,
          parsed: {
            headers: parsed.headers,
            dataRows: parsed.dataRows,
          },
          fileBuffer,
          fileName: selectedFile.name,
        });
        setWizardStep(1);
        return;
      }

      advanceToMapping(payload.job_id, payload.headers ?? parsed.headers);
    } catch (uploadError) {
      console.error("Bulk import upload failed", uploadError);
      showImportAlert(
        spreadsheetImportAlertFromError(uploadError, "parse"),
      );
    } finally {
      primaryActionInFlightRef.current = false;
      setUploading(false);
      setUploadStatusMessage(null);
    }
  }

  function handleSheetChange(sheetName: string) {
    setSelectedSheetName(sheetName);
  }

  function handleHeaderRowIndexChange(headerRowIndex: number) {
    setHeaderRowIndexBySheet((previous) => ({
      ...previous,
      [selectedSheetName]: headerRowIndex,
    }));

    const file = selectedFiles[0];
    if (file && selectedSheetName) {
      void refreshSheetDataRowCount(file, selectedSheetName, headerRowIndex);
    }
  }

  async function handleContinueReupload() {
    if (
      !pendingReupload ||
      primaryActionInFlightRef.current ||
      uploading
    ) {
      return;
    }

    primaryActionInFlightRef.current = true;
    setUploading(true);
    setUploadStatusMessage(
      `Uploading rows 0 of ${pendingReupload.parsed.dataRows.length.toLocaleString()}…`,
    );
    await yieldToBrowser();

    try {
      const uploadResult = await uploadBulkImportRowsForExistingJob({
        jobId: pendingReupload.jobId,
        dataRows: pendingReupload.parsed.dataRows,
        onProgress: (progress) => {
          setUploadStatusMessage(
            `Uploading rows ${progress.uploadedRows.toLocaleString()} of ${progress.totalRows.toLocaleString()}…`,
          );
        },
      });

      if (!uploadResult.ok) {
        showImportAlert(uploadResult.alert);
        return;
      }

      advanceToMapping(pendingReupload.jobId, pendingReupload.headers);
    } catch (continueError) {
      console.error("Bulk import reupload continue failed", continueError);
      showImportAlert(spreadsheetImportUploadFailedAlert());
    } finally {
      primaryActionInFlightRef.current = false;
      setUploading(false);
      setUploadStatusMessage(null);
    }
  }

  async function handleCancelReupload() {
    if (!pendingReupload) {
      return;
    }

    setCancellingReupload(true);

    try {
      const response = await fetch(
        `/api/bulk-import/${pendingReupload.jobId}`,
        { method: "DELETE" },
      );

      const parsed = await readSpreadsheetImportJsonResponse<{ error?: string }>(
        response,
      );
      if (!parsed.ok) {
        showImportAlert(parsed.alert);
        return;
      }

      setPendingReupload(null);
    } catch (cancelError) {
      console.error("Bulk import cancel reupload failed", cancelError);
      showImportAlert(spreadsheetImportUploadFailedAlert());
    } finally {
      setCancellingReupload(false);
    }
  }

  function handleMappingChange(header: string, value: string) {
    setMapping((current) => ({ ...current, [header]: value }));
    setValidationResult(null);
    setCommitResult(null);
  }

  async function persistMapping(): Promise<boolean> {
    if (!jobId) {
      return false;
    }

    setSavingMapping(true);

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
        body: JSON.stringify({
          column_mapping: withBulkImportHeaderRowIndex(
            columnMapping,
            resolvedHeaderRowIndex(selectedSheetName),
          ),
        }),
      });

      const parsed = await readSpreadsheetImportJsonResponse<{ error?: string }>(
        response,
      );

      if (!parsed.ok) {
        showImportAlert(parsed.alert);
        return false;
      }

      return true;
    } catch (saveError) {
      console.error("Bulk import save mapping failed", saveError);
      showImportAlert(spreadsheetImportUploadFailedAlert());
      return false;
    } finally {
      setSavingMapping(false);
    }
  }

  async function runValidation(): Promise<boolean> {
    if (!jobId) {
      return false;
    }

    setValidating(true);
    setValidationResult(null);
    setCommitResult(null);
    await yieldToBrowser();

    try {
      const response = await fetch(`/api/bulk-import/${jobId}/validate`, {
        method: "POST",
      });

      const parsed = await readSpreadsheetImportJsonResponse<
        BulkImportValidationResponse & { error?: string }
      >(response);

      if (!parsed.ok) {
        showImportAlert(parsed.alert);
        return false;
      }

      setValidationResult(parsed.data);
      setCreateMissingPositionsOnImport(true);
      return true;
    } catch (validateError) {
      console.error("Bulk import validation failed", validateError);
      showImportAlert(spreadsheetImportUploadFailedAlert());
      return false;
    } finally {
      setValidating(false);
    }
  }

  async function handleProceedToReview() {
    if (
      primaryActionInFlightRef.current ||
      savingMapping ||
      validating ||
      requiredMappingStats.unmappedRequiredFields.length > 0
    ) {
      return;
    }

    primaryActionInFlightRef.current = true;

    try {
      const saved = await persistMapping();
      if (!saved) {
        return;
      }

      const validated = await runValidation();
      if (validated) {
        setWizardStep(3);
      }
    } finally {
      primaryActionInFlightRef.current = false;
    }
  }

  async function handleCommit() {
    if (
      primaryActionInFlightRef.current ||
      committing ||
      !jobId ||
      !validationResult ||
      validationResult.valid_rows === 0
    ) {
      return;
    }

    primaryActionInFlightRef.current = true;
    setCommitting(true);

    try {
      const response = await fetch(`/api/bulk-import/${jobId}/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          create_missing_positions:
            importType !== "employee" ? undefined : createMissingPositionsOnImport,
        }),
      });

      const parsed = await readSpreadsheetImportJsonResponse<
        BulkImportCommitResponse & { error?: string }
      >(response);

      if (!parsed.ok) {
        showImportAlert(parsed.alert);
        return;
      }

      setCommitResult(parsed.data);
      setWizardStep(4);
    } catch (commitError) {
      console.error("Bulk import commit failed", commitError);
      showImportAlert(spreadsheetImportUploadFailedAlert());
    } finally {
      primaryActionInFlightRef.current = false;
      setCommitting(false);
    }
  }

  function handleDownloadTemplate() {
    downloadBulkImportTemplateCsv(
      targetFields,
      `${importType}-import-template.csv`,
    );
  }

  function handleDownloadErrorReport() {
    if (!validationResult) {
      return;
    }

    const hasReportRows =
      validationResult.issue_rows.length > 0 ||
      validationResult.warning_rows.length > 0;

    if (!hasReportRows) {
      return;
    }

    const reportIssues: BulkImportReviewIssue[] = [
      ...validationResult.issue_rows,
      ...validationResult.warning_rows,
    ].map((issue) => ({
      ...issue,
      message: formatReviewIssueMessage(issue),
      error_message: formatReviewIssueMessage(issue),
    }));

    downloadBulkImportReviewReportCsv(
      reportIssues,
      `${importType}-import-review-report.csv`,
    );
  }

  const stickyPrimaryDisabled =
    (wizardStep === 1 && (uploading || uploadBlocked)) ||
    (wizardStep === 2 &&
      (savingMapping ||
        validating ||
        requiredMappingStats.unmappedRequiredFields.length > 0)) ||
    (wizardStep === 3 &&
      (committing || !validationResult || validationResult.valid_rows === 0));

  const importPrimaryLabel =
    wizardStep === 3 && validationResult
      ? validationResult.valid_rows === 0
        ? "Import"
        : `Import ${validationResult.valid_rows.toLocaleString()} valid row${
            validationResult.valid_rows === 1 ? "" : "s"
          }`
      : "Import";

  const step2PrimaryLoading = savingMapping || validating;

  return (
    <div className={wizardCardClassName}>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <WizardProgress currentStep={wizardStep} />

        {wizardStep === 1 ? (
          <div className="space-y-4">
            <div>
              <span className="mb-2 block text-sm font-medium text-slate-700">
                Import type
              </span>
              <div className="flex w-full max-w-full flex-wrap rounded-md border border-slate-300 p-0.5">
                {IMPORT_TYPE_OPTIONS.map((type) => {
                  const active = importType === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      disabled={wizardInputsLocked}
                      onClick={() => handleImportTypeChange(type)}
                      className={`rounded px-3 py-2 text-sm font-medium transition-colors sm:px-4 disabled:cursor-not-allowed disabled:opacity-50 ${
                        active
                          ? "bg-[#0f2744] text-white"
                          : "text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      {IMPORT_TYPE_BUTTON_LABELS[type]}
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
                disabled={wizardInputsLocked}
                accept={IMPORT_ACCEPT}
                addLabel="Choose file"
                changeLabel="Change file"
                emptyHint={SPREADSHEET_UPLOAD_HINT}
              />
            </div>

            {loadingWorkbook ? (
              <p className="text-sm text-slate-600">Reading spreadsheet…</p>
            ) : null}

            {sheetSummaries.length > 0 && !loadingWorkbook ? (
              <SpreadsheetImportSheetOptions
                summaries={sheetSummaries}
                selectedSheetName={selectedSheetName}
                onSheetChange={handleSheetChange}
                headerRowIndex={resolvedHeaderRowIndex(selectedSheetName)}
                detectedHeaderRowIndex={
                  sheetSummaries.find((sheet) => sheet.name === selectedSheetName)
                    ?.detectedHeaderRowIndex ?? 0
                }
                onHeaderRowIndexChange={handleHeaderRowIndexChange}
                disabled={wizardInputsLocked}
              />
            ) : null}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setShowExpectedColumns(true)}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                View expected columns
              </button>
              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Download template
              </button>
            </div>

            {pendingReupload ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-950">
                <p className="font-medium">
                  This file appears to match one already imported on{" "}
                  {formatBulkImportTimestamp(pendingReupload.matchingCommittedAt)}
                  {" — "}continue anyway?
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <WizardPrimaryActionButton
                    onClick={() => void handleContinueReupload()}
                    disabled={cancellingReupload}
                    loading={uploading}
                    loadingLabel="Uploading…"
                  >
                    Continue
                  </WizardPrimaryActionButton>
                  <button
                    type="button"
                    onClick={() => void handleCancelReupload()}
                    disabled={cancellingReupload}
                    className="rounded-md border border-amber-400 bg-white px-4 py-2 text-sm font-medium text-amber-950 hover:bg-amber-100 disabled:opacity-50"
                  >
                    {cancellingReupload ? "Cancelling…" : "Cancel"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {wizardStep === 2 && jobId && headers.length > 0 ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Match each file column to a {IMPORT_TYPE_FIELD_LABELS[importType]}{" "}
              field. Required fields are highlighted until mapped.
            </p>
            <p className="text-sm font-medium text-[#0f2744]">
              {requiredMappingStats.mappedRequired} of{" "}
              {requiredMappingStats.totalRequired} required fields mapped
            </p>

            <ul className="space-y-3">
              {headers.map((header) => {
                const mappedTargetKey = mapping[header] ?? UNMAPPED_VALUE;
                const mappedTarget =
                  mappedTargetKey &&
                  mappedTargetKey !== UNMAPPED_VALUE &&
                  mappedTargetKey !== BULK_IMPORT_IGNORE_COLUMN
                    ? getBulkImportTargetField(importType, mappedTargetKey)
                    : undefined;
                const mapsToRequired =
                  mappedTarget?.required ??
                  (mappedTargetKey
                    ? targetFields.find((f) => f.key === mappedTargetKey)
                        ?.required
                    : false);

                return (
                  <li
                    key={header}
                    className="grid gap-2 rounded-md border border-slate-200 p-3 sm:grid-cols-2 sm:items-start"
                  >
                    <div className="text-sm font-medium text-slate-800">
                      {header}
                    </div>
                    <div>
                      <select
                        value={mappedTargetKey}
                        onChange={(event) =>
                          handleMappingChange(header, event.target.value)
                        }
                        className={`${inputClassName} ${
                          mapsToRequired === false &&
                          mappedTargetKey === UNMAPPED_VALUE
                            ? ""
                            : ""
                        }`}
                        disabled={wizardBusy}
                        aria-invalid={
                          requiredMappingStats.unmappedRequiredFields.some(
                            (field) => field.key === mappedTargetKey,
                          )
                            ? undefined
                            : undefined
                        }
                      >
                        <option value={UNMAPPED_VALUE}>Select field…</option>
                        {targetFields.map((field) => {
                          const isUnmappedRequired =
                            requiredMappingStats.unmappedRequiredFields.some(
                              (missing) => missing.key === field.key,
                            );
                          return (
                            <option key={field.key} value={field.key}>
                              {field.label}
                              {field.required ? " (required)" : ""}
                              {isUnmappedRequired ? " · not mapped yet" : ""}
                            </option>
                          );
                        })}
                        <option value={BULK_IMPORT_IGNORE_COLUMN}>
                          Ignore this column
                        </option>
                      </select>
                      {mappedTarget?.mappingHint ? (
                        <p className="mt-1 text-xs text-amber-800">
                          {mappedTarget.mappingHint}
                        </p>
                      ) : null}
                      {mappedTargetKey === BULK_IMPORT_IGNORE_COLUMN ? (
                        <p className="mt-1 text-xs text-slate-600">
                          {getBulkImportIgnoreColumnHint(importType, header) ??
                            "This column will not be imported."}
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>

            {requiredMappingStats.unmappedRequiredFields.length > 0 ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Still map:{" "}
                {requiredMappingStats.unmappedRequiredFields
                  .map((field) => field.label)
                  .join(", ")}
              </p>
            ) : null}
          </div>
        ) : null}

        {wizardStep === 3 && validationResult ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Total rows", validationResult.total_rows],
                ["Valid", validationResult.valid_rows],
                ["Errors", validationResult.error_rows],
                ["Duplicates", validationResult.duplicate_rows],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3"
                >
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    {label}
                  </p>
                  <p className="mt-1 text-xl font-semibold text-[#0f2744]">
                    {value}
                  </p>
                </div>
              ))}
            </div>

            {validationResult.blank_rows_skipped > 0 ? (
              <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                {validationResult.blank_rows_skipped.toLocaleString()} blank row
                {validationResult.blank_rows_skipped === 1 ? "" : "s"} skipped
                (no values in required mapped columns).
              </p>
            ) : null}

            {importType === "employee" &&
            validationResult.missing_positions &&
            validationResult.missing_positions.length > 0 ? (
              <div className="rounded-md border border-slate-300 bg-white px-4 py-3">
                <h3 className="text-sm font-semibold text-[#0f2744]">
                  {validationResult.missing_positions.length === 1
                    ? "1 position doesn't exist yet"
                    : `${validationResult.missing_positions.length} positions don't exist yet`}
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  These titles are not in your workspace yet (matched
                  case-insensitively):
                </p>
                <ul className="mt-2 space-y-1 text-sm text-slate-800">
                  {validationResult.missing_positions.map((entry) => (
                    <li key={entry.name}>
                      <span className="font-medium">{entry.name}</span>
                      <span className="text-slate-600">
                        {" "}
                        — {entry.employee_count} employee
                        {entry.employee_count === 1 ? "" : "s"}
                      </span>
                    </li>
                  ))}
                </ul>
                <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-slate-800">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={createMissingPositionsOnImport}
                    onChange={(event) =>
                      setCreateMissingPositionsOnImport(event.target.checked)
                    }
                  />
                  <span>Create these positions when importing</span>
                </label>
                {!createMissingPositionsOnImport ? (
                  <p className="mt-2 text-sm text-amber-900">
                    If unchecked, affected employees will import with Position
                    left blank.
                  </p>
                ) : null}
              </div>
            ) : null}

            {groupedErrorReview.length > 0 ? (
              <div className="rounded-md border border-red-200 bg-red-50/60 px-4 py-3">
                <h3 className="text-sm font-semibold text-red-900">
                  Will not be imported
                </h3>
                <ul className="mt-3 space-y-4 text-sm text-red-900">
                  {groupedErrorReview.map((group) => (
                    <li key={group.group_key}>
                      <p className="font-medium">{group.headline}</p>
                      {group.body ? (
                        <p className="mt-1 text-red-800/90">{group.body}</p>
                      ) : null}
                      <ul className="mt-2 space-y-1 text-red-800/95">
                        {group.examples.map((example) => (
                          <li key={`${example.row_number}-${example.message}`}>
                            {formatReviewIssueMessage(example)}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setErrorsPage(0);
                      setShowAllErrors(true);
                    }}
                    className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-900 hover:bg-red-50"
                  >
                    View all
                  </button>
                  {(validationResult.issue_rows.length > 0 ||
                    validationResult.warning_rows.length > 0) ? (
                    <button
                      type="button"
                      onClick={handleDownloadErrorReport}
                      className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-900 hover:bg-red-50"
                    >
                      Download error report
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {groupedWarningReview.length > 0 ? (
              <div className="rounded-md border border-amber-200 bg-amber-50/60 px-4 py-3">
                <h3 className="text-sm font-semibold text-amber-950">
                  Will be imported, but check these
                </h3>
                <ul className="mt-3 space-y-4 text-sm text-amber-950">
                  {groupedWarningReview.map((group) => (
                    <li key={group.group_key}>
                      <p className="font-medium">{group.headline}</p>
                      <p className="mt-1 text-amber-900/95">{group.body}</p>
                      <ul className="mt-2 space-y-1 text-amber-900/95">
                        {group.examples.map((example) => (
                          <li key={`${example.row_number}-${example.message}`}>
                            {formatReviewIssueMessage(example)}
                          </li>
                        ))}
                      </ul>
                      {group.group_kind === "salary_rate" &&
                      importType === "employee" ? (
                        <Link
                          href="/dashboard/administration/salary-rates"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 inline-flex rounded-md border border-amber-400 bg-white px-3 py-1.5 text-sm font-medium text-[#0f2744] hover:bg-amber-50"
                        >
                          Open Salary Settings
                        </Link>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setWarningsPage(0);
                      setShowAllWarnings(true);
                    }}
                    className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-950 hover:bg-amber-50"
                  >
                    View all
                  </button>
                  {validationResult.issue_rows.length === 0 ? (
                    <button
                      type="button"
                      onClick={handleDownloadErrorReport}
                      className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-950 hover:bg-amber-50"
                    >
                      Download error report
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {validationResult.valid_rows === 0 &&
            (validationResult.error_rows > 0 ||
              validationResult.duplicate_rows > 0) ? (
              <p className="text-sm font-medium text-red-800">
                No rows can be imported. Fix the errors and upload again.
              </p>
            ) : validationResult.error_rows > 0 ||
              validationResult.duplicate_rows > 0 ? (
              <p className="text-sm text-slate-600">
                Rows with errors will be skipped. You can fix them in your
                spreadsheet and import them later.
              </p>
            ) : null}
          </div>
        ) : null}

        {wizardStep === 4 && commitResult ? (
          <div className="space-y-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-900">
            <p className="text-lg font-semibold text-emerald-950">
              Import complete
            </p>
            <p>
              {commitResult.committed_count} row
              {commitResult.committed_count === 1 ? "" : "s"} written to{" "}
              {IMPORT_TYPE_LABELS[importType]} records.
            </p>
            <Link
              href={IMPORT_TYPE_DESTINATION[importType].href}
              className="inline-flex rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white hover:bg-[#16365c]"
            >
              {IMPORT_TYPE_DESTINATION[importType].label}
            </Link>
          </div>
        ) : null}

      </div>

      {wizardStep <= 4 ? (
        <div className="sticky bottom-0 z-10 shrink-0 border-t border-slate-200 bg-white shadow-[0_-4px_12px_rgba(15,39,68,0.06)]">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div>
              {wizardStep > 1 && wizardStep < 4 ? (
                <button
                  type="button"
                  disabled={wizardBusy}
                  onClick={() =>
                    setWizardStep((step) => (step - 1) as WizardStep)
                  }
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Back
                </button>
              ) : null}
            </div>
            <div
              className="flex min-w-0 flex-1 flex-col items-end gap-1 sm:flex-none"
              style={{ paddingRight: WIZARD_FOOTER_CHAT_CLEARANCE_CSS }}
            >
              <div className="flex flex-wrap justify-end gap-2">
                {wizardStep === 1 ? (
                  <WizardPrimaryActionButton
                    onClick={() => void handleUpload()}
                    disabled={stickyPrimaryDisabled}
                    loading={uploading}
                    loadingLabel="Uploading…"
                  >
                    Upload
                  </WizardPrimaryActionButton>
                ) : null}
                {wizardStep === 2 ? (
                  <WizardPrimaryActionButton
                    onClick={() => void handleProceedToReview()}
                    disabled={stickyPrimaryDisabled}
                    loading={step2PrimaryLoading}
                    loadingLabel="Checking…"
                  >
                    Next — Review
                  </WizardPrimaryActionButton>
                ) : null}
                {wizardStep === 3 ? (
                  <WizardPrimaryActionButton
                    onClick={() => void handleCommit()}
                    disabled={stickyPrimaryDisabled}
                    loading={committing}
                    loadingLabel="Importing…"
                  >
                    {importPrimaryLabel}
                  </WizardPrimaryActionButton>
                ) : null}
              </div>
              {wizardStep === 1 && uploadStatusMessage ? (
                <p
                  className="max-w-full text-right text-sm font-medium text-[#0f2744]"
                  aria-live="polite"
                >
                  {uploadStatusMessage}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {showExpectedColumns ? (
        <BulkImportWizardDialog
          title={`Expected columns — ${IMPORT_TYPE_LABELS[importType]} import`}
          onClose={() => setShowExpectedColumns(false)}
          wide
        >
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
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">
                      {field.example}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollableTable>
        </BulkImportWizardDialog>
      ) : null}

      {showAllErrors && validationResult ? (
        <BulkImportWizardDialog
          title="Will not be imported — all issues"
          onClose={() => setShowAllErrors(false)}
          wide
          footer={
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-600">
                Page {errorsPage + 1} of {totalErrorPages}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={errorsPage === 0}
                  onClick={() => setErrorsPage((page) => Math.max(0, page - 1))}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={errorsPage + 1 >= totalErrorPages}
                  onClick={() =>
                    setErrorsPage((page) =>
                      Math.min(totalErrorPages - 1, page + 1),
                    )
                  }
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          }
        >
          <ScrollableTable>
            <table className={scrollableTableClassName}>
              <thead className={scrollableTableHeadClassName}>
                <tr>
                  <th className={scrollableTableThClassName}>Excel row</th>
                  <th className={scrollableTableThClassName}>Issue</th>
                </tr>
              </thead>
              <tbody>
                {pagedErrors.map((issue) => (
                  <tr key={`${issue.row_number}-${issue.message}`}>
                    <td className="px-4 py-3 text-sm text-slate-800">
                      {issue.excel_row_number ?? issue.row_number}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {formatReviewIssueMessage(issue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollableTable>
        </BulkImportWizardDialog>
      ) : null}

      {showAllWarnings && validationResult ? (
        <BulkImportWizardDialog
          title="Will be imported — all warnings"
          onClose={() => setShowAllWarnings(false)}
          wide
          footer={
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-600">
                Page {warningsPage + 1} of {totalWarningPages}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={warningsPage === 0}
                  onClick={() =>
                    setWarningsPage((page) => Math.max(0, page - 1))
                  }
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={warningsPage + 1 >= totalWarningPages}
                  onClick={() =>
                    setWarningsPage((page) =>
                      Math.min(totalWarningPages - 1, page + 1),
                    )
                  }
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          }
        >
          <ScrollableTable>
            <table className={scrollableTableClassName}>
              <thead className={scrollableTableHeadClassName}>
                <tr>
                  <th className={scrollableTableThClassName}>Excel row</th>
                  <th className={scrollableTableThClassName}>Warning</th>
                </tr>
              </thead>
              <tbody>
                {pagedWarnings.map((issue) => (
                  <tr key={`${issue.row_number}-${issue.message}`}>
                    <td className="px-4 py-3 text-sm text-slate-800">
                      {issue.excel_row_number ?? issue.row_number}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {formatReviewIssueMessage(issue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollableTable>
        </BulkImportWizardDialog>
      ) : null}
    </div>
  );
}
