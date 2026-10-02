import {
  formatDate,
  formatGHS,
} from "@/app/dashboard/finance/income-register-utils";
import { formatDaysSinceLastActivity } from "@/app/dashboard/crm/customers/customer-360-utils";
import { getRemainingPayableBalance } from "@/app/dashboard/finance/accounts-payable-utils";
import { parseAccountsPayableIdFromAccrualReceiptNo } from "@/app/dashboard/finance/accounts-payable-accrual-utils";
import { isCashPaymentMethod } from "@/app/dashboard/inventory/inventory-balance-sheet-utils";
import {
  EXPENSE_PAYMENT_STATUS_SETTLED_NO_CASH,
  PAYROLL_EXPENSE_PAYMENT_METHOD_ACCRUAL,
  PAYROLL_EXPENSE_PAYMENT_STATUS_ACCRUED,
} from "@/app/dashboard/hr-payroll/payroll-lock-finance-utils";
import { roundMoney, toNumber } from "@/utils/client-invoices-types";
import { calculatePurchaseOrderTotal } from "@/utils/purchase-orders-types";
import type { SupplierRow } from "@/utils/suppliers-types";

export { formatDaysSinceLastActivity, formatGHS, formatDate };

export function vendorNameMatchesSupplier(
  supplierName: string,
  vendorText: string | null | undefined,
): boolean {
  const left = supplierName.trim().toLowerCase();
  const right = (vendorText ?? "").trim().toLowerCase();
  return left.length > 0 && left === right;
}

export function supplier360ProductPurchaseViewHref(purchaseId: string): string {
  return `/dashboard/inventory/product-purchases?productPurchaseId=${encodeURIComponent(purchaseId)}`;
}

export function supplier360RawMaterialPurchaseViewHref(
  purchaseId: string,
): string {
  return `/dashboard/inventory/raw-materials?rawMaterialPurchaseId=${encodeURIComponent(purchaseId)}`;
}

export function supplier360PurchaseOrderViewHref(purchaseOrderId: string): string {
  return `/dashboard/inventory/purchase-orders/${encodeURIComponent(purchaseOrderId)}`;
}

export function supplier360AccountsPayableViewHref(
  accountsPayableId: string,
): string {
  return `/dashboard/finance/accounts-payable?apId=${encodeURIComponent(accountsPayableId)}`;
}

export function supplier360ExpenseViewHref(expenseId: string): string {
  return `/dashboard/finance/expenses?expenseId=${encodeURIComponent(expenseId)}`;
}

export function supplier360SupplierContractViewHref(contractId: string): string {
  return `/dashboard/finance/supplier-contracts/${encodeURIComponent(contractId)}`;
}

export function supplier360FixedAssetViewHref(assetId: string): string {
  return `/dashboard/finance/fixed-assets?assetId=${encodeURIComponent(assetId)}`;
}

export function supplierStatusBadgeClassName(isActive: boolean): string {
  return isActive
    ? "bg-emerald-100 text-emerald-800"
    : "bg-slate-200 text-slate-700";
}

/** Suppliers-only roles (inventory-tier). */
export type Supplier360PurchasingSummary = {
  totalPurchased: number;
  daysSinceLastActivity: number | null;
};

/** Full Finance roles — market-standard supplier spend cards. */
export type Supplier360FinanceSummary = {
  totalSpentYtd: number;
  totalSpentAllTime: number;
  outstanding: number;
  overdue: number;
  daysSinceLastActivity: number | null;
};

export type Supplier360Summary =
  | ({ kind: "purchasing" } & Supplier360PurchasingSummary)
  | ({ kind: "finance" } & Supplier360FinanceSummary);

export type Supplier360ProductPurchase = {
  id: string;
  purchase_date: string;
  total_cost: number;
  batch_number: string | null;
  product_label: string;
  payment_method: string;
  accounts_payable_id: string | null;
};

export type Supplier360RawMaterialPurchase = {
  id: string;
  purchase_date: string;
  total_cost: number;
  material_label: string;
  supplier: string | null;
  payment_method: string | null;
  accounts_payable_id: string | null;
};

export type Supplier360PurchaseOrder = {
  id: string;
  po_number: string;
  order_date: string;
  status: string;
  total: number;
};

export type Supplier360Payable = {
  id: string;
  invoice_number: string | null;
  invoice_date: string;
  due_date: string | null;
  amount: number;
  amount_paid: number;
  balance_due: number;
  vendor_name: string | null;
};

