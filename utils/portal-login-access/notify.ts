import "server-only";

import { sendResendEmail, RESEND_PLATFORM_FROM } from "@/utils/resend-email";
import type { PortalLoginActorPersona } from "./types";

function supportActorLabel(actorPersona: PortalLoginActorPersona): string {
  if (actorPersona === "landlord") return "your landlord";
  if (actorPersona === "tenant_admin") return "your administrator";
  return "Davors support";
}

export async function notifyLoginEmailChanged(options: {
  oldEmail: string;
  newEmail: string;
  actorPersona: PortalLoginActorPersona;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const by = supportActorLabel(options.actorPersona);
  const subject = "Your DavSuite login email was updated";
  const text = [
    `Your DavSuite portal login email was changed by ${by}.`,
    "",
    `Previous login email: ${options.oldEmail}`,
    `New login email: ${options.newEmail}`,
    "",
    "If you did not request this change, contact Davors support immediately.",
  ].join("\n");
  const html = `<p>Your DavSuite portal login email was changed by <strong>${by}</strong>.</p>
<p>Previous login email: ${options.oldEmail}<br/>New login email: ${options.newEmail}</p>
<p>If you did not request this change, contact Davors support immediately.</p>`;

  const recipients = Array.from(
    new Set([
      options.oldEmail.trim().toLowerCase(),
      options.newEmail.trim().toLowerCase(),
    ]),
  );

  const failures: string[] = [];
  for (const to of recipients) {
    const result = await sendResendEmail({
      to,
      subject,
      html,
      text,
      from: RESEND_PLATFORM_FROM,
    });
    if (!result.ok) {
      failures.push(result.error);
    }
  }

  if (failures.length > 0) {
    return { ok: false, error: failures[0] ?? "Notification email failed." };
  }
  return { ok: true };
}

export async function notifyTemporaryPasswordSet(options: {
  loginEmail: string;
  actorPersona: PortalLoginActorPersona;
  created: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const by = supportActorLabel(options.actorPersona);
  const subject = options.created
    ? "Your DavSuite portal login was created"
    : "A temporary password was set for your DavSuite login";
  const action = options.created
    ? `A portal login was created for you by ${by}.`
    : `A temporary password was set for your DavSuite portal login by ${by}.`;
  const text = [
    action,
    "",
    "You must choose a new password the next time you sign in. The temporary password expires after 72 hours.",
    "",
    "If you did not request this change, contact Davors support immediately.",
  ].join("\n");
  const html = `<p>${action}</p>
<p>You must choose a new password the next time you sign in. The temporary password expires after 72 hours.</p>
<p>If you did not request this change, contact Davors support immediately.</p>`;

  const result = await sendResendEmail({
    to: options.loginEmail.trim().toLowerCase(),
    subject,
    html,
    text,
    from: RESEND_PLATFORM_FROM,
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return { ok: true };
}
