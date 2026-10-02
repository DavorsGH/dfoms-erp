import { todayAccraIsoDate } from "@/app/dashboard/finance/statutory-due-rules";
import {
  billingMonthStartFromDate,
  roundMoney,
  toNumber,
  type SupplierContractAmendmentRow,
} from "@/utils/supplier-contracts-types";

export function billingMonthEndFromStart(billingMonthStart: string): string {
  const [year, month] = billingMonthStart.slice(0, 10).split("-").map(Number);
  const end = new Date(Date.UTC(year, month, 0));
  return end.toISOString().slice(0, 10);
}

export function daysInCalendarMonth(billingMonthStart: string): number {
  const [year, month] = billingMonthStart.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function inclusiveCalendarDaysBetween(
  startIso: string,
  endIso: string,
): number {
  const start = startIso.slice(0, 10);
  const end = endIso.slice(0, 10);
  const startMs = Date.parse(`${start}T12:00:00.000Z`);
  const endMs = Date.parse(`${end}T12:00:00.000Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return 0;
  }
  return Math.round((endMs - startMs) / 86_400_000) + 1;
}

export function resolveMonthlyAmountAsOfDate(
  amendments: Array<
    Pick<SupplierContractAmendmentRow, "effective_date" | "new_monthly_amount">
  >,
  asOfIso: string,
): number {
  const asOf = asOfIso.slice(0, 10);
  const eligible = amendments
    .filter((row) => String(row.effective_date).slice(0, 10) <= asOf)
    .sort((a, b) =>
      String(b.effective_date).slice(0, 10).localeCompare(
        String(a.effective_date).slice(0, 10),
      ),
    );
  return roundMoney(toNumber(eligible[0]?.new_monthly_amount ?? 0));
}

export function firstBillableDayOfBillingWindow(
  billingMonthStart: string,
  contractStartDate: string,
): string {
  const monthStart = billingMonthStart.slice(0, 10);
  const start = contractStartDate.slice(0, 10);
  return start > monthStart ? start : monthStart;
}

export function resolveMonthlyAmountForBillingMonth(
  amendments: Array<
    Pick<SupplierContractAmendmentRow, "effective_date" | "new_monthly_amount">
  >,
  billingMonthStart: string,
  contractStartDate: string,
): number {
  const amountAsOf = firstBillableDayOfBillingWindow(
    billingMonthStart,
    contractStartDate,
  );
  return resolveMonthlyAmountAsOfDate(amendments, amountAsOf);
}

export function supplierContractStartMonthBillingRunPassed(
  startDate: string,
  todayAccra = todayAccraIsoDate(),
): boolean {
  const monthStart = billingMonthStartFromDate(startDate);
  return todayAccra.slice(0, 10) > monthStart;
}

export type SupplierContractProRatedBill = {
  grossBeforeWht: number;
  descriptionSuffix: string | null;
  billableDays: number;
  daysInMonth: number;
  periodStart: string;
  periodEnd: string;
};

export function computeSupplierContractProRatedBill(options: {
  monthlyAmount: number;
  billingMonthStart: string;
  contractStartDate: string;
  contractEndDate: string;
}): SupplierContractProRatedBill {
  const billingMonthStart = options.billingMonthStart.slice(0, 10);
  const monthEnd = billingMonthEndFromStart(billingMonthStart);
  const daysInMonth = daysInCalendarMonth(billingMonthStart);
  const startDate = options.contractStartDate.slice(0, 10);
  const endDate = options.contractEndDate.slice(0, 10);

  let periodStart = billingMonthStart;
  let periodEnd = monthEnd;

  if (
    startDate > billingMonthStart &&
    startDate.slice(0, 7) === billingMonthStart.slice(0, 7)
  ) {
    periodStart = startDate;
  }

  if (
    endDate < monthEnd &&
    endDate.slice(0, 7) === billingMonthStart.slice(0, 7)
  ) {
    periodEnd = endDate;
  }

  const billableDays = inclusiveCalendarDaysBetween(periodStart, periodEnd);
  const monthly = roundMoney(toNumber(options.monthlyAmount));

  if (billableDays <= 0 || monthly <= 0) {
    return {
      grossBeforeWht: 0,
      descriptionSuffix: null,
      billableDays,
      daysInMonth,
      periodStart,
      periodEnd,
    };
  }

  if (periodStart === billingMonthStart && periodEnd === monthEnd) {
    return {
      grossBeforeWht: monthly,
      descriptionSuffix: null,
      billableDays,
      daysInMonth,
      periodStart,
      periodEnd,
    };
  }

  const grossBeforeWht = roundMoney((monthly * billableDays) / daysInMonth);
  const formatShort = (iso: string) => {
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    const monthNames = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    return `${d} ${monthNames[m - 1]} ${y}`;
  };

  const descriptionSuffix = `Pro-rated ${formatShort(periodStart)}–${formatShort(periodEnd)} (${billableDays} of ${daysInMonth} days)`;

  return {
    grossBeforeWht,
    descriptionSuffix,
    billableDays,
    daysInMonth,
    periodStart,
    periodEnd,
  };
}
