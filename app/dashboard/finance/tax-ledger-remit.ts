/**
 * Remit-for-period: clear Tax Ledger liabilities AND post Cash Position outflow.
 *
 * Cash is posted via a Paid expense_register row with category
 * "Statutory Remittance" (not in P&L EXPENSE_SECTIONS — liability settlement only).
 * For SSNIT, Accrued PAYROLL-ESSNIT-* is flipped to Settled (No Cash Impact) so
 * employer P&L stays on the accrual row while remittance cash is not double-counted.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { scopeTaxSettingsRead } from "@/utils/phase5e-key-structure";
import {
  applyBusinessUnitScope,
  REMIT_REQUIRES_SCOPED_BU_MESSAGE,
  type BusinessUnitReadScope,
} from "@/utils/business-unit-view";
import {
  isAccruedPaymentStatus,
  isPaidStatus,
  isSettledNoCashImpactStatus,
} from "./accrued-wages-utils";
import {
  appendRemittedNote,
  buildRemittanceDueDatePatch,
  formatPeriodMonthLabel,
  PAYE_COMPONENTS,
  REMITTED_STATUS,
  SSNIT_COMPONENTS,
  stripRemittedNote,
  todayIsoDate,
  type TaxDueDateSettingsSlice,
  type TaxLedgerComponent,
  type TaxLedgerEntry,
  type TaxLedgerStatus,
} from "./tax-ledger-utils";
import {
  EXPENSE_PAYMENT_STATUS_SETTLED_NO_CASH,
  PAYROLL_EXPENSE_PAYMENT_STATUS_ACCRUED,
  PAYROLL_EXPENSE_PAYMENT_STATUS_PAID,
  buildPayrollExpenseReceiptNo,
} from "../hr-payroll/payroll-lock-finance-utils";
import { payrollMonthToPeriodKey } from "../hr-payroll/payroll-period-utils";

export type RemitTaxKind = "ssnit" | "paye" | "vat" | "wht";

export const STATUTORY_REMITTANCE_EXPENSE_CATEGORY = "Statutory Remittance";
export const STATUTORY_REMITTANCE_SUB_CATEGORY = "Tax Remittance";
export const STATUTORY_REMITTANCE_PAYMENT_METHOD = "Bank Transfer";

export const REMIT_TAX_KIND_LABEL: Record<RemitTaxKind, string> = {
  ssnit: "SSNIT",
  paye: "PAYE",
  vat: "VAT",
  wht: "WHT",
};

const VAT_COMPONENTS: readonly TaxLedgerComponent[] = ["vat_bundle", "vfrs"];
const WHT_COMPONENTS: readonly TaxLedgerComponent[] = ["wht"];
const EMPLOYER_SSNIT_COMPONENTS: readonly TaxLedgerComponent[] = [
  "ssnit_employer_tier1",
  "ssnit_tier2",
];

export function remitReceiptPrefix(kind: RemitTaxKind): string {
  switch (kind) {
    case "ssnit":
      return "TAX-REMIT-SSNIT";
    case "paye":
      return "TAX-REMIT-PAYE";
    case "vat":
      return "TAX-REMIT-VAT";
    case "wht":
      return "TAX-REMIT-WHT";
  }
}

export function buildRemitExpenseReceiptNo(
  kind: RemitTaxKind,
  periodMonth: string,
): string {
  const periodKey =
    payrollMonthToPeriodKey(periodMonth.slice(0, 10)) ??
    periodMonth.slice(0, 7);
  return `${remitReceiptPrefix(kind)}-${periodKey}`;
}

export function componentsForRemitKind(
  kind: RemitTaxKind,
): readonly TaxLedgerComponent[] {
  switch (kind) {
    case "ssnit":
      return SSNIT_COMPONENTS;
    case "paye":
      return PAYE_COMPONENTS;
    case "vat":
      return VAT_COMPONENTS;
    case "wht":
      return WHT_COMPONENTS;
  }
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function periodEndDate(periodMonth: string): string {
  const y = Number(periodMonth.slice(0, 4));
  const m = Number(periodMonth.slice(5, 7));
  const lastDay = new Date(y, m, 0).getDate();
  return `${periodMonth.slice(0, 7)}-${String(lastDay).padStart(2, "0")}`;
}

function vendorForKind(kind: RemitTaxKind): string {
  return kind === "ssnit" ? "SSNIT" : "GRA";
}

export type RemitCandidateEntry = Pick<
  TaxLedgerEntry,
  | "id"
  | "tenant_id"
  | "period_month"
  | "direction"
  | "tax_component"
  | "tax_amount"
  | "status"
  | "notes"
>;

/**
 * Entries eligible for a remit-for-period action (open + component/direction scope).
 */
