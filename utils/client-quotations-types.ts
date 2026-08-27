import {
  AUTHORIZED_BY_OTHER,
  computeLineTotalCost,
  isLineTaxedForSalesTax,
  formatGeneratedInvoiceNumber,
  formatInvoiceDate,
  formatInvoiceMoney,
  groupLineItemsByCategory,
  resolveAuthorizedByFields,
  resolveAuthorizedByFormState,
  roundMoney,
  toNumber,
  type ClientInvoiceAuthorizedSignerOption,
  type ClientInvoiceFormAuthorizedByState,
} from "@/utils/client-invoices-types";
import {
  DEFAULT_SALES_TAX_BASIS,
  type SalesTaxBasis,
} from "@/app/dashboard/finance/tax-utils";
import { computeLineItemTotals } from "@/utils/line-items-totals";

export {
  AUTHORIZED_BY_OTHER,
  computeLineTotalCost,
  formatGeneratedInvoiceNumber,
  formatInvoiceDate,
  formatInvoiceMoney,
  groupLineItemsByCategory,
  resolveAuthorizedByFields,
  resolveAuthorizedByFormState,
  roundMoney,
  toNumber,
  type ClientInvoiceAuthorizedSignerOption,
  type ClientInvoiceFormAuthorizedByState,
};

export const CLIENT_QUOTATION_ENTITY_TYPE = "CQUO" as const;

export const CLIENT_QUOTATION_DOCUMENT_TYPES = [
  "quotation",
  "proforma_invoice",
] as const;
export type ClientQuotationDocumentType =
  (typeof CLIENT_QUOTATION_DOCUMENT_TYPES)[number];

export const CLIENT_QUOTATION_TYPES = ["service", "product"] as const;
export type ClientQuotationType = (typeof CLIENT_QUOTATION_TYPES)[number];

export const CLIENT_QUOTATION_STATUSES = [
  "draft",
  "sent",
  "accepted",
  "declined",
  "expired",
] as const;
export type ClientQuotationStatus = (typeof CLIENT_QUOTATION_STATUSES)[number];

export const CLIENT_QUOTATION_DISCOUNT_TYPES = ["flat", "percentage"] as const;
export type ClientQuotationDiscountType =
  (typeof CLIENT_QUOTATION_DISCOUNT_TYPES)[number];

export const CLIENT_QUOTATION_PAYMENT_TERMS_OPTIONS = [
  "Due on Receipt",
  "Net 15",
  "Net 30",
  "Net 60",
] as const;
export type ClientQuotationPaymentTerms =
  (typeof CLIENT_QUOTATION_PAYMENT_TERMS_OPTIONS)[number];

export const DEFAULT_CLIENT_QUOTATION_PAYMENT_TERMS: ClientQuotationPaymentTerms =
  "Net 30";

export const CLIENT_QUOTATION_LIST_SELECT =
  "id, tenant_id, client_id, quotation_number, quotation_sequence, document_type, quotation_type, issue_date, valid_until, bill_to_name, subtotal, tax_due, wht_amount, total_amount_due, status, contract_id, converted_invoice_id, created_at, client:customers!client_quotations_tenant_id_client_id_fkey(client_id, client_name), converted_invoice:client_invoices!client_quotations_converted_invoice_id_fkey(id, invoice_number), source_contract:service_contracts!client_quotations_contract_id_fkey(id, contract_number)" as const;

export const CLIENT_QUOTATION_HEADER_SELECT =
  "id, tenant_id, client_id, opportunity_id, quotation_number, quotation_sequence, document_type, quotation_type, tax_basis, issue_date, valid_until, bill_to_name, bill_to_address, bill_to_phone, ship_to_name, ship_to_address, ship_to_phone, subtotal, vat_nhil_getfund_rate, tax_due, wht_rate, wht_amount, header_discount_amount, discount_type, discount_percentage, total_amount_due, status, contract_id, notes, commercial_terms, internal_notes, payment_terms, authorized_by_name, authorized_by_title, converted_invoice_id, accepted_at, created_at, updated_at, opportunity:sales_opportunities(id, opportunity_name), converted_invoice:client_invoices!client_quotations_converted_invoice_id_fkey(id, invoice_number), source_contract:service_contracts!client_quotations_contract_id_fkey(id, contract_number)" as const;

