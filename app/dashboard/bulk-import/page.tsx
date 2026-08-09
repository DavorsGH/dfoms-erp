import BulkImportClient from "./bulk-import-client";
import type { BulkImportType } from "@/lib/bulk-import/types";

type BulkImportPageProps = {
  searchParams: Promise<{ type?: string | string[] }>;
};

function parseInitialImportType(rawType: string | string[] | undefined): BulkImportType {
  const value = Array.isArray(rawType) ? rawType[0] : rawType;
  const normalized = value?.trim().toLowerCase();

  if (normalized === "employee") {
    return "employee";
  }

  if (normalized === "service") {
    return "service";
  }

  if (normalized === "product") {
    return "product";
  }

  return "product";
}

export default async function BulkImportPage({ searchParams }: BulkImportPageProps) {
  const params = await searchParams;
  const initialImportType = parseInitialImportType(params.type);

  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold text-[#0f2744]">Bulk Import</h1>
      <p className="mb-6 text-sm text-slate-600">
        Upload a spreadsheet and map columns to product, service, or employee fields.
      </p>
      <BulkImportClient initialImportType={initialImportType} />
    </div>
  );
}
