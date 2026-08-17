import { ensureSecurityNotifications } from "@/utils/security-notifications";

export const dynamic = "force-dynamic";

export default async function PortalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { getPortalLesseeSession } = await import("@/utils/lessee-portal-auth");
  const session = await getPortalLesseeSession();

  if (session) {
    await ensureSecurityNotifications({
      authUid: session.authUserId,
      persona: "lessee",
      tenantId: session.tenantId,
      lesseeId: session.lesseeId,
      passwordActionUrl: "/portal/account",
      mfaActionUrl: "/portal/account/mfa",
    });
  }

  return children;
}
