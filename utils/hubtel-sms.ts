import "server-only";

import {
  isNonOtpSmsSendingEnabled,
  type SendSmsResult,
  type SmsSendPurpose,
} from "@/utils/sms-shared";

export type { SendSmsResult, SmsSendPurpose } from "@/utils/sms-shared";
export { isNonOtpSmsSendingEnabled } from "@/utils/sms-shared";

import { sendFormulaDcSms } from "@/utils/formula-dc-sms";
import { resolveSmsProvider } from "@/utils/sms-provider";

type HubtelSendResponse = {
  status?: unknown;
  statusDescription?: unknown;
  MessageId?: unknown;
  messageId?: unknown;
  Data?: { MessageId?: unknown };
};

/**
 * Minimal Hubtel Programmable SMS sender.
 * Env: HUBTEL_CLIENT_ID, HUBTEL_CLIENT_SECRET, HUBTEL_SMS_FROM
 * Placeholder sender (e.g. DAVORS) until production-approved ID is set.
 *
 * When SMS_PROVIDER=formula_dc, delegates to Formula-DC before Hubtel logic runs.
 */
export async function sendHubtelSms(options: {
  to: string;
  content: string;
  from?: string;
  /** otp = MFA/login codes; transactional = all tenant notifications (default). */
  purpose?: SmsSendPurpose;
}): Promise<SendSmsResult> {
  if (resolveSmsProvider() === "formula_dc") {
    return sendFormulaDcSms(options);
  }

  const purpose = options.purpose ?? "transactional";

  if (purpose !== "otp" && !isNonOtpSmsSendingEnabled()) {
    console.warn(
      `[hubtel-sms] Non-OTP SMS suppressed (purpose=${purpose}, to=${options.to.trim()}). NON_OTP_SMS_ENABLED is not true.`,
    );
    return {
      ok: false,
      error:
        "Non-OTP SMS disabled (NON_OTP_SMS_ENABLED=false; temporary Hubtel migration kill switch).",
    };
  }

  const clientId = (process.env.HUBTEL_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.HUBTEL_CLIENT_SECRET ?? "").trim();
  const from =
    options.from?.trim() ||
    (process.env.HUBTEL_SMS_FROM ?? "").trim() ||
    "DAVORS";

  if (!clientId || !clientSecret) {
    return {
      ok: false,
      error: "HUBTEL_CLIENT_ID / HUBTEL_CLIENT_SECRET are not configured.",
    };
  }

  const to = options.to.trim();
  const content = options.content.trim();
  if (!to || !content) {
    return { ok: false, error: "SMS requires to and content." };
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  try {
    const response = await fetch("https://sms.hubtel.com/v1/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        From: from,
        To: to,
        Content: content,
      }),
    });

    const bodyText = await response.text().catch(() => "");

    let parsed: HubtelSendResponse | null = null;
    try {
      parsed = JSON.parse(bodyText) as HubtelSendResponse;
    } catch {
      parsed = null;
    }

    const hubtelStatus =
      typeof parsed?.status === "number"
        ? parsed.status
        : typeof parsed?.status === "string" &&
            /^\d+$/.test(parsed.status.trim())
          ? Number(parsed.status.trim())
          : null;

    const statusDescription =
      typeof parsed?.statusDescription === "string" &&
      parsed.statusDescription.trim()
        ? parsed.statusDescription.trim()
        : null;

    // Hubtel can return HTTP 2xx with body status !== 0 (e.g. 100 invalid request).
    const httpOk = response.status === 200 || response.status === 201;
    if (!httpOk || hubtelStatus !== 0) {
      return {
        ok: false,
        error:
          statusDescription ||
          bodyText ||
          `Hubtel SMS failed (HTTP ${response.status}, status=${hubtelStatus ?? "n/a"}).`,
      };
    }

    const candidate =
      parsed?.MessageId ??
      parsed?.messageId ??
      parsed?.Data?.MessageId ??
      null;

    let id: string | null = null;
    if (typeof candidate === "string" && candidate.trim()) {
      id = candidate.trim();
    } else if (typeof candidate === "number") {
      id = String(candidate);
    }

    return { ok: true, id };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Hubtel SMS request failed.",
    };
  }
}
