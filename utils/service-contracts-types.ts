import {
  computeInvoiceTotals,
  computeLineTotalCost,
  emptyLineItem,
  formatGeneratedInvoiceNumber,
  formatInvoiceDate,
  formatInvoiceMoney,
  groupLineItemsByCategory,
  roundMoney,
  toNumber,
  type ClientInvoiceFormLineItem,
  type ClientInvoiceLineItemInput,
  type ClientInvoiceWriteBody,
} from "@/utils/client-invoices-types";
import {
  DEFAULT_SALES_TAX_BASIS,
  type SalesTaxBasis,
} from "@/app/dashboard/finance/tax-utils";
import { QUOTATION_TAX_BASIS_OPTIONS, formatQuotationTaxBasisLabel } from "@/utils/client-quotations-types";

export {
  computeLineTotalCost,
  emptyLineItem,
  formatGeneratedInvoiceNumber,
  formatInvoiceDate,
  formatInvoiceMoney,
  groupLineItemsByCategory,
  roundMoney,
  toNumber,
  QUOTATION_TAX_BASIS_OPTIONS as SERVICE_CONTRACT_TAX_BASIS_OPTIONS,
  formatQuotationTaxBasisLabel as formatServiceContractTaxBasisLabel,
};

export const SERVICE_CONTRACT_ENTITY_TYPE = "SC" as const;

export const SERVICE_CONTRACT_STATUSES = [
  "draft",
  "active",
  "expired",
  "terminated",
] as const;
export type ServiceContractStatus = (typeof SERVICE_CONTRACT_STATUSES)[number];

export const SERVICE_CONTRACT_BILLING_FREQUENCIES = [
  "monthly",
  "quarterly",
  "annually",
] as const;
export type ServiceContractBillingFrequency =
  (typeof SERVICE_CONTRACT_BILLING_FREQUENCIES)[number];

export const SERVICE_CONTRACT_LIST_SELECT =
  "id, tenant_id, client_id, contract_number, contract_sequence, start_date, end_date, auto_renew, billing_frequency, next_billing_date, status, tax_basis, total_amount_due, created_at, client:customers!service_contracts_tenant_client_fkey(client_id, client_name)" as const;

export const SERVICE_CONTRACT_HEADER_SELECT =
  "id, tenant_id, client_id, contract_number, contract_sequence, start_date, end_date, auto_renew, billing_frequency, next_billing_date, status, tax_basis, vat_nhil_getfund_rate, wht_rate, subtotal, tax_due, wht_amount, total_amount_due, document_url, notes, created_at, updated_at, client:customers!service_contracts_tenant_client_fkey(client_id, client_name, address, phone)" as const;

export const SERVICE_CONTRACT_LINE_ITEM_SELECT =
  "id, contract_id, tenant_id, category_label, description, labour_amount, material_amount, discount_amount, taxed, total_cost, sort_order" as const;

export const SERVICE_CONTRACT_CUSTOMER_360_SELECT =
  "id, contract_number, start_date, end_date, status, next_billing_date, total_amount_due" as const;

export const SERVICE_CONTRACT_PORTAL_LIST_SELECT =
  "id, contract_number, start_date, end_date, billing_frequency, status, document_url, subtotal, total_amount_due" as const;

export type ServiceContractPortalListRow = {
  id: string;
  contract_number: string;
  start_date: string;
  end_date: string;
  billing_frequency: ServiceContractBillingFrequency;
  status: ServiceContractStatus;
  document_url: string | null;
  subtotal: number;
  total_amount_due: number;
};

export type ServiceContractCustomer = {
  client_id: string;
  client_name: string;
  address?: string | null;
  phone?: string | null;
};

export type ServiceContractListRow = {
  id: string;
  tenant_id: string;
  client_id: string;
  contract_number: string;
  contract_sequence: number;
  start_date: string;
  end_date: string;
  auto_renew: boolean;
  billing_frequency: ServiceContractBillingFrequency;
  next_billing_date: string | null;
  status: ServiceContractStatus;
  tax_basis: SalesTaxBasis;
  total_amount_due: number;
  created_at: string;
  client?: ServiceContractCustomer | ServiceContractCustomer[] | null;
};

