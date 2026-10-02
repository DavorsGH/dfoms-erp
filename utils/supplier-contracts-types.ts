import { todayAccraIsoDate } from "@/app/dashboard/finance/statutory-due-rules";
import { formatInvoiceDate, formatInvoiceMoney, roundMoney, toNumber } from "@/utils/client-invoices-types";
import {
  firstBillableDayOfBillingWindow,
  resolveMonthlyAmountAsOfDate,
  resolveMonthlyAmountForBillingMonth,
} from "@/utils/supplier-contract-billing";

export { formatInvoiceDate, formatInvoiceMoney, roundMoney, toNumber };

export const SUPPLIER_CONTRACT_ENTITY_TYPE = "SPC" as const;
export const SUPPLIER_CONTRACT_SOURCE_TYPE = "supplier_contract" as const;

export const SUPPLIER_CONTRACT_STATUSES = [
  "draft",
  "active",
  "expired",
  "terminated",
] as const;
export type SupplierContractStatus = (typeof SUPPLIER_CONTRACT_STATUSES)[number];

export const SUPPLIER_AGREEMENT_TYPES = ["written", "verbal"] as const;
export type SupplierAgreementType = (typeof SUPPLIER_AGREEMENT_TYPES)[number];

export const SUPPLIER_CONTRACT_LIST_AMENDMENT_EMBED =
  "supplier_contract_amendments(effective_date, new_monthly_amount)" as const;

export const SUPPLIER_CONTRACT_LIST_SELECT =
  `id, tenant_id, business_unit_id, supplier_id, supplier_name, contract_number, contract_sequence, agreement_type, start_date, end_date, auto_renew, status, expense_category, sub_category, wht_rate, next_billing_date, mid_month_reminder_enabled, mid_month_reminder_day, credit_balance, created_at, ${SUPPLIER_CONTRACT_LIST_AMENDMENT_EMBED}` as const;

export type SupplierContractListAmendmentEmbed = Pick<
  SupplierContractAmendmentRow,
  "effective_date" | "new_monthly_amount"
>;

export type SupplierContractListDbRow = Omit<
  SupplierContractListRow,
  "current_monthly_amount"
> & {
  supplier_contract_amendments?: SupplierContractListAmendmentEmbed[] | null;
};

export const SUPPLIER_CONTRACT_HEADER_SELECT =
  "id, tenant_id, business_unit_id, supplier_id, supplier_name, contract_number, contract_sequence, agreement_type, document_url, start_date, end_date, auto_renew, status, expense_category, sub_category, wht_rate, next_billing_date, mid_month_reminder_enabled, mid_month_reminder_day, credit_balance, notes, created_at, updated_at" as const;

export type SupplierContractAmendmentRow = {
  id: string;
  tenant_id: string;
  contract_id: string;
  effective_date: string;
  previous_monthly_amount: number | null;
  new_monthly_amount: number;
  change_reason: string;
  document_url: string | null;
  created_at: string;
  created_by: string | null;
};

export type SupplierContractDeductionRow = {
  id: string;
  contract_id: string;
  service_date: string;
  billing_month: string;
  accounts_payable_id: string | null;
  replacement_expense_id: string | null;
  replacement_name: string;
  deduction_amount: number;
  amount_applied: number;
  amount_carried_forward: number;
  notes: string | null;
  created_at: string;
};

export type SupplierContractListRow = {
  id: string;
  tenant_id: string;
  business_unit_id: string | null;
  supplier_id: string;
  supplier_name: string;
  contract_number: string;
  contract_sequence: number;
  agreement_type: SupplierAgreementType;
  start_date: string;
  end_date: string;
  auto_renew: boolean;
  status: SupplierContractStatus;
  expense_category: string;
  sub_category: string;
  wht_rate: number;
  next_billing_date: string | null;
  mid_month_reminder_enabled: boolean;
  mid_month_reminder_day: number;
  credit_balance: number;
  created_at: string;
  /** Current billing month amount from amendments; null when none exist. */
  current_monthly_amount: number | null;
  /** List/detail label; may show upcoming amount before first effective amendment. */
  current_monthly_amount_display: string;
};

