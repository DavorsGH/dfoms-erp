"use client";

import { useState } from "react";
import { createClient } from "@/utils/supabase/client";
import ImageFileUploadButton from "@/components/image-file-upload-button";
import { syncProductSaleVfrsTax } from "@/utils/product-sale-tax-sync";
import type { FinishedProductRecord } from "../inventory/finished-products-utils";
import type { ClientEntry } from "../operations/clients-utils";
import {
  classifyProductSaleImportRows,
  readProductSaleImportFile,
  runProductSaleImportSequentially,
  summarizeProductSaleImportPreview,
  summarizeProductSaleImportRun,
  type ClassifiedProductSaleImportRow,
  type ProductSaleImportPreview,
  type ProductSaleImportRunSummary,
} from "./product-sales-bulk-import-utils";
import { useStampBusinessUnitId } from "@/app/dashboard/business-unit-view-context";

const IMPORT_ACCEPT =
  ".csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv";

type ProductSalesBulkImportProps = {
  clients: ClientEntry[];
  finishedProducts: FinishedProductRecord[];
  onClose: () => void;
  onImported: () => Promise<void>;
  /** Create-only stamp; null = All Businesses. */
  activeBusinessUnitId?: string | null;
};

function ImportRowList({
  title,
  rows,
  tone,
}: {
  title: string;
  rows: ClassifiedProductSaleImportRow[];
  tone: "ready" | "error";
}) {
  if (rows.length === 0) {
    return null;
  }

  const toneClasses =
    tone === "ready"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : "border-red-200 bg-red-50 text-red-900";

  return (
    <details className={`rounded-md border px-4 py-3 ${toneClasses}`}>
      <summary className="cursor-pointer text-sm font-medium">
        {title} ({rows.length})
      </summary>
      <ul className="mt-3 space-y-2 text-sm">
        {rows.map((row) => (
          <li key={`${row.category}-${row.rowNumber}-${row.invoiceNo}`}>
            Row {row.rowNumber}: {row.dateLabel} · {row.invoiceNo} ·{" "}
            {row.productCode} — {row.message}
          </li>
        ))}
      </ul>
    </details>
  );
}

function ImportResultsSummary({
  summary,
}: {
  summary: ProductSaleImportRunSummary;
}) {
  return (
    <div className="space-y-4">
      <p className="rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
        {summarizeProductSaleImportRun(summary)}
      </p>

      {summary.succeeded.length > 0 ? (
        <details className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-900">
          <summary className="cursor-pointer text-sm font-medium">
            Succeeded ({summary.succeeded.length})
          </summary>
          <ul className="mt-3 space-y-2 text-sm">
            {summary.succeeded.map((row) => (
              <li key={`success-${row.rowNumber}-${row.invoiceNo}`}>
                Row {row.rowNumber}: {row.invoiceNo}
                {row.incomeId ? ` — income_register ${row.incomeId}` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {summary.failed.length > 0 ? (
        <details className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-red-900">
          <summary className="cursor-pointer text-sm font-medium">
            Failed ({summary.failed.length})
          </summary>
          <ul className="mt-3 space-y-2 text-sm">
            {summary.failed.map((row) => (
              <li key={`failed-${row.rowNumber}-${row.invoiceNo}`}>
                Row {row.rowNumber}: {row.invoiceNo} — {row.errorMessage}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export default function ProductSalesBulkImport({
  clients,
  finishedProducts,
  onClose,
  onImported,
  activeBusinessUnitId = null,
}: ProductSalesBulkImportProps) {
  const supabase = createClient();
  const stampBusinessUnit = useStampBusinessUnitId();
  const [preview, setPreview] = useState<ProductSaleImportPreview | null>(null);
  const [importSummary, setImportSummary] =
    useState<ProductSaleImportRunSummary | null>(null);
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
    setImportSummary(null);

    try {
      const rawRows = await readProductSaleImportFile(file);

      if (rawRows.length === 0) {
        throw new Error("No product sale rows were found in the file.");
      }

      setPreview(
        classifyProductSaleImportRows(rawRows, clients, finishedProducts),
      );
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

    if (!stampBusinessUnit.ok) {
      setError(stampBusinessUnit.error);
      return;
    }

    setImporting(true);
    setError(null);
    setImportSummary(null);

    const summary = await runProductSaleImportSequentially(
      preview.ready,
      async (payload) => {
        const { data, error: rpcError } = await supabase.rpc(
          "create_product_sale",
          {
            ...payload,
            p_business_unit_id: stampBusinessUnit.businessUnitId,
          },
        );

        return {
          data: (data as string | null) ?? null,
          error: rpcError ? { message: rpcError.message } : null,
        };
      },
    );

    // VFRS output tax + tax ledger for the rows this import just created
    // (forward-only — pre-existing sales are untouched). Non-fatal.
    const importedIncomeIds = summary.succeeded
      .map((row) => row.incomeId)
      .filter((id): id is string => Boolean(id));
    const { error: taxError } = await syncProductSaleVfrsTax(
      supabase,
      importedIncomeIds,
    );

    setImportSummary(summary);
    setImporting(false);

    if (taxError) {
      setError(
        `Sales imported, but the VFRS tax ledger could not be updated: ${taxError}`,
      );
    }

    if (summary.succeeded.length > 0) {
      await onImported();
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-[#0f2744]">
            Bulk Import Product Sales
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            Upload a CSV or Excel file with columns: Date, Invoice No,
            Customer ID, Customer Name, Product Code, Quantity, Unit Price,
            Amount Received, Payment Status, Due Date, Notes. Each ready row
            posts via create_product_sale (stock, COGS, and movements).
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

        {importSummary ? <ImportResultsSummary summary={importSummary} /> : null}

        {preview && !importSummary ? (
          <div className="space-y-4">
            <p className="rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
              {summarizeProductSaleImportPreview(preview)}
            </p>

            <ImportRowList
              title="Ready to import"
              rows={preview.ready}
              tone="ready"
            />
            <ImportRowList title="Errors" rows={preview.errors} tone="error" />

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

        {importSummary ? (
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                setPreview(null);
                setImportSummary(null);
                setSelectedFiles([]);
                setError(null);
              }}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              Import Another File
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
            >
              Done
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
