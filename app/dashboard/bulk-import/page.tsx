import BulkImportClient from "./bulk-import-client";
import {
  BULK_IMPORT_MODULE_BACK_LINK,
  type BulkImportModuleBackLink,
} from "@/lib/bulk-import/bulk-import-module-back-link";
import type { BulkImportType } from "@/lib/bulk-import/types";

type BulkImportPageProps = {
  searchParams: Promise<{ type?: string | string[] }>;
};

function parseInitialImportType(rawType: string | string[] | undefined): BulkImportType {
  const value = Array.isArray(rawType) ? rawType[0] : rawType;
  const normalized = value?.trim().toLowerCase();

  if (normalized === "expense") {
    return "expense";
  }

  if (normalized === "fixed_asset" || normalized === "fixed-asset") {
    return "fixed_asset";
  }

  if (normalized === "customer") {
    return "customer";
  }

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

function moduleBackLinkFromSearchParams(
  rawType: string | string[] | undefined,
): BulkImportModuleBackLink | null {
  const value = Array.isArray(rawType) ? rawType[0] : rawType;
  if (!value?.trim()) {
    return null;
  }
  return BULK_IMPORT_MODULE_BACK_LINK[parseInitialImportType(rawType)];
}

export default async function BulkImportPage({ searchParams }: BulkImportPageProps) {
  const params = await searchParams;
  const initialImportType = parseInitialImportType(params.type);
  const moduleBackLink = moduleBackLinkFromSearchParams(params.type);

  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold text-[#0f2744]">Bulk Import</h1>
      <p className="mb-6 text-sm text-slate-600">
        Upload a spreadsheet and map columns to product, service, employee, customer, expense register, or fixed asset fields.
      </p>
      <BulkImportClient
        initialImportType={initialImportType}
        moduleBackLink={moduleBackLink}
      />
    </div>
  );
}
