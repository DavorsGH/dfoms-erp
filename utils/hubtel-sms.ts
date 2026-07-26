import "server-only";

export type SendSmsResult =
  | { ok: true; id: string | null }
  | { ok: false; error: string };

/**
 * Minimal Hubtel Programmable SMS sender.
 * Env: HUBTEL_CLIENT_ID, HUBTEL_CLIENT_SECRET, HUBTEL_SMS_FROM
 * Placeholder sender (e.g. DAVORS) until production-approved ID is set.
 */
export async function sendHubtelSms(options: {
  to: string;
  content: string;
  from?: string;
}): Promise<SendSmsResult> {
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
    const response = await fetch("https://smsc.hubtel.com/v1/messages/send", {
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
    if (!response.ok) {
      return {
        ok: false,
        error: bodyText || `Hubtel SMS failed (${response.status}).`,
      };
    }

    let id: string | null = null;
    try {
      const parsed = JSON.parse(bodyText) as {
        MessageId?: unknown;
        messageId?: unknown;
        Data?: { MessageId?: unknown };
      };
      const candidate =
        parsed.MessageId ??
        parsed.messageId ??
        parsed.Data?.MessageId ??
        null;
      if (typeof candidate === "string" && candidate.trim()) {
        id = candidate.trim();
      } else if (typeof candidate === "number") {
        id = String(candidate);
      }
    } catch {
      id = null;
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
