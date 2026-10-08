import {
  isPaidStatus,
  isPayrollAutoPostedExpense,
  isSettledNoCashImpactStatus,
} from "./accrued-wages-utils";
import {
  isCustomerRefundCashOutflowExpense,
  isProductReturnCogsReversalExpense,
} from "./customer-refund-expense-utils";
import {
  appendRemittedNote,
  REMITTED_STATUS,
  todayIsoDate,
} from "./tax-ledger-utils";
import {
  STATUTORY_REMITTANCE_EXPENSE_CATEGORY,
  buildRemitExpenseReceiptNo,
  remitKindFromReceiptNo,
} from "./tax-ledger-remit";
import {
  buildPayrollPeriodTaxLedgerSourceId,
  PAYROLL_PERIOD_SOURCE_TYPE,
} from "../hr-payroll/payroll-statutory-ledger-sync";
import {
  EXPENSE_PAYMENT_STATUS_SETTLED_NO_CASH,
  PAYROLL_EXPENSE_AUTO_DESCRIPTION_PREFIX,
  PAYROLL_EXPENSE_PAYMENT_STATUS_PAID,
  PAYROLL_INCOME_RECEIPT_SUFFIX,
} from "../hr-payroll/payroll-lock-finance-utils";
import {
  STAFF_WELFARE_CONTRIBUTION_CATEGORY,
  STAFF_WELFARE_DISBURSEMENT_CATEGORY,
} from "./staff-welfare-fund-utils";
import { normalizeCategoryName } from "./profit-loss-utils";
import { parsePeriodKey } from "../hr-payroll/payroll-period-utils";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Distinct text styling for payroll/system auto-posted register rows (all tenants). */
export const AUTO_POSTED_REGISTER_ROW_TEXT_CLASS =
  "text-[#0b4f6c] font-medium";

const EMPLOYER_SSNIT_TAX_COMPONENTS = [
  "ssnit_employer_tier1",
  "ssnit_tier2",
] as const;

/** Mirrored from paystack-finance-posting (avoid server-only import in client UI). */
const PLATFORM_BILLING_INCOME_CATEGORY = "Platform Billing";
const ERP_SUITE_SUBSCRIPTION_INCOME_CATEGORY = "ERP Suite";
const PAYSTACK_INCOME_INVOICE_PREFIX = "PSK-INC-";

/** Client Invoice sync stamps this service_category (even before client_invoice_id). */
export const CLIENT_INVOICE_INCOME_CATEGORY = "Client Invoice";

/** Davors Real Estate payout remittance fee (auto-posted from mark-remitted). */
export const REAL_ESTATE_MANAGEMENT_FEE_INCOME_CATEGORY =
  "Real Estate Management Fee";

const RE_MGMT_FEE_INVOICE_PREFIX = "RE-MGMT-FEE-";

const PAYSTACK_FEE_RECEIPT_PREFIX = "PSK-FEE-";
const PAYSTACK_FEE_EXPENSE_SUB_CATEGORY = "Paystack Transaction Fees";
const PAYSTACK_FEE_VENDOR = "Paystack";

const INTERNAL_CONSUMPTION_DESCRIPTION_PREFIX =
  "Auto-posted internal consumption of";
const INVENTORY_GAIN_INCOME_DESCRIPTION = "Inventory gain (stock adjustment)";
const INVENTORY_LOSS_EXPENSE_DESCRIPTION = "Inventory loss (stock adjustment)";

export type AutoPostedExpenseKind =
  | "statutory_remit"
  | "payroll"
  | "customer_refund"
  | "product_cogs"
  | "inventory_go_live"
  | "stock_adjustment"
  | "internal_consumption"
  | "welfare"
  | "paystack_fee"
  | "product_return_cogs";

export type AutoPostedExpenseDetection = {
  autoPosted: boolean;
  kind: AutoPostedExpenseKind | null;
  lockMessage: string | null;
};

export type AutoPostedIncomeKind =
  | "system_adjustment"
  | "client_invoice"
  | "platform_billing"
  | "product_sale"
  | "management_fee";

