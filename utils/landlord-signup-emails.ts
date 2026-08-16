import "server-only";

import { sendResendEmail } from "@/utils/resend-email";
import { resolvePublicSiteUrl } from "@/utils/public-site-url";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Confirmation email sent immediately after self-signup (before email verified). */
export async function sendLandlordSignupConfirmationEmail(options: {
  email: string;
  name: string;
  verifyUrl: string;
}): Promise<void> {
  const displayName = options.name.trim() || "there";
  const result = await sendResendEmail({
    to: options.email,
    subject: "Confirm your Landlord Portal email",
    html: `
      <h2>Confirm your email address</h2>
      <p>Hi ${escapeHtml(displayName)},</p>
      <p>Thanks for signing up for the Davors Landlord Portal. Follow the link below to confirm your email address and activate your account.</p>
      <p><a href="${options.verifyUrl}">Confirm email address</a></p>
      <p>If you did not create this account, you can ignore this email.</p>
    `,
    text: `Hi ${displayName},\n\nConfirm your Landlord Portal email:\n${options.verifyUrl}\n\nIf you did not create this account, you can ignore this email.`,
  });

  if (!result.ok) {
    console.error(
      "[landlord-signup-emails] confirmation email failed:",
      result.error,
    );
  }
}

/** Welcome email sent after email confirmation auto-approves the landlord. */
export async function sendLandlordSelfSignupWelcomeEmail(options: {
  email: string;
  name: string;
}): Promise<void> {
  const siteUrl = resolvePublicSiteUrl().replace(/\/$/, "");
  const loginUrl = `${siteUrl}/landlord-portal/login`;
  const displayName = options.name.trim() || "there";

  const result = await sendResendEmail({
    to: options.email,
    subject: "Welcome to the Davors Landlord Portal",
    html: `
      <h2>Welcome to the Davors Landlord Portal</h2>
      <p>Hi ${escapeHtml(displayName)},</p>
      <p>Your email is confirmed and your landlord account is active. Sign in to manage properties, leases, rent collection, and more.</p>
      <p><a href="${loginUrl}">Sign in to the Landlord Portal</a></p>
      <p>Your account includes a 90-day trial to explore the platform.</p>
    `,
    text: `Hi ${displayName},\n\nYour Landlord Portal account is active.\n\nSign in: ${loginUrl}\n\nYour account includes a 90-day trial to explore the platform.`,
  });

  if (!result.ok) {
    console.error(
      "[landlord-signup-emails] welcome email failed:",
      result.error,
    );
  }
}
