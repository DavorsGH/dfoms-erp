import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SUPPLIER_CONTRACT_HEADER_SELECT,
  SUPPLIER_CONTRACT_SOURCE_TYPE,
  billingMonthStartFromDate,
  formatSupplierContractApInvoiceNumber,
  resolveMonthlyAmountForBillingMonth,
  roundMoney,
  toNumber,
  type SupplierContractAmendmentRow,
  type SupplierContractApContractRow,
} from "@/utils/supplier-contracts-types";
import {
  computePurchaseTaxAmounts,
  computeWhtAmount,
  roundTaxAmount,
} from "@/app/dashboard/finance/tax-utils";
import { buildPurchaseTaxLedgerRpcPayload } from "@/app/dashboard/finance/tax-ledger-sync";

export type GenerateSupplierContractApCoreOptions = {
  asOf?: Date | string;
  admin: SupabaseClient;
  tenantId?: string;
  onApCreated?: (
    contract: SupplierContractApContractRow,
    billingMonthStart: string,
  ) => Promise<void>;
  onMidMonthReminder?: (contract: SupplierContractApContractRow) => Promise<void>;
};

export type GenerateSupplierContractApResult = {
  asOfDate: string;
  created: number;
  skipped: number;
  errors: number;
  reminders: number;
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

function monthEndDate(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month, 0));
  return d.toISOString().slice(0, 10);
}

function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  return dt.toISOString().slice(0, 10);
}

function extendEndDateByOriginalTerm(startDate: string, endDate: string): string {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const months =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth());
  return addMonths(endDate, Math.max(months, 1));
}

async function loadAmendments(
  admin: SupabaseClient,
  tenantId: string,
  contractId: string,
): Promise<SupplierContractAmendmentRow[]> {
  const { data, error } = await admin
    .from("supplier_contract_amendments")
    .select(
      "id, tenant_id, contract_id, effective_date, previous_monthly_amount, new_monthly_amount, change_reason, document_url, created_at, created_by",
    )
    .eq("tenant_id", tenantId)
    .eq("contract_id", contractId)
    .order("effective_date", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data as SupplierContractAmendmentRow[] | null) ?? [];
}

async function createSupplierContractAp(
  admin: SupabaseClient,
  contract: SupplierContractApContractRow,
  billingMonthStart: string,
  grossBeforeWht: number,
): Promise<{ apId: string | null; skipped: boolean; error?: string }> {
  const invoiceNumber = formatSupplierContractApInvoiceNumber(
    contract.contract_number,
    billingMonthStart,
  );
  const whtRate = toNumber(contract.wht_rate);
  const whtAmount =
    whtRate > 0
      ? roundTaxAmount(computeWhtAmount(grossBeforeWht, whtRate))
      : 0;
  const purchaseTax = computePurchaseTaxAmounts({
    grossBeforeWht,
    whtRatePct: whtRate,
    whtAmount,
    inputVatAmount: 0,
  });

  const [year, month] = billingMonthStart.split("-").map(Number);
  const invoiceDate = billingMonthStart;
  const dueDate = monthEndDate(year, month);

  const taxRows = buildPurchaseTaxLedgerRpcPayload({
    sourceType: "accounts_payable",
    sourceId: contract.id,
    entryDate: invoiceDate,
    grossBeforeWht: purchaseTax.grossBeforeWht,
    whtRatePct: whtRate > 0 ? whtRate : null,
    whtAmount: purchaseTax.whtAmount,
    inputTaxComponent: purchaseTax.inputTaxComponent,
    inputTaxRatePct: null,
    inputVatAmount: purchaseTax.inputVatAmount,
    counterpartyName: contract.supplier_name,
    notes: `Supplier contract ${contract.contract_number}`,
    businessUnitId: contract.business_unit_id ?? null,
  });

  const { data, error } = await admin.rpc("save_accounts_payable", {
    p_tenant_id: contract.tenant_id,
    p_ap_id: null,
    p_business_unit_id: contract.business_unit_id,
    p_vendor_name: contract.supplier_name,
    p_invoice_number: invoiceNumber,
    p_expense_category: contract.expense_category,
    p_sub_category: contract.sub_category,
    p_description: `Supplier contract ${contract.contract_number}`,
    p_invoice_date: invoiceDate,
    p_due_date: dueDate,
    p_amount: purchaseTax.netOfTaxAmount,
    p_amount_paid: 0,
    p_balance_due: purchaseTax.netOfTaxAmount,
    p_status: "Outstanding",
    p_gross_before_wht: purchaseTax.grossBeforeWht,
    p_wht_rate: whtRate > 0 ? whtRate : null,
    p_wht_amount: purchaseTax.whtAmount,
    p_input_vat_amount: purchaseTax.inputVatAmount,
    p_net_of_tax_amount: purchaseTax.netOfTaxAmount,
    p_notes: contract.notes ?? null,
    p_source_type: SUPPLIER_CONTRACT_SOURCE_TYPE,
    p_tax_rows: taxRows,
    p_source_id: contract.id,
  });

  if (error) {
    if (
      error.message.includes("accounts_payable_supplier_contract_invoice_key") ||
      error.message.toLowerCase().includes("duplicate")
    ) {
      return { apId: null, skipped: true };
    }
    return { apId: null, skipped: false, error: error.message };
  }

  const apId =
    typeof data === "object" && data && "id" in data
      ? String((data as { id: string }).id)
      : null;

  return { apId, skipped: false };
}