export type AutoPostedIncomeDetection = {
  autoPosted: boolean;
  kind: AutoPostedIncomeKind | null;
  /** Short UI tooltip / banner explaining how to change or remove the row. */
  lockMessage: string | null;
};

export function getRegisterRowClassName(
  index: number,
  autoPosted: boolean,
): string {
  const stripe = index % 2 === 1 ? "bg-slate-50" : "";
  if (autoPosted) {
    return [stripe, AUTO_POSTED_REGISTER_ROW_TEXT_CLASS].filter(Boolean).join(" ");
  }
  return [stripe, "text-slate-900"].filter(Boolean).join(" ");
}

export function isInventoryGoLiveTrueUpExpense(entry: {
  receipt_no?: string | null;
}): boolean {
  return /^ADJ-PPIR-/i.test((entry.receipt_no ?? "").trim());
}

/** Tax Ledger remit-for-period cash rows (TAX-REMIT-* or Statutory Remittance category). */
export function isStatutoryRemittanceExpense(entry: {
  receipt_no?: string | null;
  expense_category?: string | null;
}): boolean {
  if (remitKindFromReceiptNo(entry.receipt_no)) {
    return true;
  }
  return (
    (entry.expense_category ?? "").trim() ===
    STATUTORY_REMITTANCE_EXPENSE_CATEGORY
  );
}

export function statutoryRemittanceExpenseLockMessage(): string {
  return "Statutory tax remittance (auto-posted). Undo via Finance → Statutory Ledger → remittance controls — do not edit or delete here.";
}

export function isProductSaleCogsExpense(entry: {
  receipt_no?: string | null;
}): boolean {
  return /^(VOID-)?COGS-/i.test((entry.receipt_no ?? "").trim());
}

export function isProductReturnCogsReceiptExpense(entry: {
  receipt_no?: string | null;
}): boolean {
  return /^RET-COGS-/i.test((entry.receipt_no ?? "").trim());
}

export function isStockAdjustmentExpense(entry: {
  receipt_no?: string | null;
  description?: string | null;
}): boolean {
  const receipt = (entry.receipt_no ?? "").trim();
  if (/^STKADJ-/i.test(receipt)) {
    return true;
  }
  return (entry.description ?? "").trim() === INVENTORY_LOSS_EXPENSE_DESCRIPTION;
}

export function isInternalConsumptionExpense(entry: {
  description?: string | null;
  receipt_no?: string | null;
}): boolean {
  const description = (entry.description ?? "").trim();
  if (
    description
      .toLowerCase()
      .startsWith(INTERNAL_CONSUMPTION_DESCRIPTION_PREFIX.toLowerCase())
  ) {
    return true;
  }
  return /^IC-/i.test((entry.receipt_no ?? "").trim());
}

export function isStaffWelfareFundExpense(entry: {
  receipt_no?: string | null;
  expense_category?: string | null;
}): boolean {
  const receipt = (entry.receipt_no ?? "").trim().toUpperCase();
  if (receipt.startsWith("WELFARE-DISB-") || receipt.startsWith("WELFARE-CONT-")) {
    return true;
  }
  const category = normalizeCategoryName(entry.expense_category ?? "");
  return (
    category === normalizeCategoryName(STAFF_WELFARE_DISBURSEMENT_CATEGORY) ||
    category === normalizeCategoryName(STAFF_WELFARE_CONTRIBUTION_CATEGORY)
  );
}

export function isPaystackTransactionFeeExpense(entry: {
  receipt_no?: string | null;
  sub_category?: string | null;
  vendor?: string | null;
}): boolean {
  const receipt = (entry.receipt_no ?? "").trim().toUpperCase();
  if (receipt.startsWith(PAYSTACK_FEE_RECEIPT_PREFIX)) {
    return true;
  }
  return (
    normalizeCategoryName(entry.sub_category ?? "") ===
      normalizeCategoryName(PAYSTACK_FEE_EXPENSE_SUB_CATEGORY) &&
    (entry.vendor ?? "").trim().toLowerCase() ===
      PAYSTACK_FEE_VENDOR.toLowerCase()
  );
}

