"use client";

import { useCallback, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import ImageFileUploadButton from "@/components/image-file-upload-button";
import { useAlert } from "@/components/feedback/feedback-context";
import type { AttendanceRegisterEntry } from "./attendance-register-utils";
import {
  classifyAttendanceImportRows,
  readAttendanceImportFile,
  summarizeAttendanceImportPreview,
  type AttendanceImportPreview,
  type ClassifiedAttendanceImportRow,
} from "./attendance-bulk-import-utils";
import type { HrEmployee } from "./employee-utils";

import {
  inspectSpreadsheetFileForImport,
  spreadsheetImportAlertFromError,
  spreadsheetImportUploadFailedAlert,
  type SpreadsheetImportAlert,
} from "@/lib/spreadsheet/spreadsheet-import-alerts";
import {
  SPREADSHEET_FILE_ACCEPT,
  SPREADSHEET_UPLOAD_HINT,
} from "@/lib/spreadsheet/spreadsheet-upload-validation";
import SpreadsheetImportSheetOptions from "@/components/spreadsheet-import-sheet-options";
import { readSpreadsheetFileToRows } from "@/lib/spreadsheet/safe-spreadsheet-parse";
import {
  loadSpreadsheetWorkbookFromFile,
  summarizeSpreadsheetSheet,
  type SpreadsheetSheetSummary,
} from "@/lib/spreadsheet/parse-spreadsheet-client";

const IMPORT_ACCEPT = SPREADSHEET_FILE_ACCEPT;

type AttendanceBulkImportProps = {
  employees: HrEmployee[];
  existingEntries: Pick<AttendanceRegisterEntry, "date" | "staff_id">[];
  onClose: () => void;
  onImported: () => Promise<void>;
};

function ImportRowList({
  title,
  rows,
  tone,
}: {
  title: string;
  rows: ClassifiedAttendanceImportRow[];
  tone: "ready" | "duplicate" | "error";
}) {
  if (rows.length === 0) {
    return null;
  }

  const toneClasses =
    tone === "ready"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : tone === "duplicate"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-red-200 bg-red-50 text-red-900";

  return (
    <details className={`rounded-md border px-4 py-3 ${toneClasses}`}>
      <summary className="cursor-pointer text-sm font-medium">
        {title} ({rows.length})
      </summary>
      <ul className="mt-3 space-y-2 text-sm">
        {rows.map((row) => (
          <li key={`${row.category}-${row.rowNumber}-${row.staffId}`}>
            Row {row.rowNumber}: {row.dateLabel} · {row.staffId}
            {row.employeeName ? ` · ${row.employeeName}` : ""} — {row.message}
          </li>
        ))}
      </ul>
    </details>
  );
}

export default function AttendanceBulkImport({
  employees,
  existingEntries,
  onClose,
  onImported,
}: AttendanceBulkImportProps) {
  const supabase = createClient();
  const { alert: showAlert } = useAlert();
  const showImportAlert = useCallback((payload: SpreadsheetImportAlert) => {
    showAlert({
      variant: "error",
      title: payload.title,
      message: payload.message,
    });
  }, [showAlert]);

  const [preview, setPreview] = useState<AttendanceImportPreview | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [fileUploadBlocked, setFileUploadBlocked] = useState(false);
  const [loadingWorkbook, setLoadingWorkbook] = useState(false);
  const [sheetSummaries, setSheetSummaries] = useState<SpreadsheetSheetSummary[]>(
    [],
  );
  const [selectedSheetName, setSelectedSheetName] = useState("");
  const [headerRowIndexBySheet, setHeaderRowIndexBySheet] = useState<
    Record<string, number>
  >({});

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

  async function parseAttendanceSheet(
    file: File,
    sheetName: string,
    headerRowIndex?: number,
  ) {
    setParsing(true);
    setPreview(null);

    try {
      const resolvedHeader = headerRowIndex ?? resolvedHeaderRowIndex(sheetName);
      const rawRows = await readAttendanceImportFile(file, {
        sheetName,
        headerRowIndex: resolvedHeader,
      });

      if (rawRows.length === 0) {
        throw new Error("No attendance rows were found in the file.");
      }

      setPreview(
        classifyAttendanceImportRows(rawRows, employees, existingEntries),
      );
    } catch (parseError) {
      console.error("Attendance import parse failed", parseError);
      showImportAlert(
        spreadsheetImportAlertFromError(parseError, "parse"),
      );
      setSelectedFiles([]);
      setFileUploadBlocked(true);
      setSheetSummaries([]);
      setSelectedSheetName("");
    } finally {
      setParsing(false);
    }
  }

  async function handleFileSelected(files: File[]) {
    const file = files[0];

    if (!file) {
      setSelectedFiles([]);
      setFileUploadBlocked(false);
      setPreview(null);
      setSheetSummaries([]);
      setSelectedSheetName("");
      return;
    }

    setSelectedFiles([file]);
    const inspection = inspectSpreadsheetFileForImport(file);
    if (!inspection.ok) {
      setFileUploadBlocked(true);
      setPreview(null);
      setSheetSummaries([]);
      setSelectedSheetName("");
      showImportAlert(inspection.alert);
      return;
    }

    setFileUploadBlocked(false);
    setLoadingWorkbook(true);
    setPreview(null);
    setSheetSummaries([]);
    setSelectedSheetName("");

    try {
      const loaded = await loadSpreadsheetWorkbookFromFile(file);
      setSheetSummaries(loaded.sheetSummaries);
      setSelectedSheetName(loaded.defaultSheetName);
      await parseAttendanceSheet(file, loaded.defaultSheetName);
    } catch (loadError) {
      console.error("Attendance import workbook load failed", loadError);
      showImportAlert(
        spreadsheetImportAlertFromError(loadError, "parse"),
      );
      setSelectedFiles([]);
      setFileUploadBlocked(true);
    } finally {
      setLoadingWorkbook(false);
    }
  }

  function handleSheetChange(sheetName: string) {
    setSelectedSheetName(sheetName);
    const file = selectedFiles[0];
    if (file) {
      void parseAttendanceSheet(file, sheetName);
    }
  }

  function handleHeaderRowIndexChange(headerRowIndex: number) {
    setHeaderRowIndexBySheet((previous) => ({
      ...previous,
      [selectedSheetName]: headerRowIndex,
    }));

    const file = selectedFiles[0];
    if (file && selectedSheetName) {
      void refreshSheetDataRowCount(file, selectedSheetName, headerRowIndex);
      void parseAttendanceSheet(file, selectedSheetName, headerRowIndex);
    }
  }

  async function handleConfirmImport() {
    if (!preview || preview.ready.length === 0) {
      return;
    }

    setImporting(true);

    const payloads = preview.ready
      .map((row) => row.payload)
      .filter((payload): payload is NonNullable<typeof payload> => payload !== null);

    const { error: insertError } = await supabase
      .from("attendance_register")
      .insert(payloads);

    if (insertError) {
      console.error("Attendance import insert failed", insertError);
      showImportAlert(spreadsheetImportUploadFailedAlert());
      setImporting(false);
      return;
    }

    await onImported();
    setImporting(false);
    onClose();
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-[#0f2744]">
            Bulk Import Attendance
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            Upload a CSV or Excel file with columns: Date, Staff ID, Employee
            Name, Employment Type, Project Assignment, Clock In, Clock Out,
            Hours Worked, Overtime Hours, Attendance Status.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          Close
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <ImageFileUploadButton
            files={selectedFiles}
            onChange={(next) => void handleFileSelected(next)}
            multiple={false}
            disabled={importing || parsing || loadingWorkbook}
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
            disabled={importing || parsing}
          />
        ) : null}

        {parsing && !loadingWorkbook ? (
          <p className="text-sm text-slate-600">Reading file…</p>
        ) : null}

        {preview ? (
          <div className="space-y-4">
            <p className="rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
              {summarizeAttendanceImportPreview(preview)}
            </p>

            <ImportRowList
              title="Ready to import"
              rows={preview.ready}
              tone="ready"
            />
            <ImportRowList
              title="Duplicates"
              rows={preview.duplicates}
              tone="duplicate"
            />
            <ImportRowList
              title="Errors"
              rows={preview.errors}
              tone="error"
            />

            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleConfirmImport}
                disabled={
                  importing || fileUploadBlocked || preview.ready.length === 0
                }
                className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {importing
                  ? "Importing…"
                  : `Confirm Import (${preview.ready.length})`}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
