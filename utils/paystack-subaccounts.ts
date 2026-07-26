import "server-only";

import { getPaystackSecretKey } from "@/utils/paystack";

const PAYSTACK_BASE = "https://api.paystack.co";
const BANKS_TTL_MS = 24 * 60 * 60 * 1000;

export type PaystackBank = {
  name: string;
  code: string;
};

export type PaystackSubaccountDetails = {
  bankName: string;
  accountLast4: string;
};

type PaystackResponse<T> = {
  status?: boolean;
  message?: string;
  data?: T;
};

const banksCacheByType = new Map<
  string,
  {
    expiresAt: number;
    promise: Promise<PaystackResult<PaystackBank[]>>;
  }
>();

type PaystackResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; httpStatus?: number };

/** Ghana MoMo provider codes from Paystack List Banks (`type=mobile_money`). */
export const GHANA_MOMO_BANK_CODES = new Set(["MTN", "VOD", "ATL"]);

/**
 * Normalize Ghana MoMo numbers for Paystack resolve/subaccount APIs.
 * Paystack docs use local 10-digit form (e.g. `0551234987`), not `+233…`.
 */
export function normalizePaystackGhanaMomoNumber(accountNumber: string): string {
  const digits = accountNumber.replace(/\D/g, "");
  if (digits.startsWith("233") && digits.length === 12) {
    return `0${digits.slice(3)}`;
  }
  if (/^\d{9}$/.test(digits)) {
    return `0${digits}`;
  }
  if (digits.startsWith("0") && digits.length === 10) {
    return digits;
  }
  return accountNumber.trim();
}

export function isGhanaMomoBankCode(bankCode: string): boolean {
  return GHANA_MOMO_BANK_CODES.has(bankCode.trim().toUpperCase());
}

function prepareSettlementAccountNumber(
  accountNumber: string,
  bankCode: string,
): string {
  const trimmed = accountNumber.trim();
  if (!isGhanaMomoBankCode(bankCode)) {
    return trimmed;
  }
  return normalizePaystackGhanaMomoNumber(trimmed);
}

function banksCacheKey(type?: string): string {
  const normalized = type?.trim() ?? "";
  return normalized || "default";
}

function getAuthorizationHeaders():
  | { ok: true; headers: { Authorization: string } }
  | { ok: false; error: string } {
  const secretKey = getPaystackSecretKey();
  if (!secretKey) {
    return { ok: false, error: "PAYSTACK_SECRET_KEY is not configured." };
  }

  if (!secretKey.startsWith("sk_test_") && !secretKey.startsWith("sk_live_")) {
    return { ok: false, error: "PAYSTACK_SECRET_KEY has an unexpected format." };
  }

  return {
    ok: true,
    headers: { Authorization: `Bearer ${secretKey}` },
  };
}

async function paystackRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<PaystackResult<T>> {
  const auth = getAuthorizationHeaders();
  if (!auth.ok) {
    return auth;
  }

  try {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", auth.headers.Authorization);
    const response = await fetch(`${PAYSTACK_BASE}${path}`, {
      ...init,
      headers,
    });
    const payload = (await response.json().catch(() => null)) as
      | PaystackResponse<T>
      | null;

    if (!response.ok || payload?.status === false || payload?.data === undefined) {
      const error =
        payload?.message ?? `Paystack request failed (${response.status}).`;
      if (response.status >= 400) {
        console.warn(
          `[paystack] ${init?.method ?? "GET"} ${path} → HTTP ${response.status}: ${error}`,
        );
      }
      return {
        ok: false,
        error,
        httpStatus: response.status,
      };
    }

    return { ok: true, data: payload.data };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Paystack request failed.",
    };
  }
}