/**
 * Classify expense_register rows written upstream (not manual Add Entry).
 */
export function detectAutoPostedExpenseRegisterEntry(entry: {
  description?: string | null;
  receipt_no?: string | null;
  expense_category?: string | null;
  sub_category?: string | null;
  is_customer_refund?: boolean | null;
  vendor?: string | null;
}): AutoPostedExpenseDetection {
  if (isStatutoryRemittanceExpense(entry)) {
    return {
      autoPosted: true,
      kind: "statutory_remit",
      lockMessage: statutoryRemittanceExpenseLockMessage(),
    };
  }
  if (isCustomerRefundCashOutflowExpense(entry)) {
    return {
      autoPosted: true,
      kind: "customer_refund",
      lockMessage: customerRefundExpenseLockMessage(),
    };
  }
  if (
    isProductReturnCogsReversalExpense(entry) ||
    isProductReturnCogsReceiptExpense(entry)
  ) {
    return {
      autoPosted: true,
      kind: "product_return_cogs",
      lockMessage:
        "Sale return COGS (auto-posted). Adjust from CRM → Sales → Return or Credit Notes — do not edit or delete here.",
    };
  }
  if (isProductSaleCogsExpense(entry)) {
    return {
      autoPosted: true,
      kind: "product_cogs",
      lockMessage:
        "Product sale COGS (auto-posted). Cancel or adjust the sale from Sales & CRM → Sales — do not edit or delete here.",
    };
  }
  if (isInventoryGoLiveTrueUpExpense(entry)) {
    return {
      autoPosted: true,
      kind: "inventory_go_live",
      lockMessage:
        "Inventory go-live true-up (ADJ-PPIR-*). Do not edit or delete — contact support if a correction is required.",
    };
  }
  if (isStockAdjustmentExpense(entry)) {
    return {
      autoPosted: true,
      kind: "stock_adjustment",
      lockMessage:
        "Inventory stock adjustment (auto-posted). Reverse from Inventory → Stock adjustments — do not edit or delete here.",
    };
  }
  if (isInternalConsumptionExpense(entry)) {
    return {
      autoPosted: true,
      kind: "internal_consumption",
      lockMessage:
        "Internal consumption (auto-posted). Edit or delete from Inventory → Internal use — do not change here.",
    };
  }
  if (isStaffWelfareFundExpense(entry)) {
    return {
      autoPosted: true,
      kind: "welfare",
      lockMessage:
        "Staff welfare fund (auto-posted). Manage from Finance → Staff Welfare Fund — do not edit or delete here.",
    };
  }
  if (isPaystackTransactionFeeExpense(entry)) {
    return {
      autoPosted: true,
      kind: "paystack_fee",
      lockMessage:
        "Paystack transaction fee (auto-posted). Managed from Platform Billing / Paystack settlement — do not edit or delete here.",
    };
  }
  if (isPayrollAutoPostedExpense(entry)) {
    return {
      autoPosted: true,
      kind: "payroll",
      lockMessage:
        "Payroll auto-posted expense. Use Mark as Paid when remitting Accrued Employer SSNIT / Accrued Staff Salaries, or Release payroll to reverse the post.",
    };
  }
  return { autoPosted: false, kind: null, lockMessage: null };
}

export function expenseRegisterAutoPostLockMessage(entry: Parameters<
  typeof detectAutoPostedExpenseRegisterEntry
>[0]): string | null {
  return detectAutoPostedExpenseRegisterEntry(entry).lockMessage;
}

/**
 * Expense Register auto-post detection (upstream/system rows).
 */
export function isAutoPostedExpenseRegisterEntry(entry: {
  description?: string | null;
  receipt_no?: string | null;
  expense_category?: string | null;
  sub_category?: string | null;
  is_customer_refund?: boolean | null;
  vendor?: string | null;
}): boolean {
  return detectAutoPostedExpenseRegisterEntry(entry).autoPosted;
}

