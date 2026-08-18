import "server-only";

import {
  isNonOtpSmsSendingEnabled,
  type SendSmsResult,
  type SmsSendPurpose,
} from "@/utils/sms-shared";

const FORMULA_DC_SEND_URL =
  "https://api.formula-dc.com/api/v1/external/sms/send";

const MAX_MESSAGE_LENGTH = 1600;
const DEFAULT_SENDER_ID = "Davors-ERP";

type FormulaDcSendResponse = {
  success?: unknown;
  message?: unknown;
  data?: {
    message_id?: unknown;
    recipient?: unknown;
    status?: unknown;
    cost?: unknown;
  };
};

/**
 * Formula-DC expects 233 + 9 digits (no "+" prefix).
 * Call sites mostly pass E.164 (+233…) via normalizeGhanaPhone / toGhanaE164;
 * Hubtel accepts +233…. This adapter normalizes either form for Formula-DC.
 */
export function toFormulaDcRecipient(to: string): string | null {
  const digits = to.trim().replace(/\D/g, "");
  if (!digits) {
    return null;
  }

  if (digits.startsWith("233") && digits.length === 12) {
    return digits;
  }
  if (digits.startsWith("0") && digits.length === 10) {
    return `233${digits.slice(1)}`;
  }
  if (digits.length === 9) {
    return `233${digits}`;
  }

  return null;
}

function resolveFormulaDcSenderId(from?: string): string {
  return (
    from?.trim() ||
    (process.env.FORMULA_DC_SENDER_ID ?? "").trim() ||
    DEFAULT_SENDER_ID
  );
}

/**
 * Formula-DC Programmable SMS sender (single message).
 * Env: FORMULA_DC_API_KEY, FORMULA_DC_SENDER_ID (defaults to Davors-ERP).
 */
export async function sendFormulaDcSms(options: {
  to: string;
  content: string;
  from?: string;
  /** otp = MFA/login codes (message_type OTP); transactional = default. */
  purpose?: SmsSendPurpose;
}): Promise<SendSmsResult> {
  const purpose = options.purpose ?? "transactional";

  if (purpose !== "otp" && !isNonOtpSmsSendingEnabled()) {
    console.warn(
      `[formula-dc-sms] Non-OTP SMS suppressed (purpose=${purpose}, to=${options.to.trim()}). NON_OTP_SMS_ENABLED is not true.`,
    );
    return {
      ok: false,
      error:
        "Non-OTP SMS disabled (NON_OTP_SMS_ENABLED=false; temporary migration kill switch).",
    };
  }

  const apiKey = (process.env.FORMULA_DC_API_KEY ?? "").trim();
  if (!apiKey) {
    return {
      ok: false,
      error: "FORMULA_DC_API_KEY is not configured.",
    };
  }

  const recipient = toFormulaDcRecipient(options.to);
  const message = options.content.trim();
  const senderId = resolveFormulaDcSenderId(options.from);

  if (!recipient) {
    return {
      ok: false,
      error: `Invalid Ghana mobile number for Formula-DC (expected 233 + 9 digits): ${options.to.trim()}`,
    };
  }
  if (!message) {
    return { ok: false, error: "SMS requires to and content." };
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return {
      ok: false,
      error: `SMS message exceeds Formula-DC limit (${MAX_MESSAGE_LENGTH} characters).`,
    };
  }

  const body: Record<string, string> = {
    to: recipient,
    message,
    sender_id: senderId,
  };
  if (purpose === "otp") {
    body.message_type = "OTP";
  }

  try {
    const response = await fetch(FORMULA_DC_SEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const bodyText = await response.text().catch(() => "");

    let parsed: FormulaDcSendResponse | null = null;
    try {
      parsed = JSON.parse(bodyText) as FormulaDcSendResponse;
    } catch {
      parsed = null;
    }

    const apiSuccess = parsed?.success === true;
    if (!response.ok || !apiSuccess) {
      const apiMessage =
        typeof parsed?.message === "string" && parsed.message.trim()
          ? parsed.message.trim()
          : null;
      return {
        ok: false,
        error:
          apiMessage ||
          bodyText ||
          `Formula-DC SMS failed (HTTP ${response.status}).`,
      };
    }

    const candidate = parsed?.data?.message_id ?? null;
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
        error instanceof Error
          ? error.message
          : "Formula-DC SMS request failed.",
    };
  }
}