export const CLIENT_QUOTATION_LINE_ITEM_SELECT =
  "id, quotation_id, tenant_id, site_id, category_label, description, labour_amount, material_amount, discount_amount, taxed, total_cost, product_id, quantity, unit_price, sort_order" as const;

export const CLIENT_QUOTATION_PORTAL_LIST_SELECT =
  "id, tenant_id, client_id, quotation_number, quotation_type, document_type, issue_date, valid_until, total_amount_due, status, contract_id, accepted_at, created_at, source_contract:service_contracts!client_quotations_contract_id_fkey(id, contract_number)" as const;

export type ClientQuotationCustomer = {
  client_id: string;
  client_name: string;
};

export type ClientQuotationConvertedInvoice = {
  id: string;
  invoice_number: string;
};

export type ClientQuotationSourceContract = {
  id: string;
  contract_number: string;
};

export type ClientQuotationListRow = {
  id: string;
  tenant_id: string;
  client_id: string;
  quotation_number: string;
  quotation_sequence: number;
  document_type: ClientQuotationDocumentType;
  quotation_type: ClientQuotationType;
  issue_date: string;
  valid_until: string | null;
  bill_to_name: string;
  subtotal: number;
  tax_due: number;
  wht_amount: number;
  total_amount_due: number;
  status: ClientQuotationStatus;
  contract_id: string | null;
  converted_invoice_id: string | null;
  created_at: string;
  client?: ClientQuotationCustomer | ClientQuotationCustomer[] | null;
  converted_invoice?: ClientQuotationConvertedInvoice | ClientQuotationConvertedInvoice[] | null;
  source_contract?: ClientQuotationSourceContract | ClientQuotationSourceContract[] | null;
};

export type ClientQuotationPortalListRow = {
  id: string;
  tenant_id: string;
  client_id: string;
  quotation_number: string;
  quotation_type: ClientQuotationType;
  document_type: ClientQuotationDocumentType;
  issue_date: string;
  valid_until: string | null;
  total_amount_due: number;
  status: ClientQuotationStatus;
  contract_id: string | null;
  accepted_at: string | null;
  created_at: string;
  source_contract?: ClientQuotationSourceContract | ClientQuotationSourceContract[] | null;
};

export type ClientQuotationLineItemRow = {
  id: string;
  quotation_id: string;
  tenant_id: string;
  site_id: string | null;
  category_label: string | null;
  description: string;
  labour_amount: number;
  material_amount: number;
  discount_amount: number;
  taxed: boolean;
  total_cost: number;
  product_id: string | null;
  quantity: number | null;
  unit_price: number | null;
  sort_order: number;
};

export type ClientQuotationHeaderRow = {
  id: string;
  tenant_id: string;
  client_id: string;
  opportunity_id: string | null;
  quotation_number: string;
  quotation_sequence: number;
  document_type: ClientQuotationDocumentType;
  quotation_type: ClientQuotationType;
  tax_basis: SalesTaxBasis | null;
  issue_date: string;
  valid_until: string | null;
  bill_to_name: string;
  bill_to_address: string | null;
  bill_to_phone: string | null;
  ship_to_name: string | null;
  ship_to_address: string | null;
  ship_to_phone: string | null;
  subtotal: number;
  vat_nhil_getfund_rate: number;
  tax_due: number;
  wht_rate: number;
  wht_amount: number;
  header_discount_amount: number;
  discount_type: ClientQuotationDiscountType;
  discount_percentage: number | null;
  total_amount_due: number;
  status: ClientQuotationStatus;
  notes: string | null;
  commercial_terms: string | null;
  internal_notes: string | null;
  payment_terms: string | null;
  authorized_by_name: string | null;
  authorized_by_title: string | null;
  contract_id: string | null;
  converted_invoice_id: string | null;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
  opportunity?:
    | ClientQuotationOpportunityRelation
    | ClientQuotationOpportunityRelation[]
    | null;
  converted_invoice?: ClientQuotationConvertedInvoice | ClientQuotationConvertedInvoice[] | null;
  source_contract?: ClientQuotationSourceContract | ClientQuotationSourceContract[] | null;
};

