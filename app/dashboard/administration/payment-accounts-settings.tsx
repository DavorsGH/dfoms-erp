"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  emptyPaymentAccountForm,
  paymentAccountContactWarning,
  paymentAccountToForm,
  validatePaymentAccountInput,
  type PaymentAccountRow,
} from "@/utils/payment-accounts-types";

type PaymentAccountsSettingsProps = {
  initialAccounts: PaymentAccountRow[];
  fetchError: string | null;
};

type FormState = ReturnType<typeof emptyPaymentAccountForm>;

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const cardClassName =
  "space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm";

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const dangerButtonClassName =
  "rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50";

function formatDetail(label: string, value: string | null | undefined) {
  if (!value?.trim()) {
    return null;
  }

  return (
    <p className="text-sm text-slate-700">
      <span className="font-medium text-slate-900">{label}:</span> {value}
    </p>
  );
}

export default function PaymentAccountsSettings({
  initialAccounts,
  fetchError,
}: PaymentAccountsSettingsProps) {
  const router = useRouter();
  const [accounts, setAccounts] = useState(initialAccounts);
  const [formOpen, setFormOpen] = useState<"new" | string | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyPaymentAccountForm());
  const [error, setError] = useState<string | null>(fetchError);
  const [warning, setWarning] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const editingAccount = useMemo(
    () =>
      formOpen && formOpen !== "new"
        ? accounts.find((account) => account.id === formOpen) ?? null
        : null,
    [accounts, formOpen],
  );

  function openCreateForm() {
    setForm(emptyPaymentAccountForm());
    setFormOpen("new");
    setError(null);
    setWarning(null);
    setSuccess(null);
  }

  function openEditForm(account: PaymentAccountRow) {
    setForm(paymentAccountToForm(account));
    setFormOpen(account.id);
    setError(null);
    setWarning(null);
    setSuccess(null);
  }

  function closeForm() {
    setFormOpen(null);
    setForm(emptyPaymentAccountForm());
    setWarning(null);
  }

  async function refreshAccounts() {
    const response = await fetch("/api/payment-accounts");
    const payload = (await response.json().catch(() => null)) as
      | { payment_accounts?: PaymentAccountRow[]; error?: string }
      | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to refresh payment accounts.");
      return;
    }

    setAccounts(payload?.payment_accounts ?? []);
    setError(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    const validationError = validatePaymentAccountInput(form);
    if (validationError) {
      setError(validationError);
      setSaving(false);
      return;
    }

    const contactWarning = paymentAccountContactWarning(form);
    setWarning(contactWarning);

    const isEditing = formOpen !== null && formOpen !== "new";
    const response = await fetch("/api/payment-accounts", {
      method: isEditing ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        isEditing
          ? {
              id: formOpen,
              ...form,
            }
          : form,
      ),
    });

    const payload = (await response.json().catch(() => null)) as
      | { payment_account?: PaymentAccountRow; error?: string }
      | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to save payment account.");
      setSaving(false);
      return;
    }

    if (payload?.payment_account) {
      setAccounts((current) => {
        if (isEditing) {
          return current.map((account) =>
            account.id === payload.payment_account!.id
              ? payload.payment_account!
              : account,
          );
        }

        return [...current, payload.payment_account!].sort((a, b) =>
          a.account_name.localeCompare(b.account_name),
        );
      });
    } else {
      await refreshAccounts();
    }

    setSuccess(
      isEditing ? "Payment account updated." : "Payment account created.",
    );
    closeForm();
    setSaving(false);
    router.refresh();
  }

  async function handleDelete(account: PaymentAccountRow) {
    const confirmed = window.confirm(
      `Delete payment account "${account.account_name}"? This cannot be undone.`,
    );

    if (!confirmed) {
      return;
    }

    setDeletingId(account.id);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/payment-accounts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: account.id }),
    });

    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to delete payment account.");
      setDeletingId(null);
      return;
    }

    setAccounts((current) => current.filter((entry) => entry.id !== account.id));

    if (formOpen === account.id) {
      closeForm();
    }

    setSuccess("Payment account deleted.");
    setDeletingId(null);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {success ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {success}
        </p>
      ) : null}

      <section className={cardClassName}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-sm font-medium text-slate-700">
              Saved Payment Accounts
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Company bank and mobile-money profiles used on customer invoices.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreateForm}
            className={primaryButtonClassName}
          >
            Add Payment Account
          </button>
        </div>

        {accounts.length === 0 ? (
          <p className="text-sm text-slate-500">
            No payment accounts yet. Add one to show customers how to pay you.
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {accounts.map((account) => (
              <article
                key={account.id}
                className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="text-base font-semibold text-[#0f2744]">
                      {account.account_name}
                    </h4>
                    <p className="mt-1 text-xs text-slate-500">
                      {account.is_active ? "Active" : "Inactive"}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => openEditForm(account)}
                      className={secondaryButtonClassName}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(account)}
                      disabled={deletingId === account.id}
                      className={dangerButtonClassName}
                    >
                      {deletingId === account.id ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  {formatDetail("Bank", account.bank_name)}
                  {formatDetail("Account number", account.bank_account_number)}
                  {formatDetail("MoMo merchant name", account.momo_merchant_name)}
                  {formatDetail("MoMo provider", account.momo_provider)}
                  {formatDetail("Merchant Number", account.momo_number)}
                  {formatDetail("Merchant ID", account.momo_merchant_id)}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {formOpen ? (
        <section className={cardClassName}>
          <div>
            <h3 className="text-sm font-medium text-slate-700">
              {formOpen === "new"
                ? "Add Payment Account"
                : `Edit ${editingAccount?.account_name ?? "Payment Account"}`}
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Account name is required. Add bank and/or MoMo details clients can
              use to pay invoices.
            </p>
          </div>

          {warning ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {warning}
            </p>
          ) : null}

          <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Account Name *
              </label>
              <input
                type="text"
                required
                value={form.account_name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    account_name: event.target.value,
                  }))
                }
                placeholder="Davors Facilities Management Services Ltd"
                className={inputClassName}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Bank Name
              </label>
              <input
                type="text"
                value={form.bank_name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    bank_name: event.target.value,
                  }))
                }
                className={inputClassName}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Bank Account Number
              </label>
              <input
                type="text"
                value={form.bank_account_number}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    bank_account_number: event.target.value,
                  }))
                }
                className={inputClassName}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                MoMo Merchant Name
              </label>
              <input
                type="text"
                value={form.momo_merchant_name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    momo_merchant_name: event.target.value,
                  }))
                }
                placeholder="Davors Enterprise"
                className={inputClassName}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                MoMo Provider
              </label>
              <input
                type="text"
                value={form.momo_provider}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    momo_provider: event.target.value,
                  }))
                }
                placeholder="MTN, Vodafone, AirtelTigo"
                className={inputClassName}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Merchant Number
              </label>
              <input
                type="text"
                value={form.momo_number}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    momo_number: event.target.value,
                  }))
                }
                className={inputClassName}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Merchant ID
              </label>
              <input
                type="text"
                value={form.momo_merchant_id}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    momo_merchant_id: event.target.value,
                  }))
                }
                className={inputClassName}
              />
            </div>

            <div className="flex items-center gap-2 md:col-span-2">
              <input
                id="payment-account-active"
                type="checkbox"
                checked={form.is_active}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    is_active: event.target.checked,
                  }))
                }
                className="h-4 w-4 rounded border-slate-300 text-[#0f2744] focus:ring-[#0f2744]"
              />
              <label
                htmlFor="payment-account-active"
                className="text-sm text-slate-700"
              >
                Active (available for invoice use)
              </label>
            </div>

            <div className="flex flex-wrap gap-2 md:col-span-2">
              <button
                type="submit"
                disabled={saving}
                className={primaryButtonClassName}
              >
                {saving
                  ? "Saving…"
                  : formOpen === "new"
                    ? "Create Payment Account"
                    : "Save Changes"}
              </button>
              <button
                type="button"
                onClick={closeForm}
                className={secondaryButtonClassName}
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </div>
  );
}