export function filterOpenEntriesForRemit(
  entries: RemitCandidateEntry[],
  kind: RemitTaxKind,
  periodMonth: string,
  tenantId: string,
): RemitCandidateEntry[] {
  const period = periodMonth.slice(0, 10);
  const allowed = new Set(componentsForRemitKind(kind));

  return entries.filter((entry) => {
    if (entry.tenant_id !== tenantId) {
      return false;
    }
    if (entry.status !== "open") {
      return false;
    }
    if (entry.period_month.slice(0, 10) !== period) {
      return false;
    }
    if (!allowed.has(entry.tax_component)) {
      return false;
    }
    if (kind === "wht" && entry.direction !== "wht_payable") {
      return false;
    }
    return true;
  });
}

/**
 * Cash Position outflow for the remittance.
 * VAT = max(0, output − input). Others = sum of open tax_amount.
 */
export function computeRemitCashAmount(
  entries: RemitCandidateEntry[],
  kind: RemitTaxKind,
): number {
  if (kind === "vat") {
    let output = 0;
    let input = 0;
    for (const entry of entries) {
      const amount = Number(entry.tax_amount) || 0;
      if (entry.direction === "output") {
        output += amount;
      } else if (entry.direction === "input") {
        input += amount;
      }
    }
    return roundCurrency(Math.max(0, output - input));
  }

  return roundCurrency(
    entries.reduce((sum, entry) => sum + (Number(entry.tax_amount) || 0), 0),
  );
}

export type RemitTaxForPeriodResult = {
  error: string | null;
  kind: RemitTaxKind;
  periodMonth: string;
  legsCleared: number;
  cashAmount: number;
  expenseReceiptNo: string | null;
  expenseInserted: boolean;
  essnitAligned: "settled" | "already_paid" | "already_settled" | "none" | null;
  dueDateAdvanced: boolean;
  message: string | null;
};

async function alignEssnitExpenseForSsnitRemit(
  supabase: SupabaseClient,
  tenantId: string,
  periodMonth: string,
): Promise<RemitTaxForPeriodResult["essnitAligned"]> {
  const periodKey =
    payrollMonthToPeriodKey(periodMonth.slice(0, 10)) ??
    periodMonth.slice(0, 7);
  const receiptNo = buildPayrollExpenseReceiptNo("ESSNIT", periodKey);

  const { data: essnit, error } = await supabase
    .from("expense_register")
    .select("id, payment_status, amount")
    .eq("tenant_id", tenantId)
    .eq("receipt_no", receiptNo)
    .maybeSingle();

  if (error) {
    throw new Error(`ESSNIT alignment lookup failed: ${error.message}`);
  }

  if (!essnit) {
    return "none";
  }

  if (isPaidStatus(essnit.payment_status)) {
    return "already_paid";
  }

  if (isSettledNoCashImpactStatus(essnit.payment_status)) {
    return "already_settled";
  }

  if (!isAccruedPaymentStatus(essnit.payment_status)) {
    // Unknown status — still settle so Mark as Paid cannot double-cash.
  }

  const { error: updateError } = await supabase
    .from("expense_register")
    .update({
      payment_status: EXPENSE_PAYMENT_STATUS_SETTLED_NO_CASH,
    })
    .eq("id", essnit.id)
    .eq("tenant_id", tenantId);

  if (updateError) {
    throw new Error(`ESSNIT alignment update failed: ${updateError.message}`);
  }

  return "settled";
}

