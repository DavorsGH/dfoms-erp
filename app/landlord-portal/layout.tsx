import {
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
import { getPlatformOnlyMonthlyBillingPastDueBanner } from "@/utils/platform-only-unit-monthly-billing";
import { createAdminClient } from "@/utils/supabase/admin";
import { ensureSecurityNotifications } from "@/utils/security-notifications";
import PlatformUnitBillingPastDueBanner from "./platform-unit-billing-past-due-banner";
import PortalLayoutClient from "./portal-layout-client";

export const dynamic = "force-dynamic";
export const fetchCache = "default-no-store";

export default async function LandlordPortalLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getLandlordPortalSession();

  if (session) {
    await ensureSecurityNotifications({
      authUid: session.authUserId,
      persona: "landlord",
      tenantId: session.tenantId,
      passwordActionUrl: "/landlord-portal/administration/account-security",
      mfaActionUrl: "/landlord-portal/administration/account-security/mfa",
    });
  }

  let billingPastDueBanner: React.ReactNode = null;
  if (
    session &&
    session.landlordType === "platform_only" &&
    landlordPortalHasDataAccess(session)
  ) {
    const admin = createAdminClient();
    const banner = await getPlatformOnlyMonthlyBillingPastDueBanner(
      admin,
      session.tenantId,
    );
    if (banner?.show) {
      billingPastDueBanner = (
        <PlatformUnitBillingPastDueBanner banner={banner} />
      );
    }
  }

  return (
    <PortalLayoutClient
      userLabel={session?.fullName ?? null}
      userPhotoUrl={session?.logoUrl ?? null}
      landlordType={session?.landlordType ?? null}
      hasDataAccess={session ? landlordPortalHasDataAccess(session) : false}
      isAuthenticatedLandlord={Boolean(session)}
      billingPastDueBanner={billingPastDueBanner}
    >
      {children}
    </PortalLayoutClient>
  );
}
