import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SERVICE_CONTRACT_ENTITY_TYPE,
  SERVICE_CONTRACT_HEADER_SELECT,
  SERVICE_CONTRACT_LINE_ITEM_SELECT,
  advanceBillingDate,
  computeServiceContractTotals,
  contractToInvoiceWriteBody,
  normalizeBillingFrequency,
  normalizeServiceContractStatus,
  resolveServiceContractTaxBasis,
  roundMoney,
  toNumber,
  type ServiceContractHeaderRow,
  type ServiceContractLineItemInput,
  type ServiceContractWriteBody,
} from "@/utils/service-contracts-types";
import {
  createClientInvoice,
  type CreateClientInvoiceOptions,
} from "@/utils/client-invoices-api";
import { formatGeneratedInvoiceNumber } from "@/utils/client-invoices-types";

type DbClient = SupabaseClient;

function nullableText(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}

function buildHeaderPayload(
  tenantId: string,
  body: ServiceContractWriteBody,
  contractSequence: number,
  contractNumber: string,
) {
  const taxBasis = resolveServiceContractTaxBasis(body.tax_basis);
  const totals = computeServiceContractTotals(
    body.line_items,
    body.vat_nhil_getfund_rate ?? 0,
    body.wht_rate ?? 0,
    taxBasis,
  );

  const status = normalizeServiceContractStatus(body.status);
  const nextBillingDate =
    nullableText(body.next_billing_date ?? null) ??
    (status === "active" ? body.start_date : null);

  return {
    tenant_id: tenantId,
    client_id: body.client_id.trim(),
    contract_number: contractNumber,
    contract_sequence: contractSequence,
    start_date: body.start_date,
    end_date: body.end_date,
    auto_renew: body.auto_renew ?? false,
    billing_frequency: normalizeBillingFrequency(body.billing_frequency),
    next_billing_date: nextBillingDate,
    status,
    tax_basis: taxBasis,
    vat_nhil_getfund_rate: roundMoney(toNumber(body.vat_nhil_getfund_rate ?? 0)),
    wht_rate: roundMoney(toNumber(body.wht_rate ?? 0)),
    subtotal: totals.subtotal,
    tax_due: totals.tax_due,
    wht_amount: totals.wht_amount,
    total_amount_due: totals.total_amount_due,
    document_url: nullableText(body.document_url ?? null),
    notes: nullableText(body.notes ?? null),
    updated_at: new Date().toISOString(),
  };
}