export type Supplier360ApPayment = {
  accounts_payable_id: string;
  payment_date: string;
  amount: number;
};

export type Supplier360Expense = {
  id: string;
  date: string;
  receipt_no: string | null;
  amount: number;
  vendor: string | null;
  expense_category: string | null;
  payment_method: string | null;
  payment_status: string | null;
};

export type Supplier360Contract = {
  id: string;
  contract_number: string;
  status: string;
  start_date: string;
  end_date: string | null;
};

export type Supplier360FixedAsset = {
  asset_id: string;
  asset_name: string;
  purchase_date: string | null;
  total_cost: number;
  vendor_name: string | null;
  payment_method: string | null;
  accounts_payable_id: string | null;
};

export type Supplier360SectionKey =
  | "purchases"
  | "purchaseOrders"
  | "payables"
  | "expenses"
  | "contracts"
  | "fixedAssets";

export type Supplier360SectionErrors = Partial<
  Record<Supplier360SectionKey, string>
>;

export const SUPPLIER_360_SECTION_LOAD_ERROR =
  "We couldn't load this section. Try refreshing the page, or contact support if it continues.";

/** Logs DB detail server-side; returns a user-safe message. */
export function reportSupplier360QueryError(
  section: Supplier360SectionKey,
  message: string | undefined | null,
): string | undefined {
  if (!message?.trim()) {
    return undefined;
  }
  console.error(`[Supplier360:${section}]`, message);
  return SUPPLIER_360_SECTION_LOAD_ERROR;
}

export const SUPPLIER_360_TABS_PURCHASING_ONLY = [
  { id: "purchases", label: "Purchases" },
  { id: "purchase-orders", label: "Purchase Orders" },
] as const;

export const SUPPLIER_360_TABS_FULL = [
  ...SUPPLIER_360_TABS_PURCHASING_ONLY,
  { id: "accounts-payable", label: "Accounts Payable" },
  { id: "expenses", label: "Expenses" },
  { id: "supplier-contracts", label: "Supplier Contracts" },
  { id: "fixed-assets", label: "Fixed Assets" },
] as const;

/** @deprecated Use getSupplier360Tabs(showFinanceDetails) */
export const SUPPLIER_360_TABS = SUPPLIER_360_TABS_FULL;

export type Supplier360TabId =
  | (typeof SUPPLIER_360_TABS_PURCHASING_ONLY)[number]["id"]
  | (typeof SUPPLIER_360_TABS_FULL)[number]["id"];

export function getSupplier360Tabs(showFinanceDetails: boolean) {
  return showFinanceDetails
    ? SUPPLIER_360_TABS_FULL
    : SUPPLIER_360_TABS_PURCHASING_ONLY;
}

export const SUPPLIER_360_PRODUCT_PURCHASE_SELECT =
  "id, purchase_date, total_cost, batch_number, payment_method, accounts_payable_id, product:product_id(product_code, product_name)" as const;

export const SUPPLIER_360_RAW_MATERIAL_PURCHASE_SELECT =
  "id, purchase_date, total_cost, supplier, payment_method, accounts_payable_id, material:material_id(material_code, material_name)" as const;

export const SUPPLIER_360_PURCHASE_ORDER_SELECT =
  "id, po_number, order_date, status, items:purchase_order_items(quantity_ordered, unit_cost)" as const;

export const SUPPLIER_360_PAYABLE_SELECT =
  "id, invoice_number, invoice_date, due_date, amount, amount_paid, balance_due, vendor_name" as const;

export const SUPPLIER_360_AP_PAYMENT_SELECT =
  "accounts_payable_id, payment_date, amount" as const;

export const SUPPLIER_360_EXPENSE_SELECT =
  "id, date, receipt_no, amount, vendor, expense_category, payment_method, payment_status" as const;

export const SUPPLIER_360_CONTRACT_SELECT =
  "id, contract_number, status, start_date, end_date" as const;

export const SUPPLIER_360_FIXED_ASSET_SELECT =
  "asset_id, asset_name, purchase_date, total_cost, vendor_name, payment_method, accounts_payable_id" as const;