/**
 * Remit one tax kind for one period: cash outflow + clear open legs + due-date roll.
 * Always scoped by tenantId.
 */
export async function remitTaxForPeriod(
  supabase: SupabaseClient,
  params: {
    tenantId: string;
    periodMonth: string;
    kind: RemitTaxKind;
    settings: TaxDueDateSettingsSlice;
    /** Optional preloaded entries; otherwise loads from DB. */
    entries?: RemitCandidateEntry[];
    /** Create-only stamp for remittance expense; null = All Businesses. */
    businessUnitId?: string | null;
    /**
     * Read scope for open-leg candidates. All Businesses is refused
     * (dfoms-bu-view-all-no-remit) — remittance must target one BU context.
     */
    readScope?: BusinessUnitReadScope;
    /** When true, refuse immediately (All Businesses selected). */
    viewAllBusinessUnits?: boolean;
  },
): Promise<RemitTaxForPeriodResult> {
  const { tenantId, kind, settings } = params;
  const periodMonth = params.periodMonth.slice(0, 10);
  const label = REMIT_TAX_KIND_LABEL[kind];
  const periodLabel = formatPeriodMonthLabel(periodMonth);
  const empty = (
    error: string | null,
    message: string | null = null,
  ): RemitTaxForPeriodResult => ({
    error,
    kind,
    periodMonth,
    legsCleared: 0,
    cashAmount: 0,
    expenseReceiptNo: null,
    expenseInserted: false,
    essnitAligned: null,
    dueDateAdvanced: false,
    message,
  });

  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodMonth)) {
    return empty("Invalid period month.");
  }

  if (!tenantId.trim()) {
    return empty("Tenant is required.");
  }

  if (
    params.viewAllBusinessUnits === true ||
    params.readScope?.mode === "all"
  ) {
    return empty(REMIT_REQUIRES_SCOPED_BU_MESSAGE);
  }

  const readScope: BusinessUnitReadScope =
    params.readScope ??
    (params.businessUnitId
      ? { mode: "unit", id: params.businessUnitId }
      : { mode: "default" });

  let candidates: RemitCandidateEntry[];
  if (params.entries) {
    candidates = filterOpenEntriesForRemit(
      params.entries,
      kind,
      periodMonth,
      tenantId,
    );
  } else {
    const components = [...componentsForRemitKind(kind)];
    let query = applyBusinessUnitScope(
      supabase
        .from("tax_ledger_entries")
        .select(
          "id, tenant_id, period_month, direction, tax_component, tax_amount, status, notes",
        )
        .eq("tenant_id", tenantId)
        .eq("period_month", periodMonth)
        .eq("status", "open")
        .in("tax_component", components),
      readScope,
    );

    if (kind === "wht") {
      query = query.eq("direction", "wht_payable");
    }

    const { data, error } = await query;
    if (error) {
      return empty(`Tax Ledger lookup failed: ${error.message}`);
    }
    candidates = (data as RemitCandidateEntry[] | null) ?? [];
  }

  if (candidates.length === 0) {
    return empty(
      null,
      `No open ${label} liabilities for ${periodLabel} to remit.`,
    );
  }

  let cashAmount = computeRemitCashAmount(candidates, kind);
  let employerCashSkipped = false;

  // Orphan recovery / Mark-as-Paid coordination for SSNIT.
  if (kind === "ssnit") {
    const periodKey =
      payrollMonthToPeriodKey(periodMonth) ?? periodMonth.slice(0, 7);
    const essnitReceipt = buildPayrollExpenseReceiptNo("ESSNIT", periodKey);
    const { data: essnit } = await supabase
      .from("expense_register")
      .select("id, payment_status, amount")
      .eq("tenant_id", tenantId)
      .eq("receipt_no", essnitReceipt)
      .maybeSingle();

    // Mark as Paid already posted employer cash — never cash employer legs again.
    if (essnit && isPaidStatus(essnit.payment_status)) {
      const cashEligible = candidates.filter(
        (entry) =>
          !EMPLOYER_SSNIT_COMPONENTS.includes(
            entry.tax_component as (typeof EMPLOYER_SSNIT_COMPONENTS)[number],
          ),
      );
      const employerOpen = candidates.filter((entry) =>
        EMPLOYER_SSNIT_COMPONENTS.includes(
          entry.tax_component as (typeof EMPLOYER_SSNIT_COMPONENTS)[number],
        ),
      );
      if (employerOpen.length > 0) {
        employerCashSkipped = true;
      }
      cashAmount = computeRemitCashAmount(cashEligible, kind);
    } else if (
      essnit &&
      isAccruedPaymentStatus(essnit.payment_status) &&
      !candidates.some((entry) =>
        EMPLOYER_SSNIT_COMPONENTS.includes(
          entry.tax_component as (typeof EMPLOYER_SSNIT_COMPONENTS)[number],
        ),
      )
    ) {
      // Orphan recovery: employer legs cleared without cash but ESSNIT still Accrued.
      cashAmount = roundCurrency(
        cashAmount + (Number(essnit.amount) || 0),
      );
    }
  }

  if (kind === "vat" && cashAmount <= 0) {
    return empty(
      null,
      `No net VAT payable for ${periodLabel} (output ≤ input). Nothing remitted.`,
    );
  }

  // Employer legs may remain open after Mark as Paid if tax clear failed —
  // clear them without posting remittance cash when ESSNIT is already Paid.
  if (cashAmount <= 0) {
    if (kind === "ssnit" && employerCashSkipped && candidates.length > 0) {
      let essnitAligned: RemitTaxForPeriodResult["essnitAligned"] = null;
      try {
        essnitAligned = await alignEssnitExpenseForSsnitRemit(
          supabase,
          tenantId,
          periodMonth,
        );
      } catch (err) {
        return empty(
          err instanceof Error
            ? err.message
            : "ESSNIT alignment failed while clearing already-paid employer legs.",
        );
      }

      const remittedOn = todayIsoDate();
      const nowIso = new Date().toISOString();
      const results = await Promise.all(
        candidates.map((entry) =>
          supabase
            .from("tax_ledger_entries")
            .update({
              status: REMITTED_STATUS,
              remitted_at: remittedOn,
              notes: appendRemittedNote(entry.notes, new Date(remittedOn)),
              updated_at: nowIso,
            })
            .eq("id", entry.id)
            .eq("tenant_id", tenantId)
            .eq("status", "open"),
        ),
      );

      const firstLegError = results.find((result) => result.error)?.error;
      if (firstLegError) {
        return empty(
          `Tax Ledger clear failed for already-paid employer SSNIT: ${firstLegError.message}`,
        );
      }

      return {
        error: null,
        kind,
        periodMonth,
        legsCleared: candidates.length,
        cashAmount: 0,
        expenseReceiptNo: null,
        expenseInserted: false,
        essnitAligned,
        dueDateAdvanced: false,
        message: `Cleared ${candidates.length} open employer SSNIT leg(s) for ${periodLabel} with no additional cash (Employer SSNIT already Paid via Expense Register).`,
      };
    }

    return empty(
      null,
      `Open ${label} legs for ${periodLabel} sum to zero. Nothing remitted.`,
    );
  }

  const receiptNo = buildRemitExpenseReceiptNo(kind, periodMonth);

  const { data: existingExpense, error: existingError } = await supabase
    .from("expense_register")
    .select("id, payment_status, amount")
    .eq("tenant_id", tenantId)
    .eq("receipt_no", receiptNo)
    .maybeSingle();

  if (existingError) {
    return empty(
      `Remittance expense lookup failed: ${existingError.message}`,
    );
  }

  if (existingExpense && isPaidStatus(existingExpense.payment_status)) {
    return empty(
      `Remittance already posted for ${label} ${periodLabel} (${receiptNo}).`,
    );
  }

  let expenseInserted = false;
  if (existingExpense) {
    const { error: updateExpenseError } = await supabase
      .from("expense_register")
      .update({
        date: periodEndDate(periodMonth),
        expense_category: STATUTORY_REMITTANCE_EXPENSE_CATEGORY,
        sub_category: STATUTORY_REMITTANCE_SUB_CATEGORY,
        description: `${label} remittance for ${periodLabel}`,
        vendor: vendorForKind(kind),
        price: cashAmount,
        quantity: 1,
        amount: cashAmount,
        payment_method: STATUTORY_REMITTANCE_PAYMENT_METHOD,
        payment_status: PAYROLL_EXPENSE_PAYMENT_STATUS_PAID,
        approved_by: "System",
        notes: `Tax Ledger remit-for-period (${kind})`,
      })
      .eq("id", existingExpense.id)
      .eq("tenant_id", tenantId);

    if (updateExpenseError) {
      return empty(
        `Failed to update remittance expense: ${updateExpenseError.message}`,
      );
    }
  } else {
    const { error: insertError } = await supabase.from("expense_register").insert({
      tenant_id: tenantId,
      date: periodEndDate(periodMonth),
      expense_category: STATUTORY_REMITTANCE_EXPENSE_CATEGORY,
      sub_category: STATUTORY_REMITTANCE_SUB_CATEGORY,
      description: `${label} remittance for ${periodLabel}`,
      vendor: vendorForKind(kind),
      price: cashAmount,
      quantity: 1,
      amount: cashAmount,
      payment_method: STATUTORY_REMITTANCE_PAYMENT_METHOD,
      approved_by: "System",
      receipt_no: receiptNo,
      payment_status: PAYROLL_EXPENSE_PAYMENT_STATUS_PAID,
      notes: `Tax Ledger remit-for-period (${kind})`,
      business_unit_id: params.businessUnitId ?? null,
    });

    if (insertError) {
      return empty(
        `Failed to post remittance cash: ${insertError.message}`,
      );
    }
    expenseInserted = true;
  }

  let essnitAligned: RemitTaxForPeriodResult["essnitAligned"] = null;
  if (kind === "ssnit") {
    try {
      essnitAligned = await alignEssnitExpenseForSsnitRemit(
        supabase,
        tenantId,
        periodMonth,
      );
    } catch (err) {
      return {
        ...empty(
          err instanceof Error
            ? err.message
            : "ESSNIT alignment failed after cash post.",
        ),
        cashAmount,
        expenseReceiptNo: receiptNo,
        expenseInserted,
      };
    }
  }

  const remittedOn = todayIsoDate();
  const nowIso = new Date().toISOString();
  const results = await Promise.all(
    candidates.map((entry) =>
      supabase
        .from("tax_ledger_entries")
        .update({
          status: REMITTED_STATUS,
          remitted_at: remittedOn,
          notes: appendRemittedNote(entry.notes, new Date(remittedOn)),
          updated_at: nowIso,
        })
        .eq("id", entry.id)
        .eq("tenant_id", tenantId)
        .eq("status", "open"),
    ),
  );

  const firstLegError = results.find((result) => result.error)?.error;
  if (firstLegError) {
    return {
      ...empty(
        `Cash posted (${receiptNo}), but Tax Ledger clear failed: ${firstLegError.message}`,
      ),
      cashAmount,
      expenseReceiptNo: receiptNo,
      expenseInserted,
      essnitAligned,
    };
  }

  const remittedIds = new Set(candidates.map((entry) => entry.id));
  const remainingOpenQuery = await supabase
    .from("tax_ledger_entries")
    .select("status, tax_component")
    .eq("tenant_id", tenantId)
    .eq("status", "open");

  const remainingOpen =
    (remainingOpenQuery.data as Array<{
      status: TaxLedgerStatus;
      tax_component: TaxLedgerComponent;
    }> | null) ?? [];

  // Prefer in-memory remaining when we have a full entry list from the UI.
  const remainingFromParams = params.entries
    ? params.entries.filter(
        (entry) =>
          entry.tenant_id === tenantId &&
          entry.status === "open" &&
          !remittedIds.has(entry.id),
      )
    : remainingOpen;

  const dueDatePatch = buildRemittanceDueDatePatch(
    settings,
    candidates.map((entry) => entry.tax_component),
    remainingFromParams,
  );

  let dueDateAdvanced = false;
  if (Object.keys(dueDatePatch).length > 0) {
    const { error: advanceError } = await scopeTaxSettingsRead(
      supabase
        .from("tax_settings")
        .update(dueDatePatch)
        .eq("tenant_id", tenantId),
      params.businessUnitId ?? null,
    );

    if (advanceError) {
      return {
        error: `Remitted ${candidates.length} ${label} leg(s) and posted cash ${cashAmount.toFixed(2)}, but due-date advance failed: ${advanceError.message}`,
        kind,
        periodMonth,
        legsCleared: candidates.length,
        cashAmount,
        expenseReceiptNo: receiptNo,
        expenseInserted,
        essnitAligned,
        dueDateAdvanced: false,
        message: null,
      };
    }
    dueDateAdvanced = true;
  }

  const essnitNote =
    essnitAligned === "settled"
      ? " Accrued Employer SSNIT expense marked Settled (No Cash Impact)."
      : essnitAligned === "already_paid"
        ? employerCashSkipped
          ? " Employer SSNIT already Paid — remittance cash is employee (and any non-employer) legs only; open employer legs cleared without extra cash."
          : " Employer SSNIT expense already Paid — remittance cash is for remaining open legs only."
        : "";

  return {
    error: null,
    kind,
    periodMonth,
    legsCleared: candidates.length,
    cashAmount,
    expenseReceiptNo: receiptNo,
    expenseInserted,
    essnitAligned,
    dueDateAdvanced,
    message: `Remitted ${label} for ${periodLabel}: cleared ${candidates.length} leg(s), Cash Position outflow ${cashAmount.toFixed(2)} (${receiptNo}).${essnitNote}${dueDateAdvanced ? " Next due date advanced." : ""}`,
  };
}

