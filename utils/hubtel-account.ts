import "server-only";

export type HubtelAccountProfileResult = {
  available: boolean;
  balance: number | null;
  currency: string | null;
  accountLabel: string | null;
  endpoint: string | null;
  error: string | null;
};

const PROFILE_ENDPOINTS = [
  "https://sms.hubtel.com/v1/account/profile",
  "https://smsc.hubtel.com/v1/account/profile",
  "https://sms.hubtel.com/v1/account",
  "https://smsc.hubtel.com/v1/account",
] as const;

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
 * Best-effort Hubtel programmable SMS account profile/balance lookup.
 * Hubtel documents dashboard monitoring; REST balance is not guaranteed on all keys.
 */
export async function fetchHubtelAccountProfile(): Promise<HubtelAccountProfileResult> {
  const clientId = (process.env.HUBTEL_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.HUBTEL_CLIENT_SECRET ?? "").trim();

  if (!clientId || !clientSecret) {
    return {
      available: false,
      balance: null,
      currency: null,
      accountLabel: null,
      endpoint: null,
      error: "HUBTEL_CLIENT_ID / HUBTEL_CLIENT_SECRET are not configured.",
    };
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  let lastError = "Hubtel account profile endpoint not available.";

  for (const endpoint of PROFILE_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        headers: {
          Authorization: `Basic ${auth}`,
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

      if (!response.ok) {
        lastError = `HTTP ${response.status} from ${endpoint}`;
        continue;
      }

      const { balance, currency, accountLabel } = parseBalance(parsed);
      if (balance !== null || accountLabel) {
        return {
          available: true,
          balance,
          currency: currency ?? "GHS",
          accountLabel,
          endpoint,
          error: balance === null
            ? "Profile returned without a numeric balance field."
            : null,
        };
      }

      lastError = `No balance field in response from ${endpoint}`;
    } catch (error) {
      lastError =
        error instanceof Error
          ? `${endpoint}: ${error.message}`
          : `${endpoint}: request failed`;
    }
  }

  return {
    available: false,
    balance: null,
    currency: null,
    accountLabel: null,
    endpoint: null,
    error: lastError,
  };
}
