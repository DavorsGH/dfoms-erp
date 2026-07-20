export const PAYMENT_ACCOUNT_SELECT =
  "id, tenant_id, account_name, bank_name, bank_account_number, momo_provider, momo_number, momo_merchant_name, momo_merchant_id, is_active, created_at, updated_at" as const;

export type PaymentAccountRow = {
  id: string;
  tenant_id: string;
  account_name: string;
  bank_name: string | null;
  bank_account_number: string | null;
  momo_provider: string | null;
  momo_number: string | null;
  momo_merchant_name: string | null;
  momo_merchant_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type PaymentAccountInput = {
  account_name?: string;
  bank_name?: string | null;
  bank_account_number?: string | null;
  momo_provider?: string | null;
  momo_number?: string | null;
  momo_merchant_name?: string | null;
  momo_merchant_id?: string | null;
  is_active?: boolean;
};

export type PaymentAccountUpdateBody = PaymentAccountInput & {
  id: string;
};

export type PaymentAccountDeleteBody = {
  id: string;
};

export function emptyPaymentAccountForm() {
  return {
    account_name: "",
    bank_name: "",
    bank_account_number: "",
    momo_provider: "",
    momo_number: "",
    momo_merchant_name: "",
    momo_merchant_id: "",
    is_active: true,
  };
}

export function paymentAccountToForm(row: PaymentAccountRow) {
  return {
    account_name: row.account_name,
    bank_name: row.bank_name ?? "",
    bank_account_number: row.bank_account_number ?? "",
    momo_provider: row.momo_provider ?? "",
    momo_number: row.momo_number ?? "",
    momo_merchant_name: row.momo_merchant_name ?? "",
    momo_merchant_id: row.momo_merchant_id ?? "",
    is_active: row.is_active,
  };
}

export function trimPaymentAccountInput(input: PaymentAccountInput) {
  return {
    account_name: (input.account_name ?? "").trim(),
    bank_name: (input.bank_name ?? "").trim() || null,
    bank_account_number: (input.bank_account_number ?? "").trim() || null,
    momo_provider: (input.momo_provider ?? "").trim() || null,
    momo_number: (input.momo_number ?? "").trim() || null,
    momo_merchant_name: (input.momo_merchant_name ?? "").trim() || null,
    momo_merchant_id: (input.momo_merchant_id ?? "").trim() || null,
    is_active: input.is_active ?? true,
  };
}

export function validatePaymentAccountInput(input: PaymentAccountInput): string | null {
  const trimmed = trimPaymentAccountInput(input);

  if (!trimmed.account_name) {
    return "Account name is required.";
  }

  return null;
}

export function paymentAccountContactWarning(input: PaymentAccountInput): string | null {
  const trimmed = trimPaymentAccountInput(input);

  if (!trimmed.bank_account_number && !trimmed.momo_number) {
    return "Consider adding a bank account number or MoMo number so clients know how to pay.";
  }

  return null;
}
