import Link from "next/link";
import { redirect } from "next/navigation";
import { getPortalLesseeSession } from "@/utils/lessee-portal-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import PushNotificationsSettings from "@/components/push-notifications-settings";
import { portalPageGreetingClassName } from "@/components/portal-header-brand";
import PortalShell from "../portal-shell";
import {
  portalPrimaryButtonClassName,
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../portal-ui";
import PortalAccountChangePasswordForm from "./change-password-form";

export const dynamic = "force-dynamic";

export default async function PortalAccountPage() {
  const session = await getPortalLesseeSession();
  if (!session) {
    redirect("/portal/login");
  }

  const admin = createAdminClient();
  const { data: lessee } = await admin
    .from("lessees")
    .select("phone, email")
    .eq("tenant_id", session.tenantId)
    .eq("lessee_id", session.lesseeId)
    .maybeSingle();

  const contactPhone =
    typeof lessee?.phone === "string" && lessee.phone.trim()
      ? lessee.phone.trim()
      : "—";
  const contactEmail =
    session.email ??
    (typeof lessee?.email === "string" && lessee.email.trim()
      ? lessee.email.trim()
      : "—");

  return (
    <PortalShell fullName={session.fullName} photoUrl={session.photoUrl}>
      <h1 className={portalPageGreetingClassName}>My Account</h1>

      <div className="mt-6 space-y-6">
        <section className={portalSectionClassName}>
          <h2 className={portalSectionTitleClassName}>Profile</h2>
          <dl className="mt-4 grid max-w-md gap-4 text-sm">
            <div>
              <dt className="font-medium text-slate-500">Name</dt>
              <dd className="mt-1 text-slate-900">{session.fullName}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-500">Login email</dt>
              <dd className="mt-1 text-slate-900">{contactEmail}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-500">Contact phone</dt>
              <dd className="mt-1 text-slate-900">{contactPhone}</dd>
            </div>
          </dl>
          <p className="mt-4 text-sm text-slate-600">
            Contact details are managed by your landlord. Ask them to update your
            record if anything is incorrect.
          </p>
        </section>

        <PushNotificationsSettings persona="lessee" />

        <section className={portalSectionClassName}>
          <h2 className={portalSectionTitleClassName}>
            Two-factor authentication
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Optional extra protection for your Tenant Portal sign-in.
          </p>
          <Link href="/portal/account/mfa" className={`mt-4 inline-flex ${portalPrimaryButtonClassName}`}>
            Manage two-factor settings
          </Link>
        </section>

        <PortalAccountChangePasswordForm />
      </div>
    </PortalShell>
  );
}
