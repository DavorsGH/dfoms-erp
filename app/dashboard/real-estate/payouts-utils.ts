export type RemittanceStatus = "pending" | "remitted";

export type EscrowEntryType = "collection" | "fee_deduction" | "remittance";

export type PayoutListRow = {
  payoutId: string;
  tenantId: string;
  periodStart: string;
  periodEnd: string;
  grossAmountGhs: number;
  managementFeeGhs: number | null;
  netAmountGhs: number;
  remittanceStatus: RemittanceStatus;
  remittanceDate: string | null;
  remittanceReference: string | null;
  createdAt: string;
};

export const REMITTANCE_STATUS_OPTIONS: Array<{
  value: RemittanceStatus;
  label: string;
}> = [
  { value: "pending", label: "Pending" },
  { value: "remitted", label: "Remitted" },
];

export function formatRemittanceStatus(
  value: string | null | undefined,
): string {
  if (!value) {
    return "—";
  }
  const match = REMITTANCE_STATUS_OPTIONS.find(
    (option) => option.value === value,
  );
  return match?.label ?? value.replace(/_/g, " ");
}

export function formatPayoutMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) {
    return "—";
  }
  return `GHS ${Number(value).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatPayoutDate(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatPayoutPeriod(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  if (!start || !end) {
    return "—";
  }
  return `${formatPayoutDate(start)} – ${formatPayoutDate(end)}`;
}

export function isRemittanceStatus(value: string): value is RemittanceStatus {
  return value === "pending" || value === "remitted";
}

export function roundPayoutMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