export type PaidRemitExpense = {
  id: string;
  receiptNo: string;
  amount: number;
  paymentStatus: string | null;
};

export type UndoRemitTaxForPeriodResult = {
  error: string | null;
  kind: RemitTaxKind;
  periodMonth: string;
  legsReopened: number;
  cashAmountReversed: number;
  expenseReceiptNo: string | null;
  expenseDeleted: boolean;
  essnitRestored: "accrued" | "left_paid" | "left_other" | "none" | null;
  message: string | null;
};

export function remitKindFromReceiptNo(
  receiptNo: string | null | undefined,
): RemitTaxKind | null {
  const normalized = (receiptNo ?? "").trim().toUpperCase();
  if (normalized.startsWith("TAX-REMIT-SSNIT-")) return "ssnit";
  if (normalized.startsWith("TAX-REMIT-PAYE-")) return "paye";
  if (normalized.startsWith("TAX-REMIT-VAT-")) return "vat";
  if (normalized.startsWith("TAX-REMIT-WHT-")) return "wht";
  return null;
}

/**
 * Locate a Paid TAX-REMIT-* expense for the period/kind (tenant-scoped).
 */
export async function findPaidRemitExpense(
  supabase: SupabaseClient,
  params: {
    tenantId: string;
    periodMonth: string;
    kind: RemitTaxKind;
  },
): Promise<PaidRemitExpense | null> {
  const periodMonth = params.periodMonth.slice(0, 10);
  const receiptNo = buildRemitExpenseReceiptNo(params.kind, periodMonth);

  const { data, error } = await supabase
    .from("expense_register")
    .select("id, receipt_no, amount, payment_status")
    .eq("tenant_id", params.tenantId)
    .eq("receipt_no", receiptNo)
    .maybeSingle();

  if (error) {
    throw new Error(`Remittance expense lookup failed: ${error.message}`);
  }

  if (!data || !isPaidStatus(data.payment_status)) {
    return null;
  }

  return {
    id: data.id as string,
    receiptNo: (data.receipt_no as string) ?? receiptNo,
    amount: Number(data.amount) || 0,
    paymentStatus: (data.payment_status as string | null) ?? null,
  };
}

