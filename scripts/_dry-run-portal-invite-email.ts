/**
 * Dry-run render of shared portal invite emails (no Resend send).
 *   npx tsx scripts/_dry-run-portal-invite-email.ts
 */
import { writeFileSync } from "node:fs";
import { buildPortalInviteEmail } from "../utils/portal-invite-email";

const IGNORE = "If you did not expect this email, you can ignore it.";
const REUSE_HINT =
  "You already have an account. Sign in with your existing password (or use Forgot password if you need a reset).";
const url = "https://example.test/accept-invite?token=dry-run";

const samples = {
  staff: buildPortalInviteEmail({
    portalName: "Staff ERP Portal",
    inviteeDisplayName: "Jamie Staff",
    inviterLine: "Ada Lovelace has invited you to join the Staff ERP Portal.",
    inviteUrl: url,
    expiryDays: 7,
    subject: "You're invited to Davors Facilities ERP",
  }),
  landlord: buildPortalInviteEmail({
    portalName: "Davors Landlord Portal",
    inviteeDisplayName: "Acme Holdings",
    inviterLine:
      "Your landlord account with Davors Facilities is approved. Use the link below to set a password and view your properties, leases, and rent collection status online.",
    inviteUrl: url,
    expiryDays: 7,
    subject: "You're invited to the Davors Landlord Portal",
  }),
  lessee_new: buildPortalInviteEmail({
    portalName: "Davors Tenant Portal",
    inviteeDisplayName: "Jordan Tenant",
    inviterLine:
      "Your landlord (managed by Davors Facilities) has invited you to view your lease and rent status online.",
    inviteUrl: url,
    expiryDays: 7,
    subject: "You're invited to the Davors Tenant Portal",
  }),
  lessee_reuse: buildPortalInviteEmail({
    portalName: "Davors Tenant Portal",
    inviteeDisplayName: "Jordan Tenant",
    inviterLine:
      "Your landlord (managed by Davors Facilities) has invited you to view your lease and rent status online.",
    inviteUrl: url,
    expiryDays: 7,
    subject: "You're invited to the Davors Tenant Portal",
    existingAuthAccount: true,
    reuseSubject: "New lease linked — Davors Tenant Portal",
    reuseHeading: "Davors Tenant Portal",
    reuseInviterLine:
      "Your landlord (managed by Davors Facilities) has invited you to view a lease on the Tenant Portal.",
    reuseLinkPurpose: "link the lease",
    reuseHint: REUSE_HINT,
  }),
  fm_new: buildPortalInviteEmail({
    portalName: "Facility Manager Portal",
    inviteeDisplayName: "Sam Manager",
    inviterLine:
      "David Avors has invited you to manage properties on Davors Facilities.",
    inviteUrl: url,
    expiryDays: 7,
    subject: "You're invited as a Facility Manager — Davors Facilities",
  }),
  fm_reuse: buildPortalInviteEmail({
    portalName: "Facility Manager Portal",
    inviteeDisplayName: "Sam Manager",
    inviterLine:
      "David Avors has invited you to manage properties on Davors Facilities.",
    inviteUrl: url,
    expiryDays: 7,
    subject: "You're invited as a Facility Manager — Davors Facilities",
    existingAuthAccount: true,
    reuseSubject: "Facility Manager access — Davors Facilities",
    reuseHeading: "Davors Facility Manager Portal",
    reuseInviterLine:
      "David Avors has invited you to manage properties on the Facility Manager Portal.",
    reuseLinkPurpose: "link your Facility Manager access",
    reuseHint: REUSE_HINT,
  }),
};

const checks: string[] = [];

for (const [key, content] of Object.entries(samples)) {
  const hasIgnoreHtml = content.html.includes(IGNORE);
  const hasIgnoreText = content.text.includes(IGNORE);
  const hasCta =
    content.html.includes("Accept invite and set your password") ||
    content.html.includes("Accept this invite");
  checks.push(
    `${key}: subject=${JSON.stringify(content.subject)} ignoreHtml=${hasIgnoreHtml} ignoreText=${hasIgnoreText} cta=${hasCta}`,
  );
  if (!hasIgnoreHtml || !hasIgnoreText) {
    throw new Error(`${key}: missing ignore line in html/text`);
  }
}

if (
  !samples.staff.html.includes(
    "Ada Lovelace has invited you to join the Staff ERP Portal.",
  )
) {
  throw new Error("staff: named inviter line missing from HTML");
}
if (!samples.staff.html.includes("Welcome to the Staff ERP Portal")) {
  throw new Error("staff: portal heading mismatch");
}
if (!samples.staff.html.includes("Hi Jamie Staff,")) {
  throw new Error("staff: named invitee greeting missing from HTML");
}
if (
  !samples.landlord.html.includes(
    "Your landlord account with Davors Facilities is approved.",
  )
) {
  throw new Error("landlord: approval wording missing");
}
if (samples.landlord.html.includes("has invited you to")) {
  throw new Error("landlord: should not use third-party invite phrasing");
}

const outPath = "scripts/_dry-run-portal-invite-email-out.txt";
const body = Object.entries(samples)
  .map(
    ([key, c]) =>
      `===== ${key} =====\nSUBJECT: ${c.subject}\n\n--- HTML ---\n${c.html.trim()}\n\n--- TEXT ---\n${c.text}\n`,
  )
  .join("\n");
writeFileSync(outPath, `${checks.join("\n")}\n\n${body}`, "utf8");
console.log(checks.join("\n"));
console.log(`Wrote ${outPath}`);
console.log("PASS dry-run portal invite email renders");
