import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

const PAYSTACK_BASE = "https://api.paystack.co";

export function getPaystackSecretKey(): string | null {
  const key = (process.env.PAYSTACK_SECRET_KEY ?? "").trim();
  return key || null;
}

export function ghsToPesewas(ghs: number): number {
  return Math.round(Number(ghs) * 100);
}

function requireSecretKey():
  | { ok: true; secretKey: string }
  | { ok: false; error: string } {
  const secretKey = getPaystackSecretKey();
  if (!secretKey) {
    return { ok: false, error: "PAYSTACK_SECRET_KEY is not configured." };
  }

  if (!secretKey.startsWith("sk_test_") && !secretKey.startsWith("sk_live_")) {
    return { ok: false, error: "PAYSTACK_SECRET_KEY has an unexpected format." };
  }

  return { ok: true, secretKey };
}

/**
 * Updates a Paystack Plan amount. Uses Paystack defaults for
 * update_existing_subscriptions (true when omitted) — existing subscriptions
 * on this plan are affected as well as new ones.
 */
export async function updatePaystackPlanAmount(options: {
  planCode: string;
  amountPesewas: number;
  currency?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = requireSecretKey();
  if (!auth.ok) {
    return auth;
  }

  try {
    const response = await fetch(
      `${PAYSTACK_BASE}/plan/${encodeURIComponent(options.planCode)}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${auth.secretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: options.amountPesewas,
          currency: options.currency ?? "GHS",
        }),
      },
    );

    const payload = (await response.json().catch(() => null)) as {
      status?: boolean;
      message?: string;
    } | null;

    if (!response.ok || payload?.status === false) {
      return {
        ok: false,
        error:
          payload?.message ??
          `Paystack plan update failed (${response.status}).`,
      };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Paystack plan update request failed.",
    };
  }
}

export type PaystackInitializeResult =
  | {
      ok: true;
      authorizationUrl: string;
      accessCode: string;
      reference: string;
    }
  | { ok: false; error: string };

type PaystackInitializePayload = {
  status?: boolean;
  message?: string;
  data?: {
    authorization_url?: string;
    access_code?: string;
    reference?: string;
  };
};

async function postPaystackInitialize(
  body: Record<string, unknown>,
): Promise<PaystackInitializeResult> {
  const auth = requireSecretKey();
  if (!auth.ok) {
    return auth;
  }

  try {
    const response = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const payload = (await response.json().catch(() => null)) as
      | PaystackInitializePayload
      | null;

    if (!response.ok || payload?.status === false) {
      return {
        ok: false,
        error:
          payload?.message ??
          `Paystack initialize failed (${response.status}).`,
      };
    }

    const authorizationUrl = payload?.data?.authorization_url?.trim() ?? "";
    const accessCode = payload?.data?.access_code?.trim() ?? "";
    const reference = payload?.data?.reference?.trim() ?? "";

    if (!authorizationUrl || !reference) {
      return {
        ok: false,
        error:
          "Paystack initialize response missing authorization_url/reference.",
      };
    }

    return {
      ok: true,
      authorizationUrl,
      accessCode,
      reference,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Paystack initialize request failed.",
    };
  }
}

/** POST /transaction/initialize — subscription checkout via plan code. */
export async function initializePaystackTransaction(options: {
  email: string;
  planCode: string;
  amountPesewas: number;
  callbackUrl: string;
  currency?: string;
  metadata?: Record<string, unknown>;
}): Promise<PaystackInitializeResult> {
  return postPaystackInitialize({
    email: options.email,
    amount: options.amountPesewas,
    plan: options.planCode,
    callback_url: options.callbackUrl,
    currency: options.currency ?? "GHS",
    metadata: options.metadata ?? undefined,
  });
}

/**
 * POST /transaction/initialize — one-off charge (no plan).
 * Used for POS / product-sale payment links (card or MoMo).
 */
export async function initializePaystackOneOffTransaction(options: {
  email: string;
  amountPesewas: number;
  callbackUrl: string;
  currency?: string;
  metadata?: Record<string, unknown>;
  channels?: string[];
  /**
   * Tenant fund routing: the Paystack subaccount code (ACCT_…) of the tenant's
   * settlement account. POS / product-sale customer payments belong to the
   * tenant, not the platform, so for that flow this is NOT optional — callers
   * must resolve the tenant's active subaccount (billing_settings) and block
   * the charge if it is missing. Paystack settles the split into the
   * subaccount's bank account automatically.
   */
  subaccountCode?: string;
}): Promise<PaystackInitializeResult> {
  const body: Record<string, unknown> = {
    email: options.email,
    amount: options.amountPesewas,
    callback_url: options.callbackUrl,
    currency: options.currency ?? "GHS",
    metadata: options.metadata ?? undefined,
  };

  if (options.channels && options.channels.length > 0) {
    body.channels = options.channels;
  }

  // Paystack single-split param is `subaccount` (split_code is for multi-split).
  if (options.subaccountCode?.trim()) {
    body.subaccount = options.subaccountCode.trim();
  }

  return postPaystackInitialize(body);
}

export type PaystackVerifyResult =
  | {
      ok: true;
      status: string;
      reference: string;
      amount: number | null;
      currency: string | null;
      paidAt: string | null;
      gatewayResponse: string | null;
      customerEmail: string | null;
      planCode: string | null;
      /** Paystack channel used for the charge (card, mobile_money, …). */
      channel: string | null;
      authorizationCode: string | null;
      authorizationEmail: string | null;
      authorizationChannel: string | null;
      authorizationReusable: boolean | null;
      metadata: Record<string, unknown>;
    }
  | { ok: false; error: string };

function parsePaystackVerifyMetadata(
  raw: Record<string, unknown> | string | null | undefined,
): Record<string, unknown> {
  if (!raw) {
    return {};
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed.startsWith("{")) {
      return {};
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
    return {};
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw;
  }
  return {};
}

/** GET /transaction/verify/:reference */
export async function verifyPaystackTransaction(
  reference: string,
): Promise<PaystackVerifyResult> {
  const auth = requireSecretKey();
  if (!auth.ok) {
    return auth;
  }

  const trimmed = reference.trim();
  if (!trimmed) {
    return { ok: false, error: "Missing payment reference." };
  }

  try {
    const response = await fetch(
      `${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(trimmed)}`,
      {
        headers: {
          Authorization: `Bearer ${auth.secretKey}`,
        },
      },
    );

    const payload = (await response.json().catch(() => null)) as {
      status?: boolean;
      message?: string;
      data?: {
        status?: string;
        reference?: string;
        amount?: number;
        currency?: string;
        paid_at?: string | null;
        gateway_response?: string | null;
        channel?: string | null;
        customer?: { email?: string | null } | null;
        plan?: { plan_code?: string | null } | string | null;
        plan_object?: { plan_code?: string | null } | string | null;
        authorization?: {
          authorization_code?: string | null;
          email?: string | null;
          channel?: string | null;
          reusable?: boolean | null;
        } | null;
        metadata?: Record<string, unknown> | string | null;
      };
    } | null;

    if (!response.ok || payload?.status === false || !payload?.data) {
      return {
        ok: false,
        error:
          payload?.message ??
          `Paystack verify failed (${response.status}).`,
      };
    }

    const planCandidates = [payload.data.plan, payload.data.plan_object];
    let planCode: string | null = null;
    for (const plan of planCandidates) {
      if (typeof plan === "string" && plan.trim()) {
        planCode = plan.trim();
        break;
      }
      if (plan && typeof plan === "object" && plan.plan_code?.trim()) {
        planCode = plan.plan_code.trim();
        break;
      }
    }

    const channel =
      (typeof payload.data.channel === "string" &&
      payload.data.channel.trim()
        ? payload.data.channel.trim()
        : null) ??
      (typeof payload.data.authorization?.channel === "string" &&
      payload.data.authorization.channel.trim()
        ? payload.data.authorization.channel.trim()
        : null);

    const authorizationCode =
      typeof payload.data.authorization?.authorization_code === "string" &&
      payload.data.authorization.authorization_code.trim()
        ? payload.data.authorization.authorization_code.trim()
        : null;
    const authorizationEmail =
      typeof payload.data.authorization?.email === "string" &&
      payload.data.authorization.email.trim()
        ? payload.data.authorization.email.trim()
        : null;
    const authorizationChannel =
      typeof payload.data.authorization?.channel === "string" &&
      payload.data.authorization.channel.trim()
        ? payload.data.authorization.channel.trim()
        : null;
    const authorizationReusable =
      typeof payload.data.authorization?.reusable === "boolean"
        ? payload.data.authorization.reusable
        : null;

    return {
      ok: true,
      status: payload.data.status ?? "unknown",
      reference: payload.data.reference ?? trimmed,
      amount: payload.data.amount ?? null,
      currency: payload.data.currency ?? null,
      paidAt: payload.data.paid_at ?? null,
      gatewayResponse: payload.data.gateway_response ?? null,
      customerEmail: payload.data.customer?.email ?? null,
      planCode,
      channel,
      authorizationCode,
      authorizationEmail,
      authorizationChannel,
      authorizationReusable,
      metadata: parsePaystackVerifyMetadata(payload.data.metadata),
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Paystack verify request failed.",
    };
  }
}

/**
 * Verify x-paystack-signature: HMAC SHA512 of the raw request body with the
 * secret key. Uses timing-safe comparison.
 */
export function verifyPaystackWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  const auth = requireSecretKey();
  if (!auth.ok) {
    return false;
  }

  const signature = (signatureHeader ?? "").trim();
  if (!signature) {
    return false;
  }

  const expected = createHmac("sha512", auth.secretKey)
    .update(rawBody, "utf8")
    .digest("hex");

  try {
    const expectedBuf = Buffer.from(expected, "utf8");
    const actualBuf = Buffer.from(signature, "utf8");
    if (expectedBuf.length !== actualBuf.length) {
      return false;
    }
    return timingSafeEqual(expectedBuf, actualBuf);
  } catch {
    return false;
  }
}

export type PaystackSubscriptionAuthorization = {
  last4: string | null;
  brand: string | null;
  expMonth: string | null;
  expYear: string | null;
  channel: string | null;
  reusable: boolean | null;
};

export type PaystackSubscriptionDetails = {
  subscriptionCode: string;
  emailToken: string | null;
  status: string | null;
  nextPaymentDate: string | null;
  authorization: PaystackSubscriptionAuthorization | null;
};

function parsePaystackSubscriptionAuthorization(
  raw: unknown,
): PaystackSubscriptionAuthorization | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const authorization = raw as Record<string, unknown>;
  const last4 =
    typeof authorization.last4 === "string" && authorization.last4.trim()
      ? authorization.last4.trim()
      : null;
  const brand =
    (typeof authorization.brand === "string" && authorization.brand.trim()
      ? authorization.brand.trim()
      : null) ??
    (typeof authorization.card_type === "string" &&
    authorization.card_type.trim()
      ? authorization.card_type.trim()
      : null);
  const expMonth =
    authorization.exp_month != null
      ? String(authorization.exp_month).trim() || null
      : null;
  const expYear =
    authorization.exp_year != null
      ? String(authorization.exp_year).trim() || null
      : null;
  const channel =
    typeof authorization.channel === "string" && authorization.channel.trim()
      ? authorization.channel.trim()
      : null;
  const reusable =
    typeof authorization.reusable === "boolean" ? authorization.reusable : null;

  if (!last4 && !brand && !expMonth && !expYear && !channel) {
    return null;
  }

  return {
    last4,
    brand,
    expMonth,
    expYear,
    channel,
    reusable,
  };
}

/** GET /subscription/:code_or_id */
export async function fetchPaystackSubscription(
  subscriptionCodeOrId: string,
): Promise<
  { ok: true; subscription: PaystackSubscriptionDetails } | { ok: false; error: string }
> {
  const auth = requireSecretKey();
  if (!auth.ok) {
    return auth;
  }

  const trimmed = subscriptionCodeOrId.trim();
  if (!trimmed) {
    return { ok: false, error: "Missing Paystack subscription code." };
  }

  try {
    const response = await fetch(
      `${PAYSTACK_BASE}/subscription/${encodeURIComponent(trimmed)}`,
      {
        headers: {
          Authorization: `Bearer ${auth.secretKey}`,
        },
      },
    );

    const payload = (await response.json().catch(() => null)) as {
      status?: boolean;
      message?: string;
      data?: {
        subscription_code?: string;
        email_token?: string;
        status?: string;
        next_payment_date?: string | null;
        authorization?: unknown;
      };
    } | null;

    if (!response.ok || payload?.status === false || !payload?.data) {
      return {
        ok: false,
        error:
          payload?.message ??
          `Paystack subscription fetch failed (${response.status}).`,
      };
    }

    const subscriptionCode =
      payload.data.subscription_code?.trim() || trimmed;
    const emailToken = payload.data.email_token?.trim() || null;

    return {
      ok: true,
      subscription: {
        subscriptionCode,
        emailToken,
        status: payload.data.status ?? null,
        nextPaymentDate: payload.data.next_payment_date ?? null,
        authorization: parsePaystackSubscriptionAuthorization(
          payload.data.authorization,
        ),
      },
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Paystack subscription fetch request failed.",
    };
  }
}

/** GET /subscription/:code/manage/link — hosted page to add or replace subscription card. */
export async function fetchPaystackSubscriptionManageLink(
  subscriptionCodeOrId: string,
): Promise<{ ok: true; link: string } | { ok: false; error: string }> {
  const auth = requireSecretKey();
  if (!auth.ok) {
    return auth;
  }

  const trimmed = subscriptionCodeOrId.trim();
  if (!trimmed) {
    return { ok: false, error: "Missing Paystack subscription code." };
  }

  try {
    const response = await fetch(
      `${PAYSTACK_BASE}/subscription/${encodeURIComponent(trimmed)}/manage/link`,
      {
        headers: {
          Authorization: `Bearer ${auth.secretKey}`,
        },
      },
    );

    const payload = (await response.json().catch(() => null)) as {
      status?: boolean;
      message?: string;
      data?: {
        link?: string;
      };
    } | null;

    if (!response.ok || payload?.status === false || !payload?.data) {
      return {
        ok: false,
        error:
          payload?.message ??
          `Paystack subscription manage link failed (${response.status}).`,
      };
    }

    const link = payload.data.link?.trim() ?? "";
    if (!link) {
      return {
        ok: false,
        error: "Paystack manage link response missing link URL.",
      };
    }

    return { ok: true, link };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Paystack subscription manage link request failed.",
    };
  }
}

/** POST /subscription/disable — stops future charges; current period remains paid. */
export async function disablePaystackSubscription(options: {
  subscriptionCode: string;
  emailToken: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = requireSecretKey();
  if (!auth.ok) {
    return auth;
  }

  const code = options.subscriptionCode.trim();
  const token = options.emailToken.trim();
  if (!code || !token) {
    return {
      ok: false,
      error: "Paystack subscription code and email token are required.",
    };
  }

  try {
    const response = await fetch(`${PAYSTACK_BASE}/subscription/disable`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code, token }),
    });

    const payload = (await response.json().catch(() => null)) as {
      status?: boolean;
      message?: string;
    } | null;

    if (!response.ok || payload?.status === false) {
      return {
        ok: false,
        error:
          payload?.message ??
          `Paystack subscription disable failed (${response.status}).`,
      };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Paystack subscription disable request failed.",
    };
  }
}

export type PaystackChargeAuthorizationResult =
  | {
      ok: true;
      reference: string;
      status: string;
      gatewayResponse: string | null;
    }
  | { ok: false; error: string };

/** POST /transaction/charge_authorization — off-session charge with stored auth code. */
export async function chargePaystackAuthorization(options: {
  authorizationCode: string;
  email: string;
  amountPesewas: number;
  reference: string;
  currency?: string;
  metadata?: Record<string, unknown>;
}): Promise<PaystackChargeAuthorizationResult> {
  const auth = requireSecretKey();
  if (!auth.ok) {
    return auth;
  }

  const authorizationCode = options.authorizationCode.trim();
  const email = options.email.trim();
  const reference = options.reference.trim();
  if (!authorizationCode || !email || !reference) {
    return {
      ok: false,
      error: "authorization_code, email, and reference are required.",
    };
  }
  if (!Number.isFinite(options.amountPesewas) || options.amountPesewas <= 0) {
    return { ok: false, error: "amount must be a positive integer (pesewas)." };
  }

  try {
    const response = await fetch(`${PAYSTACK_BASE}/transaction/charge_authorization`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        authorization_code: authorizationCode,
        email,
        amount: options.amountPesewas,
        currency: options.currency ?? "GHS",
        reference,
        metadata: options.metadata ?? undefined,
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      status?: boolean;
      message?: string;
      data?: {
        status?: string;
        reference?: string;
        gateway_response?: string | null;
      };
    } | null;

    if (!response.ok || payload?.status === false || !payload?.data) {
      return {
        ok: false,
        error:
          payload?.message ??
          `Paystack charge_authorization failed (${response.status}).`,
      };
    }

    const paystackStatus = payload.data.status ?? "unknown";
    if (paystackStatus !== "success") {
      return {
        ok: false,
        error:
          payload.data.gateway_response?.trim() ||
          payload.message ||
          `Charge not successful (status: ${paystackStatus}).`,
      };
    }

    return {
      ok: true,
      reference: payload.data.reference ?? reference,
      status: paystackStatus,
      gatewayResponse: payload.data.gateway_response ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Paystack charge_authorization request failed.",
    };
  }
}

export type PaystackListedTransaction = {
  reference: string;
  amountPesewas: number;
  status: string;
  paidAt: string | null;
};

type PaystackListTransactionsPayload = {
  status?: boolean;
  message?: string;
  data?: Array<{
    reference?: string;
    amount?: number;
    status?: string;
    paid_at?: string;
    created_at?: string;
  }>;
  meta?: {
    page?: number;
    pageCount?: number;
    perPage?: number;
    total?: number;
  };
};

/** GET /transaction — list transactions in a date window (paginated). */
export async function listPaystackTransactions(options: {
  from: string;
  to: string;
  status?: string;
  perPage?: number;
}): Promise<
  | { ok: true; transactions: PaystackListedTransaction[] }
  | { ok: false; error: string }
> {
  const auth = requireSecretKey();
  if (!auth.ok) {
    return auth;
  }

  const perPage = options.perPage ?? 100;
  const transactions: PaystackListedTransaction[] = [];
  let page = 1;
  let pageCount = 1;

  try {
    while (page <= pageCount) {
      const params = new URLSearchParams({
        from: options.from,
        to: options.to,
        perPage: String(perPage),
        page: String(page),
      });
      if (options.status?.trim()) {
        params.set("status", options.status.trim());
      }

      const response = await fetch(`${PAYSTACK_BASE}/transaction?${params}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${auth.secretKey}`,
        },
      });

      const payload = (await response.json().catch(() => null)) as
        | PaystackListTransactionsPayload
        | null;

      if (!response.ok || payload?.status === false) {
        return {
          ok: false,
          error:
            payload?.message ??
            `Paystack transaction list failed (${response.status}).`,
        };
      }

      for (const row of payload?.data ?? []) {
        const reference = row.reference?.trim() ?? "";
        const amountPesewas =
          typeof row.amount === "number" && Number.isFinite(row.amount)
            ? row.amount
            : null;
        const status = row.status?.trim() ?? "";
        if (!reference || amountPesewas == null || !status) {
          continue;
        }

        transactions.push({
          reference,
          amountPesewas,
          status,
          paidAt: row.paid_at?.trim() || row.created_at?.trim() || null,
        });
      }

      pageCount = payload?.meta?.pageCount ?? page;
      page += 1;
    }

    return { ok: true, transactions };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Paystack transaction list request failed.",
    };
  }
}