export type ClientQuotationLineItemInput = {
  site_id?: string | null;
  category_label?: string | null;
  description: string;
  labour_amount: number;
  material_amount: number;
  discount_amount: number;
  taxed: boolean;
  sort_order: number;
  product_id?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
};

export type ClientQuotationWriteBody = {
  client_id: string;
  opportunity_id?: string | null;
  document_type?: ClientQuotationDocumentType;
  quotation_type?: ClientQuotationType;
  tax_basis?: SalesTaxBasis;
  issue_date: string;
  valid_until?: string | null;
  bill_to_name: string;
  bill_to_address?: string | null;
  bill_to_phone?: string | null;
  ship_to_name?: string | null;
  ship_to_address?: string | null;
  ship_to_phone?: string | null;
  vat_nhil_getfund_rate?: number;
  wht_rate?: number;
  header_discount_amount?: number;
  discount_type?: ClientQuotationDiscountType;
  discount_percentage?: number | null;
  status?: ClientQuotationStatus;
  notes?: string | null;
  commercial_terms?: string | null;
  internal_notes?: string | null;
  payment_terms?: string | null;
  authorized_by_name?: string | null;
  authorized_by_title?: string | null;
  line_items: ClientQuotationLineItemInput[];
  payment_account_ids: string[];
};

export type ClientQuotationFormLineItem = ClientQuotationLineItemInput & {
  key: string;
};

export type ClientQuotationSiteOption = {
  site_code: string;
  site_name: string;
  client_id: string;
};

export type ClientQuotationPipelineOpportunityOption = {
  id: string;
  opportunity_name: string;
  client_id: string;
};

export type ClientQuotationOpportunityRelation = {
  id: string;
  opportunity_name: string;
};

export function resolveQuotationOpportunityName(
  quotation: Pick<ClientQuotationHeaderRow, "opportunity_id"> & {
    opportunity?:
      | ClientQuotationOpportunityRelation
      | ClientQuotationOpportunityRelation[]
      | null;
  },
): string | null {
  if (!quotation.opportunity_id) {
    return null;
  }

  const relation = Array.isArray(quotation.opportunity)
    ? quotation.opportunity[0]
    : quotation.opportunity;
  const name = relation?.opportunity_name?.trim();
  return name || null;
}

export function normalizeQuotationType(value: unknown): ClientQuotationType {
  return value === "product" ? "product" : "service";
}

export function isProductPickerLine(
  line: Pick<ClientQuotationLineItemInput, "product_id">,
): boolean {
  return line.product_id !== null && line.product_id !== undefined;
}

export function isProductCatalogLine(
  line: Pick<ClientQuotationLineItemInput, "product_id">,
): boolean {
  return Boolean(line.product_id?.trim());
}

export function computeQuotationLineTotalCost(
  line: ClientQuotationLineItemInput,
  quotationType: ClientQuotationType = "service",
): number {
  if (quotationType === "product" && isProductCatalogLine(line)) {
    return roundMoney(
      toNumber(line.quantity) * toNumber(line.unit_price) -
        toNumber(line.discount_amount),
    );
  }

  return computeLineTotalCost(line);
}

export function normalizeQuotationDiscountType(
  value: unknown,
): ClientQuotationDiscountType {
  return value === "percentage" ? "percentage" : "flat";
}

