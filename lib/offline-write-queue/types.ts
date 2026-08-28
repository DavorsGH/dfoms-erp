export type OfflineWriteQueueType =
  | "attendance"
  | "expense"
  | "pos_cash_sale";

export type OfflineWriteQueueStatus =
  | "pending"
  | "syncing"
  | "failed"
  | "synced"
  | "conflict";

export type AttendanceQueuePayload = {
  date: string;
  staff_id: string;
  employment_type: string | null;
  project_assignment: string | null;
  clock_in: string | null;
  clock_out: string | null;
  hours_worked: number | null;
  overtime_hours: number | null;
  attendance_status: string;
  /** Optional display label for pending rows in the UI. */
  staff_name?: string | null;
};

export type ExpenseQueuePayload = {
  date: string;
  expense_category: string;
  sub_category: string;
  description: string | null;
  vendor: string;
  price: number;
  quantity: number;
  amount: number;
  payment_method: string;
  approved_by: string;
  /** User-supplied receipt; empty means allocate EXP# at sync time. */
  supplied_receipt_no: string;
  payment_status: string;
  gross_before_wht: number;
  wht_rate: number | null;
  wht_amount: number;
  input_vat_amount: number;
  net_of_tax_amount: number;
  notes: string | null;
  project_id?: string | null;
  /** Tax ledger fields for syncPurchaseTaxLedger replay. */
  wht_rate_pct: number | null;
  input_tax_component: "vat_bundle" | "vfrs" | null;
  notification_detail: string;
};

export type PosCashSaleQueueLine = {
  productId: string;
  productCode: string;
  productName: string;
  unitOfMeasure: string;
  quantity: number;
  unitPrice: number;
};

export type PosCashSaleQueuePayload = {
  saleDate: string;
  clientId: string | null;
  customerName: string | null;
  salesRepId: string | null;
  paymentMethod: "Cash";
  amountReceived: number;
  notes: string | null;
  /** Provisional offline token — not a tax invoice. */
  provisionalToken: string;
  lines: PosCashSaleQueueLine[];
  /** Set when sync parks the item as a server conflict. */
  conflictId?: string | null;
  suspenseInvoiceNo?: string | null;
};

export type OfflineWriteQueuePayload =
  | AttendanceQueuePayload
  | ExpenseQueuePayload
  | PosCashSaleQueuePayload;

export type OfflineWriteQueueItem = {
  /** Client-generated UUID — idempotency key. */
  id: string;
  type: OfflineWriteQueueType;
  payload: OfflineWriteQueuePayload;
  tenantId: string;
  authUid: string;
  /** Indexed session scope: `${tenantId}:${authUid}` */
  sessionKey: string;
  createdAt: string;
  status: OfflineWriteQueueStatus;
  retryCount: number;
  lastError: string | null;
  syncedAt: string | null;
  /** Expense/POS: avoid re-firing admin notification on retry. */
  notificationSent?: boolean;
};

export function buildWriteQueueSessionKey(
  tenantId: string,
  authUid: string,
): string {
  return `${tenantId}:${authUid}`;
}