async function fetchPaystackBanks(
  type?: string,
): Promise<PaystackResult<PaystackBank[]>> {
  const params = new URLSearchParams({
    country: "ghana",
    currency: "GHS",
  });
  const normalizedType = type?.trim();
  if (normalizedType) {
    params.set("type", normalizedType);
  }

  const result = await paystackRequest<
    Array<{ name?: string; code?: string; active?: boolean }>
  >(`/bank?${params.toString()}`);

  if (!result.ok) {
    return result;
  }

  return {
    ok: true,
    data: result.data
      .filter(
        (bank) =>
          bank.active !== false &&
          typeof bank.name === "string" &&
          typeof bank.code === "string",
      )
      .map((bank) => ({
        name: bank.name!.trim(),
        code: bank.code!.trim(),
      }))
      .filter((bank) => bank.name && bank.code)
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function listPaystackBanks(
  type?: string,
): Promise<PaystackResult<PaystackBank[]>> {
  const key = banksCacheKey(type);
  const now = Date.now();
  const cached = banksCacheByType.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }

  const promise = fetchPaystackBanks(type);
  banksCacheByType.set(key, { expiresAt: now + BANKS_TTL_MS, promise });
  void promise.then((result) => {
    if (!result.ok) {
      banksCacheByType.delete(key);
    }
  });
  return promise;
}

export async function resolvePaystackAccount(options: {
  accountNumber: string;
  bankCode: string;
}): Promise<PaystackResult<{ accountName: string }>> {
  const bankCode = options.bankCode.trim();
  const accountNumber = prepareSettlementAccountNumber(
    options.accountNumber,
    bankCode,
  );
  const result = await paystackRequest<{ account_name?: string }>(
    `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
  );

  if (!result.ok) {
    return result;
  }

  const accountName = result.data.account_name?.trim() ?? "";
  if (!accountName) {
    return { ok: false, error: "Paystack did not return an account name." };
  }

  return { ok: true, data: { accountName } };
}

export async function createPaystackSubaccount(options: {
  businessName: string;
  bankCode: string;
  accountNumber: string;
}): Promise<PaystackResult<{ subaccountCode: string }>> {
  const bankCode = options.bankCode.trim();
  const accountNumber = prepareSettlementAccountNumber(
    options.accountNumber,
    bankCode,
  );
  const result = await paystackRequest<{ subaccount_code?: string }>(
    "/subaccount",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        business_name: options.businessName,
        settlement_bank: bankCode,
        account_number: accountNumber,
        percentage_charge: 0,
      }),
    },
  );

  if (!result.ok) {
    return result;
  }

  const subaccountCode = result.data.subaccount_code?.trim() ?? "";
  if (!subaccountCode) {
    return { ok: false, error: "Paystack did not return a subaccount code." };
  }

  return { ok: true, data: { subaccountCode } };
}

/**
 * Update an existing Paystack subaccount in place (PUT /subaccount/:code).
 * Paystack has no Delete Subaccount API — use `active: false` to deactivate.
 */
export async function updatePaystackSubaccount(options: {
  subaccountCode: string;
  businessName: string;
  bankCode: string;
  accountNumber: string;
  active?: boolean;
}): Promise<PaystackResult<{ subaccountCode: string }>> {
  const subaccountCode = options.subaccountCode.trim();
  if (!subaccountCode) {
    return { ok: false, error: "subaccountCode is required." };
  }

  const bankCode = options.bankCode.trim();
  const accountNumber = prepareSettlementAccountNumber(
    options.accountNumber,
    bankCode,
  );
  const body: Record<string, unknown> = {
    business_name: options.businessName,
    settlement_bank: bankCode,
    account_number: accountNumber,
    percentage_charge: 0,
  };
  if (typeof options.active === "boolean") {
    body.active = options.active;
  }

  const result = await paystackRequest<{ subaccount_code?: string }>(
    `/subaccount/${encodeURIComponent(subaccountCode)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  if (!result.ok) {
    return result;
  }

  const returnedCode = result.data.subaccount_code?.trim() || subaccountCode;
  return { ok: true, data: { subaccountCode: returnedCode } };
}

/** Deactivate a subaccount (Paystack has no delete endpoint). */
export async function setPaystackSubaccountActive(
  subaccountCode: string,
  active: boolean,
): Promise<PaystackResult<{ subaccountCode: string; active: boolean }>> {
  const code = subaccountCode.trim();
  if (!code) {
    return { ok: false, error: "subaccountCode is required." };
  }

  const result = await paystackRequest<{
    subaccount_code?: string;
    active?: boolean | number;
  }>(`/subaccount/${encodeURIComponent(code)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ active }),
  });

  if (!result.ok) {
    return result;
  }

  return {
    ok: true,
    data: {
      subaccountCode: result.data.subaccount_code?.trim() || code,
      active: Boolean(result.data.active ?? active),
    },
  };
}

export async function getPaystackSubaccount(
  subaccountCode: string,
): Promise<PaystackResult<PaystackSubaccountDetails>> {
  const result = await paystackRequest<{
    account_number?: string;
    settlement_bank?: string | { name?: string };
    active?: boolean | number;
    is_verified?: boolean;
  }>(`/subaccount/${encodeURIComponent(subaccountCode)}`);

  if (!result.ok) {
    return result;
  }

  const accountNumber = result.data.account_number?.trim() ?? "";
  const settlementBank = result.data.settlement_bank;
  const bankName =
    typeof settlementBank === "string"
      ? settlementBank.trim()
      : settlementBank?.name?.trim() ?? "";

  if (!accountNumber || !bankName) {
    return { ok: false, error: "Paystack returned incomplete account details." };
  }

  return {
    ok: true,
    data: {
      bankName,
      accountLast4: accountNumber.slice(-4),
    },
  };
}
