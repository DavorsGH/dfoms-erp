import type { VatReturnPeriod } from "./tax-utils";
import type { TaxLedgerBalanceSource } from "./tax-ledger-utils";
import { STATUTORY_DUE_KIND_COMPONENTS } from "./tax-ledger-utils";
import {
  type GraReconciliationKind,
  vatObligationPeriodKey,
} from "./statutory-due-rules";

export type GraRemittanceStatus =
  | "Open"
  | "Remitted"
  | "Partly remitted"
  | "None";

export type GraReconciliationLedgerBreakdown = {
  totalAmount: number;
  openAmount: number;
  remittedAmount: number;
  remittanceStatus: GraRemittanceStatus;
};

const GRA_LEDGER_STATUSES = new Set(["open", "paid", "filed"]);

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function periodKeyForKind(
  entry: TaxLedgerBalanceSource,
  kind: GraReconciliationKind,
  targetPeriodMonth: string,
  vatReturnPeriod: VatReturnPeriod,
): boolean {
  const key =
    kind === "vat"
      ? vatObligationPeriodKey(entry.period_month, vatReturnPeriod)
      : entry.period_month.slice(0, 10);
  return key === targetPeriodMonth.slice(0, 10);
}

function entryMatchesGraKind(
  entry: TaxLedgerBalanceSource,
  kind: GraReconciliationKind,
): boolean {
  if (entry.status === "reversed" || !GRA_LEDGER_STATUSES.has(entry.status)) {
    return false;
  }

  if (kind === "vat") {
    return entry.direction === "output" || entry.direction === "input";
  }

  const components = STATUTORY_DUE_KIND_COMPONENTS[kind];
  if (!components.includes(entry.tax_component)) {
    return false;
  }

  if (kind === "wht") {
    return entry.direction === "wht_payable";
  }

  return entry.direction === "statutory_payable";
}

function sumGraKindForStatus(
  entries: TaxLedgerBalanceSource[],
  kind: GraReconciliationKind,
  periodMonth: string,
  vatReturnPeriod: VatReturnPeriod,
  status: "open" | "remitted",
): number {
  let output = 0;
  let input = 0;
  let whtPayable = 0;
  let paye = 0;

  for (const entry of entries) {
    if (!periodKeyForKind(entry, kind, periodMonth, vatReturnPeriod)) {
      continue;
    }

    const isOpen = entry.status === "open";
    const isRemitted = entry.status === "paid" || entry.status === "filed";
    if (status === "open" && !isOpen) {
      continue;
    }
    if (status === "remitted" && !isRemitted) {
      continue;
    }

    const amount = Number(entry.tax_amount) || 0;

    if (kind === "vat") {
      if (!entryMatchesGraKind(entry, kind)) {
        continue;
      }
      if (entry.direction === "output") {
        output += amount;
      } else if (entry.direction === "input") {
        input += amount;
      }
      continue;
    }

    if (!entryMatchesGraKind(entry, kind)) {
      continue;
    }

    if (kind === "wht") {
      whtPayable += amount;
    } else if (kind === "paye") {
      paye += amount;
    }
  }

  if (kind === "vat") {
    return roundMoney(output - input);
  }
  if (kind === "wht") {
    return roundMoney(whtPayable);
  }
  return roundMoney(paye);
}

export function summarizeGraReconciliationLedger(
  entries: TaxLedgerBalanceSource[],
  kind: GraReconciliationKind,
  periodMonth: string,
  vatReturnPeriod: VatReturnPeriod,
): GraReconciliationLedgerBreakdown {
  const openAmount = sumGraKindForStatus(
    entries,
    kind,
    periodMonth,
    vatReturnPeriod,
    "open",
  );
  const remittedAmount = sumGraKindForStatus(
    entries,
    kind,
    periodMonth,
    vatReturnPeriod,
    "remitted",
  );
  const totalAmount = roundMoney(openAmount + remittedAmount);

  let remittanceStatus: GraRemittanceStatus = "None";
  if (openAmount !== 0 && remittedAmount !== 0) {
    remittanceStatus = "Partly remitted";
  } else if (openAmount !== 0) {
    remittanceStatus = "Open";
  } else if (remittedAmount !== 0) {
    remittanceStatus = "Remitted";
  }

  return {
    totalAmount,
    openAmount,
    remittedAmount,
    remittanceStatus,
  };
}

type GraRemittanceDateSource = TaxLedgerBalanceSource & {
  remitted_at?: string | null;
};

/** Latest `remitted_at` on paid/filed legs in scope for this GRA reconciliation kind/period. */
export function latestGraRemittanceLedgerDate(
  entries: GraRemittanceDateSource[],
  kind: GraReconciliationKind,
  periodMonth: string,
  vatReturnPeriod: VatReturnPeriod,
): string | null {
  let latest: string | null = null;

  for (const entry of entries) {
    if (entry.status !== "paid" && entry.status !== "filed") {
      continue;
    }
    if (!periodKeyForKind(entry, kind, periodMonth, vatReturnPeriod)) {
      continue;
    }
    if (!entryMatchesGraKind(entry, kind)) {
      continue;
    }
    const remittedAt = entry.remitted_at?.slice(0, 10) ?? null;
    if (remittedAt && (!latest || remittedAt > latest)) {
      latest = remittedAt;
    }
  }

  return latest;
}

export function formatGraLedgerStatusLabel(
  breakdown: GraReconciliationLedgerBreakdown,
): string {
  switch (breakdown.remittanceStatus) {
    case "Open":
      return "Open";
    case "Remitted":
      return "Remitted";
    case "Partly remitted":
      return `Partly remitted (open ${breakdown.openAmount.toFixed(2)}, remitted ${breakdown.remittedAmount.toFixed(2)})`;
    default:
      return "No ledger activity";
  }
}
