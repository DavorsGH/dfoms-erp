import AssistantChatWidget from "@/components/ai-assistant/assistant-chat-widget";
import { getFacilityManagerSession } from "@/utils/facility-portal-auth";
import { getFacilityPortalNavLinks } from "./portal-nav-config";
import PortalLayoutClient from "./portal-layout-client";

export const dynamic = "force-dynamic";
export const fetchCache = "default-no-store";

export default async function FacilityPortalLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getFacilityManagerSession();
  const links = session ? getFacilityPortalNavLinks(session) : [];

  return (
    <PortalLayoutClient
      userLabel={session?.fullName ?? null}
      links={links}
      isAuthenticated={Boolean(session)}
    >
      {children}
      {session ? <AssistantChatWidget /> : null}
    </PortalLayoutClient>
  );
}
