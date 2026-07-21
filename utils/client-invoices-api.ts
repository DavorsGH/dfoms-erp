import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CLIENT_INVOICE_HEADER_SELECT,
  CLIENT_INVOICE_LINE_ITEM_SELECT,
  computeInvoiceTotals,
  normalizeStatus,
  roundMoney,
  suggestInvoiceNumber,
  toNumber,
  type ClientInvoiceHeaderRow,
  type ClientInvoiceLineItemInput,
  type ClientInvoiceWriteBody,
} from "@/utils/client-invoices-types";

type DbClient = SupabaseClient;

function nullableText(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}

function invoiceYearFromDate(invoiceDate: string) {
  const parsed = new Date(`${invoiceDate}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? new Date().getFullYear() : parsed.getFullYear();
}

function buildHeaderPayload(
  tenantId: string,
  body: ClientInvoiceWriteBody,
  invoiceSequence: number,
  invoiceNumber: string,
) {
  const totals = computeInvoiceTotals(
    body.line_items,
    body.vat_nhil_getfund_rate ?? 20,
    body.wht_rate ?? 7.5,
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
    vat_nhil_getfund_rate: roundMoney(toNumber(body.vat_nhil_getfund_rate ?? 20)),
    tax_due: totals.tax_due,
    wht_rate: roundMoney(toNumber(body.wht_rate ?? 7.5)),
    wht_amount: totals.wht_amount,
    total_amount_due: totals.total_amount_due,
    status: normalizeStatus(body.status),
    amount_received: roundMoney(toNumber(body.amount_received ?? 0)),
    notes: nullableText(body.notes ?? null),
    updated_at: new Date().toISOString(),
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

async function syncIncomeRegisterFromClientInvoice(
  supabase: DbClient,
  tenantId: string,
  invoice: ClientInvoiceHeaderRow,
) {
  // Draft invoices should have no Income Register entry at all.
  if (invoice.status === "draft") {
    const { error } = await supabase
      .from("income_register")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("client_invoice_id", invoice.id);
    return { error: error?.message ?? null };
  }

  const amount = toNumber(invoice.total_amount_due);
  const amountReceived =
    invoice.status === "paid"
      ? amount
      : invoice.status === "partial"
        ? toNumber(invoice.amount_received)
        : 0;
  const outstandingBalance = amount - amountReceived;

  let paymentStatus: string;
  if (invoice.status === "paid") {
    paymentStatus = "Paid";
  } else if (invoice.status === "partial") {
    paymentStatus = "Partial";
  } else {
    // status === "sent"
    const today = new Date().toISOString().slice(0, 10);
    const dueDate = invoice.due_date ?? invoice.invoice_date;
    paymentStatus = dueDate && dueDate < today ? "Overdue" : "Pending";
  }

  const payload = {
    tenant_id: tenantId,
    client_invoice_id: invoice.id,
    date: invoice.invoice_date,
    invoice_no: invoice.invoice_number,
    client_id: invoice.client_id,
    customer_name: invoice.bill_to_name,
    entry_type: "service" as const,
    service_category: "Client Invoice",
    description: invoice.notes ?? null,
    amount,
    amount_received: amountReceived,
    outstanding_balance: outstandingBalance,
    payment_status: paymentStatus,
    due_date: invoice.due_date ?? invoice.invoice_date,
  };

  const { error } = await supabase
    .from("income_register")
    .upsert(payload, { onConflict: "client_invoice_id" });

  return { error: error?.message ?? null };
}

export async function createClientInvoice(
  supabase: DbClient,
  tenantId: string,
  body: ClientInvoiceWriteBody,
) {
  const { sequence, error: sequenceError } = await getNextInvoiceSequence(
    supabase,
    tenantId,
  );

  if (sequenceError) {
    return { invoice: null, error: sequenceError };
  }

  const invoiceNumber = suggestInvoiceNumber(
    sequence,
    invoiceYearFromDate(body.invoice_date),
  );
  const headerPayload = buildHeaderPayload(
    tenantId,
    body,
    sequence,
    invoiceNumber,
  );
  const { data: invoice, error: insertError } = await supabase
    .from("client_invoices")
    .insert(headerPayload)
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

export async function updateClientInvoice(
  supabase: DbClient,
  tenantId: string,
  invoiceId: string,
  body: ClientInvoiceWriteBody,
  existingSequence: number,
  existingInvoiceNumber: string,
) {
  const headerPayload = buildHeaderPayload(
    tenantId,
    body,
    existingSequence,
    existingInvoiceNumber,
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
