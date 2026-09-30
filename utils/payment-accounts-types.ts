export const PAYMENT_ACCOUNT_SELECT =
  "id, tenant_id, account_name, bank_name, bank_account_number, momo_provider, momo_number, momo_merchant_name, momo_merchant_id, is_active, created_at, updated_at" as const;

export type PaymentAccountAvailability = "all" | "selected";

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
  /** Empty = available to all business units. */
  business_unit_ids: string[];
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
  availability?: PaymentAccountAvailability;
  business_unit_ids?: string[];
};

export type PaymentAccountUpdateBody = PaymentAccountInput & {
  id: string;
  link_business_unit_id?: string;
  unlink_business_unit_id?: string;
};

export type PaymentAccountDeleteBody = {
  id: string;
};

export function emptyPaymentAccountForm() {
  return {
    account_name: "",
    availability: "all" as PaymentAccountAvailability,
    business_unit_ids: [] as string[],
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
  const hasSelection = row.business_unit_ids.length > 0;
  return {
    account_name: row.account_name,
    availability: hasSelection ? ("selected" as const) : ("all" as const),
    business_unit_ids: [...row.business_unit_ids],
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

export function normalizePaymentAccountBusinessUnitIds(
  ids: string[] | null | undefined,
): string[] {
  if (!ids?.length) {
    return [];
  }
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of ids) {
    const id = raw?.trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    normalized.push(id);
  }
  return normalized.sort();
}

export function paymentAccountAvailableToAll(account: PaymentAccountRow): boolean {
  return account.business_unit_ids.length === 0;
}

export function paymentAccountLinkedToBusinessUnit(
  account: PaymentAccountRow,
  businessUnitId: string | null | undefined,
): boolean {
  const buId = businessUnitId?.trim() || null;
  if (!buId) {
    return paymentAccountAvailableToAll(account);
  }
  return account.business_unit_ids.includes(buId);
}

export function validatePaymentAccountInput(input: PaymentAccountInput): string | null {
  const trimmed = trimPaymentAccountInput(input);

  if (!trimmed.account_name) {
    return "Account name is required.";
  }

  if (input.availability === "selected") {
    const ids = normalizePaymentAccountBusinessUnitIds(input.business_unit_ids);
    if (ids.length === 0) {
      return "Select at least one business unit, or choose All business units.";
    }
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

export function paymentAccountsForBusinessUnit(
  accounts: PaymentAccountRow[],
  businessUnitId: string | null | undefined,
): PaymentAccountRow[] {
  const buId = businessUnitId?.trim() || null;
  return accounts.filter(
    (account) =>
      paymentAccountAvailableToAll(account) ||
      (buId !== null && account.business_unit_ids.includes(buId)),
  );
}

export function paymentAccountsForDocumentPicker(
  accounts: PaymentAccountRow[],
  businessUnitId: string | null | undefined,
  selectedAccountIds: string[],
): PaymentAccountRow[] {
  const scoped = paymentAccountsForBusinessUnit(accounts, businessUnitId);
  const scopedIds = new Set(scoped.map((account) => account.id));
  const extras = accounts.filter(
    (account) =>
      selectedAccountIds.includes(account.id) && !scopedIds.has(account.id),
  );
  return [...scoped, ...extras].sort((a, b) =>
    a.account_name.localeCompare(b.account_name),
  );
}

export function formatPaymentAccountSummary(account: PaymentAccountRow): string {
  return [
    account.bank_name,
    account.bank_account_number,
    account.momo_provider,
    account.momo_number,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function formatPaymentAccountAvailabilityLabel(
  account: PaymentAccountRow,
  unitNameById: Map<string, string>,
): string {
  if (paymentAccountAvailableToAll(account)) {
    return "All";
  }
  return account.business_unit_ids
    .map((id) => unitNameById.get(id) ?? "Unknown unit")
    .join(", ");
}
