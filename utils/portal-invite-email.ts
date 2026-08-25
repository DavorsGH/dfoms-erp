/**
 * Shared HTML + plain-text builder for portal invite emails.
 * Callers supply persona-specific copy; subjects and CTA behavior stay at the call site.
 */

export type PortalInviteEmailInput = {
  /** Shown in "Welcome to the {portalName}" (new-account) heading. */
  portalName: string;
  /** Used in "Hi {name},". */
  inviteeDisplayName: string;
  /** Full sentence after the greeting (inviter / approval wording). */
  inviterLine: string;
  inviteUrl: string;
  expiryDays: number;
  subject: string;
  /** When true, builds the existing-account (reuse) variant. */
  existingAuthAccount?: boolean;
  reuseSubject?: string;
  /** Heading without "Welcome to the …" (e.g. "Davors Tenant Portal"). */
  reuseHeading?: string;
  reuseInviterLine?: string;
  /** Anchor label in the reuse paragraph. Default: "Accept this invite". */
  reuseCtaLabel?: string;
  /**
   * Phrase after the reuse CTA, e.g. "link the lease" or
   * "link your Facility Manager access".
   */
  reuseLinkPurpose?: string;
  /** Extra hint paragraph (e.g. REUSED_ACCOUNT_LOGIN_HINT). */
  reuseHint?: string;
};

export type PortalInviteEmailContent = {
  subject: string;
  html: string;
  text: string;
};

const DEFAULT_NEW_CTA = "Accept invite and set your password";
const DEFAULT_REUSE_CTA = "Accept this invite";
const IGNORE_LINE = "If you did not expect this email, you can ignore it.";

export function escapePortalInviteHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function expiryFooter(expiryDays: number): string {
  return `This link expires in ${expiryDays} days. ${IGNORE_LINE}`;
}

/**
 * Build invite email HTML + plain text from persona-specific strings.
 * Reuse-account branch is optional (Lessee / Facility Manager).
 */
export function buildPortalInviteEmail(
  input: PortalInviteEmailInput,
): PortalInviteEmailContent {
  const safeName = escapePortalInviteHtml(input.inviteeDisplayName);
  const footer = expiryFooter(input.expiryDays);

  if (input.existingAuthAccount) {
    const subject = input.reuseSubject ?? input.subject;
    const heading = input.reuseHeading ?? input.portalName;
    const inviterLine = input.reuseInviterLine ?? input.inviterLine;
    const ctaLabel = input.reuseCtaLabel ?? DEFAULT_REUSE_CTA;
    const linkPurpose =
      input.reuseLinkPurpose?.trim() || "link your portal access";
    const reuseHint = input.reuseHint?.trim() ?? "";

    const html = `
      <h2>${escapePortalInviteHtml(heading)}</h2>
      <p>Hi ${safeName},</p>
      <p>${escapePortalInviteHtml(inviterLine)}</p>
      <p>You already have a portal account. <a href="${input.inviteUrl}">${escapePortalInviteHtml(ctaLabel)}</a> to ${escapePortalInviteHtml(linkPurpose)}, then sign in with your existing password.</p>
      ${
        reuseHint
          ? `<p>${escapePortalInviteHtml(reuseHint)}</p>`
          : ""
      }
      <p>${footer}</p>
    `;

    const textParts = [
      `Hi ${input.inviteeDisplayName},`,
      "",
      inviterLine,
      "",
      `You already have an account. ${ctaLabel} to ${linkPurpose}, then sign in with your existing password:`,
      input.inviteUrl,
    ];
    if (reuseHint) {
      textParts.push("", reuseHint);
    }
    textParts.push("", footer);

    return {
      subject,
      html,
      text: textParts.join("\n"),
    };
  }

  const inviterLine = input.inviterLine;
  const html = `
      <h2>Welcome to the ${escapePortalInviteHtml(input.portalName)}</h2>
      <p>Hi ${safeName},</p>
      <p>${escapePortalInviteHtml(inviterLine)}</p>
      <p><a href="${input.inviteUrl}">${DEFAULT_NEW_CTA}</a></p>
      <p>${footer}</p>
    `;

  const text = [
    `Welcome to the ${input.portalName}`,
    "",
    `Hi ${input.inviteeDisplayName},`,
    "",
    inviterLine,
    "",
    `${DEFAULT_NEW_CTA}:`,
    input.inviteUrl,
    "",
    footer,
  ].join("\n");

  return {
    subject: input.subject,
    html,
    text,
  };
}
