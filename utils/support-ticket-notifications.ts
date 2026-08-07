import "server-only";

import { getAdminNotificationEmail } from "@/utils/admin-notifications";
import { sendResendEmail } from "@/utils/resend-email";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getSupportTicketAdminUrl(ticketId: string): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://portal.davorsfacilities.com").replace(
    /\/$/,
    "",
  );
  return `${base}/dashboard/administration/support-tickets?ticket=${encodeURIComponent(ticketId)}`;
}

/** Notify Davors platform support when a tenant submits a ticket. */
export async function notifySupportTicketSubmitted(options: {
  ticketId: string;
  tenantName: string;
  subject: string;
}): Promise<void> {
  try {
    const to = getAdminNotificationEmail();
    if (!to) {
      console.warn(
        "[support-tickets] Skipping admin email: ADMIN_NOTIFICATION_EMAIL is not set.",
      );
      return;
    }

    const ticketUrl = getSupportTicketAdminUrl(options.ticketId);
    const subject = `Support ticket: ${options.subject}`;
    const text = [
      "A tenant submitted a support ticket.",
      "",
      `Tenant: ${options.tenantName}`,
      `Subject: ${options.subject}`,
      `View ticket: ${ticketUrl}`,
    ].join("\n");

    const html = `
      <h2>New support ticket</h2>
      <p>A tenant submitted a support ticket via Report a Problem.</p>
      <ul>
        <li><strong>Tenant:</strong> ${escapeHtml(options.tenantName)}</li>
        <li><strong>Subject:</strong> ${escapeHtml(options.subject)}</li>
      </ul>
      <p><a href="${escapeHtml(ticketUrl)}">Open ticket in Davors admin</a></p>
    `.trim();

    const result = await sendResendEmail({ to, subject, html, text });
    if (!result.ok) {
      console.error(
        `[support-tickets] Admin notification failed for ${options.ticketId}: ${result.error}`,
      );
    }
  } catch (error) {
    console.error(
      "[support-tickets] Admin notification error:",
      error instanceof Error ? error.message : error,
    );
  }
}