export type ServiceContractLineItemRow = {
  id: string;
  contract_id: string;
  tenant_id: string;
  category_label: string | null;
  description: string;
  labour_amount: number;
  material_amount: number;
  discount_amount: number;
  taxed: boolean;
  total_cost: number;
  sort_order: number;
};

export type ServiceContractHeaderRow = {
  id: string;
  tenant_id: string;
  client_id: string;
  contract_number: string;
  contract_sequence: number;
  start_date: string;
  end_date: string;
  auto_renew: boolean;
  billing_frequency: ServiceContractBillingFrequency;
  next_billing_date: string | null;
  status: ServiceContractStatus;
  tax_basis: SalesTaxBasis;
  vat_nhil_getfund_rate: number;
  wht_rate: number;
  subtotal: number;
  tax_due: number;
  wht_amount: number;
  total_amount_due: number;
  document_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  client?: ServiceContractCustomer | ServiceContractCustomer[] | null;
};

export type ServiceContractLineItemInput = ClientInvoiceLineItemInput;

export type ServiceContractWriteBody = {
  client_id: string;
  start_date: string;
  end_date: string;
  auto_renew?: boolean;
  billing_frequency?: ServiceContractBillingFrequency;
  next_billing_date?: string | null;
  status?: ServiceContractStatus;
  tax_basis?: SalesTaxBasis;
  vat_nhil_getfund_rate?: number;
  wht_rate?: number;
  document_url?: string | null;
  notes?: string | null;
  line_items: ServiceContractLineItemInput[];
};

export type ServiceContractFormLineItem = ClientInvoiceFormLineItem;

export type ServiceContractCustomer360Row = {
  id: string;
  contract_number: string;
  start_date: string;
  end_date: string;
  status: ServiceContractStatus;
  next_billing_date: string | null;
  total_amount_due: number;
};

export type ServiceContractOption = {
  id: string;
  contract_number: string;
  client_id: string;
  status: ServiceContractStatus;
};

export type ClientInvoiceSourceContract = {
  id: string;
  contract_number: string;
};

export function normalizeServiceContractStatus(value: unknown): ServiceContractStatus {
  if (
    value === "active" ||
    value === "expired" ||
    value === "terminated"
  ) {
    return value;
  }

  return "draft";
}

export function normalizeBillingFrequency(
  value: unknown,
): ServiceContractBillingFrequency {
  if (value === "quarterly" || value === "annually") {
    return value;
  }

  return "monthly";
}

export function resolveServiceContractTaxBasis(
  taxBasis: SalesTaxBasis | undefined | null,
): SalesTaxBasis {
  if (taxBasis === "total_cost" || taxBasis === "service_only") {
    return taxBasis;
  }

  return DEFAULT_SALES_TAX_BASIS;
}

export function formatServiceContractStatus(status: string) {
  switch (status) {
    case "active":
      return "Active";
    case "expired":
      return "Expired";
    case "terminated":
      return "Terminated";
    default:
      return "Draft";
  }
}

export function serviceContractStatusBadgeClassName(status: string) {
  switch (status) {
    case "active":
      return "bg-emerald-100 text-emerald-900";
    case "expired":
      return "bg-amber-100 text-amber-900";
    case "terminated":
      return "bg-slate-100 text-slate-700";
    default:
      return "bg-sky-100 text-sky-900";
  }
}

export const SERVICE_CONTRACT_DISPLAY_STEPS = [
  { id: "draft", label: "Draft" },
  { id: "active", label: "Active" },
  { id: "renewal_due", label: "Renewal Due" },
  { id: "expired", label: "Expired" },
  { id: "terminated", label: "Terminated" },
] as const;

export type ServiceContractDisplayStepId =
  (typeof SERVICE_CONTRACT_DISPLAY_STEPS)[number]["id"];

export function resolveServiceContractDisplayStep(
  status: ServiceContractStatus,
  endDate: string | null | undefined,
): ServiceContractDisplayStepId {
  if (status === "terminated") {
    return "terminated";
  }

  if (status === "expired") {
    return "expired";
  }

  if (status === "active") {
    return isContractExpiringWithinDays(endDate) ? "renewal_due" : "active";
  }

  return "draft";
}

