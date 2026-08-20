import "server-only";

import {
  describeHubtelClientId,
  getHubtelClientIdLabel,
  getHubtelCredentials,
  HUBTEL_SMS_API_BASE,
  maskHubtelClientId,
} from "@/utils/hubtel-api";

export type HubtelAccountProfileResult = {
  available: boolean;
  balance: number | null;
  currency: string | null;
  accountLabel: string | null;
  endpoint: string | null;
  configuredClientId: string | null;
  configuredClientIdLabel: string | null;
  error: string | null;
};

const PROFILE_ENDPOINT = `${HUBTEL_SMS_API_BASE}/account/profile`;

function parseBalance(payload: unknown): {
  balance: number | null;
  currency: string | null;
  accountLabel: string | null;
} {
  if (!payload || typeof payload !== "object") {
    return { balance: null, currency: null, accountLabel: null };
  }

  const root = payload as Record<string, unknown>;
  const data =
    root.Data && typeof root.Data === "object"
      ? (root.Data as Record<string, unknown>)
      : root;

  const balanceCandidates = [
    data.balance,
    data.Balance,
    data.accountBalance,
    data.AccountBalance,
    data.smsBalance,
    data.SmsBalance,
    data.creditBalance,
    data.CreditBalance,
  ];

  let balance: number | null = null;
  for (const candidate of balanceCandidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed)) {
      balance = parsed;
      break;
    }
  }

  const currencyRaw =
    (typeof data.currency === "string" && data.currency) ||
    (typeof data.Currency === "string" && data.Currency) ||
    null;

  const accountLabel =
    (typeof data.accountName === "string" && data.accountName) ||
    (typeof data.AccountName === "string" && data.AccountName) ||
    (typeof data.accountId === "string" && data.accountId) ||
    (typeof data.AccountId === "string" && data.AccountId) ||
    null;

  return {
    balance,
    currency: currencyRaw,
    accountLabel,
  };
}

/**
 * Hubtel programmable SMS account profile lookup.
 * Official SDKs reference GET /v1/account/profile (Basic auth). As of 2026-08 this
 * returns HTTP 404 on sms.hubtel.com for programmable keys — balance is dashboard-only.
 */
export async function fetchHubtelAccountProfile(): Promise<HubtelAccountProfileResult> {
  const credentials = getHubtelCredentials();
  if (!credentials) {
    return {
      available: false,
      balance: null,
      currency: null,
      accountLabel: null,
      endpoint: null,
      configuredClientId: null,
      configuredClientIdLabel: null,
      error: "HUBTEL_CLIENT_ID / HUBTEL_CLIENT_SECRET are not configured.",
    };
  }

  const { clientId, authHeader } = credentials;
  const configuredClientId = maskHubtelClientId(clientId);
  const configuredClientIdLabel = describeHubtelClientId(clientId);

  try {
    const response = await fetch(PROFILE_ENDPOINT, {
      method: "GET",
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    const bodyText = await response.text().catch(() => "");
    let parsed: unknown = null;
    try {
      parsed = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      parsed = null;
    }

    if (response.status === 404) {
      return {
        available: false,
        balance: null,
        currency: null,
        accountLabel: null,
        endpoint: PROFILE_ENDPOINT,
        configuredClientId,
        configuredClientIdLabel,
        error:
          "Hubtel programmable SMS keys do not expose a public balance REST endpoint (GET /v1/account/profile → 404). Check balance in Hubtel dashboard under Developers → Programmable API Keys → SMS API Keys.",
      };
    }

    if (!response.ok) {
      return {
        available: false,
        balance: null,
        currency: null,
        accountLabel: null,
        endpoint: PROFILE_ENDPOINT,
        configuredClientId,
        configuredClientIdLabel,
        error: `HTTP ${response.status} from ${PROFILE_ENDPOINT}`,
      };
    }

    const { balance, currency, accountLabel } = parseBalance(parsed);
    if (balance !== null || accountLabel) {
      return {
        available: balance !== null,
        balance,
        currency: currency ?? "GHS",
        accountLabel,
        endpoint: PROFILE_ENDPOINT,
        configuredClientId,
        configuredClientIdLabel,
        error:
          balance === null
            ? "Profile returned without a numeric balance field."
            : null,
      };
    }

    return {
      available: false,
      balance: null,
      currency: null,
      accountLabel,
      endpoint: PROFILE_ENDPOINT,
      configuredClientId,
      configuredClientIdLabel,
      error: `No balance field in response from ${PROFILE_ENDPOINT}`,
    };
  } catch (error) {
    return {
      available: false,
      balance: null,
      currency: null,
      accountLabel: null,
      endpoint: PROFILE_ENDPOINT,
      configuredClientId,
      configuredClientIdLabel,
      error:
        error instanceof Error
          ? `${PROFILE_ENDPOINT}: ${error.message}`
          : `${PROFILE_ENDPOINT}: request failed`,
    };
  }
}

export { getHubtelClientIdLabel };