export function normalizeSupplier360ProductPurchase(
  row: Record<string, unknown>,
): Supplier360ProductPurchase {
  const product = Array.isArray(row.product)
    ? row.product[0]
    : row.product;
  const productRecord = (product ?? {}) as Record<string, unknown>;
  const code = String(productRecord.product_code ?? "").trim();
  const name = String(productRecord.product_name ?? "").trim();
  const product_label =
    code && name ? `${code} — ${name}` : name || code || "—";

  return {
    id: String(row.id),
    purchase_date: String(row.purchase_date ?? "").slice(0, 10),
    total_cost: toNumber(row.total_cost),
    batch_number:
      typeof row.batch_number === "string" ? row.batch_number : null,
    product_label,
    payment_method: String(row.payment_method ?? ""),
    accounts_payable_id:
      row.accounts_payable_id == null || row.accounts_payable_id === ""
        ? null
        : String(row.accounts_payable_id),
  };
}

export function normalizeSupplier360RawMaterialPurchase(
  row: Record<string, unknown>,
): Supplier360RawMaterialPurchase {
  const material = Array.isArray(row.material)
    ? row.material[0]
    : row.material;
  const materialRecord = (material ?? {}) as Record<string, unknown>;
  const code = String(materialRecord.material_code ?? "").trim();
  const name = String(materialRecord.material_name ?? "").trim();
  const material_label =
    code && name ? `${code} — ${name}` : name || code || "—";

  return {
    id: String(row.id),
    purchase_date: String(row.purchase_date ?? "").slice(0, 10),
    total_cost: toNumber(row.total_cost),
    material_label,
    supplier: typeof row.supplier === "string" ? row.supplier : null,
    payment_method:
      typeof row.payment_method === "string" ? row.payment_method : null,
    accounts_payable_id:
      row.accounts_payable_id == null || row.accounts_payable_id === ""
        ? null
        : String(row.accounts_payable_id),
  };
}

export function normalizeSupplier360PurchaseOrder(
  row: Record<string, unknown>,
): Supplier360PurchaseOrder {
  const itemsRaw = row.items;
  const items = (Array.isArray(itemsRaw) ? itemsRaw : []).map((item) => {
    const record = (item ?? {}) as Record<string, unknown>;
    return {
      quantity_ordered: Number(record.quantity_ordered) || 0,
      unit_cost: Number(record.unit_cost) || 0,
    };
  });

  return {
    id: String(row.id),
    po_number: String(row.po_number ?? "—"),
    order_date: String(row.order_date ?? "").slice(0, 10),
    status: String(row.status ?? "—"),
    total: calculatePurchaseOrderTotal(items),
  };
}

export function normalizeSupplier360Payable(
  row: Record<string, unknown>,
): Supplier360Payable {
  return {
    id: String(row.id),
    invoice_number:
      typeof row.invoice_number === "string" ? row.invoice_number : null,
    invoice_date: String(row.invoice_date ?? "").slice(0, 10),
    due_date:
      row.due_date == null || row.due_date === ""
        ? null
        : String(row.due_date).slice(0, 10),
    amount: toNumber(row.amount),
    amount_paid: toNumber(row.amount_paid),
    balance_due: toNumber(row.balance_due),
    vendor_name: typeof row.vendor_name === "string" ? row.vendor_name : null,
  };
}

export function normalizeSupplier360Expense(
  row: Record<string, unknown>,
): Supplier360Expense {
  return {
    id: String(row.id),
    date: String(row.date ?? "").slice(0, 10),
    receipt_no: typeof row.receipt_no === "string" ? row.receipt_no : null,
    amount: toNumber(row.amount),
    vendor: typeof row.vendor === "string" ? row.vendor : null,
    expense_category:
      typeof row.expense_category === "string" ? row.expense_category : null,
    payment_method:
      typeof row.payment_method === "string" ? row.payment_method : null,
    payment_status:
      typeof row.payment_status === "string" ? row.payment_status : null,
  };
}

export function normalizeSupplier360ApPayment(
  row: Record<string, unknown>,
): Supplier360ApPayment {
  return {
    accounts_payable_id: String(row.accounts_payable_id),
    payment_date: String(row.payment_date ?? "").slice(0, 10),
    amount: toNumber(row.amount),
  };
}

function isExpenseRegisterPaidStatus(
  paymentStatus: string | null | undefined,
): boolean {
  return (paymentStatus ?? "").trim().toLowerCase() === "paid";
}