export function formatServiceContractDisplayStep(step: ServiceContractDisplayStepId) {
  return (
    SERVICE_CONTRACT_DISPLAY_STEPS.find((entry) => entry.id === step)?.label ?? "Draft"
  );
}

export function serviceContractDisplayStepBadgeClassName(
  step: ServiceContractDisplayStepId,
) {
  switch (step) {
    case "active":
      return "bg-emerald-100 text-emerald-900 border-emerald-200";
    case "renewal_due":
      return "bg-amber-100 text-amber-900 border-amber-200";
    case "expired":
      return "bg-orange-100 text-orange-900 border-orange-200";
    case "terminated":
      return "bg-slate-100 text-slate-700 border-slate-200";
    default:
      return "bg-sky-100 text-sky-900 border-sky-200";
  }
}

export type ServiceContractGeneratedInvoice = {
  id: string;
  invoice_number: string;
  invoice_date: string;
  billing_period_start: string | null;
  billing_period_end: string | null;
  status: string;
  total_amount_due: number;
};

export function formatServiceContractBillingPeriod(
  start: string | null | undefined,
  end: string | null | undefined,
  invoiceDate: string,
) {
  if (start && end) {
    return `${formatInvoiceDate(start)} – ${formatInvoiceDate(end)}`;
  }

  return formatInvoiceDate(invoiceDate);
}

export function isServiceContractDocumentImage(documentPath: string | null | undefined) {
  if (!documentPath?.trim()) {
    return false;
  }

  return /\.(jpe?g|png|webp)$/i.test(documentPath.trim());
}

export function serviceContractDocumentFileName(documentPath: string | null | undefined) {
  if (!documentPath?.trim()) {
    return null;
  }

  const segments = documentPath.split("/");
  return segments[segments.length - 1] || documentPath;
}

export function formatBillingFrequencyLabel(frequency: string) {
  switch (frequency) {
    case "quarterly":
      return "Quarterly";
    case "annually":
      return "Annually";
    default:
      return "Monthly";
  }
}

export function isContractExpiringWithinDays(
  endDate: string | null | undefined,
  days = 30,
  asOf = new Date(),
): boolean {
  if (!endDate) {
    return false;
  }

  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(end.getTime())) {
    return false;
  }

  const today = new Date(
    Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()),
  );
  const threshold = new Date(today);
  threshold.setUTCDate(threshold.getUTCDate() + days);

  return end >= today && end <= threshold;
}

export function advanceBillingDate(
  date: string,
  frequency: ServiceContractBillingFrequency,
): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }

  switch (frequency) {
    case "quarterly":
      parsed.setUTCMonth(parsed.getUTCMonth() + 3);
      break;
    case "annually":
      parsed.setUTCFullYear(parsed.getUTCFullYear() + 1);
      break;
    default:
      parsed.setUTCMonth(parsed.getUTCMonth() + 1);
      break;
  }

  return parsed.toISOString().slice(0, 10);
}

export function computeServiceContractTotals(
  lineItems: ServiceContractLineItemInput[],
  vatRate: unknown,
  whtRate: unknown,
  taxBasis: SalesTaxBasis,
) {
  return computeInvoiceTotals(lineItems, vatRate, whtRate, taxBasis);
}

function firstEmbeddedRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) {
    return null;
  }

  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export function normalizeServiceContractListRow(
  row: ServiceContractListRow,
): ServiceContractListRow {
  return {
    ...row,
    total_amount_due: toNumber(row.total_amount_due),
    client: firstEmbeddedRelation(row.client),
  };
}

export function normalizeServiceContractHeaderRow(
  row: ServiceContractHeaderRow,
): ServiceContractHeaderRow {
  return {
    ...row,
    vat_nhil_getfund_rate: toNumber(row.vat_nhil_getfund_rate),
    wht_rate: toNumber(row.wht_rate),
    subtotal: toNumber(row.subtotal),
    tax_due: toNumber(row.tax_due),
    wht_amount: toNumber(row.wht_amount),
    total_amount_due: toNumber(row.total_amount_due),
    client: firstEmbeddedRelation(row.client),
  };
}