function buildLineItemRows(
  tenantId: string,
  contractId: string,
  lineItems: ServiceContractLineItemInput[],
  vatRate: number,
  whtRate: number,
  taxBasis: ReturnType<typeof resolveServiceContractTaxBasis>,
) {
  const totals = computeServiceContractTotals(
    lineItems,
    vatRate,
    whtRate,
    taxBasis,
  );

  return totals.line_items.map((line, index) => ({
    contract_id: contractId,
    tenant_id: tenantId,
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

async function replaceLineItems(
  supabase: DbClient,
  tenantId: string,
  contractId: string,
  body: ServiceContractWriteBody,
) {
  const taxBasis = resolveServiceContractTaxBasis(body.tax_basis);
  const vatRate = toNumber(body.vat_nhil_getfund_rate ?? 0);
  const whtRate = toNumber(body.wht_rate ?? 0);

  const { error: deleteLinesError } = await supabase
    .from("service_contract_line_items")
    .delete()
    .eq("contract_id", contractId)
    .eq("tenant_id", tenantId);

  if (deleteLinesError) {
    return { error: deleteLinesError.message };
  }

  const lineRows = buildLineItemRows(
    tenantId,
    contractId,
    body.line_items,
    vatRate,
    whtRate,
    taxBasis,
  );

  if (lineRows.length > 0) {
    const { error: insertLinesError } = await supabase
      .from("service_contract_line_items")
      .insert(lineRows);

    if (insertLinesError) {
      return { error: insertLinesError.message };
    }
  }

  return { error: null };
}

export async function getNextServiceContractSequence(
  supabase: DbClient,
  tenantId: string,
) {
  const { data, error } = await supabase
    .from("service_contracts")
    .select("contract_sequence")
    .eq("tenant_id", tenantId)
    .order("contract_sequence", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return { sequence: 1, error: error.message };
  }

  return {
    sequence: (data?.contract_sequence ?? 0) + 1,
    error: null,
  };
}

export async function peekNextServiceContractNumber(
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
        .eq("entity_type", SERVICE_CONTRACT_ENTITY_TYPE)
        .maybeSingle(),
    ]);

  if (tenantError) {
    return { contractNumber: null, error: tenantError.message };
  }

  if (counterError) {
    return { contractNumber: null, error: counterError.message };
  }

  const tenantCode = (tenant as { tenant_code?: string } | null)?.tenant_code;
  if (!tenantCode) {
    return { contractNumber: null, error: "Tenant code is not configured." };
  }

  const lastIssued = toNumber(
    (counter as { next_value?: number } | null)?.next_value ?? 0,
  );

  return {
    contractNumber: formatGeneratedInvoiceNumber(
      tenantCode,
      SERVICE_CONTRACT_ENTITY_TYPE,
      lastIssued + 1,
    ),
    error: null,
  };
}

async function allocateServiceContractNumber(supabase: DbClient, tenantId: string) {
  const { data, error } = await supabase.rpc("generate_next_code", {
    p_tenant_id: tenantId,
    p_entity_type: SERVICE_CONTRACT_ENTITY_TYPE,
    p_padding: 4,
  });

  if (error) {
    return { contractNumber: null, error: error.message };
  }

  const contractNumber = typeof data === "string" ? data.trim() : "";
  if (!contractNumber) {
    return {
      contractNumber: null,
      error: "generate_next_code returned an empty contract number.",
    };
  }

  return { contractNumber, error: null };
}

export async function createServiceContract(
  supabase: DbClient,
  tenantId: string,
  body: ServiceContractWriteBody,
) {
  const { contractNumber, error: allocateError } = await allocateServiceContractNumber(
    supabase,
    tenantId,
  );

  if (allocateError || !contractNumber) {
    return {
      contract: null,
      error: allocateError ?? "Unable to allocate contract number.",
    };
  }

  const { sequence, error: sequenceError } = await getNextServiceContractSequence(
    supabase,
    tenantId,
  );

  if (sequenceError) {
    return { contract: null, error: sequenceError };
  }

  const headerPayload = buildHeaderPayload(
    tenantId,
    body,
    sequence,
    contractNumber,
  );

  const { data: contract, error: insertError } = await supabase
    .from("service_contracts")
    .insert(headerPayload)
    .select(SERVICE_CONTRACT_HEADER_SELECT)
    .single();

  if (insertError || !contract) {
    return {
      contract: null,
      error: insertError?.message ?? "Unable to create service contract.",
    };
  }

  const childResult = await replaceLineItems(
    supabase,
    tenantId,
    contract.id,
    body,
  );

  if (childResult.error) {
    await supabase
      .from("service_contracts")
      .delete()
      .eq("id", contract.id)
      .eq("tenant_id", tenantId);
    return { contract: null, error: childResult.error };
  }

  return { contract: contract as ServiceContractHeaderRow, error: null };
}

export type ActiveServiceContractSummary = {
  id: string;
  contract_number: string;
};

export async function findActiveServiceContractForClient(
  supabase: DbClient,
  tenantId: string,
  clientId: string,
): Promise<ActiveServiceContractSummary | null> {
  const { data, error } = await supabase
    .from("service_contracts")
    .select("id, contract_number")
    .eq("tenant_id", tenantId)
    .eq("client_id", clientId.trim())
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data?.id || !data.contract_number) {
    return null;
  }

  return {
    id: data.id,
    contract_number: data.contract_number,
  };
}

export async function loadActiveServiceContractsByClientId(
  supabase: DbClient,
  tenantId: string,
): Promise<Record<string, ActiveServiceContractSummary>> {
  const { data, error } = await supabase
    .from("service_contracts")
    .select("id, client_id, contract_number")
    .eq("tenant_id", tenantId)
    .eq("status", "active");

  if (error || !data) {
    return {};
  }

  const map: Record<string, ActiveServiceContractSummary> = {};
  for (const row of data) {
    if (!row.client_id || !row.contract_number || map[row.client_id]) {
      continue;
    }
    map[row.client_id] = {
      id: row.id,
      contract_number: row.contract_number,
    };
  }

  return map;
}

export async function updateServiceContract(
  supabase: DbClient,
  tenantId: string,
  contractId: string,
  body: ServiceContractWriteBody,
  existingSequence: number,
  existingContractNumber: string,
) {
  const headerPayload = buildHeaderPayload(
    tenantId,
    body,
    existingSequence,
    existingContractNumber,
  );

  const { data: contract, error: updateError } = await supabase
    .from("service_contracts")
    .update(headerPayload)
    .eq("id", contractId)
    .eq("tenant_id", tenantId)
    .select(SERVICE_CONTRACT_HEADER_SELECT)
    .single();

  if (updateError || !contract) {
    return {
      contract: null,
      error: updateError?.message ?? "Service contract not found.",
    };
  }

  const childResult = await replaceLineItems(supabase, tenantId, contractId, body);
  if (childResult.error) {
    return { contract: null, error: childResult.error };
  }

  return { contract: contract as ServiceContractHeaderRow, error: null };
}

export async function loadServiceContractDetail(
  supabase: DbClient,
  tenantId: string,
  contractId: string,
) {
  const [contractResult, lineItemsResult] = await Promise.all([
    supabase
      .from("service_contracts")
      .select(SERVICE_CONTRACT_HEADER_SELECT)
      .eq("id", contractId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("service_contract_line_items")
      .select(SERVICE_CONTRACT_LINE_ITEM_SELECT)
      .eq("contract_id", contractId)
      .eq("tenant_id", tenantId)
      .order("sort_order", { ascending: true }),
  ]);

  if (contractResult.error) {
    return {
      contract: null,
      line_items: [],
      error: contractResult.error.message,
    };
  }

  if (!contractResult.data) {
    return {
      contract: null,
      line_items: [],
      error: "Service contract not found.",
    };
  }

  return {
    contract: contractResult.data as ServiceContractHeaderRow,
    line_items: lineItemsResult.data ?? [],
    error: lineItemsResult.error?.message ?? null,
  };
}

export async function loadGeneratedInvoicesForContract(
  supabase: DbClient,
  tenantId: string,
  contractId: string,
) {
  const { data, error } = await supabase
    .from("client_invoices")
    .select(
      "id, invoice_number, invoice_date, billing_period_start, billing_period_end, status, total_amount_due",
    )
    .eq("tenant_id", tenantId)
    .eq("contract_id", contractId)
    .order("invoice_date", { ascending: false })
    .order("invoice_sequence", { ascending: false });

  if (error) {
    return { invoices: [], error: error.message };
  }

  return { invoices: data ?? [], error: null };
}

export async function loadActiveServiceContractsForTenant(
  supabase: DbClient,
  tenantId: string,
) {
  const { data, error } = await supabase
    .from("service_contracts")
    .select("id, contract_number, client_id, status")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .order("contract_number", { ascending: true });

  if (error) {
    return { contracts: [], error: error.message };
  }

  return { contracts: data ?? [], error: null };
}

export async function loadActiveServiceContractsForCustomer(
  supabase: DbClient,
  tenantId: string,
  clientId: string,
) {
  const { data, error } = await supabase
    .from("service_contracts")
    .select("id, contract_number, client_id, status")
    .eq("tenant_id", tenantId)
    .eq("client_id", clientId)
    .eq("status", "active")
    .order("contract_number", { ascending: true });

  if (error) {
    return { contracts: [], error: error.message };
  }

  return { contracts: data ?? [], error: null };
}

export async function createInvoiceFromServiceContract(
  supabase: DbClient,
  tenantId: string,
  contract: ServiceContractHeaderRow,
  lineItems: ServiceContractLineItemInput[],
  invoiceDate: string,
  customer: { client_name: string; address?: string | null; phone?: string | null },
) {
  const invoiceBody = contractToInvoiceWriteBody(
    contract,
    lineItems,
    {
      client_id: contract.client_id,
      client_name: customer.client_name,
      address: customer.address ?? null,
      phone: customer.phone ?? null,
    },
    invoiceDate,
  );

  const options: CreateClientInvoiceOptions = {
    fixedHeaderTotals: {
      subtotal: toNumber(contract.subtotal),
      tax_due: toNumber(contract.tax_due),
      wht_amount: toNumber(contract.wht_amount),
      total_amount_due: toNumber(contract.total_amount_due),
    },
    taxBasisOverride: resolveServiceContractTaxBasis(contract.tax_basis),
    contractId: contract.id,
  };

  return createClientInvoice(supabase, tenantId, invoiceBody, options);
}

export async function advanceServiceContractBillingDate(
  supabase: DbClient,
  tenantId: string,
  contract: Pick<
    ServiceContractHeaderRow,
    "id" | "next_billing_date" | "billing_frequency" | "end_date" | "auto_renew"
  >,
  asOfDate: string,
) {
  const currentNext = contract.next_billing_date ?? asOfDate;
  let nextDate = currentNext;

  while (nextDate <= asOfDate) {
    nextDate = advanceBillingDate(nextDate, contract.billing_frequency);
  }

  const updates: Record<string, unknown> = {
    next_billing_date: nextDate,
    updated_at: new Date().toISOString(),
  };

  if (
    contract.auto_renew &&
    contract.end_date < asOfDate &&
    nextDate > contract.end_date
  ) {
    updates.end_date = advanceBillingDate(
      contract.end_date,
      contract.billing_frequency,
    );
  }

  const { error } = await supabase
    .from("service_contracts")
    .update(updates)
    .eq("id", contract.id)
    .eq("tenant_id", tenantId);

  return { error: error?.message ?? null };
}
