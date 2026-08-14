import type { SupabaseClient } from "@supabase/supabase-js";
import type { SalesTaxBasis } from "@/app/dashboard/finance/tax-utils";
import { createClientInvoice } from "@/utils/client-invoices-api";
import type { ClientInvoiceWriteBody } from "@/utils/client-invoices-types";
import {
  CLIENT_QUOTATION_ENTITY_TYPE,
  CLIENT_QUOTATION_HEADER_SELECT,
  CLIENT_QUOTATION_LINE_ITEM_SELECT,
  computeQuotationTotals,
  DEFAULT_CLIENT_QUOTATION_PAYMENT_TERMS,
  formatGeneratedInvoiceNumber,
  isProductCatalogLine,
  normalizeDocumentType,
  normalizeQuotationDiscountType,
  normalizeQuotationStatus,
  normalizeQuotationType,
  resolveQuotationTaxBasis,
  quotationToInvoiceWriteBody,
  roundMoney,
  toNumber,
  type ClientQuotationHeaderRow,
  type ClientQuotationLineItemInput,
  type ClientQuotationType,
  type ClientQuotationWriteBody,
} from "@/utils/client-quotations-types";

type DbClient = SupabaseClient;

function nullableText(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}

function buildHeaderPayload(
  tenantId: string,
  body: ClientQuotationWriteBody,
  quotationSequence: number,
  quotationNumber: string,
) {
  const quotationType = normalizeQuotationType(body.quotation_type);
  const taxBasis = resolveQuotationTaxBasis(body.tax_basis, quotationType);
  const discountType =
    quotationType === "product"
      ? normalizeQuotationDiscountType(body.discount_type)
      : "flat";
  const totals = computeQuotationTotals(
    body.line_items,
    body.vat_nhil_getfund_rate ?? 20,
    body.wht_rate ?? 7.5,
    taxBasis,
    body.header_discount_amount ?? 0,
    quotationType,
    discountType,
    body.discount_percentage ?? 0,
  );

  return {
    tenant_id: tenantId,
    client_id: body.client_id.trim(),
    opportunity_id: nullableText(body.opportunity_id ?? null),
    quotation_number: quotationNumber,
    quotation_sequence: quotationSequence,
    document_type: normalizeDocumentType(body.document_type),
    quotation_type: quotationType,
    tax_basis: taxBasis,
    issue_date: body.issue_date,
    valid_until: nullableText(body.valid_until ?? null),
    bill_to_name: body.bill_to_name.trim(),
    bill_to_address: nullableText(body.bill_to_address ?? null),
    bill_to_phone: nullableText(body.bill_to_phone ?? null),
    ship_to_name: nullableText(body.ship_to_name ?? null),
    ship_to_address: nullableText(body.ship_to_address ?? null),
    ship_to_phone: nullableText(body.ship_to_phone ?? null),
    subtotal: totals.subtotal,
    vat_nhil_getfund_rate: roundMoney(toNumber(body.vat_nhil_getfund_rate ?? 20)),
    tax_due: totals.tax_due,
    wht_rate: roundMoney(toNumber(body.wht_rate ?? 7.5)),
    wht_amount: totals.wht_amount,
    header_discount_amount: totals.header_discount_amount,
    discount_type: discountType,
    discount_percentage:
      quotationType === "product" && discountType === "percentage"
        ? roundMoney(toNumber(body.discount_percentage ?? 0))
        : null,
    total_amount_due: totals.total_amount_due,
    status: normalizeQuotationStatus(body.status),
    notes: nullableText(body.notes ?? null),
    commercial_terms: nullableText(body.commercial_terms ?? null),
    internal_notes: nullableText(body.internal_notes ?? null),
    payment_terms: nullableText(
      body.payment_terms ?? DEFAULT_CLIENT_QUOTATION_PAYMENT_TERMS,
    ),
    authorized_by_name: nullableText(body.authorized_by_name ?? null),
    authorized_by_title: nullableText(body.authorized_by_title ?? null),
    updated_at: new Date().toISOString(),
  };
}

