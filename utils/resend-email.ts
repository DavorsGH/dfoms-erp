import "server-only";

export type SendEmailResult = { ok: true } | { ok: false; error: string };

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
}): Promise<SendEmailResult> {
  const apiKey = (process.env.RESEND_API_KEY ?? "").trim();
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY is not configured." };
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
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        ok: false,
        error: body || `Resend request failed (${response.status}).`,
      };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Resend request failed.",
    };
  }
}