export function customerRefundExpenseLockMessage(): string {
  return "Customer refund (auto-posted). Manage refunds from Finance → Credit Notes — do not edit or delete here.";
}

export function productSaleReturnIncomeLockMessage(): string {
  return "Sale return (auto-posted). Process adjustments from CRM → Sales → Return — do not edit or delete here.";
}

function isPlatformBillingIncomeCategory(category: string | null | undefined) {
  const normalized = (category ?? "").trim();
  return (
    normalized === PLATFORM_BILLING_INCOME_CATEGORY ||
    normalized === ERP_SUITE_SUBSCRIPTION_INCOME_CATEGORY
  );
}

/**
 * Classify Income Register rows written by an upstream system (not manual Add Entry).
 * Used to lock Edit/Delete. No new column — existing signals only.
 */
export function detectAutoPostedIncomeRegisterEntry(entry: {
  description?: string | null;
  invoice_no?: string | null;
  is_system_adjustment?: boolean | null;
  client_invoice_id?: string | null;
  service_category?: string | null;
  entry_type?: string | null;
  is_sale_return?: boolean | null;
}): AutoPostedIncomeDetection {
  if (entry.is_sale_return === true) {
    return {
      autoPosted: true,
      kind: "product_sale",
      lockMessage: productSaleReturnIncomeLockMessage(),
    };
  }

  if (entry.is_system_adjustment) {
    return {
      autoPosted: true,
      kind: "system_adjustment",
      lockMessage:
        "System non-cash adjustment (payroll / forfeit). Reverse via payroll unlock or the originating correction — do not edit or delete here.",
    };
  }

  const invoice = (entry.invoice_no ?? "").trim();
  if (
    new RegExp(`^PAYROLL-${PAYROLL_INCOME_RECEIPT_SUFFIX}-`, "i").test(invoice)
  ) {
    return {
      autoPosted: true,
      kind: "system_adjustment",
      lockMessage:
        "Payroll auto-posted income. Reverse via payroll unlock — do not edit or delete here.",
    };
  }

  const description = (entry.description ?? "").trim().toLowerCase();
  if (
    description.startsWith(
      PAYROLL_EXPENSE_AUTO_DESCRIPTION_PREFIX.toLowerCase(),
    )
  ) {
    return {
      autoPosted: true,
      kind: "system_adjustment",
      lockMessage:
        "Payroll auto-posted income. Reverse via payroll unlock — do not edit or delete here.",
    };
  }

  const category = (entry.service_category ?? "").trim();
  if (
    Boolean(entry.client_invoice_id) ||
    category === CLIENT_INVOICE_INCOME_CATEGORY
  ) {
    return {
      autoPosted: true,
      kind: "client_invoice",
      lockMessage:
        "Synced from a Client Invoice. Cancel or delete the Client Invoice instead — editing this row directly can desync AR/tax and unbalance the Balance Sheet.",
    };
  }

  if (
    isPlatformBillingIncomeCategory(category) ||
    invoice.toUpperCase().startsWith(PAYSTACK_INCOME_INVOICE_PREFIX)
  ) {
    return {
      autoPosted: true,
      kind: "platform_billing",
      lockMessage:
        "Auto-posted from Platform Billing / Paystack. Manage the subscription charge at its source — do not edit or delete here.",
    };
  }

  if ((entry.entry_type ?? "").trim() === "product_sale") {
    return {
      autoPosted: true,
      kind: "product_sale",
      lockMessage:
        "Product sale (POS). Cancel or adjust the sale from Sales / POS — do not edit or delete here.",
    };
  }

  if (
    description === INVENTORY_GAIN_INCOME_DESCRIPTION.toLowerCase() ||
    (entry.description ?? "").trim() === INVENTORY_GAIN_INCOME_DESCRIPTION
  ) {
    return {
      autoPosted: true,
      kind: "system_adjustment",
      lockMessage:
        "Inventory stock adjustment gain (auto-posted). Reverse from Inventory → Stock adjustments — do not edit or delete here.",
    };
  }

  if (
    category === REAL_ESTATE_MANAGEMENT_FEE_INCOME_CATEGORY ||
    invoice.toUpperCase().startsWith(RE_MGMT_FEE_INVOICE_PREFIX)
  ) {
    return {
      autoPosted: true,
      kind: "management_fee",
      lockMessage:
        "Auto-posted from Real Estate payout remittance. Reverse from the payout remittance flow — do not edit or delete here.",
    };
  }

  return { autoPosted: false, kind: null, lockMessage: null };
}

