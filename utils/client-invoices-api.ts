import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateIncomeOutstanding } from "@/app/dashboard/finance/income-register-utils";
import {
  loadTenantSalesTaxBasis,
  type SalesTaxBasis,
} from "@/app/dashboard/finance/tax-utils";
import {
  deleteTaxLedgerEntriesForSource,
  syncIncomeRegisterTaxLedger,
} from "@/app/dashboard/finance/tax-ledger-sync";
import { deriveClientInvoiceStatusFromPayments } from "@/utils/client-invoice-payment-utils";
import {
  AUTHORIZED_SIGNER_USER_ACCOUNT_SELECT,
  CLIENT_INVOICE_HEADER_SELECT,
  CLIENT_INVOICE_LINE_ITEM_SELECT,
  computeInvoiceTotals,
  formatGeneratedInvoiceNumber,
  mapAuthorizedSignerOptions,
  normalizeStatus,
  roundMoney,
  toNumber,
  type ClientInvoiceAuthorizedSignerOption,
  type ClientInvoiceHeaderRow,
  type ClientInvoiceLineItemInput,
  type ClientInvoiceStatus,
  type ClientInvoiceWriteBody,
} from "@/utils/client-invoices-types";
import {
  resolveCreateBusinessUnitId,
  type CreateBusinessUnitStampOptions,
} from "@/utils/business-unit-stamp";

type DbClient = SupabaseClient;

const CLIENT_INVOICE_INCOME_SERVICE_CATEGORY = "Client Invoice";

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

function nullableText(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}

