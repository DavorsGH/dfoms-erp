import "server-only";

export type SendEmailResult =
  | { ok: true; id: string | null }
  | { ok: false; error: string };

export type ResendEmailAttachment = {
  filename: string;
  /** Raw bytes or a base64-encoded string. */
  content: Buffer | Uint8Array | string;
  contentType?: string;
};

function attachmentContentBase64(
  content: Buffer | Uint8Array | string,
): string {
  if (typeof content === "string") {
    return content;
  }
  return Buffer.from(content).toString("base64");
}

/** True when RESEND_API_KEY is present (non-empty after trim). */
export function isResendConfigured(): boolean {
  return Boolean((process.env.RESEND_API_KEY ?? "").trim());
}

export function resendNotConfiguredMessage(): string {
  return "Email sending is not configured (RESEND_API_KEY is missing). No email was sent.";
}

/**
 * Minimal Resend sender. Env: RESEND_API_KEY
 * From: Davors Facilities ERP <noreply@davorsfacilities.com>
 */
export async function sendResendEmail(options: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  attachments?: ResendEmailAttachment[];
}): Promise<SendEmailResult> {
  const apiKey = (process.env.RESEND_API_KEY ?? "").trim();
  if (!apiKey) {
    return { ok: false, error: resendNotConfiguredMessage() };
  }

  const from =
    options.from?.trim() ||
    "Davors Facilities ERP <noreply@davorsfacilities.com>";

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text ?? undefined,
        attachments:
          options.attachments && options.attachments.length > 0
            ? options.attachments.map((attachment) => ({
                filename: attachment.filename,
                content: attachmentContentBase64(attachment.content),
                ...(attachment.contentType
                  ? { content_type: attachment.contentType }
                  : {}),
              }))
            : undefined,
      }),
    });

    const bodyText = await response.text().catch(() => "");
    if (!response.ok) {
      return {
        ok: false,
        error: bodyText || `Resend request failed (${response.status}).`,
      };
    }

    let id: string | null = null;
    try {
      const parsed = JSON.parse(bodyText) as { id?: unknown };
      if (typeof parsed.id === "string" && parsed.id.trim()) {
        id = parsed.id.trim();
      }
    } catch {
      id = null;
    }

    return { ok: true, id };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Resend request failed.",
    };
  }
}