/** Active contract row from header select (cron/AP — no list amount). */
export type SupplierContractApContractRow = Omit<
  SupplierContractListRow,
  "current_monthly_amount" | "current_monthly_amount_display"
> & { notes?: string | null };

export type SupplierContractWriteBody = {
  supplier_id: string;
  agreement_type: SupplierAgreementType;
  document_url?: string | null;
  start_date: string;
  end_date: string;
  auto_renew?: boolean;
  status?: SupplierContractStatus;
  expense_category: string;
  sub_category: string;
  wht_rate?: number;
  initial_monthly_amount: number;
  next_billing_date?: string | null;
  mid_month_reminder_enabled?: boolean;
  mid_month_reminder_day?: number;
  notes?: string | null;
  business_unit_id?: string | null;
};

export type SupplierContractAmendmentWriteBody = {
  effective_date: string;
  new_monthly_amount: number;
  change_reason: string;
  document_url?: string | null;
};

export function normalizeSupplierContractStatus(
  value: string | null | undefined,
): SupplierContractStatus {
  const normalized = String(value ?? "draft").trim().toLowerCase();
  if (SUPPLIER_CONTRACT_STATUSES.includes(normalized as SupplierContractStatus)) {
    return normalized as SupplierContractStatus;
  }
  return "draft";
}