/** P&L accrual mirror of an AP bill — cash is counted via accounts_payable_payments. */
export function isSupplier360ExpenseLinkedToAccountsPayable(
  expense: Pick<
    Supplier360Expense,
    "receipt_no" | "payment_method" | "payment_status"
  >,
): boolean {
  if (parseAccountsPayableIdFromAccrualReceiptNo(expense.receipt_no)) {
    return true;
  }
  const method = (expense.payment_method ?? "").trim().toLowerCase();
  if (method === PAYROLL_EXPENSE_PAYMENT_METHOD_ACCRUAL.toLowerCase()) {
    return true;
  }
  const status = (expense.payment_status ?? "").trim();
  if (
    status === PAYROLL_EXPENSE_PAYMENT_STATUS_ACCRUED ||
    status === EXPENSE_PAYMENT_STATUS_SETTLED_NO_CASH
  ) {
    return true;
  }
  return false;
}

/** Settled in cash/bank/MoMo — not via supplier AP bill. */
export function isSupplier360DirectCashPurchase(input: {
  accounts_payable_id: string | null;
  payment_method: string | null;
}): boolean {
  if (input.accounts_payable_id) {
    return false;
  }
  return isCashPaymentMethod(input.payment_method);
}

function calendarYearFromDateString(dateStr: string): number | null {
  const year = Number.parseInt(dateStr.slice(0, 4), 10);
  return Number.isFinite(year) ? year : null;
}

function sumAmountsInCalendarYear(
  rows: { date: string; amount: number }[],
  year: number,
): number {
  return rows.reduce((sum, row) => {
    if (calendarYearFromDateString(row.date) === year) {
      return sum + row.amount;
    }
    return sum;
  }, 0);
}

export function computeSupplier360DaysSinceLastActivity(input: {
  productPurchaseDates: string[];
  rawMaterialPurchaseDates: string[];
  purchaseOrderDates: string[];
  expenseDates: string[];
  contractDates: string[];
  fixedAssetDates: string[];
  payableInvoiceDates: string[];
}): number | null {
  const timestamps = [
    ...input.productPurchaseDates,
    ...input.rawMaterialPurchaseDates,
    ...input.purchaseOrderDates,
    ...input.expenseDates,
    ...input.contractDates,
    ...input.fixedAssetDates,
    ...input.payableInvoiceDates,
  ]
    .filter(Boolean)
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value));

  if (timestamps.length === 0) {
    return null;
  }
  const latest = Math.max(...timestamps);
  return Math.floor((Date.now() - latest) / (1000 * 60 * 60 * 24));
}

export function computeSupplier360PurchasingSummary(input: {
  productPurchases: Supplier360ProductPurchase[];
  rawMaterialPurchases: Supplier360RawMaterialPurchase[];
  productPurchaseDates: string[];
  rawMaterialPurchaseDates: string[];
  purchaseOrderDates: string[];
}): Supplier360PurchasingSummary {
  const totalProduct = input.productPurchases.reduce(
    (sum, row) => sum + row.total_cost,
    0,
  );
  const totalRaw = input.rawMaterialPurchases.reduce(
    (sum, row) => sum + row.total_cost,
    0,
  );

  return {
    totalPurchased: roundMoney(totalProduct + totalRaw),
    daysSinceLastActivity: computeSupplier360DaysSinceLastActivity({
      productPurchaseDates: input.productPurchaseDates,
      rawMaterialPurchaseDates: input.rawMaterialPurchaseDates,
      purchaseOrderDates: input.purchaseOrderDates,
      expenseDates: [],
      contractDates: [],
      fixedAssetDates: [],
      payableInvoiceDates: [],
    }),
  };
}