async function restoreEssnitAfterSsnitUndo(
  supabase: SupabaseClient,
  tenantId: string,
  periodMonth: string,
): Promise<UndoRemitTaxForPeriodResult["essnitRestored"]> {
  const periodKey =
    payrollMonthToPeriodKey(periodMonth.slice(0, 10)) ??
    periodMonth.slice(0, 7);
  const receiptNo = buildPayrollExpenseReceiptNo("ESSNIT", periodKey);

  const { data: essnit, error } = await supabase
    .from("expense_register")
    .select("id, payment_status")
    .eq("tenant_id", tenantId)
    .eq("receipt_no", receiptNo)
    .maybeSingle();

  if (error) {
    throw new Error(`ESSNIT restore lookup failed: ${error.message}`);
  }

  if (!essnit) {
    return "none";
  }

  // Mark as Paid posted Cash Position independently — never reverse that cash.
  if (isPaidStatus(essnit.payment_status)) {
    return "left_paid";
  }

  if (!isSettledNoCashImpactStatus(essnit.payment_status)) {
    return "left_other";
  }

  const { error: updateError } = await supabase
    .from("expense_register")
    .update({
      payment_status: PAYROLL_EXPENSE_PAYMENT_STATUS_ACCRUED,
    })
    .eq("id", essnit.id)
    .eq("tenant_id", tenantId);

  if (updateError) {
    throw new Error(`ESSNIT restore update failed: ${updateError.message}`);
  }

  return "accrued";
}

