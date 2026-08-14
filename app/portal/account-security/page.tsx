import { redirect } from "next/navigation";
import { getPortalLesseeSession } from "@/utils/lessee-portal-auth";
import PortalShell from "../portal-shell";
import PortalChangePasswordForm from "./change-password-form";
import PushNotificationsSettings from "@/components/push-notifications-settings";
import { portalPageGreetingClassName } from "@/components/portal-header-brand";

export const dynamic = "force-dynamic";

export default async function PortalAccountSecurityPage() {
  const session = await getPortalLesseeSession();
  if (!session) {
    redirect("/portal/login");
  }

  return (
    <PortalShell fullName={session.fullName} photoUrl={session.photoUrl}>
      <h1 className={portalPageGreetingClassName}>Account security</h1>
      <div className="mt-6 space-y-6">
        <PushNotificationsSettings persona="lessee" />
        <PortalChangePasswordForm />
      </div>
    </PortalShell>
  );
}