function buildHeaderPayload(
  tenantId: string,
  body: ClientInvoiceWriteBody,
  invoiceSequence: number,
  invoiceNumber: string,
  taxBasis: SalesTaxBasis,
  fixedHeaderTotals?: CreateClientInvoiceOptions["fixedHeaderTotals"],
  contractId?: string | null,
) {
  const totals = fixedHeaderTotals
    ? {
        subtotal: roundMoney(toNumber(fixedHeaderTotals.subtotal)),
        tax_due: roundMoney(toNumber(fixedHeaderTotals.tax_due)),
        wht_amount: roundMoney(toNumber(fixedHeaderTotals.wht_amount)),
        total_amount_due: roundMoney(toNumber(fixedHeaderTotals.total_amount_due)),
      }
    : computeInvoiceTotals(
        body.line_items,
        body.vat_nhil_getfund_rate ?? 0,
        body.wht_rate ?? 0,
        taxBasis,
      );

  return {
    tenant_id: tenantId,
    client_id: body.client_id.trim(),
    invoice_number: invoiceNumber,
    invoice_sequence: invoiceSequence,
    invoice_date: body.invoice_date,
    due_date: nullableText(body.due_date ?? null),
    billing_period_start: nullableText(body.billing_period_start ?? null),
    billing_period_end: nullableText(body.billing_period_end ?? null),
    bill_to_name: body.bill_to_name.trim(),
    bill_to_address: nullableText(body.bill_to_address ?? null),
    bill_to_phone: nullableText(body.bill_to_phone ?? null),
    subtotal: totals.subtotal,
    vat_nhil_getfund_rate: roundMoney(toNumber(body.vat_nhil_getfund_rate ?? 0)),
    tax_due: totals.tax_due,
    wht_rate: roundMoney(toNumber(body.wht_rate ?? 0)),
    wht_amount: totals.wht_amount,
    total_amount_due: totals.total_amount_due,
    status: normalizeStatus(body.status),
    amount_received: roundMoney(toNumber(body.amount_received ?? 0)),
    notes: nullableText(body.notes ?? null),
    authorized_by_name: nullableText(body.authorized_by_name ?? null),
    authorized_by_title: nullableText(body.authorized_by_title ?? null),
    contract_id: nullableText(contractId ?? body.contract_id ?? null),
    updated_at: new Date().toISOString(),
  };
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

function buildLineItemRows(
  tenantId: string,
  invoiceId: string,
  lineItems: ClientInvoiceLineItemInput[],
) {
  const totals = computeInvoiceTotals(lineItems, 20, 7.5);

  return totals.line_items.map((line, index) => ({
    invoice_id: invoiceId,
    tenant_id: tenantId,
    site_id: nullableText(line.site_id ?? null),
    category_label: nullableText(line.category_label ?? null),
    description: line.description.trim(),
    labour_amount: roundMoney(toNumber(line.labour_amount)),
    material_amount: roundMoney(toNumber(line.material_amount)),
    discount_amount: roundMoney(toNumber(line.discount_amount)),
    taxed: line.taxed ?? true,
    total_cost: line.total_cost,
    sort_order: line.sort_order ?? index,
  }));
}

async function replaceLineItemsAndPaymentAccounts(
  supabase: DbClient,
  tenantId: string,
  invoiceId: string,
  body: ClientInvoiceWriteBody,
) {
  const { error: deleteLinesError } = await supabase
    .from("client_invoice_line_items")
    .delete()
    .eq("invoice_id", invoiceId)
    .eq("tenant_id", tenantId);

  if (deleteLinesError) {
    return { error: deleteLinesError.message };
  }

  const { error: deleteLinksError } = await supabase
    .from("client_invoice_payment_accounts")
    .delete()
    .eq("invoice_id", invoiceId)
    .eq("tenant_id", tenantId);

  if (deleteLinksError) {
    return { error: deleteLinksError.message };
  }

  const lineRows = buildLineItemRows(tenantId, invoiceId, body.line_items);
  if (lineRows.length > 0) {
    const { error: insertLinesError } = await supabase
      .from("client_invoice_line_items")
      .insert(lineRows);

    if (insertLinesError) {
      return { error: insertLinesError.message };
    }
  }

  const uniquePaymentAccountIds = [...new Set(body.payment_account_ids.filter(Boolean))];
  if (uniquePaymentAccountIds.length > 0) {
    const { error: insertLinksError } = await supabase
      .from("client_invoice_payment_accounts")
      .insert(
        uniquePaymentAccountIds.map((paymentAccountId) => ({
          invoice_id: invoiceId,
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

async function allocateInvoiceNumber(supabase: DbClient, tenantId: string) {
  const { data, error } = await supabase.rpc("generate_next_code", {
    p_tenant_id: tenantId,
    p_entity_type: "INV",
    p_padding: 4,
  });

  if (error) {
    return { invoiceNumber: null, error: error.message };
  }

  const invoiceNumber = typeof data === "string" ? data.trim() : "";
  if (!invoiceNumber) {
    return {
      invoiceNumber: null,
      error: "generate_next_code returned an empty invoice number.",
    };
  }

  return { invoiceNumber, error: null };
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

export async function syncIncomeRegisterFromClientInvoice(
  supabase: DbClient,
  tenantId: string,
  invoice: ClientInvoiceHeaderRow,
) {
  // Draft invoices should have no Income Register entry (nor tax ledger legs).
  if (invoice.status === "draft") {
    const { incomeId, error: lookupError } =
      await findClientInvoiceIncomeRegisterId(
        supabase,
        tenantId,
        invoice.invoice_number,
        invoice.id,
      );

    if (lookupError) {
      return { error: lookupError };
    }

    if (!incomeId) {
      return { error: null };
    }

    const { error } = await supabase
      .from("income_register")
      .delete()
      .eq("id", incomeId)
      .eq("tenant_id", tenantId);

    if (error) {
      return { error: error.message };
    }

    const { error: ledgerError } = await deleteTaxLedgerEntriesForSource(
      supabase,
      "income_register",
      incomeId,
    );
    if (ledgerError) {
      return { error: ledgerError };
    }

    return { error: null };
  }

  const amount = toNumber(invoice.total_amount_due);
  const isVoided = invoice.status === "voided";
  const amountReceived = isVoided
    ? toNumber(invoice.amount_received)
    : invoice.status === "paid" || invoice.status === "partial"
      ? toNumber(invoice.amount_received)
      : 0;
  const outputVatAmount = roundMoney(toNumber(invoice.tax_due));
  const whtAmount = roundMoney(toNumber(invoice.wht_amount));
  const outstandingBalance = isVoided
    ? 0
    : calculateIncomeOutstanding(amount, amountReceived, whtAmount);

  let paymentStatus: string;
  if (isVoided) {
    paymentStatus = "Voided";
  } else if (invoice.status === "paid") {
    paymentStatus = "Paid";
  } else if (invoice.status === "partial") {
    paymentStatus = "Partial";
  } else {
    const today = new Date().toISOString().slice(0, 10);
    const dueDate = invoice.due_date ?? invoice.invoice_date;
    paymentStatus = dueDate && dueDate < today ? "Overdue" : "Pending";
  }

  const payload = {
    tenant_id: tenantId,
    date: invoice.invoice_date,
    invoice_no: invoice.invoice_number,
    client_invoice_id: invoice.id,
    client_id: invoice.client_id,
    customer_name: invoice.bill_to_name,
    entry_type: "service" as const,
    service_category: CLIENT_INVOICE_INCOME_SERVICE_CATEGORY,
    description: invoice.notes ?? null,
    amount,
    amount_received: amountReceived,
    outstanding_balance: outstandingBalance,
    tax_inclusive: true,
    net_of_tax_amount: roundMoney(amount - outputVatAmount),
    output_tax_component: outputVatAmount > 0 ? ("vat_bundle" as const) : null,
    output_vat_amount: outputVatAmount,
    wht_rate: roundMoney(toNumber(invoice.wht_rate)) || null,
    wht_amount: whtAmount,
    payment_status: paymentStatus,
    due_date: invoice.due_date ?? invoice.invoice_date,
    // Inherit invoice BU (create stamp / convert / contract). Do not use live switcher.
    business_unit_id: invoice.business_unit_id ?? null,
  };

  const { incomeId: existingIncomeId, error: lookupError } =
    await findClientInvoiceIncomeRegisterId(
      supabase,
      tenantId,
      invoice.invoice_number,
      invoice.id,
    );

  if (lookupError) {
    return { error: lookupError };
  }

  const writeResult = existingIncomeId
    ? await supabase
        .from("income_register")
        .update(payload)
        .eq("id", existingIncomeId)
        .eq("tenant_id", tenantId)
        .select("id")
        .single()
    : await supabase.from("income_register").insert(payload).select("id").single();

  const incomeRow = writeResult.data;
  const error = writeResult.error;

  if (error || !incomeRow) {
    return { error: error?.message ?? "Unable to sync the Income Register row." };
  }

  const incomeId = (incomeRow as { id: string }).id;

  if (isVoided) {
    const { error: ledgerError } = await deleteTaxLedgerEntriesForSource(
      supabase,
      "income_register",
      incomeId,
    );
    return { error: ledgerError };
  }

  const { error: ledgerError } = await syncIncomeRegisterTaxLedger(supabase, {
    sourceId: incomeId,
    entryDate: invoice.invoice_date,
    amount,
    whtRatePct: whtAmount > 0 ? roundMoney(toNumber(invoice.wht_rate)) || null : null,
    whtAmount,
    outputTaxComponent: outputVatAmount > 0 ? "vat_bundle" : null,
    outputTaxRatePct:
      outputVatAmount > 0 ? roundMoney(toNumber(invoice.vat_nhil_getfund_rate)) : null,
    outputVatAmount,
    counterpartyName: invoice.bill_to_name,
    notes: `Invoice ${invoice.invoice_number}`,
    tenantId,
  });

  return { error: ledgerError };
}

export async function createClientInvoice(
  supabase: DbClient,
  tenantId: string,
  body: ClientInvoiceWriteBody,
  options?: CreateClientInvoiceOptions,
) {
  // Display/stored invoice_number comes from the shared atomic allocator.
  // invoice_sequence stays a separate tenant-unique integer (ordering / legacy UNIQUE).
  const { invoiceNumber, error: allocateError } = await allocateInvoiceNumber(
    supabase,
    tenantId,
  );

  if (allocateError || !invoiceNumber) {
    return {
      invoice: null,
      error: allocateError ?? "Unable to allocate invoice number.",
    };
  }

  const { sequence, error: sequenceError } = await getNextInvoiceSequence(
    supabase,
    tenantId,
  );

  if (sequenceError) {
    return { invoice: null, error: sequenceError };
  }

  const businessUnitId = await resolveCreateBusinessUnitId(options);
  const { salesTaxBasis, error: taxBasisError } = await loadTenantSalesTaxBasis(
    supabase,
    tenantId,
    businessUnitId,
  );
  if (taxBasisError) {
    return { invoice: null, error: taxBasisError };
  }

  const taxBasis = options?.taxBasisOverride ?? salesTaxBasis;
  const headerPayload = buildHeaderPayload(
    tenantId,
    body,
    sequence,
    invoiceNumber,
    taxBasis,
    options?.fixedHeaderTotals,
    options?.contractId,
  );
  headerPayload.status = "draft";
  headerPayload.amount_received = 0;

  const insertPayload = {
    ...headerPayload,
    business_unit_id: businessUnitId,
  };

  const { data: invoice, error: insertError } = await supabase
    .from("client_invoices")
    .insert(insertPayload)
    .select(CLIENT_INVOICE_HEADER_SELECT)
    .single();

  if (insertError || !invoice) {
    return { invoice: null, error: insertError?.message ?? "Unable to create invoice." };
  }

  const childResult = await replaceLineItemsAndPaymentAccounts(
    supabase,
    tenantId,
    invoice.id,
    body,
  );

  if (childResult.error) {
    await supabase
      .from("client_invoices")
      .delete()
      .eq("id", invoice.id)
      .eq("tenant_id", tenantId);
    return { invoice: null, error: childResult.error };
  }

  const syncResult = await syncIncomeRegisterFromClientInvoice(
    supabase,
    tenantId,
    invoice as ClientInvoiceHeaderRow,
  );
  if (syncResult.error) {
    return { invoice: invoice as ClientInvoiceHeaderRow, error: null, syncWarning: syncResult.error };
  }

  return { invoice: invoice as ClientInvoiceHeaderRow, error: null };
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

  const totalDue = roundMoney(toNumber(detail.invoice.total_amount_due));
  const updatePayload =
    nextStatus === "paid"
      ? {
          status: "paid" as const,
          amount_received: totalDue,
          updated_at: new Date().toISOString(),
        }
      : {
          status: "sent" as const,
          updated_at: new Date().toISOString(),
        };

  const { data: invoice, error } = await supabase
    .from("client_invoices")
    .update(updatePayload)
    .eq("id", invoiceId)
    .eq("tenant_id", tenantId)
    .eq("status", currentStatus)
    .select(CLIENT_INVOICE_HEADER_SELECT)
    .single();

  if (error || !invoice) {
    return {
      invoice: null,
      error: error?.message ?? "Unable to update invoice status.",
    };
  }

  const syncResult = await syncIncomeRegisterFromClientInvoice(
    supabase,
    tenantId,
    invoice as ClientInvoiceHeaderRow,
  );

  if (syncResult.error) {
    return {
      invoice: invoice as ClientInvoiceHeaderRow,
      error: syncResult.error,
    };
  }

  return { invoice: invoice as ClientInvoiceHeaderRow, error: null };
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

  const { data: invoice, error } = await supabase
    .from("client_invoices")
    .update({
      status: "voided",
      updated_at: new Date().toISOString(),
    })
    .eq("id", invoiceId)
    .eq("tenant_id", tenantId)
    .eq("status", currentStatus)
    .select(CLIENT_INVOICE_HEADER_SELECT)
    .single();

  if (error || !invoice) {
    return {
      invoice: null,
      error: error?.message ?? "Unable to void invoice.",
    };
  }

  const syncResult = await syncIncomeRegisterFromClientInvoice(
    supabase,
    tenantId,
    invoice as ClientInvoiceHeaderRow,
  );

  if (syncResult.error) {
    return {
      invoice: invoice as ClientInvoiceHeaderRow,
      error: syncResult.error,
    };
  }

  return { invoice: invoice as ClientInvoiceHeaderRow, error: null };
}

export async function updateClientInvoice(
  supabase: DbClient,
  tenantId: string,
  invoiceId: string,
  body: ClientInvoiceWriteBody,
  existingSequence: number,
  existingInvoiceNumber: string,
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

  const { salesTaxBasis, error: taxBasisError } = await loadTenantSalesTaxBasis(
    supabase,
    tenantId,
    invoiceBusinessUnitId,
  );
  if (taxBasisError) {
    return { invoice: null, error: taxBasisError };
  }

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

  const headerPayload = buildHeaderPayload(
    tenantId,
    writeBody,
    existingSequence,
    existingInvoiceNumber,
    salesTaxBasis,
  );
  const { data: invoice, error: updateError } = await supabase
    .from("client_invoices")
    .update(headerPayload)
    .eq("id", invoiceId)
    .eq("tenant_id", tenantId)
    .select(CLIENT_INVOICE_HEADER_SELECT)
    .single();

  if (updateError || !invoice) {
    return { invoice: null, error: updateError?.message ?? "Invoice not found." };
  }

  const childResult = await replaceLineItemsAndPaymentAccounts(
    supabase,
    tenantId,
    invoiceId,
    body,
  );

  if (childResult.error) {
    return { invoice: null, error: childResult.error };
  }

  const syncResult = await syncIncomeRegisterFromClientInvoice(
    supabase,
    tenantId,
    invoice as ClientInvoiceHeaderRow,
  );
  if (syncResult.error) {
    return { invoice: invoice as ClientInvoiceHeaderRow, error: null, syncWarning: syncResult.error };
  }

  return { invoice: invoice as ClientInvoiceHeaderRow, error: null };
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
