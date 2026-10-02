import {
  emptyLineItem,
  type ClientInvoiceFormLineItem,
  type ClientInvoiceSiteOption,
} from "@/utils/client-invoices-types";
import type { ServiceContractLineItemInput } from "@/utils/service-contracts-types";

export type ClientInvoiceSiteLineSource = {
  site_code: string;
  site_name: string;
  project_code?: string | null;
  project_name?: string | null;
  building?: string | null;
  floor_zone?: string | null;
};

function normalizeMatchKey(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function pickServiceContractLineForSite(
  site: ClientInvoiceSiteLineSource,
  contractLines: ServiceContractLineItemInput[],
): ServiceContractLineItemInput | null {
  if (contractLines.length === 0) {
    return null;
  }

  const projectName = site.project_name?.trim();
  const projectCode = site.project_code?.trim();

  if (projectName || projectCode) {
    const matched = contractLines.find((line) => {
      const category = normalizeMatchKey(line.category_label);
      if (projectName && category === normalizeMatchKey(projectName)) {
        return true;
      }
      if (projectCode && category === normalizeMatchKey(projectCode)) {
        return true;
      }
      return false;
    });
    if (matched) {
      return matched;
    }
  }

  return contractLines[0] ?? null;
}

function buildSiteLineDescription(
  site: ClientInvoiceSiteLineSource,
  contractLine: ServiceContractLineItemInput | null,
): string {
  const locationParts = [site.building?.trim(), site.floor_zone?.trim()].filter(Boolean);
  const locationSuffix =
    locationParts.length > 0 ? ` (${locationParts.join(" / ")})` : "";

  const contractDescription = contractLine?.description?.trim();
  if (contractDescription) {
    return `${site.site_name.trim()}${locationSuffix} — ${contractDescription}`;
  }

  return `${site.site_name.trim()}${locationSuffix}`;
}

export function buildClientInvoiceLineFromSite(options: {
  site: ClientInvoiceSiteLineSource;
  contractLineItems: ServiceContractLineItemInput[];
  sortOrder: number;
}): ClientInvoiceFormLineItem {
  const contractLine = pickServiceContractLineForSite(
    options.site,
    options.contractLineItems,
  );

  return {
    ...emptyLineItem(options.sortOrder),
    site_id: options.site.site_code,
    category_label:
      contractLine?.category_label?.trim() ||
      options.site.project_name?.trim() ||
      "General",
    description: buildSiteLineDescription(options.site, contractLine),
    labour_amount: Number(contractLine?.labour_amount) || 0,
    material_amount: Number(contractLine?.material_amount) || 0,
    discount_amount: Number(contractLine?.discount_amount) || 0,
    taxed: contractLine?.taxed ?? true,
  };
}

export function clientInvoiceSiteLinePickerVisible(options: {
  itemSource: "none" | "site" | "product";
}): boolean {
  return options.itemSource === "site";
}

export function normalizeClientInvoiceSiteOption(
  raw: Record<string, unknown>,
): ClientInvoiceSiteOption | null {
  const site_code =
    typeof raw.site_code === "string" ? raw.site_code.trim() : "";
  const site_name =
    typeof raw.site_name === "string" ? raw.site_name.trim() : "";
  const client_id =
    typeof raw.client_id === "string" ? raw.client_id.trim() : "";
  if (!site_code || !site_name || !client_id) {
    return null;
  }

  const projectRaw = Array.isArray(raw.project)
    ? raw.project[0]
    : raw.project;
  const project =
    projectRaw && typeof projectRaw === "object"
      ? (projectRaw as Record<string, unknown>)
      : null;

  return {
    site_code,
    site_name,
    client_id,
    building:
      typeof raw.building === "string" ? raw.building.trim() || null : null,
    floor_zone:
      typeof raw.floor_zone === "string" ? raw.floor_zone.trim() || null : null,
    project_code:
      typeof project?.project_code === "string"
        ? project.project_code.trim() || null
        : null,
    project_name:
      typeof project?.project_name === "string"
        ? project.project_name.trim() || null
        : null,
  };
}