export function resolveQuotationHeaderDiscountAmount(
  lineSubtotal: number,
  discountType: ClientQuotationDiscountType,
  headerDiscountAmount: unknown,
  discountPercentage: unknown,
): number {
  if (discountType === "percentage") {
    const percentage = Math.max(0, toNumber(discountPercentage));
    return roundMoney((lineSubtotal * percentage) / 100);
  }

  return roundMoney(Math.max(0, toNumber(headerDiscountAmount)));
}

export function quotationHeaderDiscountLabel(
  quotation: Pick<
    ClientQuotationHeaderRow,
    "discount_type" | "header_discount_amount" | "discount_percentage"
  >,
): string | null {
  const amount = toNumber(quotation.header_discount_amount);
  if (amount <= 0) {
    return null;
  }

  if (normalizeQuotationDiscountType(quotation.discount_type) === "percentage") {
    const percentage = toNumber(quotation.discount_percentage);
    return `Discount: ${percentage}%`;
  }

  return `Discount: ${formatInvoiceMoney(amount)}`;
}

export function computeQuotationTotals(
  lineItems: ClientQuotationLineItemInput[],
  vatRate: unknown,
  whtRate: unknown,
  taxBasis: SalesTaxBasis = DEFAULT_SALES_TAX_BASIS,
  headerDiscountAmount: unknown = 0,
  quotationType: ClientQuotationType = "service",
  discountType: ClientQuotationDiscountType = "flat",
  discountPercentage: unknown = 0,
) {
  const baseTotals = computeLineItemTotals(
    lineItems,
    vatRate,
    whtRate,
    taxBasis,
    (line) => computeQuotationLineTotalCost(line, quotationType),
  );

  const lineSubtotal = baseTotals.subtotal;
  const headerDiscount = resolveQuotationHeaderDiscountAmount(
    lineSubtotal,
    discountType,
    headerDiscountAmount,
    discountPercentage,
  );
  const subtotal = roundMoney(Math.max(0, lineSubtotal - headerDiscount));
  const totalAmountDue = roundMoney(subtotal + baseTotals.tax_due);

  return {
    line_items: baseTotals.line_items,
    line_subtotal: lineSubtotal,
    header_discount_amount: headerDiscount,
    subtotal,
    tax_due: baseTotals.tax_due,
    wht_amount: baseTotals.wht_amount,
    total_amount_due: totalAmountDue,
    labour_total: baseTotals.labour_total,
    tax_base: baseTotals.tax_base,
  };
}

export function quotationLineToInvoiceInput(
  line: ClientQuotationLineItemInput,
  quotationType: ClientQuotationType = "service",
): ClientQuotationLineItemInput {
  if (quotationType === "product" && isProductCatalogLine(line)) {
    return {
      site_id: line.site_id ?? null,
      category_label: line.category_label ?? null,
      description: line.description.trim(),
      labour_amount: 0,
      material_amount: roundMoney(toNumber(line.quantity) * toNumber(line.unit_price)),
      discount_amount: roundMoney(toNumber(line.discount_amount)),
      taxed: line.taxed ?? true,
      sort_order: line.sort_order,
    };
  }

  return {
    site_id: line.site_id ?? null,
    category_label: line.category_label ?? null,
    description: line.description.trim(),
    labour_amount: roundMoney(toNumber(line.labour_amount)),
    material_amount: roundMoney(toNumber(line.material_amount)),
    discount_amount: roundMoney(toNumber(line.discount_amount)),
    taxed: line.taxed ?? true,
    sort_order: line.sort_order,
  };
}

export function mapQuotationLineForDisplay(
  line: ClientQuotationLineItemRow,
  quotationType: ClientQuotationType,
): ClientQuotationLineItemRow {
  if (quotationType === "product" && line.product_id) {
    const materialAmount = roundMoney(
      toNumber(line.quantity) * toNumber(line.unit_price),
    );

    return {
      ...line,
      labour_amount: 0,
      material_amount: materialAmount,
      total_cost: computeQuotationLineTotalCost(
        {
          ...line,
          material_amount: materialAmount,
          labour_amount: 0,
        },
        quotationType,
      ),
    };
  }

  return line;
}

