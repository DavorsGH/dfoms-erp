export type DividendDeclarationStatus =
  | "draft"
  | "declared"
  | "paid"
  | "cancelled";

export type ShareholderPaymentMethod = "bank" | "momo" | "cash" | "cheque";

export type TenantShareholderRow = {
  id: string;
  tenant_id: string;
  full_name: string;
  share_pct: number;
  staff_id: string | null;
  tin: string | null;
  payment_method: ShareholderPaymentMethod;
  momo_number: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  /** Set by shareholders list API (not stored on tenant_shareholders). */
  can_delete?: boolean;
};

export type DividendDeclarationRow = {
  id: string;
  tenant_id: string;
  business_unit_id: string;
  declaration_number: string;
  declaration_date: string;
  period_start: string;
  period_end: string;
  resolution_reference: string | null;
  resolution_notes: string | null;
  gross_amount: number;
  wht_rate_pct: number;
  wht_amount: number;
  net_amount: number;
  status: DividendDeclarationStatus;
  declared_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type DividendDeclarationLineRow = {
  id: string;
  tenant_id: string;
  declaration_id: string;
  shareholder_id: string | null;
  payee_name: string;
  tin: string | null;
  share_pct: number;
  gross_amount: number;
  wht_amount: number;
  net_amount: number;
  paid_amount: number;
  payment_date: string | null;
  payment_method: ShareholderPaymentMethod | null;
  payment_reference: string | null;
  created_at: string;
  updated_at: string;
};

export type DividendBalanceSheetDeclaration = Pick<
  DividendDeclarationRow,
  | "id"
  | "business_unit_id"
  | "status"
  | "declaration_date"
  | "gross_amount"
  | "net_amount"
>;

export type DividendBalanceSheetLine = Pick<
  DividendDeclarationLineRow,
  "declaration_id" | "paid_amount" | "payment_date" | "net_amount"
>;

export const TENANT_SHAREHOLDER_SELECT =
  "id, tenant_id, full_name, share_pct, staff_id, tin, payment_method, momo_number, bank_name, bank_account_number, is_active, created_at, updated_at";

export const DIVIDEND_DECLARATION_SELECT =
  "id, tenant_id, business_unit_id, declaration_number, declaration_date, period_start, period_end, resolution_reference, resolution_notes, gross_amount, wht_rate_pct, wht_amount, net_amount, status, declared_at, declared_by_auth_uid, paid_at, cancelled_at, cancelled_by_auth_uid, cancel_reason, created_at, updated_at";

export const DIVIDEND_LINE_SELECT =
  "id, tenant_id, declaration_id, shareholder_id, payee_name, tin, share_pct, gross_amount, wht_amount, net_amount, paid_amount, payment_date, payment_method, payment_reference, created_at, updated_at";

export const DIVIDEND_ENTITY_TYPE = "DIV";