/**
 * Undo remit-for-period: delete Paid TAX-REMIT cash, reopen remitted legs,
 * and (SSNIT) restore Settled ESSNIT → Accrued when remit caused Settled.
 * Never reverses Mark-as-Paid ESSNIT cash. Tenant-scoped and idempotent.
 */
export async function undoRemitTaxForPeriod(
  supabase: SupabaseClient,
  params: {
    tenantId: string;
    periodMonth: string;
    kind: RemitTaxKind;
    readScope?: BusinessUnitReadScope;
    viewAllBusinessUnits?: boolean;
  },
): Promise<UndoRemitTaxForPeriodResult> {
  const { tenantId, kind } = params;
  const periodMonth = params.periodMonth.slice(0, 10);
  const label = REMIT_TAX_KIND_LABEL[kind];
  const periodLabel = formatPeriodMonthLabel(periodMonth);
  const empty = (
    error: string | null,
    message: string | null = null,
  ): UndoRemitTaxForPeriodResult => ({
    error,
    kind,
    periodMonth,
    legsReopened: 0,
    cashAmountReversed: 0,
    expenseReceiptNo: null,
    expenseDeleted: false,
    essnitRestored: null,
    message,
  });

  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodMonth)) {
    return empty("Invalid period month.");
  }

  if (!tenantId.trim()) {
    return empty("Tenant is required.");
  }

  if (
    params.viewAllBusinessUnits === true ||
    params.readScope?.mode === "all"
  ) {
    return empty(REMIT_REQUIRES_SCOPED_BU_MESSAGE);
  }

  const readScope: BusinessUnitReadScope = params.readScope ?? {
    mode: "default",
  };

  let paidExpense: PaidRemitExpense | null;
  try {
    paidExpense = await findPaidRemitExpense(supabase, {
      tenantId,
      periodMonth,
      kind,
    });
  } catch (err) {
    return empty(
      err instanceof Error ? err.message : "Remittance expense lookup failed.",
    );
  }

  const receiptNo = buildRemitExpenseReceiptNo(kind, periodMonth);

  if (!paidExpense) {
    return empty(
      null,
      `No Paid ${label} remittance (${receiptNo}) for ${periodLabel} to undo.`,
    );
  }

  // Decide SSNIT leg reopen scope before deleting cash (Mark-as-Paid guard).
  let leaveEmployerLegsRemitted = false;
  if (kind === "ssnit") {
    const periodKey =
      payrollMonthToPeriodKey(periodMonth) ?? periodMonth.slice(0, 7);
    const essnitReceipt = buildPayrollExpenseReceiptNo("ESSNIT", periodKey);
    const { data: essnit } = await supabase
      .from("expense_register")
      .select("id, payment_status")
      .eq("tenant_id", tenantId)
      .eq("receipt_no", essnitReceipt)
      .maybeSingle();

    if (essnit && isPaidStatus(essnit.payment_status)) {
      leaveEmployerLegsRemitted = true;
    }
  }

  const cashAmount = roundCurrency(paidExpense.amount);

  const { error: deleteError } = await supabase
    .from("expense_register")
    .delete()
    .eq("id", paidExpense.id)
    .eq("tenant_id", tenantId);

  if (deleteError) {
    return empty(
      `Failed to delete remittance cash (${receiptNo}): ${deleteError.message}`,
    );
  }

  let essnitRestored: UndoRemitTaxForPeriodResult["essnitRestored"] = null;
  if (kind === "ssnit") {
    try {
      essnitRestored = await restoreEssnitAfterSsnitUndo(
        supabase,
        tenantId,
        periodMonth,
      );
    } catch (err) {
      return {
        ...empty(
          err instanceof Error
            ? err.message
            : "ESSNIT restore failed after remittance cash delete.",
        ),
        cashAmountReversed: cashAmount,
        expenseReceiptNo: receiptNo,
        expenseDeleted: true,
      };
    }
  }

  const components = leaveEmployerLegsRemitted
    ? componentsForRemitKind(kind).filter(
        (component) =>
          !EMPLOYER_SSNIT_COMPONENTS.includes(
            component as (typeof EMPLOYER_SSNIT_COMPONENTS)[number],
          ),
      )
    : [...componentsForRemitKind(kind)];

  let remittedQuery = applyBusinessUnitScope(
    supabase
      .from("tax_ledger_entries")
      .select("id, notes")
      .eq("tenant_id", tenantId)
      .eq("period_month", periodMonth)
      .eq("status", REMITTED_STATUS)
      .in("tax_component", components),
    readScope,
  );

  if (kind === "wht") {
    remittedQuery = remittedQuery.eq("direction", "wht_payable");
  }

  const { data: remittedLegs, error: remittedError } = await remittedQuery;

  if (remittedError) {
    return {
      ...empty(
        `Remittance cash deleted (${receiptNo}), but Tax Ledger lookup failed: ${remittedError.message}`,
      ),
      cashAmountReversed: cashAmount,
      expenseReceiptNo: receiptNo,
      expenseDeleted: true,
      essnitRestored,
    };
  }

  const legs =
    (remittedLegs as Array<{ id: string; notes: string | null }> | null) ?? [];
  const nowIso = new Date().toISOString();

  const results = await Promise.all(
    legs.map((leg) =>
      supabase
        .from("tax_ledger_entries")
        .update({
          status: "open" satisfies TaxLedgerStatus,
          remitted_at: null,
          notes: stripRemittedNote(leg.notes),
          updated_at: nowIso,
        })
        .eq("id", leg.id)
        .eq("tenant_id", tenantId)
        .eq("status", REMITTED_STATUS),
    ),
  );

  const firstLegError = results.find((result) => result.error)?.error;
  if (firstLegError) {
    return {
      ...empty(
        `Remittance cash deleted (${receiptNo}), but reopening Tax Ledger legs failed: ${firstLegError.message}`,
      ),
      cashAmountReversed: cashAmount,
      expenseReceiptNo: receiptNo,
      expenseDeleted: true,
      essnitRestored,
      legsReopened: 0,
    };
  }

  const essnitNote =
    essnitRestored === "accrued"
      ? " Employer SSNIT expense restored to Accrued - Not Yet Paid."
      : essnitRestored === "left_paid"
        ? " Employer SSNIT Mark-as-Paid cash left intact (employer remitted legs unchanged)."
        : "";

  return {
    error: null,
    kind,
    periodMonth,
    legsReopened: legs.length,
    cashAmountReversed: cashAmount,
    expenseReceiptNo: receiptNo,
    expenseDeleted: true,
    essnitRestored,
    message: `Undid ${label} remit for ${periodLabel}: deleted Cash Position outflow ${cashAmount.toFixed(2)} (${receiptNo}), reopened ${legs.length} leg(s).${essnitNote}`,
  };
}
