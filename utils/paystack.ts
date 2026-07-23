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

/** POST /transaction/initialize — subscription checkout via plan code. */
export async function initializePaystackTransaction(options: {
  email: string;
  planCode: string;
  amountPesewas: number;
  callbackUrl: string;
  currency?: string;
  metadata?: Record<string, unknown>;
}): Promise<PaystackInitializeResult> {
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
      body: JSON.stringify({
        email: options.email,
        amount: options.amountPesewas,
        plan: options.planCode,
        callback_url: options.callbackUrl,
        currency: options.currency ?? "GHS",
        metadata: options.metadata ?? undefined,
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      status?: boolean;
      message?: string;
      data?: {
        authorization_url?: string;
        access_code?: string;
        reference?: string;
      };
    } | null;

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
    }
  | { ok: false; error: string };

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
        customer?: { email?: string | null } | null;
        plan?: { plan_code?: string | null } | string | null;
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

    const plan = payload.data.plan;
    const planCode =
      typeof plan === "string"
        ? plan
        : plan && typeof plan === "object"
          ? (plan.plan_code ?? null)
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
