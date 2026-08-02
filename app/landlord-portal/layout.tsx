import {
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
import PortalLayoutClient from "./portal-layout-client";

export const dynamic = "force-dynamic";
export const fetchCache = "default-no-store";

export default async function LandlordPortalLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getLandlordPortalSession();

  return (
    <PortalLayoutClient
      userLabel={session?.fullName ?? null}
      landlordType={session?.landlordType ?? null}
      hasDataAccess={session ? landlordPortalHasDataAccess(session) : false}
      isAuthenticatedLandlord={Boolean(session)}
    >
      {children}
    </PortalLayoutClient>
  );
}
