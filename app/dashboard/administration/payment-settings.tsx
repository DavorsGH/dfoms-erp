"use client";

import { useEffect, useState } from "react";
import type { PaystackSubaccountStatus } from "@/utils/billing-settings-types";
import {
  resolveOnlinePaymentsConnectionStatus,
  type OnlinePaymentsConnectionStatus,
} from "@/utils/product-sale-paystack";

type Bank = {
  name: string;
  code: string;
};

type AccountDetails = {
  bankName: string;
  accountLast4: string;
};

type SettlementAccountType = "bank" | "mobile_money";

type PaymentSettingsProps = {
  initialStatus: PaystackSubaccountStatus;
  initialVerifiedOk?: boolean | null;
  initialLastVerifyError?: string | null;
  hidden: boolean;
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744] disabled:bg-slate-50 disabled:text-slate-500";

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const banksRequests = new Map<SettlementAccountType, Promise<Bank[]>>();

function loadBanks(accountType: SettlementAccountType) {
  const existing = banksRequests.get(accountType);
  if (existing) {
    return existing;
  }

  const query =
    accountType === "mobile_money" ? "?type=mobile_money" : "";
  const request = fetch(`/api/billing-settings/paystack-banks${query}`).then(
    async (response) => {
      const payload = (await response.json().catch(() => null)) as
        | { banks?: Bank[]; error?: string }
        | null;
      if (!response.ok) {
        banksRequests.delete(accountType);
        throw new Error(
          payload?.error ??
            (accountType === "mobile_money"
              ? "Unable to load mobile money providers."
              : "Unable to load banks."),
        );
      }
      return payload?.banks ?? [];
    },
  );
  banksRequests.set(accountType, request);
  return request;
}

function connectionStatusDisplay(status: OnlinePaymentsConnectionStatus) {
  if (status === "connected") {
    return {
      label: "Connected",
      className: "border-emerald-200 bg-emerald-50 text-emerald-800",
    };
  }

  if (status === "needs_attention") {
    return {
      label: "Needs attention",
      className: "border-amber-200 bg-amber-50 text-amber-900",
    };
  }

  if (status === "checking") {
    return {
      label: "Checking connection…",
      className: "border-sky-200 bg-sky-50 text-sky-900",
    };
  }

  return {
    label: "Not connected",
    className: "border-slate-200 bg-slate-50 text-slate-700",
  };
}

function accountTypeButtonClassName(selected: boolean) {
  return [
    "flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors",
    selected
      ? "bg-[#0f2744] text-white"
      : "bg-white text-slate-700 hover:bg-slate-50",
  ].join(" ");
}

/** True when the value looks like a complete Ghana MoMo number (local or +233). */
function isCompleteGhanaMomoNumber(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return (
    (digits.startsWith("0") && digits.length === 10) ||
    (digits.startsWith("233") && digits.length === 12) ||
    digits.length === 9
  );
}

function resolveFailureMessage(
  accountType: SettlementAccountType,
  apiError: string | undefined,
): string {
  const message = apiError?.trim();
  if (message) {
    return message;
  }
  return accountType === "mobile_money"
    ? "Could not verify this mobile money number - please check and try again"
    : "Could not verify this account number - please check and try again";
}