export function defaultTaxBasisForQuotationType(
  quotationType: ClientQuotationType,
): SalesTaxBasis {
  return quotationType === "product" ? "total_cost" : "service_only";
}

export function resolveQuotationTaxBasis(
  taxBasis: unknown,
  quotationType: ClientQuotationType,
): SalesTaxBasis {
  if (taxBasis === "total_cost" || taxBasis === "service_only") {
    return taxBasis;
  }

  return defaultTaxBasisForQuotationType(quotationType);
}

export const QUOTATION_TAX_BASIS_OPTIONS: Array<{
  value: SalesTaxBasis;
  label: string;
}> = [
  { value: "service_only", label: "Service Cost Only" },
  { value: "total_cost", label: "Total Cost" },
];

export function formatQuotationTaxBasisLabel(taxBasis: SalesTaxBasis) {
  return (
    QUOTATION_TAX_BASIS_OPTIONS.find((option) => option.value === taxBasis)?.label ??
    "Service Cost Only"
  );
}

export function formatQuotationType(quotationType: string) {
  return quotationType === "product" ? "Product Quotation" : "Service Quotation";
}

export function formatQuotationDocumentType(documentType: string) {
  return documentType === "proforma_invoice" ? "Pro-forma Invoice" : "Quotation";
}

export function quotationPrintTitle(documentType: string) {
  return documentType === "proforma_invoice" ? "PRO-FORMA INVOICE" : "QUOTATION";
}

export function quotationNumberMetaLabel(documentType: string) {
  return documentType === "proforma_invoice" ? "Pro-forma Invoice #: " : "Quotation #: ";
}

function firstEmbeddedRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) {
    return null;
  }

  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export function resolveConvertedInvoiceLink(
  quotation: Pick<ClientQuotationListRow, "converted_invoice_id" | "converted_invoice">,
) {
  const embedded = firstEmbeddedRelation(quotation.converted_invoice);
  if (embedded?.id && embedded.invoice_number) {
    return embedded;
  }

  if (!quotation.converted_invoice_id) {
    return null;
  }

  return {
    id: quotation.converted_invoice_id,
    invoice_number: quotation.converted_invoice_id,
  };
}

export function resolveRaisedContractLink(
  quotation: Pick<ClientQuotationListRow, "contract_id" | "source_contract">,
) {
  const embedded = firstEmbeddedRelation(quotation.source_contract);
  if (embedded?.id && embedded.contract_number) {
    return embedded;
  }

  if (!quotation.contract_id) {
    return null;
  }

  return {
    id: quotation.contract_id,
    contract_number: quotation.contract_id,
  };
}

export function quotationHasBeenSent(status: ClientQuotationStatus | string | undefined) {
  return Boolean(status && status !== "draft");
}

export function formatQuotationStatus(status: string) {
  switch (status) {
    case "sent":
      return "Sent";
    case "accepted":
      return "Accepted";
    case "declined":
      return "Declined";
    case "expired":
      return "Expired";
    default:
      return "Draft";
  }
}

export function quotationShowsAcceptedDate(status: ClientQuotationStatus | string) {
  return status === "accepted";
}

export function resolveQuotationAcceptedOnDate(
  quotation: Pick<ClientQuotationHeaderRow, "accepted_at">,
) {
  const raw = quotation.accepted_at?.trim();
  if (!raw) {
    return null;
  }

  return raw.slice(0, 10);
}

export type QuotationExpiryDisplay = {
  columnLabel: string;
  metaLabel: string;
  metaValue: string | null;
  footerValidityText: string;
};

