import Link from "next/link";
import { redirect } from "next/navigation";
import { getMfaSettingsForCurrentUser } from "@/lib/mfa/enrollment-actions";
import { getPortalLesseeSession } from "@/utils/lessee-portal-auth";
import { portalPageGreetingClassName } from "@/components/portal-header-brand";
import PortalShell from "../../portal-shell";
import {
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../../portal-ui";
import PortalMfaSettingsClient from "./mfa-settings-client";

export const dynamic = "force-dynamic";

export default async function PortalAccountMfaPage() {
  const session = await getPortalLesseeSession();
  if (!session) {
    redirect("/portal/login");
  }

  const settings = await getMfaSettingsForCurrentUser("lessee");

  return (
    <PortalShell fullName={session.fullName} photoUrl={session.photoUrl}>
      <Link
        href="/portal/account"
        className="text-sm text-slate-500 underline hover:text-slate-800"
      >
        ← Back to My Account
      </Link>
      <h1 className={`${portalPageGreetingClassName} mt-2`}>
        Two-factor authentication
      </h1>
      <p className="mt-1 text-sm text-slate-600">
        Optional extra sign-in protection for the Tenant Portal.
      </p>
      <section className={`${portalSectionClassName} mt-6`}>
        <PortalMfaSettingsClient initialSettings={settings} />
      </section>
    </PortalShell>
  );
}
