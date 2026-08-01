"use client";

import { useState } from "react";
import { createClient } from "@/utils/supabase/client";
import ImageFileUploadButton from "@/components/image-file-upload-button";
import type { CrmProductEntry } from "./products-utils";
import {
  classifyProductImportRows,
  readProductImportFile,
  summarizeProductImportPreview,
  type ClassifiedProductImportRow,
  type ProductImportPreview,
} from "./products-bulk-import-utils";

const IMPORT_ACCEPT =
  ".csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv";

type ProductsBulkImportProps = {
  existingProducts: CrmProductEntry[];
  onClose: () => void;
  onImported: () => Promise<void>;
};

function ImportRowList({
  title,
  rows,
  tone,
}: {
  title: string;
  rows: ClassifiedProductImportRow[];
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
          <li key={`${row.category}-${row.rowNumber}-${row.name}`}>
            Row {row.rowNumber}: {row.name} · {row.productCategory} — {row.message}
          </li>
        ))}
      </ul>
    </details>
  );
}

export default function ProductsBulkImport({
  existingProducts,
  onClose,
  onImported,
}: ProductsBulkImportProps) {
  const supabase = createClient();
  const [preview, setPreview] = useState<ProductImportPreview | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFileSelected(files: File[]) {
    const file = files[0];
    setSelectedFiles(files);

    if (!file) {
      setPreview(null);
      return;
    }

    setParsing(true);
    setError(null);
    setPreview(null);

    try {
      const rawRows = await readProductImportFile(file);

      if (rawRows.length === 0) {
        throw new Error("No product rows were found in the file.");
      }

      setPreview(classifyProductImportRows(rawRows, existingProducts));
    } catch (parseError) {
      setError(
        parseError instanceof Error
          ? parseError.message
          : "Failed to read the import file.",
      );
      setSelectedFiles([]);
    } finally {
      setParsing(false);
    }
  }

  async function handleConfirmImport() {
    if (!preview || preview.ready.length === 0) {
      return;
    }

    setImporting(true);
    setError(null);

    const payloads = preview.ready
      .map((row) => row.payload)
      .filter((payload): payload is NonNullable<typeof payload> => payload !== null);

    const { error: insertError } = await supabase
      .from("crm_products")
      .insert(payloads);

    if (insertError) {
      setError(insertError.message);
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
            Bulk Import Products
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            Upload a CSV or Excel file with columns: Name, Product Type,
            Category, Unit Price, Billing Cycle, Active.
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
            disabled={importing || parsing}
            accept={IMPORT_ACCEPT}
            addLabel="Choose file"
            changeLabel="Change file"
            emptyHint="CSV or Excel (.xlsx)."
          />
        </div>

        {parsing ? (
          <p className="text-sm text-slate-600">Reading file…</p>
        ) : null}

        {error ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {preview ? (
          <div className="space-y-4">
            <p className="rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
              {summarizeProductImportPreview(preview)}
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
                disabled={importing || preview.ready.length === 0}
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
