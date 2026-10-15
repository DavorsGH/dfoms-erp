import {
  parseAccountsPayableIdFromAccrualReceiptNo,
} from "../finance/accounts-payable-accrual-utils";
import { formatGHS } from "../finance/income-register-utils";
import {
  supplierNamesMatch,
  type VendorSupplierOption,
} from "../finance/vendor-select-utils";
import type {
  ExpenseLinkOption,
  PayableLinkOption,
} from "./consumables-store-data";

export type ConsumablePurchaseLinkChoice = {
  key: string;
  type: "expense" | "payable";
  id: string;
  date: string;
  amount: number;
  label: string;
  searchText: string;
  matchesSupplier: boolean;
};

function matchesSelectedSupplier(
  selectedSupplierId: string,
  selectedSupplierName: string,
  supplierId: string | null | undefined,
  vendorName: string | null | undefined,
): boolean {
  if (!selectedSupplierId) {
    return false;
  }
  if (supplierId && supplierId === selectedSupplierId) {
    return true;
  }
  if (selectedSupplierName && vendorName) {
    return supplierNamesMatch(vendorName, selectedSupplierName);
  }
  return false;
}

function formatLinkLabel(input: {
  date: string;
  reference: string;
  vendor: string;
  amount: number;
  kind: "Expense" | "Bill";
}): string {
  const day = input.date.slice(0, 10);
  const ref = input.reference.trim() || "—";
  const vendor = input.vendor.trim() || "—";
  return `${day} · ${ref} · ${vendor} · ${formatGHS(input.amount)} · ${input.kind}`;
}

function payableChoice(
  row: PayableLinkOption,
  selectedSupplierId: string,
  selectedSupplierName: string,
  supplierId?: string | null,
): ConsumablePurchaseLinkChoice {
  const vendor = row.vendor_name?.trim() || "—";
  const reference = row.invoice_number?.trim() || "—";
  const label = formatLinkLabel({
    date: row.invoice_date,
    reference,
    vendor,
    amount: row.amount,
    kind: "Bill",
  });
  return {
    key: `payable:${row.id}`,
    type: "payable",
    id: row.id,
    date: row.invoice_date,
    amount: row.amount,
    label,
    searchText: label.toLowerCase(),
    matchesSupplier: matchesSelectedSupplier(
      selectedSupplierId,
      selectedSupplierName,
      supplierId ?? null,
      vendor,
    ),
  };
}

function expenseChoice(
  row: ExpenseLinkOption,
  selectedSupplierId: string,
  selectedSupplierName: string,
): ConsumablePurchaseLinkChoice {
  const vendor = row.vendor?.trim() || row.vendor_label?.trim() || "—";
  const reference = row.receipt_no?.trim() || "—";
  const label = formatLinkLabel({
    date: row.date,
    reference,
    vendor,
    amount: row.amount,
    kind: "Expense",
  });
  return {
    key: `expense:${row.id}`,
    type: "expense",
    id: row.id,
    date: row.date,
    amount: row.amount,
    label,
    searchText: label.toLowerCase(),
    matchesSupplier: matchesSelectedSupplier(
      selectedSupplierId,
      selectedSupplierName,
      null,
      vendor,
    ),
  };
}

export function buildConsumablePurchaseLinkChoices(
  expenses: ExpenseLinkOption[],
  payables: PayableLinkOption[],
  suppliers: VendorSupplierOption[],
  selectedSupplierId: string,
): {
  fromSupplier: ConsumablePurchaseLinkChoice[];
  other: ConsumablePurchaseLinkChoice[];
} {
  const payableById = new Map(payables.map((row) => [row.id, row]));
  const selectedSupplierName =
    suppliers.find((row) => row.id === selectedSupplierId)?.name ?? "";
  const emittedPayableIds = new Set<string>();
  const merged: ConsumablePurchaseLinkChoice[] = [];

  for (const row of payables) {
    emittedPayableIds.add(row.id);
    merged.push(
      payableChoice(row, selectedSupplierId, selectedSupplierName, null),
    );
  }

  for (const row of expenses) {
    const accrualPayableId = parseAccountsPayableIdFromAccrualReceiptNo(
      row.receipt_no,
    );
    if (accrualPayableId) {
      if (emittedPayableIds.has(accrualPayableId)) {
        continue;
      }
      const payable = payableById.get(accrualPayableId);
      if (payable) {
        emittedPayableIds.add(accrualPayableId);
        merged.push(
          payableChoice(
            payable,
            selectedSupplierId,
            selectedSupplierName,
            null,
          ),
        );
      } else {
        emittedPayableIds.add(accrualPayableId);
        const vendor = row.vendor?.trim() || "—";
        const label = formatLinkLabel({
          date: row.date,
          reference: "—",
          vendor,
          amount: row.amount,
          kind: "Bill",
        });
        merged.push({
          key: `payable:${accrualPayableId}`,
          type: "payable",
          id: accrualPayableId,
          date: row.date,
          amount: row.amount,
          label,
          searchText: label.toLowerCase(),
          matchesSupplier: matchesSelectedSupplier(
            selectedSupplierId,
            selectedSupplierName,
            null,
            vendor,
          ),
        });
      }
      continue;
    }
    merged.push(expenseChoice(row, selectedSupplierId, selectedSupplierName));
  }

  merged.sort((left, right) => right.date.localeCompare(left.date));

  const fromSupplier = merged.filter((row) => row.matchesSupplier);
  const other = merged.filter((row) => !row.matchesSupplier);
  return { fromSupplier, other };
}

export function formatConsumableMovementPurchaseLabel(input: {
  kind: "expense" | "payable";
  receiptNo?: string | null;
  vendor?: string | null;
  invoiceNumber?: string | null;
  vendorName?: string | null;
}): string {
  if (input.kind === "payable") {
    const invoice = input.invoiceNumber?.trim() || "—";
    const vendor = input.vendorName?.trim() || "—";
    return `Bill ${invoice} · ${vendor}`;
  }
  const receipt = input.receiptNo?.trim() || "—";
  const vendor = input.vendor?.trim() || "—";
  return `${receipt} · ${vendor}`;
}