function buildLineItemRows(
  tenantId: string,
  quotationId: string,
  lineItems: ClientQuotationLineItemInput[],
  quotationType: ClientQuotationType,
  vatRate: number,
  whtRate: number,
  taxBasis: SalesTaxBasis,
  headerDiscountAmount: number,
  discountType: ReturnType<typeof normalizeQuotationDiscountType>,
  discountPercentage: number,
) {
  const totals = computeQuotationTotals(
    lineItems,
    vatRate,
    whtRate,
    taxBasis,
    headerDiscountAmount,
    quotationType,
    discountType,
    discountPercentage,
  );

  return totals.line_items.map((line, index) => {
    const isCatalogProduct = quotationType === "product" && isProductCatalogLine(line);

    return {
      quotation_id: quotationId,
      tenant_id: tenantId,
      site_id: nullableText(line.site_id ?? null),
      category_label: nullableText(line.category_label ?? null),
      description: line.description.trim(),
      labour_amount: isCatalogProduct
        ? 0
        : roundMoney(toNumber(line.labour_amount)),
      material_amount: isCatalogProduct
        ? roundMoney(toNumber(line.quantity) * toNumber(line.unit_price))
        : roundMoney(toNumber(line.material_amount)),
      discount_amount: roundMoney(toNumber(line.discount_amount)),
      taxed: line.taxed ?? true,
      total_cost: line.total_cost,
      product_id: isCatalogProduct ? line.product_id?.trim() ?? null : null,
      quantity: isCatalogProduct ? toNumber(line.quantity) : null,
      unit_price: isCatalogProduct ? roundMoney(toNumber(line.unit_price)) : null,
      sort_order: line.sort_order ?? index,
    };
  });
}

async function replaceLineItemsAndPaymentAccounts(
  supabase: DbClient,
  tenantId: string,
  quotationId: string,
  body: ClientQuotationWriteBody,
) {
  const quotationType = normalizeQuotationType(body.quotation_type);
  const taxBasis = resolveQuotationTaxBasis(body.tax_basis, quotationType);
  const vatRate = toNumber(body.vat_nhil_getfund_rate ?? 20);
  const whtRate = toNumber(body.wht_rate ?? 7.5);
  const headerDiscountAmount = toNumber(body.header_discount_amount ?? 0);
  const discountType =
    quotationType === "product"
      ? normalizeQuotationDiscountType(body.discount_type)
      : "flat";
  const discountPercentage = toNumber(body.discount_percentage ?? 0);

  const { error: deleteLinesError } = await supabase
    .from("client_quotation_line_items")
    .delete()
    .eq("quotation_id", quotationId)
    .eq("tenant_id", tenantId);

  if (deleteLinesError) {
    return { error: deleteLinesError.message };
  }

  const { error: deleteLinksError } = await supabase
    .from("client_quotation_payment_accounts")
    .delete()
    .eq("quotation_id", quotationId)
    .eq("tenant_id", tenantId);

  if (deleteLinksError) {
    return { error: deleteLinksError.message };
  }

  const lineRows = buildLineItemRows(
    tenantId,
    quotationId,
    body.line_items,
    quotationType,
    vatRate,
    whtRate,
    taxBasis,
    headerDiscountAmount,
    discountType,
    discountPercentage,
  );
  if (lineRows.length > 0) {
    const { error: insertLinesError } = await supabase
      .from("client_quotation_line_items")
      .insert(lineRows);

    if (insertLinesError) {
      return { error: insertLinesError.message };
    }
  }

  const uniquePaymentAccountIds = [...new Set(body.payment_account_ids.filter(Boolean))];
  if (uniquePaymentAccountIds.length > 0) {
    const { error: insertLinksError } = await supabase
      .from("client_quotation_payment_accounts")
      .insert(
        uniquePaymentAccountIds.map((paymentAccountId) => ({
          quotation_id: quotationId,
          payment_account_id: paymentAccountId,
          tenant_id: tenantId,
        })),
      );

    if (insertLinksError) {
      return { error: insertLinksError.message };
    }
  }

  return { error: null };
}

export async function getNextQuotationSequence(supabase: DbClient, tenantId: string) {
  const { data, error } = await supabase
    .from("client_quotations")
    .select("quotation_sequence")
    .eq("tenant_id", tenantId)
    .order("quotation_sequence", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return { sequence: 1, error: error.message };
  }

  return {
    sequence: (data?.quotation_sequence ?? 0) + 1,
    error: null,
  };
}

