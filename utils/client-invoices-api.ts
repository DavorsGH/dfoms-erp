import type { SupabaseClient } from "@supabase/supabase-js";
import { deriveClientInvoiceStatusFromPayments } from "@/utils/client-invoice-payment-utils";
import {
  AUTHORIZED_SIGNER_USER_ACCOUNT_SELECT,
  CLIENT_INVOICE_HEADER_SELECT,
  CLIENT_INVOICE_LINE_ITEM_SELECT,
  formatGeneratedInvoiceNumber,
  mapAuthorizedSignerOptions,
  normalizeStatus,
  roundMoney,
  toNumber,
  type ClientInvoiceAuthorizedSignerOption,
  type ClientInvoiceHeaderRow,
  type ClientInvoiceStatus,
  type ClientInvoiceWriteBody,
} from "@/utils/client-invoices-types";
import {
  resolveCreateBusinessUnitId,
  StampRefusedViewAllError,
  type CreateBusinessUnitStampOptions,
} from "@/utils/business-unit-stamp";
import type { SalesTaxBasis } from "@/app/dashboard/finance/tax-utils";

type DbClient = SupabaseClient;

export type CreateClientInvoiceOptions = {
  fixedHeaderTotals?: {
    subtotal: number;
    tax_due: number;
    wht_amount: number;
    total_amount_due: number;
  };
  taxBasisOverride?: SalesTaxBasis;
  contractId?: string | null;
} & CreateBusinessUnitStampOptions;

const CLIENT_INVOICE_INCOME_SERVICE_CATEGORY = "Client Invoice";

function buildSaveClientInvoicePayload(body: ClientInvoiceWriteBody) {
  return {
    client_id: body.client_id.trim(),
    contract_id: body.contract_id ?? null,
    invoice_date: body.invoice_date,
    due_date: body.due_date ?? null,
    billing_period_start: body.billing_period_start ?? null,
    billing_period_end: body.billing_period_end ?? null,
    bill_to_name: body.bill_to_name.trim(),
    bill_to_address: body.bill_to_address ?? null,
    bill_to_phone: body.bill_to_phone ?? null,
    vat_nhil_getfund_rate: roundMoney(toNumber(body.vat_nhil_getfund_rate ?? 0)),
    wht_rate: roundMoney(toNumber(body.wht_rate ?? 0)),
    status: normalizeStatus(body.status),
    amount_received: roundMoney(toNumber(body.amount_received ?? 0)),
    notes: body.notes ?? null,
    authorized_by_name: body.authorized_by_name ?? null,
    authorized_by_title: body.authorized_by_title ?? null,
    line_items: body.line_items.map((line) => ({
      site_id: line.site_id ?? null,
      category_label: line.category_label ?? null,
      description: line.description.trim(),
      labour_amount: roundMoney(toNumber(line.labour_amount)),
      material_amount: roundMoney(toNumber(line.material_amount)),
      discount_amount: roundMoney(toNumber(line.discount_amount)),
      taxed: line.taxed ?? true,
      sort_order: line.sort_order,
    })),
    payment_account_ids: body.payment_account_ids.filter(Boolean),
  };
}

function parseSaveClientInvoiceResult(data: unknown): ClientInvoiceHeaderRow | null {
  if (!data || typeof data !== "object") {
    return null;
  }
  const invoice = (data as { invoice?: ClientInvoiceHeaderRow }).invoice;
  return invoice ?? null;
}

export async function loadAuthorizedSignerOptions(
  supabase: DbClient,
  tenantId: string,
): Promise<{ signers: ClientInvoiceAuthorizedSignerOption[]; error: string | null }> {
  const { data, error } = await supabase
    .from("user_accounts")
    .select(AUTHORIZED_SIGNER_USER_ACCOUNT_SELECT)
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .not("employee_id", "is", null)
    .order("email", { ascending: true });

  if (error) {
    return { signers: [], error: error.message };
  }

  return {
    signers: mapAuthorizedSignerOptions(data ?? []),
    error: null,
  };
}

export async function getNextInvoiceSequence(
  supabase: DbClient,
  tenantId: string,
) {
  const { data, error } = await supabase
    .from("client_invoices")
    .select("invoice_sequence")
    .eq("tenant_id", tenantId)
    .order("invoice_sequence", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return { sequence: 1, error: error.message };
  }

  return {
    sequence: (data?.invoice_sequence ?? 0) + 1,
    error: null,
  };
}