export function resolvePortalQuotationExpiryDisplay(
  quotation: Pick<
    ClientQuotationHeaderRow,
    "status" | "valid_until" | "accepted_at"
  >,
): QuotationExpiryDisplay {
  if (quotationShowsAcceptedDate(quotation.status)) {
    const acceptedOn = resolveQuotationAcceptedOnDate(quotation);
    const formattedAcceptedOn = acceptedOn ? formatInvoiceDate(acceptedOn) : "—";
    return {
      columnLabel: "Accepted on",
      metaLabel: "Accepted on: ",
      metaValue: formattedAcceptedOn,
      footerValidityText: acceptedOn
        ? `This quotation was accepted on ${formattedAcceptedOn}.`
        : "This quotation has been accepted.",
    };
  }

  const formattedValidUntil = formatInvoiceDate(quotation.valid_until);
  return {
    columnLabel: "Valid Until",
    metaLabel: "Valid Until: ",
    metaValue: formattedValidUntil,
    footerValidityText: quotationValidityFooter(quotation.valid_until),
  };
}

function quotationValidityFooter(validUntil: string | null | undefined) {
  if (!validUntil?.trim()) {
    return "This document is subject to the validity period shown above.";
  }

  return `This document is valid until ${formatInvoiceDate(validUntil)} unless otherwise agreed in writing.`;
}

export function defaultValidUntil(fromDate = new Date()) {
  const valid = new Date(fromDate);
  valid.setDate(valid.getDate() + 30);
  return valid.toISOString().slice(0, 10);
}

function normalizeQuotationAddressField(value: string | null | undefined) {
  return (value ?? "").trim();
}

export function quotationHasDistinctShipTo(
  quotation: Pick<
    ClientQuotationHeaderRow,
    | "bill_to_name"
    | "bill_to_address"
    | "bill_to_phone"
    | "ship_to_name"
    | "ship_to_address"
    | "ship_to_phone"
  >,
) {
  const shipName = normalizeQuotationAddressField(quotation.ship_to_name);
  const shipAddress = normalizeQuotationAddressField(quotation.ship_to_address);
  const shipPhone = normalizeQuotationAddressField(quotation.ship_to_phone);

  if (!shipName && !shipAddress && !shipPhone) {
    return false;
  }

  return (
    shipName !== normalizeQuotationAddressField(quotation.bill_to_name) ||
    shipAddress !== normalizeQuotationAddressField(quotation.bill_to_address) ||
    shipPhone !== normalizeQuotationAddressField(quotation.bill_to_phone)
  );
}

export function normalizeClientQuotationPaymentTerms(
  value: unknown,
): ClientQuotationPaymentTerms {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return (CLIENT_QUOTATION_PAYMENT_TERMS_OPTIONS as readonly string[]).includes(
    trimmed,
  )
    ? (trimmed as ClientQuotationPaymentTerms)
    : DEFAULT_CLIENT_QUOTATION_PAYMENT_TERMS;
}

export function quotationPaymentTermsLabel(
  paymentTerms: string | null | undefined,
) {
  const trimmed = normalizeQuotationAddressField(paymentTerms);
  return trimmed || DEFAULT_CLIENT_QUOTATION_PAYMENT_TERMS;
}

export function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export function emptyQuotationLineItem(sortOrder: number): ClientQuotationFormLineItem {
  return {
    key: crypto.randomUUID(),
    site_id: null,
    category_label: "",
    description: "",
    labour_amount: 0,
    material_amount: 0,
    discount_amount: 0,
    taxed: true,
    sort_order: sortOrder,
    product_id: null,
    quantity: null,
    unit_price: null,
  };
}

export function emptyProductQuotationLineItem(
  sortOrder: number,
): ClientQuotationFormLineItem {
  return {
    key: crypto.randomUUID(),
    site_id: null,
    category_label: "",
    description: "",
    labour_amount: 0,
    material_amount: 0,
    discount_amount: 0,
    taxed: true,
    sort_order: sortOrder,
    product_id: "",
    quantity: 1,
    unit_price: 0,
  };
}

