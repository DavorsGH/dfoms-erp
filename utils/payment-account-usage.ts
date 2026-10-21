/**
 * Payment account delete / in-use messaging (pure — unit-testable).
 */

export const PAYMENT_ACCOUNT_IN_USE_CODE = "payment_account_in_use" as const;

export const PAYMENT_ACCOUNT_IN_USE_TITLE = "This account is in use";

/** Tables that block delete when they reference payment_accounts (RESTRICT). */
export const PAYMENT_ACCOUNT_USAGE_SOURCES = [
  {
    table: "salary_advance_register",
    column: "payment_account_id",
    label: "salary advances",
    exampleLabel: "salary advances",
  },
  {
    table: "client_invoice_payment_accounts",
    column: "payment_account_id",
    label: "invoices",
    exampleLabel: "invoices",
  },
  {
    table: "client_quotation_payment_accounts",
    column: "payment_account_id",
    label: "quotations",
    exampleLabel: "quotations",
  },
] as const;

export type PaymentAccountUsageSourceLabel =
  (typeof PAYMENT_ACCOUNT_USAGE_SOURCES)[number]["label"];

export type PaymentAccountUsageSummary = {
  total: number;
  labels: PaymentAccountUsageSourceLabel[];
  exampleLabel: string;
};

export function formatPaymentAccountInUseBody(options: {
  accountName: string;
  usage: PaymentAccountUsageSummary;
}): string {
  const name = options.accountName.trim() || "This account";
  const n = Math.max(0, Math.floor(options.usage.total));
  const types =
    options.usage.labels.length > 0
      ? options.usage.labels.join(", ")
      : "records";
  const example =
    options.usage.exampleLabel.trim() ||
    options.usage.labels[0] ||
    "salary advances";
  return (
    `${name} is linked to ${n.toLocaleString()} ${types}` +
    ` (for example ${example}), so it can't be deleted. Deactivate it instead` +
    ` — it will no longer be offered for new records, and past records stay intact.`
  );
}

export function buildPaymentAccountUsageSummary(
  countsByLabel: Partial<Record<PaymentAccountUsageSourceLabel, number>>,
): PaymentAccountUsageSummary {
  const labels: PaymentAccountUsageSourceLabel[] = [];
  let total = 0;
  let exampleLabel = "salary advances";

  for (const source of PAYMENT_ACCOUNT_USAGE_SOURCES) {
    const count = Math.max(0, Math.floor(Number(countsByLabel[source.label]) || 0));
    if (count <= 0) {
      continue;
    }
    labels.push(source.label);
    total += count;
    if (labels.length === 1) {
      exampleLabel = source.exampleLabel;
    }
  }

  if (labels.length === 0) {
    return { total: 0, labels: [], exampleLabel: "salary advances" };
  }

  return { total, labels, exampleLabel };
}

/** Map FK constraint / referencing table → usage label for safety-net messaging. */
export const PAYMENT_ACCOUNT_FK_TABLE_LABELS: Record<string, string> = {
  salary_advance_register: "salary advances",
  salary_advance_register_payment_account_id_fkey: "salary advances",
  client_invoice_payment_accounts: "invoices",
  client_invoice_payment_accounts_payment_account_id_fkey: "invoices",
  client_quotation_payment_accounts: "quotations",
  client_quotation_payment_accounts_payment_account_id_fkey: "quotations",
};
