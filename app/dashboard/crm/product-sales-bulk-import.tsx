"use client";

import { useRef, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import type { FinishedProductRecord } from "../inventory/finished-products-utils";
import { inputClassName } from "../hr-payroll/hr-register-utils";
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

type ProductSalesBulkImportProps = {
  clients: ClientEntry[];
  finishedProducts: FinishedProductRecord[];
  onClose: () => void;
  onImported: () => Promise<void>;
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
}: ProductSalesBulkImportProps) {
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ProductSaleImportPreview | null>(null);
  const [importSummary, setImportSummary] =
    useState<ProductSaleImportRunSummary | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    setParsing(true);
    setError(null);
    setPreview(null);
    setImportSummary(null);
    setFileName(file.name);

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
      setFileName(null);
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
    setImportSummary(null);

    const summary = await runProductSaleImportSequentially(
      preview.ready,
      async (payload) => {
        const { data, error: rpcError } = await supabase.rpc(
          "create_product_sale",
          payload,
        );

        return {
          data: (data as string | null) ?? null,
          error: rpcError ? { message: rpcError.message } : null,
        };
      },
    );

    setImportSummary(summary);
    setImporting(false);

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
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            onChange={handleFileChange}
            className={inputClassName}
            disabled={importing}
          />
          {fileName ? (
            <p className="mt-2 text-sm text-slate-600">Selected file: {fileName}</p>
          ) : null}
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
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Choose Another File
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
                setFileName(null);
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