export async function peekNextQuotationNumber(supabase: DbClient, tenantId: string) {
  const [{ data: tenant, error: tenantError }, { data: counter, error: counterError }] =
    await Promise.all([
      supabase
        .from("tenants")
        .select("tenant_code")
        .eq("id", tenantId)
        .maybeSingle(),
      supabase
        .from("id_sequences")
        .select("next_value")
        .eq("tenant_id", tenantId)
        .eq("entity_type", CLIENT_QUOTATION_ENTITY_TYPE)
        .maybeSingle(),
    ]);

  if (tenantError) {
    return { quotationNumber: null, error: tenantError.message };
  }

  if (counterError) {
    return { quotationNumber: null, error: counterError.message };
  }

  const tenantCode = (tenant as { tenant_code?: string } | null)?.tenant_code;
  if (!tenantCode) {
    return { quotationNumber: null, error: "Tenant code is not configured." };
  }

  const lastIssued = toNumber(
    (counter as { next_value?: number } | null)?.next_value ?? 0,
  );

  return {
    quotationNumber: formatGeneratedInvoiceNumber(
      tenantCode,
      CLIENT_QUOTATION_ENTITY_TYPE,
      lastIssued + 1,
    ),
    error: null,
  };
}

async function allocateQuotationNumber(supabase: DbClient, tenantId: string) {
  const { data, error } = await supabase.rpc("generate_next_code", {
    p_tenant_id: tenantId,
    p_entity_type: CLIENT_QUOTATION_ENTITY_TYPE,
    p_padding: 4,
  });

  if (error) {
    return { quotationNumber: null, error: error.message };
  }

  const quotationNumber = typeof data === "string" ? data.trim() : "";
  if (!quotationNumber) {
    return {
      quotationNumber: null,
      error: "generate_next_code returned an empty quotation number.",
    };
  }

  return { quotationNumber, error: null };
}

export async function createClientQuotation(
  supabase: DbClient,
  tenantId: string,
  body: ClientQuotationWriteBody,
) {
  const { quotationNumber, error: allocateError } = await allocateQuotationNumber(
    supabase,
    tenantId,
  );

  if (allocateError || !quotationNumber) {
    return {
      quotation: null,
      error: allocateError ?? "Unable to allocate quotation number.",
    };
  }

  const { sequence, error: sequenceError } = await getNextQuotationSequence(
    supabase,
    tenantId,
  );

  if (sequenceError) {
    return { quotation: null, error: sequenceError };
  }

  const headerPayload = buildHeaderPayload(
    tenantId,
    body,
    sequence,
    quotationNumber,
  );

  const { data: quotation, error: insertError } = await supabase
    .from("client_quotations")
    .insert(headerPayload)
    .select(CLIENT_QUOTATION_HEADER_SELECT)
    .single();

  if (insertError || !quotation) {
    return {
      quotation: null,
      error: insertError?.message ?? "Unable to create quotation.",
    };
  }

  const childResult = await replaceLineItemsAndPaymentAccounts(
    supabase,
    tenantId,
    quotation.id,
    body,
  );

  if (childResult.error) {
    await supabase
      .from("client_quotations")
      .delete()
      .eq("id", quotation.id)
      .eq("tenant_id", tenantId);
    return { quotation: null, error: childResult.error };
  }

  return { quotation: quotation as ClientQuotationHeaderRow, error: null };
}

export async function updateClientQuotation(
  supabase: DbClient,
  tenantId: string,
  quotationId: string,
  body: ClientQuotationWriteBody,
  existingSequence: number,
  existingQuotationNumber: string,
) {
  const headerPayload = buildHeaderPayload(
    tenantId,
    body,
    existingSequence,
    existingQuotationNumber,
  );

  const { data: quotation, error: updateError } = await supabase
    .from("client_quotations")
    .update(headerPayload)
    .eq("id", quotationId)
    .eq("tenant_id", tenantId)
    .select(CLIENT_QUOTATION_HEADER_SELECT)
    .single();

  if (updateError || !quotation) {
    return { quotation: null, error: updateError?.message ?? "Quotation not found." };
  }

  const childResult = await replaceLineItemsAndPaymentAccounts(
    supabase,
    tenantId,
    quotationId,
    body,
  );

  if (childResult.error) {
    return { quotation: null, error: childResult.error };
  }

  return { quotation: quotation as ClientQuotationHeaderRow, error: null };
}

