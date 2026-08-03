import {
  isPaidStatus,
  isPayrollAutoPostedExpense,
  isSettledNoCashImpactStatus,
} from "./accrued-wages-utils";
import {
  appendRemittedNote,
  REMITTED_STATUS,
  todayIsoDate,
} from "./tax-ledger-utils";
import { buildRemitExpenseReceiptNo } from "./tax-ledger-remit";
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
import { parsePeriodKey } from "../hr-payroll/payroll-period-utils";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Distinct text styling for payroll/system auto-posted register rows (all tenants). */
export const AUTO_POSTED_REGISTER_ROW_TEXT_CLASS =
  "text-[#0b4f6c] font-medium";

const EMPLOYER_SSNIT_TAX_COMPONENTS = [
  "ssnit_employer_tier1",
  "ssnit_tier2",
] as const;

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

/**
 * Expense Register auto-post detection:
 * description prefix "Auto-posted from Payroll…" OR receipt_no PAYROLL-SAL-* / PAYROLL-ESSNIT-*.
 */
export function isAutoPostedExpenseRegisterEntry(entry: {
  description?: string | null;
  receipt_no?: string | null;
}): boolean {
  return isPayrollAutoPostedExpense(entry);
}

/**
 * Income Register auto-post detection (DEDSAV / system adj):
 * is_system_adjustment flag, or PAYROLL-DEDSAV-* invoice, or Auto-posted description.
 */
export function isAutoPostedIncomeRegisterEntry(entry: {
  description?: string | null;
  invoice_no?: string | null;
  is_system_adjustment?: boolean | null;
}): boolean {
  if (entry.is_system_adjustment) {
    return true;
  }

  const invoice = (entry.invoice_no ?? "").trim();
  if (
    new RegExp(`^PAYROLL-${PAYROLL_INCOME_RECEIPT_SUFFIX}-`, "i").test(invoice)
  ) {
    return true;
  }

  const description = (entry.description ?? "").trim().toLowerCase();
  return description.startsWith(
    PAYROLL_EXPENSE_AUTO_DESCRIPTION_PREFIX.toLowerCase(),
  );
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