/**
 * Income Register auto-post detection (DEDSAV / Client Invoice / Platform Billing / …).
 */
export function isAutoPostedIncomeRegisterEntry(entry: {
  description?: string | null;
  invoice_no?: string | null;
  is_system_adjustment?: boolean | null;
  client_invoice_id?: string | null;
  service_category?: string | null;
  entry_type?: string | null;
}): boolean {
  return detectAutoPostedIncomeRegisterEntry(entry).autoPosted;
}

export function isPayrollEssnitExpense(entry: {
  receipt_no?: string | null;
}): boolean {
  return /^PAYROLL-ESSNIT-/i.test((entry.receipt_no ?? "").trim());
}

export function isPayrollSalExpense(entry: {
  receipt_no?: string | null;
}): boolean {
  return /^PAYROLL-SAL-/i.test((entry.receipt_no ?? "").trim());
}

/**
 * Mark as Paid only for Accrued auto-posted SAL / ESSNIT (cash still owed).
 * Never for DEDSAV (income), Settled, or already Paid (e.g. Full Lock SAL).
 */
export function canMarkAutoPostedExpenseAsPaid(entry: {
  description?: string | null;
  receipt_no?: string | null;
  payment_status?: string | null;
}): boolean {
  if (!isAutoPostedExpenseRegisterEntry(entry)) {
    return false;
  }
  if (isPaidStatus(entry.payment_status)) {
    return false;
  }
  if (isSettledNoCashImpactStatus(entry.payment_status)) {
    return false;
  }
  if (
    !isPayrollSalExpense(entry) &&
    !isPayrollEssnitExpense(entry)
  ) {
    return false;
  }
  // Accrued / unpaid auto-posts only (Paid and Settled already excluded).
  return true;
}

export function parsePayrollPeriodKeyFromEssnitReceipt(
  receiptNo: string | null | undefined,
): string | null {
  const match = /PAYROLL-ESSNIT-(\d{4}-\d{2})/i.exec((receiptNo ?? "").trim());
  if (!match) {
    return null;
  }
  return parsePeriodKey(match[1])
    ? match[1]
    : null;
}

/**
 * Mark Accrued ESSNIT expense Paid (Cash Position) and remit matching employer
 * SSNIT tax_ledger legs (tier1 + tier2) for that payroll period.
 * Does NOT remit employee SSNIT — use Tax Ledger "Remit SSNIT for period" for
 * remaining employee remittance cash and liability clear.
 *
 * If Remit SSNIT already posted cash for the period (TAX-REMIT-SSNIT-*), flips
 * ESSNIT to Settled (No Cash Impact) instead — never a second Cash Position hit.
 */