export function formatSupplierContractStatus(status: SupplierContractStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export type SupplierContractDisplayStatus =
  | "Draft"
  | "Active"
  | "Renewal Due"
  | "Expired"
  | "Terminated";

export function resolveSupplierContractDisplayStatus(input: {
  status: SupplierContractStatus | string;
  end_date: string;
  reference?: Date;
}): SupplierContractDisplayStatus {
  const status = normalizeSupplierContractStatus(input.status);
  if (status === "active" && isSupplierContractRenewalDue(input.end_date, 30, input.reference)) {
    return "Renewal Due";
  }
  switch (status) {
    case "active":
      return "Active";
    case "expired":
      return "Expired";
    case "terminated":
      return "Terminated";
    default:
      return "Draft";
  }
}

export function supplierContractDisplayStatusBadgeClassName(
  displayStatus: SupplierContractDisplayStatus,
): string {
  switch (displayStatus) {
    case "Active":
      return "border-green-200 bg-green-50 text-green-800";
    case "Renewal Due":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "Expired":
      return "border-slate-200 bg-slate-100 text-slate-700";
    case "Terminated":
      return "border-red-200 bg-red-50 text-red-800";
    default:
      return "border-amber-200 bg-amber-50 text-amber-900";
  }
}

export function supplierContractStatusBadgeClassName(
  status: SupplierContractStatus,
): string {
  return supplierContractDisplayStatusBadgeClassName(
    resolveSupplierContractDisplayStatus({ status, end_date: "" }),
  );
}

export type SupplierContractSettingsPatch = {
  status?: SupplierContractStatus | string;
  end_date?: string;
  auto_renew?: boolean;
  mid_month_reminder_enabled?: boolean;
  mid_month_reminder_day?: number;
  notes?: string | null;
  business_unit_id?: string | null;
};

export function isSupplierContractRenewalDue(
  endDate: string,
  withinDays = 30,
  reference = new Date(),
): boolean {
  const end = new Date(endDate);
  if (Number.isNaN(end.getTime())) {
    return false;
  }
  const ref = new Date(reference);
  ref.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  const diffMs = end.getTime() - ref.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= withinDays;
}

export function billingMonthStartFromDate(dateStr: string): string {
  const d = dateStr.slice(0, 10);
  return `${d.slice(0, 7)}-01`;
}

export {
  firstBillableDayOfBillingWindow,
  resolveMonthlyAmountAsOfDate,
  resolveMonthlyAmountForBillingMonth,
};

/** Latest amendment with effective_date <= asOf (Africa/Accra today by default). */
export function resolveSupplierContractCurrentMonthlyAmount(
  _contract: Pick<SupplierContractListRow, "next_billing_date">,
  amendments: SupplierContractListAmendmentEmbed[],
  referenceIso?: string,
): number {
  const asOf = referenceIso?.trim()?.slice(0, 10) ?? todayAccraIsoDate();
  return resolveMonthlyAmountAsOfDate(amendments, asOf);
}

function formatSupplierContractUpcomingAmountDate(isoDate: string): string {
  const date = new Date(`${isoDate.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return isoDate.slice(0, 10);
  }
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Earliest amendment with effective_date strictly after asOf (Africa/Accra today). */
export function resolveNextSupplierContractMonthlyAmendment(
  amendments: SupplierContractListAmendmentEmbed[],
  referenceIso?: string,
): Pick<SupplierContractListAmendmentEmbed, "effective_date" | "new_monthly_amount"> | null {
  const asOf = referenceIso?.trim()?.slice(0, 10) ?? todayAccraIsoDate();
  const sorted = [...amendments].sort((a, b) =>
    String(a.effective_date).slice(0, 10).localeCompare(
      String(b.effective_date).slice(0, 10),
    ),
  );
  const next = sorted.find(
    (row) => String(row.effective_date).slice(0, 10) > asOf,
  );
  return next ?? null;
}

/** Display-only: current amount, or upcoming amount before any amendment is effective. */
export function formatSupplierContractCurrentMonthlyAmountDisplay(
  amendments: SupplierContractListAmendmentEmbed[],
  referenceIso?: string,
): string {
  if (amendments.length === 0) {
    return "—";
  }
  const current = resolveSupplierContractCurrentMonthlyAmount(
    { next_billing_date: null },
    amendments,
    referenceIso,
  );
  if (current > 0) {
    return formatInvoiceMoney(current);
  }
  const upcoming = resolveNextSupplierContractMonthlyAmendment(
    amendments,
    referenceIso,
  );
  if (upcoming && toNumber(upcoming.new_monthly_amount) > 0) {
    const effective = String(upcoming.effective_date).slice(0, 10);
    return `${formatInvoiceMoney(upcoming.new_monthly_amount)} from ${formatSupplierContractUpcomingAmountDate(effective)}`;
  }
  return formatInvoiceMoney(current);
}

export function formatSupplierContractApInvoiceNumber(
  contractNumber: string,
  billingMonthStart: string,
): string {
  const ym = billingMonthStart.slice(0, 7);
  return `${contractNumber}-${ym}`;
}

export function validateSupplierContractBody(
  body: SupplierContractWriteBody,
): string | null {
  if (!body.supplier_id?.trim()) {
    return "Supplier is required.";
  }
  if (!body.start_date || !body.end_date) {
    return "Start and end dates are required.";
  }
  if (body.end_date < body.start_date) {
    return "End date must be on or after start date.";
  }
  if (!body.expense_category?.trim() || !body.sub_category?.trim()) {
    return "Category and sub-category are required.";
  }
  if (toNumber(body.initial_monthly_amount) <= 0) {
    return "Initial monthly amount must be greater than zero.";
  }
  if (
    body.agreement_type === "written" &&
    normalizeSupplierContractStatus(body.status) === "active" &&
    !body.document_url?.trim()
  ) {
    return "Written agreements require a document before activation.";
  }
  return null;
}

export function normalizeSupplierContractListRow(
  row: SupplierContractListDbRow,
): SupplierContractListRow {
  const amendments = row.supplier_contract_amendments ?? [];
  const current_monthly_amount =
    amendments.length === 0
      ? null
      : resolveSupplierContractCurrentMonthlyAmount(row, amendments);
  const current_monthly_amount_display =
    formatSupplierContractCurrentMonthlyAmountDisplay(amendments);

  const {
    supplier_contract_amendments: _amendments,
    wht_rate,
    credit_balance,
    contract_sequence,
    ...rest
  } = row;

  return {
    ...rest,
    wht_rate: toNumber(wht_rate),
    credit_balance: roundMoney(toNumber(credit_balance)),
    contract_sequence: toNumber(contract_sequence),
    current_monthly_amount,
    current_monthly_amount_display,
  };
}