/** Non-allocating UI peek of the next generate_next_code('INV') value. */
export async function peekNextInvoiceNumber(
  supabase: DbClient,
  tenantId: string,
) {
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
        .eq("entity_type", "INV")
        .maybeSingle(),
    ]);

  if (tenantError) {
    return { invoiceNumber: null, error: tenantError.message };
  }

  if (counterError) {
    return { invoiceNumber: null, error: counterError.message };
  }

  const tenantCode = (tenant as { tenant_code?: string } | null)?.tenant_code;
  if (!tenantCode) {
    return { invoiceNumber: null, error: "Tenant code is not configured." };
  }

  const lastIssued = toNumber(
    (counter as { next_value?: number } | null)?.next_value ?? 0,
  );
  return {
    invoiceNumber: formatGeneratedInvoiceNumber(tenantCode, "INV", lastIssued + 1),
    error: null,
  };
}

/**
 * Income Register row id owned by one client invoice.
 * Prefer client_invoice_id; fall back to invoice_no + service_category for
 * legacy rows that predate the FK link.
 */
export async function findClientInvoiceIncomeRegisterId(
  supabase: DbClient,
  tenantId: string,
  invoiceNumber: string,
  clientInvoiceId?: string | null,
): Promise<{ incomeId: string | null; error: string | null }> {
  if (clientInvoiceId) {
    const byId = await supabase
      .from("income_register")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("client_invoice_id", clientInvoiceId)
      .maybeSingle();

    if (byId.error) {
      return { incomeId: null, error: byId.error.message };
    }

    if (byId.data) {
      return { incomeId: (byId.data as { id: string }).id, error: null };
    }
  }

  const { data, error } = await supabase
    .from("income_register")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("invoice_no", invoiceNumber)
    .eq("service_category", CLIENT_INVOICE_INCOME_SERVICE_CATEGORY)
    .maybeSingle();

  if (error) {
    return { incomeId: null, error: error.message };
  }

  return { incomeId: (data as { id: string } | null)?.id ?? null, error: null };
}

export async function sumClientInvoicePayments(
  supabase: DbClient,
  tenantId: string,
  invoiceId: string,
): Promise<{ total: number; error: string | null }> {
  const { data, error } = await supabase
    .from("client_invoice_payments")
    .select("amount")
    .eq("tenant_id", tenantId)
    .eq("invoice_id", invoiceId);

  if (error) {
    return { total: 0, error: error.message };
  }

  const total = roundMoney(
    (data ?? []).reduce((sum, row) => sum + toNumber(row.amount), 0),
  );

  return { total, error: null };
}

export async function createClientInvoice(
  supabase: DbClient,
  tenantId: string,
  body: ClientInvoiceWriteBody,
  options?: CreateClientInvoiceOptions,
) {
  let businessUnitId: string | null;
  try {
    businessUnitId = await resolveCreateBusinessUnitId(options);
  } catch (error) {
    if (error instanceof StampRefusedViewAllError) {
      return { invoice: null, error: error.message };
    }
    throw error;
  }

  const { data, error } = await supabase.rpc("save_client_invoice", {
    p_tenant_id: tenantId,
    p_invoice_id: null,
    p_business_unit_id: businessUnitId,
    p_payload: buildSaveClientInvoicePayload(body),
    p_fixed_header_totals: options?.fixedHeaderTotals ?? null,
    p_tax_basis_override: options?.taxBasisOverride ?? null,
    p_contract_id: options?.contractId ?? null,
  });

  if (error) {
    return { invoice: null, error: error.message };
  }

  const invoice = parseSaveClientInvoiceResult(data);
  if (!invoice) {
    return { invoice: null, error: "Unable to create invoice." };
  }

  return { invoice, error: null };
}

const INVOICE_STATUS_TRANSITIONS: Record<
  ClientInvoiceStatus,
  Array<"sent" | "paid" | "voided">
> = {
  draft: ["sent"],
  sent: ["paid", "voided"],
  partial: ["voided"],
  paid: ["voided"],
  voided: [],
};

export async function updateClientInvoiceStatus(
  supabase: DbClient,
  tenantId: string,
  invoiceId: string,
  nextStatus: "sent" | "paid",
) {
  const detail = await loadClientInvoiceDetail(supabase, tenantId, invoiceId);
  if (detail.error || !detail.invoice) {
    return { invoice: null, error: detail.error ?? "Invoice not found." };
  }

  const currentStatus = normalizeStatus(detail.invoice.status);
  const allowed = INVOICE_STATUS_TRANSITIONS[currentStatus] ?? [];
  if (!allowed.includes(nextStatus)) {
    return {
      invoice: null,
      error: `Cannot change invoice status from ${currentStatus} to ${nextStatus}.`,
    };
  }

  const { data, error } = await supabase.rpc("change_client_invoice_status", {
    p_tenant_id: tenantId,
    p_invoice_id: invoiceId,
    p_next_status: nextStatus,
  });

  if (error) {
    return { invoice: null, error: error.message };
  }

  const invoice = parseSaveClientInvoiceResult(data);
  if (!invoice) {
    return { invoice: null, error: "Unable to update invoice status." };
  }

  return { invoice, error: null };
}