export async function markAutoPostedExpensePaid(
  supabase: SupabaseClient,
  entry: {
    id: string;
    tenant_id?: string | null;
    receipt_no?: string | null;
    payment_status?: string | null;
    description?: string | null;
  },
): Promise<{ error: string | null; taxLegsRemitted: number }> {
  if (!canMarkAutoPostedExpenseAsPaid(entry)) {
    return {
      error: "This auto-posted entry is not eligible for Mark as Paid.",
      taxLegsRemitted: 0,
    };
  }

  const isEssnit = isPayrollEssnitExpense(entry);
  let tenantId = entry.tenant_id?.trim() || null;
  let periodKey: string | null = null;
  let payrollMonth: string | null = null;
  let remittanceAlreadyPosted = false;

  if (isEssnit) {
    periodKey = parsePayrollPeriodKeyFromEssnitReceipt(entry.receipt_no);
    if (!periodKey || !parsePeriodKey(periodKey)) {
      return {
        error:
          "Could not parse payroll period from ESSNIT receipt — remit employer SSNIT on Tax Ledger manually.",
        taxLegsRemitted: 0,
      };
    }
    payrollMonth = `${periodKey}-01`;

    if (!tenantId) {
      const { data: row } = await supabase
        .from("expense_register")
        .select("tenant_id")
        .eq("id", entry.id)
        .maybeSingle();
      tenantId =
        (row as { tenant_id?: string | null } | null)?.tenant_id ?? null;
    }

    if (!tenantId) {
      return {
        error:
          "Tenant could not be resolved for Tax Ledger remittance.",
        taxLegsRemitted: 0,
      };
    }

    const remitReceipt = buildRemitExpenseReceiptNo("ssnit", payrollMonth);
    const { data: remitExpense, error: remitLookupError } = await supabase
      .from("expense_register")
      .select("id, payment_status")
      .eq("tenant_id", tenantId)
      .eq("receipt_no", remitReceipt)
      .maybeSingle();

    if (remitLookupError) {
      return {
        error: `Remittance lookup failed: ${remitLookupError.message}`,
        taxLegsRemitted: 0,
      };
    }

    remittanceAlreadyPosted = Boolean(
      remitExpense && isPaidStatus(remitExpense.payment_status),
    );
  }

  const nowIso = new Date().toISOString();
  const nextStatus = remittanceAlreadyPosted
    ? EXPENSE_PAYMENT_STATUS_SETTLED_NO_CASH
    : PAYROLL_EXPENSE_PAYMENT_STATUS_PAID;

  const { error: updateError } = await supabase
    .from("expense_register")
    .update({
      payment_status: nextStatus,
    })
    .eq("id", entry.id);

  if (updateError) {
    return { error: updateError.message, taxLegsRemitted: 0 };
  }

  if (!isEssnit || !tenantId || !payrollMonth) {
    return { error: null, taxLegsRemitted: 0 };
  }

  let sourceId: string;
  try {
    sourceId = buildPayrollPeriodTaxLedgerSourceId(payrollMonth);
  } catch (err) {
    return {
      error:
        err instanceof Error
          ? `Expense updated, but Tax Ledger source id failed: ${err.message}`
          : "Expense updated, but Tax Ledger source id failed.",
      taxLegsRemitted: 0,
    };
  }

  const remittedOn = todayIsoDate();
  const stamp = appendRemittedNote(null, new Date(remittedOn));

  const { data: openLegs, error: selectError } = await supabase
    .from("tax_ledger_entries")
    .select("id, notes")
    .eq("tenant_id", tenantId)
    .eq("source_type", PAYROLL_PERIOD_SOURCE_TYPE)
    .eq("source_id", sourceId)
    .eq("status", "open")
    .in("tax_component", [...EMPLOYER_SSNIT_TAX_COMPONENTS]);

  if (selectError) {
    return {
      error: `Expense updated, but Tax Ledger lookup failed: ${selectError.message}`,
      taxLegsRemitted: 0,
    };
  }

  const legs = (openLegs as Array<{ id: string; notes: string | null }> | null) ?? [];
  if (legs.length === 0) {
    return { error: null, taxLegsRemitted: 0 };
  }

  const results = await Promise.all(
    legs.map((leg) =>
      supabase
        .from("tax_ledger_entries")
        .update({
          status: REMITTED_STATUS,
          remitted_at: remittedOn,
          notes: appendRemittedNote(leg.notes, new Date(remittedOn)),
          updated_at: nowIso,
        })
        .eq("id", leg.id)
        .eq("tenant_id", tenantId)
        .eq("status", "open"),
    ),
  );

  const firstError = results.find((result) => result.error)?.error;
  if (firstError) {
    return {
      error: `Expense updated, but Tax Ledger remittance failed: ${firstError.message}. Stamp: ${stamp}`,
      taxLegsRemitted: 0,
    };
  }

  return { error: null, taxLegsRemitted: legs.length };
}
