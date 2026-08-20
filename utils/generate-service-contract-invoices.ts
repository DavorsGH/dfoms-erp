import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  advanceServiceContractBillingDate,
  createInvoiceFromServiceContract,
} from "@/utils/service-contracts-api";
import {
  SERVICE_CONTRACT_HEADER_SELECT,
  SERVICE_CONTRACT_LINE_ITEM_SELECT,
  type ServiceContractHeaderRow,
  type ServiceContractLineItemInput,
} from "@/utils/service-contracts-types";

export type GenerateServiceContractInvoicesOptions = {
  asOf?: Date | string;
  admin?: SupabaseClient;
  tenantId?: string;
};

export type ServiceContractInvoiceResult = {
  contractId: string;
  tenantId: string;
  contractNumber: string;
  skipped: boolean;
  skipReason?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  error?: string;
};

export type GenerateServiceContractInvoicesResult = {
  asOfDate: string;
  created: number;
  skipped: number;
  errors: number;
  contracts: ServiceContractInvoiceResult[];
};

function toDateString(value: Date | string | undefined): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "string" && value.trim()) {
    return value.trim().slice(0, 10);
  }

  return new Date().toISOString().slice(0, 10);
}

type DueContractRow = ServiceContractHeaderRow & {
  client:
    | { client_name: string; address?: string | null; phone?: string | null }
    | { client_name: string; address?: string | null; phone?: string | null }[]
    | null;
};

function resolveCustomer(
  client: DueContractRow["client"],
): { client_name: string; address?: string | null; phone?: string | null } | null {
  if (!client) {
    return null;
  }

  const row = Array.isArray(client) ? (client[0] ?? null) : client;
  if (!row?.client_name?.trim()) {
    return null;
  }

  return row;
}

export async function generateServiceContractInvoices(
  options: GenerateServiceContractInvoicesOptions = {},
): Promise<GenerateServiceContractInvoicesResult> {
  const admin = options.admin ?? createAdminClient();
  const asOfDate = toDateString(options.asOf);

  let query = admin
    .from("service_contracts")
    .select(`${SERVICE_CONTRACT_HEADER_SELECT}`)
    .eq("status", "active")
    .not("next_billing_date", "is", null)
    .lte("next_billing_date", asOfDate);

  if (options.tenantId) {
    query = query.eq("tenant_id", options.tenantId);
  }

  const { data: contracts, error: contractsError } = await query;

  if (contractsError) {
    throw new Error(contractsError.message);
  }

  const results: ServiceContractInvoiceResult[] = [];
  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const rawContract of (contracts as DueContractRow[] | null) ?? []) {
    const contract = rawContract as DueContractRow;
    const baseResult: ServiceContractInvoiceResult = {
      contractId: contract.id,
      tenantId: contract.tenant_id,
      contractNumber: contract.contract_number,
      skipped: false,
    };

    if (contract.end_date < asOfDate && !contract.auto_renew) {
      skipped += 1;
      results.push({
        ...baseResult,
        skipped: true,
        skipReason: "Contract end date passed and auto-renew is off.",
      });

      await admin
        .from("service_contracts")
        .update({
          status: "expired",
          updated_at: new Date().toISOString(),
        })
        .eq("id", contract.id)
        .eq("tenant_id", contract.tenant_id)
        .eq("status", "active");

      continue;
    }

    const customer = resolveCustomer(contract.client);
    if (!customer) {
      errors += 1;
      results.push({
        ...baseResult,
        error: "Customer record missing for contract.",
      });
      continue;
    }

    const { data: lineItemRows, error: lineItemsError } = await admin
      .from("service_contract_line_items")
      .select(SERVICE_CONTRACT_LINE_ITEM_SELECT)
      .eq("contract_id", contract.id)
      .eq("tenant_id", contract.tenant_id)
      .order("sort_order", { ascending: true });

    if (lineItemsError) {
      errors += 1;
      results.push({
        ...baseResult,
        error: lineItemsError.message,
      });
      continue;
    }

    const lineItems: ServiceContractLineItemInput[] = (lineItemRows ?? []).map(
      (line) => ({
        category_label: line.category_label,
        description: line.description,
        labour_amount: Number(line.labour_amount) || 0,
        material_amount: Number(line.material_amount) || 0,
        discount_amount: Number(line.discount_amount) || 0,
        taxed: line.taxed,
        sort_order: line.sort_order,
      }),
    );

    if (lineItems.length === 0) {
      skipped += 1;
      results.push({
        ...baseResult,
        skipped: true,
        skipReason: "No line items on contract.",
      });
      continue;
    }

    const { invoice, error: createError } = await createInvoiceFromServiceContract(
      admin,
      contract.tenant_id,
      contract,
      lineItems,
      asOfDate,
      customer,
    );

    if (createError || !invoice) {
      errors += 1;
      results.push({
        ...baseResult,
        error: createError ?? "Unable to create invoice.",
      });
      continue;
    }

    const { error: advanceError } = await advanceServiceContractBillingDate(
      admin,
      contract.tenant_id,
      contract,
      asOfDate,
    );

    if (advanceError) {
      errors += 1;
      results.push({
        ...baseResult,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoice_number,
        error: `Invoice ${invoice.invoice_number} created, but next billing date was not advanced: ${advanceError}`,
      });
      continue;
    }

    created += 1;
    results.push({
      ...baseResult,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
    });

    void import("@/utils/tenant-admin-director-tier2-notifications").then(
      ({ notifyAdminsDirectorsDraftServiceContractInvoice }) => {
        void notifyAdminsDirectorsDraftServiceContractInvoice(
          contract.tenant_id,
          contract.contract_number,
          invoice.invoice_number,
          customer.client_name,
        );
      },
    );
  }

  return {
    asOfDate,
    created,
    skipped,
    errors,
    contracts: results,
  };
}