export async function voidClientInvoice(
  supabase: DbClient,
  tenantId: string,
  invoiceId: string,
) {
  const detail = await loadClientInvoiceDetail(supabase, tenantId, invoiceId);
  if (detail.error || !detail.invoice) {
    return { invoice: null, error: detail.error ?? "Invoice not found." };
  }

  const currentStatus = normalizeStatus(detail.invoice.status);
  const allowed = INVOICE_STATUS_TRANSITIONS[currentStatus] ?? [];
  if (!allowed.includes("voided")) {
    return {
      invoice: null,
      error:
        currentStatus === "draft"
          ? "Draft invoices should be deleted, not voided."
          : currentStatus === "voided"
            ? "This invoice is already voided."
            : `Cannot void an invoice with status ${currentStatus}.`,
    };
  }

  const { data, error } = await supabase.rpc("void_client_invoice", {
    p_tenant_id: tenantId,
    p_invoice_id: invoiceId,
  });

  if (error) {
    return { invoice: null, error: error.message };
  }

  const invoice = parseSaveClientInvoiceResult(data);
  if (!invoice) {
    return { invoice: null, error: "Unable to void invoice." };
  }

  return { invoice, error: null };
}

export async function updateClientInvoice(
  supabase: DbClient,
  tenantId: string,
  invoiceId: string,
  body: ClientInvoiceWriteBody,
  _existingSequence: number,
  _existingInvoiceNumber: string,
) {
  const { data: existingScope, error: scopeError } = await supabase
    .from("client_invoices")
    .select("business_unit_id")
    .eq("id", invoiceId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (scopeError) {
    return { invoice: null, error: scopeError.message };
  }

  const invoiceBusinessUnitId =
    (existingScope?.business_unit_id as string | null | undefined)?.trim() ||
    null;

  let writeBody = body;
  const { total: paymentsTotal, error: paymentsSumError } =
    await sumClientInvoicePayments(supabase, tenantId, invoiceId);

  if (paymentsSumError) {
    return { invoice: null, error: paymentsSumError };
  }

  if (paymentsTotal > 0) {
    const { data: existingInvoice, error: existingError } = await supabase
      .from("client_invoices")
      .select("total_amount_due, wht_amount")
      .eq("id", invoiceId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (existingError || !existingInvoice) {
      return { invoice: null, error: existingError?.message ?? "Invoice not found." };
    }

    const totalDue = toNumber(existingInvoice.total_amount_due);
    const whtAmount = toNumber(existingInvoice.wht_amount);
    writeBody = {
      ...body,
      amount_received: paymentsTotal,
      status: deriveClientInvoiceStatusFromPayments(
        paymentsTotal,
        totalDue,
        whtAmount,
        body.status ?? "sent",
      ),
    };
  }

  const { data, error } = await supabase.rpc("save_client_invoice", {
    p_tenant_id: tenantId,
    p_invoice_id: invoiceId,
    p_business_unit_id: invoiceBusinessUnitId,
    p_payload: buildSaveClientInvoicePayload(writeBody),
    p_fixed_header_totals: null,
    p_tax_basis_override: null,
    p_contract_id: writeBody.contract_id ?? null,
  });

  if (error) {
    return { invoice: null, error: error.message };
  }

  const invoice = parseSaveClientInvoiceResult(data);
  if (!invoice) {
    return { invoice: null, error: "Invoice not found." };
  }

  return { invoice, error: null };
}

export async function loadClientInvoiceDetail(
  supabase: DbClient,
  tenantId: string,
  invoiceId: string,
) {
  const [invoiceResult, lineItemsResult, paymentLinksResult] = await Promise.all([
    supabase
      .from("client_invoices")
      .select(CLIENT_INVOICE_HEADER_SELECT)
      .eq("id", invoiceId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("client_invoice_line_items")
      .select(CLIENT_INVOICE_LINE_ITEM_SELECT)
      .eq("invoice_id", invoiceId)
      .eq("tenant_id", tenantId)
      .order("sort_order", { ascending: true }),
    supabase
      .from("client_invoice_payment_accounts")
      .select("payment_account_id")
      .eq("invoice_id", invoiceId)
      .eq("tenant_id", tenantId),
  ]);

  if (invoiceResult.error) {
    return {
      invoice: null,
      line_items: [],
      payment_account_ids: [],
      error: invoiceResult.error.message,
    };
  }

  if (!invoiceResult.data) {
    return {
      invoice: null,
      line_items: [],
      payment_account_ids: [],
      error: "Invoice not found.",
    };
  }

  const fetchError =
    lineItemsResult.error?.message ?? paymentLinksResult.error?.message ?? null;

  return {
    invoice: invoiceResult.data as ClientInvoiceHeaderRow,
    line_items: lineItemsResult.data ?? [],
    payment_account_ids:
      paymentLinksResult.data?.map((row) => row.payment_account_id) ?? [],
    error: fetchError,
  };
}