export function normalizeClientQuotationListRow(
  row: ClientQuotationListRow,
): ClientQuotationListRow {
  return {
    ...row,
    quotation_type: normalizeQuotationType(row.quotation_type),
    subtotal: toNumber(row.subtotal),
    tax_due: toNumber(row.tax_due),
    wht_amount: toNumber(row.wht_amount),
    total_amount_due: toNumber(row.total_amount_due),
    client: Array.isArray(row.client) ? row.client[0] ?? null : row.client ?? null,
    converted_invoice: Array.isArray(row.converted_invoice)
      ? (row.converted_invoice[0] ?? null)
      : (row.converted_invoice ?? null),
    source_contract: Array.isArray(row.source_contract)
      ? (row.source_contract[0] ?? null)
      : (row.source_contract ?? null),
  };
}

export function normalizeClientQuotationPortalListRow(
  row: ClientQuotationPortalListRow,
): ClientQuotationPortalListRow {
  return {
    ...row,
    quotation_type: normalizeQuotationType(row.quotation_type),
    total_amount_due: toNumber(row.total_amount_due),
    source_contract: Array.isArray(row.source_contract)
      ? (row.source_contract[0] ?? null)
      : (row.source_contract ?? null),
  };
}

export function normalizeDocumentType(value: unknown): ClientQuotationDocumentType {
  return value === "proforma_invoice" ? "proforma_invoice" : "quotation";
}

export function normalizeQuotationStatus(value: unknown): ClientQuotationStatus {
  if (
    value === "sent" ||
    value === "accepted" ||
    value === "declined" ||
    value === "expired"
  ) {
    return value;
  }

  return "draft";
}

export function validateClientQuotationBody(body: ClientQuotationWriteBody): string | null {
  if (!body.client_id?.trim()) {
    return "Customer is required.";
  }

  if (!body.issue_date?.trim()) {
    return "Issue date is required.";
  }

  if (!body.bill_to_name?.trim()) {
    return "Bill to name is required.";
  }

  if (!Array.isArray(body.line_items) || body.line_items.length === 0) {
    return "Add at least one line item.";
  }

  for (const [index, line] of body.line_items.entries()) {
    if (!line.description?.trim()) {
      return `Line ${index + 1} description is required.`;
    }

    const quotationType = normalizeQuotationType(body.quotation_type);
    if (quotationType === "product" && isProductCatalogLine(line)) {
      if (!line.product_id?.trim()) {
        return `Line ${index + 1} product is required.`;
      }
      if (toNumber(line.quantity) <= 0) {
        return `Line ${index + 1} quantity must be greater than zero.`;
      }
      if (toNumber(line.unit_price) < 0) {
        return `Line ${index + 1} unit price cannot be negative.`;
      }
    }
  }

  if (!Array.isArray(body.payment_account_ids)) {
    return "Payment account selection is invalid.";
  }

  if (!body.authorized_by_name?.trim()) {
    return "Authorized By is required.";
  }

  return null;
}

export function emptyQuotationForm() {
  return {
    authorized_by_selection: "",
    authorized_by_other_name: "",
    authorized_by_other_title: "",
    client_id: "",
    opportunity_id: "",
    document_type: "quotation" as ClientQuotationDocumentType,
    quotation_type: "service" as ClientQuotationType,
    tax_basis: "service_only" as SalesTaxBasis,
    issue_date: todayIsoDate(),
    valid_until: defaultValidUntil(),
    bill_to_name: "",
    bill_to_address: "",
    bill_to_phone: "",
    ship_to_same_as_billing: true,
    ship_to_name: "",
    ship_to_address: "",
    ship_to_phone: "",
    vat_nhil_getfund_rate: 0,
    wht_rate: 0,
    header_discount_amount: 0,
    discount_type: "flat" as ClientQuotationDiscountType,
    discount_percentage: null,
    status: "draft" as ClientQuotationStatus,
    notes: "",
    commercial_terms: "",
    internal_notes: "",
    payment_terms: DEFAULT_CLIENT_QUOTATION_PAYMENT_TERMS,
    payment_account_ids: [] as string[],
    line_items: [emptyQuotationLineItem(0)],
  };
}