export async function generateSupplierContractAccountsPayableCore(
  options: GenerateSupplierContractApCoreOptions,
): Promise<GenerateSupplierContractApResult> {
  const admin = options.admin;
  const asOfDate = toDateString(options.asOf);
  const asOfDay = Number(asOfDate.slice(8, 10));
  let created = 0;
  let skipped = 0;
  let errors = 0;
  let reminders = 0;

  let query = admin
    .from("supplier_contracts")
    .select(SUPPLIER_CONTRACT_HEADER_SELECT)
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

  for (const raw of (contracts ?? []) as SupplierContractApContractRow[]) {
    const contract = raw;
    const billingAnchor = contract.next_billing_date ?? asOfDate;
    const billingMonthStart = billingMonthStartFromDate(billingAnchor);

    if (contract.end_date < asOfDate && !contract.auto_renew) {
      await admin
        .from("supplier_contracts")
        .update({ status: "expired", updated_at: new Date().toISOString() })
        .eq("id", contract.id)
        .eq("tenant_id", contract.tenant_id)
        .eq("status", "active");
      skipped += 1;
      continue;
    }

    let endDate = contract.end_date;
    if (contract.auto_renew && endDate < asOfDate) {
      endDate = extendEndDateByOriginalTerm(contract.start_date, contract.end_date);
      await admin
        .from("supplier_contracts")
        .update({ end_date: endDate, updated_at: new Date().toISOString() })
        .eq("id", contract.id)
        .eq("tenant_id", contract.tenant_id);
    }

    const amendments = await loadAmendments(admin, contract.tenant_id, contract.id);
    let monthly = resolveMonthlyAmountForBillingMonth(amendments, billingMonthStart);
    let creditApplied = 0;
    let creditBalance = roundMoney(toNumber(contract.credit_balance));
    if (creditBalance > 0 && monthly > 0) {
      creditApplied = roundMoney(Math.min(creditBalance, monthly));
      monthly = roundMoney(monthly - creditApplied);
      creditBalance = roundMoney(creditBalance - creditApplied);
    }

    if (monthly > 0) {
      const apResult = await createSupplierContractAp(
        admin,
        contract,
        billingMonthStart,
        monthly,
      );
      if (apResult.error) {
        errors += 1;
        continue;
      }
      if (apResult.skipped) {
        skipped += 1;
      } else {
        created += 1;
        if (options.onApCreated) {
          await options.onApCreated(contract, billingMonthStart);
        }
      }
    } else if (creditApplied > 0) {
      skipped += 1;
    }

    const nextBilling = addMonths(billingMonthStart, 1);
    await admin
      .from("supplier_contracts")
      .update({
        next_billing_date: nextBilling,
        credit_balance: creditBalance,
        updated_at: new Date().toISOString(),
      })
      .eq("id", contract.id)
      .eq("tenant_id", contract.tenant_id);

    if (
      contract.mid_month_reminder_enabled &&
      asOfDay === contract.mid_month_reminder_day &&
      options.onMidMonthReminder
    ) {
      await options.onMidMonthReminder(contract);
      reminders += 1;
    }
  }

  return { asOfDate, created, skipped, errors, reminders };
}
