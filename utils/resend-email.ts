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

/** Verified Resend sending address (domain must stay fixed). */
export const RESEND_NOREPLY_ADDRESS = "noreply@davorsfacilities.com";

/** Platform default From when no tenant display name applies (invites, signup, etc.). */
export const RESEND_PLATFORM_FROM = `Davors Facilities ERP <${RESEND_NOREPLY_ADDRESS}>`;

/**
 * Build a Resend `from` value: `"Display Name <noreply@…>"`.
 * Only the display name changes; the verified address is always `RESEND_NOREPLY_ADDRESS`.
 */
export function formatResendFrom(displayName: string): string {
  const cleaned = displayName
    .replace(/[\r\n<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const name = cleaned || "Notification";
  const needsQuotes = /[,;@"]/.test(name);
  const safeName = needsQuotes
    ? `"${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
    : name;
  return `${safeName} <${RESEND_NOREPLY_ADDRESS}>`;
}

/**
 * Minimal Resend sender. Env: RESEND_API_KEY
 * Default From: Davors Facilities ERP <noreply@davorsfacilities.com>
 * Pass `from` via formatResendFrom(tenantCompanyName) for tenant-branded mail.
 */
export async function sendResendEmail(options: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  /** Optional Reply-To (e.g. business unit business_email). */
  replyTo?: string | null;
  attachments?: ResendEmailAttachment[];
}): Promise<SendEmailResult> {
  const apiKey = (process.env.RESEND_API_KEY ?? "").trim();
  if (!apiKey) {
    return { ok: false, error: resendNotConfiguredMessage() };
  }

  const from = options.from?.trim() || RESEND_PLATFORM_FROM;
  const replyTo = options.replyTo?.trim() || null;

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
        ...(replyTo ? { reply_to: replyTo } : {}),
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
