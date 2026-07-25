"use client";

import { useEffect, useState } from "react";
import type { PaystackSubaccountStatus } from "@/utils/billing-settings-types";

type Bank = {
  name: string;
  code: string;
};

type AccountDetails = {
  bankName: string;
  accountLast4: string;
};

type PaymentSettingsProps = {
  initialStatus: PaystackSubaccountStatus;
  hidden: boolean;
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744] disabled:bg-slate-50 disabled:text-slate-500";

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

let banksRequest: Promise<Bank[]> | null = null;

function loadBanks() {
  banksRequest ??= fetch("/api/billing-settings/paystack-banks").then(
    async (response) => {
      const payload = (await response.json().catch(() => null)) as
        | { banks?: Bank[]; error?: string }
        | null;
      if (!response.ok) {
        banksRequest = null;
        throw new Error(payload?.error ?? "Unable to load banks.");
      }
      return payload?.banks ?? [];
    },
  );
  return banksRequest;
}

function statusDisplay(status: PaystackSubaccountStatus) {
  if (status === "active") {
    return {
      label: "Active",
      className:
        "border-emerald-200 bg-emerald-50 text-emerald-800",
    };
  }

  if (status === "pending") {
    return {
      label: "Pending verification",
      className: "border-amber-200 bg-amber-50 text-amber-800",
    };
  }

  return {
    label: "Not set up",
    className: "border-amber-200 bg-amber-50 text-amber-800",
  };
}

export default function PaymentSettings({
  initialStatus,
  hidden,
}: PaymentSettingsProps) {
  const [status, setStatus] =
    useState<PaystackSubaccountStatus>(initialStatus);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [bankCode, setBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountDetails, setAccountDetails] = useState<AccountDetails | null>(
    null,
  );
  const [editing, setEditing] = useState(initialStatus !== "active");
  const [banksLoading, setBanksLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(
    initialStatus === "active",
  );
  const [resolving, setResolving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    loadBanks()
      .then((loadedBanks) => {
        if (!cancelled) {
          setBanks(loadedBanks);
          setBanksLoading(false);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load banks.",
          );
          setBanksLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (initialStatus !== "active") {
      return;
    }

    let cancelled = false;
    fetch("/api/billing-settings/paystack-subaccount")
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as
          | {
              account?: {
                bank_name?: string;
                account_last4?: string;
              } | null;
              error?: string;
            }
          | null;

        if (!response.ok) {
          throw new Error(payload?.error ?? "Unable to load payment account.");
        }

        if (!cancelled && payload?.account) {
          setAccountDetails({
            bankName: payload.account.bank_name ?? "Bank",
            accountLast4: payload.account.account_last4 ?? "",
          });
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load payment account.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDetailsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [initialStatus]);

  useEffect(() => {
    if (!editing || !bankCode || !accountNumber.trim()) {
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setResolving(true);
      try {
        const params = new URLSearchParams({
          account_number: accountNumber.trim(),
          bank_code: bankCode,
        });
        const response = await fetch(
          `/api/billing-settings/paystack-resolve-account?${params}`,
          { signal: controller.signal },
        );
        const payload = (await response.json().catch(() => null)) as
          | { account_name?: string }
          | null;

        if (!response.ok || !payload?.account_name) {
          setResolveError(
            "Could not verify this account number - please check and try again",
          );
          return;
        }

        setAccountName(payload.account_name);
      } catch (resolveFailure) {
        if (
          !(resolveFailure instanceof DOMException) ||
          resolveFailure.name !== "AbortError"
        ) {
          setResolveError(
            "Could not verify this account number - please check and try again",
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setResolving(false);
        }
      }
    }, 500);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [accountNumber, bankCode, editing]);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    const response = await fetch(
      "/api/billing-settings/paystack-subaccount",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bank_code: bankCode,
          account_number: accountNumber.trim(),
        }),
      },
    );
    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to save payment account.");
      setSaving(false);
      return;
    }

    const selectedBank = banks.find((bank) => bank.code === bankCode);
    setAccountDetails({
      bankName: selectedBank?.name ?? "Bank",
      accountLast4: accountNumber.trim().slice(-4),
    });
    setStatus("active");
    setEditing(false);
    setSaving(false);
    setSuccess("Payment account verified and activated.");
  }

  function handleUpdate() {
    setEditing(true);
    setBankCode("");
    setAccountNumber("");
    setAccountName("");
    setError(null);
    setResolveError(null);
    setResolving(false);
    setSuccess(null);
  }

  const statusInfo = statusDisplay(status);

  return (
    <div hidden={hidden} className="max-w-4xl space-y-6">
      <p className="text-sm text-slate-600">
        Route POS and product-sale payments to your verified bank account.
      </p>

      <div
        className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium ${statusInfo.className}`}
      >
        {statusInfo.label}
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {success ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {success}
        </p>
      ) : null}

      {status === "active" && !editing ? (
        <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div>
            <h3 className="text-sm font-medium text-slate-700">
              Settlement Account
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Payments are settled to this account by Paystack.
            </p>
          </div>

          {detailsLoading ? (
            <p className="text-sm text-slate-500">Loading account details…</p>
          ) : accountDetails ? (
            <div>
              <p className="font-medium text-[#0f2744]">
                {accountDetails.bankName}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                Account ending in {accountDetails.accountLast4}
              </p>
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              Account details are temporarily unavailable.
            </p>
          )}

          <button
            type="button"
            onClick={handleUpdate}
            className={secondaryButtonClassName}
          >
            Update
          </button>
        </section>
      ) : (
        <form
          onSubmit={handleSave}
          className="space-y-5 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
        >
          <div>
            <h3 className="text-sm font-medium text-slate-700">
              Settlement Account
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Paystack verifies this account before it can receive settlements.
            </p>
          </div>

          <div>
            <label
              htmlFor="payment_bank"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Bank
            </label>
            <select
              id="payment_bank"
              value={bankCode}
              onChange={(event) => {
                setBankCode(event.target.value);
                setAccountName("");
                setResolveError(null);
                setResolving(false);
              }}
              disabled={banksLoading || saving}
              className={inputClassName}
            >
              <option value="">
                {banksLoading ? "Loading banks…" : "Select a bank"}
              </option>
              {banks.map((bank) => (
                <option key={bank.code} value={bank.code}>
                  {bank.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="payment_account_number"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Account Number
            </label>
            <input
              id="payment_account_number"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={accountNumber}
              onChange={(event) => {
                setAccountNumber(event.target.value);
                setAccountName("");
                setResolveError(null);
                setResolving(false);
              }}
              disabled={saving}
              className={inputClassName}
            />
          </div>

          <div>
            <label
              htmlFor="payment_account_name"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Account Name
            </label>
            <input
              id="payment_account_name"
              type="text"
              readOnly
              value={resolving ? "Verifying account…" : accountName}
              placeholder="Resolved automatically"
              className={inputClassName}
            />
            {resolveError ? (
              <p className="mt-1 text-sm text-red-700">{resolveError}</p>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={!accountName || resolving || saving}
            className={primaryButtonClassName}
          >
            {saving ? "Saving…" : "Save & Verify"}
          </button>
        </form>
      )}
    </div>
  );
}