export default function PaymentSettings({
  initialStatus,
  initialVerifiedOk = null,
  initialLastVerifyError = null,
  hidden,
}: PaymentSettingsProps) {
  const [status, setStatus] =
    useState<PaystackSubaccountStatus>(initialStatus);
  const [verifiedOk, setVerifiedOk] = useState<boolean | null>(
    initialVerifiedOk,
  );
  const [accountType, setAccountType] =
    useState<SettlementAccountType>("bank");
  const [banks, setBanks] = useState<Bank[]>([]);
  const [bankCode, setBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountDetails, setAccountDetails] = useState<AccountDetails | null>(
    null,
  );
  // Edit form only when not connected, or Needs attention. Never-checked
  // (null) stays on the checking view until Paystack responds.
  const [editing, setEditing] = useState(
    initialStatus !== "active" || initialVerifiedOk === false,
  );
  const connectionStatus = resolveOnlinePaymentsConnectionStatus({
    paystack_subaccount_status: status,
    paystack_subaccount_code: status === "active" ? "set" : null,
    paystack_subaccount_verified_ok: verifiedOk,
  });
  const showConnectedView =
    status === "active" && verifiedOk === true && !editing;
  const showCheckingView =
    status === "active" && verifiedOk === null && !editing;
  const [banksLoading, setBanksLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(
    initialStatus === "active",
  );
  const [resolving, setResolving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(
    initialStatus === "active" && initialVerifiedOk === false
      ? initialLastVerifyError?.trim() ||
          "Paystack can't find this account. Update the settlement account."
      : null,
  );
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBanksLoading(true);
    setError(null);

    loadBanks(accountType)
      .then((loadedBanks) => {
        if (!cancelled) {
          setBanks(loadedBanks);
          setBanksLoading(false);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setBanks([]);
          setError(
            loadError instanceof Error
              ? loadError.message
              : accountType === "mobile_money"
                ? "Unable to load mobile money providers."
                : "Unable to load banks.",
          );
          setBanksLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [accountType]);

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
              verification?: {
                verified_ok?: boolean;
                last_verify_error?: string | null;
              };
              error?: string;
            }
          | null;

        if (cancelled) {
          return;
        }

        // Directors can open Online Payments; GET verifies. POST (save) stays
        // super_admin-only — keep server-rendered status on 403.
        if (response.status === 403) {
          return;
        }

        if (!response.ok && response.status >= 500) {
          throw new Error(payload?.error ?? "Unable to load payment account.");
        }

        const verified = payload?.verification?.verified_ok;
        const ok = verified === true;
        setVerifiedOk(ok ? true : verified === false ? false : null);

        if (ok && payload?.account) {
          setAccountDetails({
            bankName: payload.account.bank_name ?? "Settlement account",
            accountLast4: payload.account.account_last4 ?? "",
          });
          setEditing(false);
          setError(null);
          return;
        }

        if (verified === false) {
          const attentionMessage =
            payload?.verification?.last_verify_error?.trim() ||
            payload?.error?.trim() ||
            "Paystack can't find this account. Update the settlement account.";
          setAccountDetails(null);
          setEditing(true);
          setError(attentionMessage);
          return;
        }

        // Still checking / no account payload yet — leave null + checking UI.
        setAccountDetails(null);
        setEditing(false);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setVerifiedOk(false);
          setEditing(true);
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

    // Avoid burning Paystack test-mode live-resolve quota on incomplete MoMo input.
    if (
      accountType === "mobile_money" &&
      !isCompleteGhanaMomoNumber(accountNumber)
    ) {
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
          | { account_name?: string; error?: string }
          | null;

        if (!response.ok || !payload?.account_name) {
          setResolveError(
            resolveFailureMessage(accountType, payload?.error),
          );
          return;
        }

        setAccountName(payload.account_name);
      } catch (resolveFailure) {
        if (
          !(resolveFailure instanceof DOMException) ||
          resolveFailure.name !== "AbortError"
        ) {
          setResolveError(resolveFailureMessage(accountType, undefined));
        }
      } finally {
        if (!controller.signal.aborted) {
          setResolving(false);
        }
      }
    }, accountType === "mobile_money" ? 800 : 500);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [accountNumber, accountType, bankCode, editing]);

  function handleAccountTypeChange(nextType: SettlementAccountType) {
    if (nextType === accountType) {
      return;
    }

    setAccountType(nextType);
    setBankCode("");
    setAccountNumber("");
    setAccountName("");
    setBanks([]);
    setResolveError(null);
    setResolving(false);
    setError(null);
    setSuccess(null);
  }

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
      | {
          error?: string;
          account?: {
            bank_name?: string | null;
            account_last4?: string | null;
          } | null;
          verification?: {
            verified_ok?: boolean;
            last_verify_error?: string | null;
          };
        }
      | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to save payment account.");
      setSaving(false);
      return;
    }

    const ok = payload?.verification?.verified_ok !== false;
    setStatus("active");
    setVerifiedOk(ok);

    if (!ok) {
      setAccountDetails(null);
      setEditing(true);
      setError(
        payload?.verification?.last_verify_error?.trim() ||
          payload?.error?.trim() ||
          "Paystack can't find this account. Update the settlement account.",
      );
      setSaving(false);
      return;
    }

    const selectedBank = banks.find((bank) => bank.code === bankCode);
    setAccountDetails({
      bankName:
        payload?.account?.bank_name?.trim() ||
        selectedBank?.name ||
        (accountType === "mobile_money" ? "Mobile Money" : "Bank"),
      accountLast4:
        payload?.account?.account_last4?.trim() ||
        accountNumber.trim().slice(-4),
    });
    setEditing(false);
    setSaving(false);
    setSuccess("Payment account verified and activated.");
  }

  function handleUpdate() {
    setEditing(true);
    setAccountType("bank");
    setBankCode("");
    setAccountNumber("");
    setAccountName("");
    setError(null);
    setResolveError(null);
    setResolving(false);
    setSuccess(null);
  }

  const statusInfo = connectionStatusDisplay(connectionStatus);
  const isMobileMoney = accountType === "mobile_money";
  const providerLabel = isMobileMoney ? "Mobile Money Provider" : "Bank";
  const numberLabel = isMobileMoney ? "Mobile Money Number" : "Account Number";

  return (
    <div hidden={hidden} className="max-w-4xl space-y-6">
      <div
        className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium ${statusInfo.className}`}
      >
        {statusInfo.label}
      </div>

      {connectionStatus === "needs_attention" ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Needs attention — Paystack can&apos;t find this account. Update the
          settlement account.
        </p>
      ) : null}

      {connectionStatus === "checking" ? (
        <p className="rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950">
          Checking connection… confirming this settlement account with Paystack.
        </p>
      ) : null}

      {error && connectionStatus !== "needs_attention" && connectionStatus !== "checking" ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {success ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {success}
        </p>
      ) : null}

      {showCheckingView ? (
        <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div>
            <h3 className="text-sm font-medium text-slate-700">
              Settlement Account
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Confirming the Paystack settlement account for Mobile Money.
            </p>
          </div>
          <p className="text-sm text-slate-500">
            {detailsLoading
              ? "Checking connection…"
              : "Checking connection… this usually finishes in a few seconds."}
          </p>
        </section>
      ) : showConnectedView ? (
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
                {accountDetails.accountLast4
                  ? `Number ending in ${accountDetails.accountLast4}`
                  : "Settlement number unavailable"}
              </p>
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              Loading settlement details…
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
            <p className="mb-1 block text-sm font-medium text-slate-700">
              Account Type
            </p>
            <div
              className="inline-flex w-full max-w-md rounded-md border border-slate-300 bg-slate-100 p-1"
              role="group"
              aria-label="Account Type"
            >
              <button
                type="button"
                aria-pressed={accountType === "bank"}
                onClick={() => handleAccountTypeChange("bank")}
                disabled={saving}
                className={accountTypeButtonClassName(accountType === "bank")}
              >
                Bank
              </button>
              <button
                type="button"
                aria-pressed={accountType === "mobile_money"}
                onClick={() => handleAccountTypeChange("mobile_money")}
                disabled={saving}
                className={accountTypeButtonClassName(
                  accountType === "mobile_money",
                )}
              >
                Mobile Money
              </button>
            </div>
          </div>

          <div>
            <label
              htmlFor="payment_bank"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              {providerLabel}
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
                {banksLoading
                  ? isMobileMoney
                    ? "Loading providers…"
                    : "Loading banks…"
                  : isMobileMoney
                    ? "Select a provider"
                    : "Select a bank"}
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
              {numberLabel}
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
              placeholder={
                isMobileMoney ? "e.g. 054XXXXXXX (10 digits)" : undefined
              }
              className={inputClassName}
            />
            {isMobileMoney ? (
              <p className="mt-1 text-xs text-slate-500">
                Use the Ghana number registered to the wallet (leading 0). Country
                code 233 is also accepted.
              </p>
            ) : null}
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