export async function loadClientQuotationDetail(
  supabase: DbClient,
  tenantId: string,
  quotationId: string,
) {
  const [quotationResult, lineItemsResult, paymentLinksResult] = await Promise.all([
    supabase
      .from("client_quotations")
      .select(CLIENT_QUOTATION_HEADER_SELECT)
      .eq("id", quotationId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("client_quotation_line_items")
      .select(CLIENT_QUOTATION_LINE_ITEM_SELECT)
      .eq("quotation_id", quotationId)
      .eq("tenant_id", tenantId)
      .order("sort_order", { ascending: true }),
    supabase
      .from("client_quotation_payment_accounts")
      .select("payment_account_id")
      .eq("quotation_id", quotationId)
      .eq("tenant_id", tenantId),
  ]);

  if (quotationResult.error) {
    return {
      quotation: null,
      line_items: [],
      payment_account_ids: [],
      error: quotationResult.error.message,
    };
  }

  if (!quotationResult.data) {
    return {
      quotation: null,
      line_items: [],
      payment_account_ids: [],
      error: "Quotation not found.",
    };
  }

  const fetchError =
    lineItemsResult.error?.message ?? paymentLinksResult.error?.message ?? null;

  return {
    quotation: quotationResult.data as ClientQuotationHeaderRow,
    line_items: lineItemsResult.data ?? [],
    payment_account_ids:
      paymentLinksResult.data?.map((row) => row.payment_account_id) ?? [],
    error: fetchError,
  };
}

export async function convertClientQuotationToInvoice(
  supabase: DbClient,
  tenantId: string,
  quotationId: string,
) {
  const detail = await loadClientQuotationDetail(supabase, tenantId, quotationId);

  if (detail.error || !detail.quotation) {
    return { invoice: null, error: detail.error ?? "Quotation not found." };
  }

  const quotation = detail.quotation;

  if (quotation.status !== "accepted") {
    return {
      invoice: null,
      error: "Only accepted quotations can be converted to an invoice.",
    };
  }

  if (quotation.converted_invoice_id) {
    return {
      invoice: null,
      error: "This quotation has already been converted to an invoice.",
    };
  }

  const quotationType = normalizeQuotationType(quotation.quotation_type);
  const lineItems: ClientQuotationLineItemInput[] = detail.line_items.map((line) => ({
    site_id: line.site_id,
    category_label: line.category_label,
    description: line.description,
    labour_amount: toNumber(line.labour_amount),
    material_amount: toNumber(line.material_amount),
    discount_amount: toNumber(line.discount_amount),
    taxed: line.taxed,
    sort_order: line.sort_order,
    product_id: line.product_id,
    quantity: line.quantity != null ? toNumber(line.quantity) : null,
    unit_price: line.unit_price != null ? toNumber(line.unit_price) : null,
  }));

  const invoiceBody: ClientInvoiceWriteBody = quotationToInvoiceWriteBody(
    quotation,
    lineItems,
    detail.payment_account_ids,
  );

  const { invoice, error: createError } = await createClientInvoice(
    supabase,
    tenantId,
    invoiceBody,
    {
      fixedHeaderTotals: {
        subtotal: toNumber(quotation.subtotal),
        tax_due: toNumber(quotation.tax_due),
        wht_amount: toNumber(quotation.wht_amount),
        total_amount_due: toNumber(quotation.total_amount_due),
      },
    },
  );

  if (createError || !invoice) {
    return { invoice: null, error: createError ?? "Unable to create invoice." };
  }

  const { error: linkError } = await supabase
    .from("client_quotations")
    .update({
      converted_invoice_id: invoice.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", quotationId)
    .eq("tenant_id", tenantId)
    .is("converted_invoice_id", null);

  if (linkError) {
    return {
      invoice,
      error: `Invoice ${invoice.invoice_number} was created, but linking back to the quotation failed: ${linkError.message}`,
    };
  }

  return { invoice, error: null };
}