export function clientQuotationToFormState(
  quotation: ClientQuotationHeaderRow,
  lineItems: ClientQuotationLineItemRow[],
  paymentAccountIds: string[],
  signers: ClientInvoiceAuthorizedSignerOption[] = [],
) {
  return {
    ...resolveAuthorizedByFormState(quotation, signers),
    client_id: quotation.client_id,
    opportunity_id: quotation.opportunity_id ?? "",
    document_type: normalizeDocumentType(quotation.document_type),
    quotation_type: normalizeQuotationType(quotation.quotation_type),
    tax_basis: resolveQuotationTaxBasis(
      quotation.tax_basis,
      normalizeQuotationType(quotation.quotation_type),
    ),
    issue_date: quotation.issue_date,
    valid_until:
      quotation.valid_until ?? defaultValidUntil(new Date(quotation.issue_date)),
    bill_to_name: quotation.bill_to_name,
    bill_to_address: quotation.bill_to_address ?? "",
    bill_to_phone: quotation.bill_to_phone ?? "",
    ship_to_same_as_billing: !quotationHasDistinctShipTo(quotation),
    ship_to_name: quotation.ship_to_name ?? "",
    ship_to_address: quotation.ship_to_address ?? "",
    ship_to_phone: quotation.ship_to_phone ?? "",
    vat_nhil_getfund_rate: toNumber(quotation.vat_nhil_getfund_rate),
    wht_rate: toNumber(quotation.wht_rate),
    header_discount_amount: toNumber(quotation.header_discount_amount),
    discount_type: normalizeQuotationDiscountType(quotation.discount_type),
    discount_percentage:
      quotation.discount_percentage != null
        ? toNumber(quotation.discount_percentage)
        : null,
    status: normalizeQuotationStatus(quotation.status),
    notes: quotation.notes ?? "",
    commercial_terms: quotation.commercial_terms ?? "",
    internal_notes: quotation.internal_notes ?? "",
    payment_terms: normalizeClientQuotationPaymentTerms(quotation.payment_terms),
    payment_account_ids: paymentAccountIds,
    line_items: [...lineItems]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((line, index) => ({
        key: line.id,
        site_id: line.site_id,
        category_label: line.category_label ?? "",
        description: line.description,
        labour_amount: toNumber(line.labour_amount),
        material_amount: toNumber(line.material_amount),
        discount_amount: toNumber(line.discount_amount),
        taxed: line.taxed,
        sort_order: index,
        product_id: line.product_id,
        quantity: line.quantity != null ? toNumber(line.quantity) : null,
        unit_price: line.unit_price != null ? toNumber(line.unit_price) : null,
      })),
  };
}

export function quotationToInvoiceWriteBody(
  quotation: ClientQuotationHeaderRow,
  lineItems: ClientQuotationLineItemInput[],
  paymentAccountIds: string[],
) {
  const quotationType = normalizeQuotationType(quotation.quotation_type);
  const invoiceLines = lineItems.map((line) =>
    quotationLineToInvoiceInput(line, quotationType),
  );

  const headerDiscount = roundMoney(toNumber(quotation.header_discount_amount));
  if (headerDiscount > 0) {
    invoiceLines.push({
      description: "Quotation discount",
      labour_amount: 0,
      material_amount: 0,
      discount_amount: headerDiscount,
      taxed: false,
      sort_order: invoiceLines.length,
    });
  }

  return {
    client_id: quotation.client_id,
    contract_id: quotation.contract_id ?? null,
    invoice_date: quotation.issue_date,
    due_date: quotation.valid_until,
    billing_period_start: null,
    billing_period_end: null,
    bill_to_name: quotation.bill_to_name,
    bill_to_address: quotation.bill_to_address,
    bill_to_phone: quotation.bill_to_phone,
    vat_nhil_getfund_rate: quotation.vat_nhil_getfund_rate,
    wht_rate: quotation.wht_rate,
    status: "draft" as const,
    amount_received: 0,
    notes: quotation.notes,
    authorized_by_name: quotation.authorized_by_name,
    authorized_by_title: quotation.authorized_by_title,
    line_items: invoiceLines,
    payment_account_ids: paymentAccountIds,
  };
}