export function computeSupplier360FinanceSummary(input: {
  productPurchases: Supplier360ProductPurchase[];
  rawMaterialPurchases: Supplier360RawMaterialPurchase[];
  fixedAssets: Supplier360FixedAsset[];
  payables: Supplier360Payable[];
  apPayments: Supplier360ApPayment[];
  expenses: Supplier360Expense[];
  productPurchaseDates: string[];
  rawMaterialPurchaseDates: string[];
  purchaseOrderDates: string[];
  expenseDates: string[];
  contractDates: string[];
  fixedAssetDates: string[];
  /** Calendar year for YTD Total Spent (defaults to current UTC year). */
  calendarYear?: number;
}): Supplier360FinanceSummary {
  const year = input.calendarYear ?? new Date().getFullYear();
  const payableIds = new Set(input.payables.map((row) => row.id));

  const apPaymentRows = input.apPayments
    .filter((row) => payableIds.has(row.accounts_payable_id))
    .map((row) => ({ date: row.payment_date, amount: row.amount }));

  const expenseCashRows = input.expenses
    .filter(
      (row) =>
        isExpenseRegisterPaidStatus(row.payment_status) &&
        !isSupplier360ExpenseLinkedToAccountsPayable(row),
    )
    .map((row) => ({ date: row.date, amount: row.amount }));

  const directPurchaseRows = [
    ...input.productPurchases
      .filter((row) =>
        isSupplier360DirectCashPurchase({
          accounts_payable_id: row.accounts_payable_id,
          payment_method: row.payment_method,
        }),
      )
      .map((row) => ({ date: row.purchase_date, amount: row.total_cost })),
    ...input.rawMaterialPurchases
      .filter((row) =>
        isSupplier360DirectCashPurchase({
          accounts_payable_id: row.accounts_payable_id,
          payment_method: row.payment_method,
        }),
      )
      .map((row) => ({ date: row.purchase_date, amount: row.total_cost })),
  ];

  const directFixedAssetRows = input.fixedAssets
    .filter(
      (row) =>
        row.purchase_date &&
        isSupplier360DirectCashPurchase({
          accounts_payable_id: row.accounts_payable_id,
          payment_method: row.payment_method,
        }),
    )
    .map((row) => ({
      date: row.purchase_date as string,
      amount: row.total_cost,
    }));

  const allSpentRows = [
    ...apPaymentRows,
    ...expenseCashRows,
    ...directPurchaseRows,
    ...directFixedAssetRows,
  ];

  const totalSpentAllTime = roundMoney(
    allSpentRows.reduce((sum, row) => sum + row.amount, 0),
  );
  const totalSpentYtd = roundMoney(
    sumAmountsInCalendarYear(allSpentRows, year),
  );

  let outstanding = 0;
  let overdue = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (const payable of input.payables) {
    const balance = getRemainingPayableBalance(payable);
    outstanding += balance;
    if (payable.due_date && payable.due_date < today && balance > 0) {
      overdue += balance;
    }
  }

  return {
    totalSpentYtd,
    totalSpentAllTime,
    outstanding: roundMoney(outstanding),
    overdue: roundMoney(overdue),
    daysSinceLastActivity: computeSupplier360DaysSinceLastActivity({
      productPurchaseDates: input.productPurchaseDates,
      rawMaterialPurchaseDates: input.rawMaterialPurchaseDates,
      purchaseOrderDates: input.purchaseOrderDates,
      expenseDates: input.expenseDates,
      contractDates: input.contractDates,
      fixedAssetDates: input.fixedAssetDates,
      payableInvoiceDates: input.payables.map((row) => row.invoice_date),
    }),
  };
}

export function normalizeSupplier360Contract(
  row: Record<string, unknown>,
): Supplier360Contract {
  return {
    id: String(row.id),
    contract_number: String(row.contract_number ?? "—"),
    status: String(row.status ?? "—"),
    start_date: String(row.start_date ?? "").slice(0, 10),
    end_date:
      row.end_date == null ? null : String(row.end_date).slice(0, 10),
  };
}

export function normalizeSupplier360FixedAsset(
  row: Record<string, unknown>,
): Supplier360FixedAsset {
  return {
    asset_id: String(row.asset_id),
    asset_name: String(row.asset_name ?? "—"),
    purchase_date:
      row.purchase_date == null
        ? null
        : String(row.purchase_date).slice(0, 10),
    total_cost: toNumber(row.total_cost),
    vendor_name: typeof row.vendor_name === "string" ? row.vendor_name : null,
    payment_method:
      typeof row.payment_method === "string" ? row.payment_method : null,
    accounts_payable_id:
      row.accounts_payable_id == null || row.accounts_payable_id === ""
        ? null
        : String(row.accounts_payable_id),
  };
}

export type Supplier360Data = {
  supplier: SupplierRow;
  summary: Supplier360Summary;
  productPurchases: Supplier360ProductPurchase[];
  rawMaterialPurchases: Supplier360RawMaterialPurchase[];
  purchaseOrders: Supplier360PurchaseOrder[];
  payables: Supplier360Payable[];
  expenses: Supplier360Expense[];
  contracts: Supplier360Contract[];
  fixedAssets: Supplier360FixedAsset[];
};
