import "server-only";

import { sendResendEmail } from "@/utils/resend-email";

/**
 * Platform-level recipient for ops alerts (signups, paid conversions).
 * Tenant-independent — not billing_settings.email_recipient (per-tenant invoices).
 */
export function getAdminNotificationEmail(): string | null {
  const email = (process.env.ADMIN_NOTIFICATION_EMAIL ?? "").trim();
  return email.length > 0 ? email : null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function notifyAdminBestEffort(options: {
  subject: string;
  html: string;
  text: string;
  context: string;
}): Promise<void> {
  try {
    const to = getAdminNotificationEmail();
    if (!to) {
      console.warn(
        `[admin-notifications] Skipping ${options.context}: ADMIN_NOTIFICATION_EMAIL is not set.`,
      );
      return;
    }

    const result = await sendResendEmail({
      to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });

    if (!result.ok) {
      console.error(
        `[admin-notifications] Failed ${options.context}: ${result.error}`,
      );
    }
  } catch (error) {
    console.error(
      `[admin-notifications] Failed ${options.context}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

/** EVENT 2a — new tenant trial signup. */
export async function notifyNewTenantSignup(options: {
  tenantName: string;
  adminEmail: string;
  trialEndDate: string;
}): Promise<void> {
  const subject = `New ERP Suite signup (trial): ${options.tenantName}`;
  const text = [
    "A new tenant signed up and started a trial.",
    "",
    `Tenant: ${options.tenantName}`,
    `Event: New signup (trial)`,
    `Admin email: ${options.adminEmail}`,
    `Trial ends: ${options.trialEndDate}`,
  ].join("\n");

  const html = `
    <h2>New ERP Suite signup</h2>
    <p>A new tenant signed up and started a trial.</p>
    <ul>
      <li><strong>Tenant:</strong> ${escapeHtml(options.tenantName)}</li>
      <li><strong>Event:</strong> New signup (trial)</li>
      <li><strong>Admin email:</strong> ${escapeHtml(options.adminEmail)}</li>
      <li><strong>Trial ends:</strong> ${escapeHtml(options.trialEndDate)}</li>
    </ul>
  `.trim();

  await notifyAdminBestEffort({
    subject,
    html,
    text,
    context: `signup:${options.tenantName}`,
  });
}

/** EVENT 2b — trial (or unpaid) subscription converted to paid/active. */
export async function notifySubscriptionConvertedToPaid(options: {
  tenantName: string;
  tierName: string | null;
  amountLabel: string | null;
}): Promise<void> {
  const tier = options.tierName?.trim() || "Unknown tier";
  const amount = options.amountLabel?.trim() || "Amount not available";
  const subject = `Subscription converted to paid: ${options.tenantName}`;
  const text = [
    "A tenant subscription converted from trial to paid/active.",
    "",
    `Tenant: ${options.tenantName}`,
    `Event: Converted to paid`,
    `Tier: ${tier}`,
    `Amount: ${amount}`,
  ].join("\n");

  const html = `
    <h2>Subscription converted to paid</h2>
    <p>A tenant subscription converted from trial to paid/active.</p>
    <ul>
      <li><strong>Tenant:</strong> ${escapeHtml(options.tenantName)}</li>
      <li><strong>Event:</strong> Converted to paid</li>
      <li><strong>Tier:</strong> ${escapeHtml(tier)}</li>
      <li><strong>Amount:</strong> ${escapeHtml(amount)}</li>
    </ul>
  `.trim();

  await notifyAdminBestEffort({
    subject,
    html,
    text,
    context: `paid-conversion:${options.tenantName}`,
  });
}
