import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyBusinessUnitScope,
  type BusinessUnitReadScope,
} from "@/utils/business-unit-view";
import { scopeToBusinessUnitId } from "@/utils/phase5e-key-structure";
import { latestGraRemittanceLedgerDate } from "./gra-reconciliation-ledger";
import {
  buildRemitExpenseReceiptNo,
  type RemitTaxKind,
} from "./tax-ledger-remit";
import type { VatReturnPeriod } from "./tax-utils";
import {
  formatDate,
  TAX_LEDGER_SELECT,
  normalizeTaxLedgerEntry,
  type TaxLedgerEntry,
} from "./tax-ledger-utils";
import {
  OBLIGATION_KIND_LABELS,
  todayAccraIsoDate,
  type GraReconciliationKind,
} from "./statutory-due-rules";

export type GraPenaltyRecordingMode = "paid" | "unpaid";

export type GraPenaltyDialogDefaults = {
  date: string;
  paymentMethod: string | null;
  dateDefaultNote: string;
  /** Where the remitted-path date came from (for reporting). */
  remittanceDateSource:
    | "expense_register.date"
    | "tax_ledger_entries.remitted_at"
    | "due_date_plus_one"
    | "fallback_today";
};

function addCalendarDay(isoDate: string): string {
  const parsed = Date.parse(`${isoDate.slice(0, 10)}T12:00:00.000Z`);
  return new Date(parsed + 86_400_000).toISOString().slice(0, 10);
}

function latestIsoDate(
  left: string | null | undefined,
  right: string | null | undefined,
): string | null {
  const a = left?.slice(0, 10) ?? null;
  const b = right?.slice(0, 10) ?? null;
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  return a >= b ? a : b;
}

function businessUnitReadScope(
  businessUnitId: string | null,
): BusinessUnitReadScope {
  if (businessUnitId) {
    return { mode: "unit", id: businessUnitId };
  }
  return { mode: "default" };
}

export async function resolveGraPenaltyDialogDefaults(options: {
  supabase: SupabaseClient;
  tenantId: string;
  businessUnitId: string | null;
  periodMonth: string;
  kind: GraReconciliationKind;
  dueDateIso: string;
  hasRemittedLedgerActivity: boolean;
  vatReturnPeriod: VatReturnPeriod;
  recordingMode: GraPenaltyRecordingMode;
  todayIso?: string;
}): Promise<GraPenaltyDialogDefaults> {
  const kindLabel = OBLIGATION_KIND_LABELS[options.kind];
  const todayIso = options.todayIso ?? todayAccraIsoDate();

  if (options.recordingMode === "unpaid") {
    const date = addCalendarDay(options.dueDateIso);
    return {
      date,
      paymentMethod: null,
      dateDefaultNote: `Defaulted to the day after the due date (${formatDate(date)}). Creates Accounts Payable to GRA plus a matching accrual expense.`,
      remittanceDateSource: "due_date_plus_one",
    };
  }

  if (!options.hasRemittedLedgerActivity) {
    return {
      date: todayIso,
      paymentMethod: null,
      dateDefaultNote: `Defaulted to today (${formatDate(todayIso)}) as the payment date.`,
      remittanceDateSource: "fallback_today",
    };
  }

  const remitKind = options.kind as RemitTaxKind;
  const receiptNo = buildRemitExpenseReceiptNo(remitKind, options.periodMonth);

  let expenseQuery = options.supabase
    .from("expense_register")
    .select("date, payment_method, payment_status")
    .eq("tenant_id", options.tenantId)
    .eq("receipt_no", receiptNo);

  expenseQuery = scopeToBusinessUnitId(
    expenseQuery,
    options.businessUnitId,
  );

  const { data: remitExpense, error: expenseError } =
    await expenseQuery.maybeSingle();

  if (expenseError) {
    console.error(
      "[gra-penalty-dialog-defaults] remittance expense lookup failed:",
      expenseError.message,
    );
  }

  let ledgerQuery = applyBusinessUnitScope(
    options.supabase
      .from("tax_ledger_entries")
      .select(TAX_LEDGER_SELECT)
      .eq("tenant_id", options.tenantId)
      .in("status", ["paid", "filed"]),
    businessUnitReadScope(options.businessUnitId),
  );

  const { data: ledgerRows, error: ledgerError } = await ledgerQuery;

  if (ledgerError) {
    console.error(
      "[gra-penalty-dialog-defaults] tax ledger lookup failed:",
      ledgerError.message,
    );
  }

  const ledgerEntries =
    (ledgerRows as TaxLedgerEntry[] | null)?.map((row) =>
      normalizeTaxLedgerEntry(row),
    ) ?? [];

  const ledgerRemittedAt = latestGraRemittanceLedgerDate(
    ledgerEntries,
    options.kind,
    options.periodMonth,
    options.vatReturnPeriod,
  );

  const expenseDate =
    remitExpense?.date != null
      ? String(remitExpense.date).slice(0, 10)
      : null;

  let remittanceDate = latestIsoDate(expenseDate, ledgerRemittedAt);
  let remittanceDateSource: GraPenaltyDialogDefaults["remittanceDateSource"] =
    "fallback_today";

  if (
    remittanceDate &&
    expenseDate &&
    (!ledgerRemittedAt || expenseDate >= ledgerRemittedAt)
  ) {
    remittanceDateSource = "expense_register.date";
  } else if (remittanceDate && ledgerRemittedAt) {
    remittanceDateSource = "tax_ledger_entries.remitted_at";
  } else if (remittanceDate && expenseDate) {
    remittanceDateSource = "expense_register.date";
  }

  if (!remittanceDate) {
    remittanceDate = todayIso;
    remittanceDateSource = "fallback_today";
  }

  const paymentMethodFromRemit =
    remitExpense &&
    typeof remitExpense.payment_method === "string" &&
    remitExpense.payment_method.trim()
      ? remitExpense.payment_method.trim()
      : null;

  return {
    date: remittanceDate,
    paymentMethod: paymentMethodFromRemit,
    dateDefaultNote: `Defaulted to the ${kindLabel} remittance date (${formatDate(remittanceDate)})`,
    remittanceDateSource,
  };
}