export function validateServiceContractBody(body: ServiceContractWriteBody): string | null {
  if (!body.client_id?.trim()) {
    return "Customer is required.";
  }

  if (!body.start_date?.trim()) {
    return "Start date is required.";
  }

  if (!body.end_date?.trim()) {
    return "End date is required.";
  }

  if (body.end_date < body.start_date) {
    return "End date must be on or after start date.";
  }

  if (!Array.isArray(body.line_items) || body.line_items.length === 0) {
    return "Add at least one line item.";
  }

  for (const [index, line] of body.line_items.entries()) {
    if (!line.description?.trim()) {
      return `Line ${index + 1} description is required.`;
    }
  }

  return null;
}

export function serviceContractToFormState(
  contract: ServiceContractHeaderRow,
  lineItems: ServiceContractLineItemRow[],
) {
  return {
    client_id: contract.client_id,
    start_date: contract.start_date,
    end_date: contract.end_date,
    auto_renew: contract.auto_renew,
    billing_frequency: normalizeBillingFrequency(contract.billing_frequency),
    next_billing_date: contract.next_billing_date ?? contract.start_date,
    status: normalizeServiceContractStatus(contract.status),
    tax_basis: resolveServiceContractTaxBasis(contract.tax_basis),
    vat_nhil_getfund_rate: toNumber(contract.vat_nhil_getfund_rate),
    wht_rate: toNumber(contract.wht_rate),
    document_url: contract.document_url ?? "",
    notes: contract.notes ?? "",
    line_items: [...lineItems]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((line, index) => ({
        key: line.id,
        site_id: null,
        category_label: line.category_label ?? "",
        description: line.description,
        labour_amount: toNumber(line.labour_amount),
        material_amount: toNumber(line.material_amount),
        discount_amount: toNumber(line.discount_amount),
        taxed: line.taxed,
        sort_order: index,
      })),
  };
}

export function contractToInvoiceWriteBody(
  contract: ServiceContractHeaderRow,
  lineItems: ServiceContractLineItemInput[],
  customer: ServiceContractCustomer,
  invoiceDate: string,
): ClientInvoiceWriteBody {
  return {
    client_id: contract.client_id,
    contract_id: contract.id,
    invoice_date: invoiceDate,
    due_date: invoiceDate,
    billing_period_start: contract.start_date,
    billing_period_end: contract.end_date,
    bill_to_name: customer.client_name,
    bill_to_address: customer.address ?? null,
    bill_to_phone: customer.phone ?? null,
    vat_nhil_getfund_rate: contract.vat_nhil_getfund_rate,
    wht_rate: contract.wht_rate,
    status: "draft",
    amount_received: 0,
    notes: contract.notes
      ? `Generated from service contract ${contract.contract_number}. ${contract.notes}`
      : `Generated from service contract ${contract.contract_number}.`,
    line_items: lineItems.map((line, index) => ({
      ...line,
      sort_order: line.sort_order ?? index,
    })),
    payment_account_ids: [],
  };
}

export function defaultServiceContractFormState(
  vatRate = 20,
  whtRate = 7.5,
  taxBasis: SalesTaxBasis = DEFAULT_SALES_TAX_BASIS,
) {
  const today = new Date().toISOString().slice(0, 10);
  const end = new Date();
  end.setUTCFullYear(end.getUTCFullYear() + 1);

  return {
    client_id: "",
    start_date: today,
    end_date: end.toISOString().slice(0, 10),
    auto_renew: false,
    billing_frequency: "monthly" as ServiceContractBillingFrequency,
    next_billing_date: today,
    status: "draft" as ServiceContractStatus,
    tax_basis: taxBasis,
    vat_nhil_getfund_rate: vatRate,
    wht_rate: whtRate,
    document_url: "",
    notes: "",
    line_items: [emptyLineItem(0)],
  };
}

export function normalizeServiceContractCustomer360Row(
  row: ServiceContractCustomer360Row,
): ServiceContractCustomer360Row {
  return {
    ...row,
    total_amount_due: toNumber(row.total_amount_due),
    status: normalizeServiceContractStatus(row.status),
  };
}
